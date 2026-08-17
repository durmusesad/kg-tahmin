// scraper.py'daki bülten çekme/eşleştirme mantığının Cloudflare Worker portu.
// Amaç: tarayıcının CORS engeline takılmadan Nesine'den canlı veri çekip
// data/odds.json ile aynı şemada JSON dönmek, edge'de 60sn cache'leyerek
// yoğun "Yenile" trafiğinde bile Nesine'ye dakikada 1'den fazla istek gitmesini önlemek.

import gecmisData from "../../data/historical_stats.json";

const BULTEN_URL = "https://cdnbulten.nesine.com/api/bulten/getprebultenfull";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const gecmis = gecmisData.ciftler || {};

function ligAdiBul(ligler, lc) {
  const lcStr = String(lc ?? "");
  for (const lig of ligler) {
    if (String(lig.LID ?? "") === lcStr) return lig.N || "Bilinmiyor";
  }
  return "Bilinmiyor";
}

function esdToDate(esdMs) {
  const n = Number(esdMs);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n);
  return isNaN(d.getTime()) ? null : d;
}

function oranBul(maListesi, mtid, sov, n) {
  for (const market of maListesi || []) {
    if (market.MTID !== mtid) continue;
    if (Number(market.SOV ?? 0) !== sov) continue;
    for (const opsiyon of market.OCA || []) {
      if (opsiyon.N === n) {
        const oran = Number(opsiyon.O ?? 0);
        if (!Number.isFinite(oran)) return null;
        return oran > 1.0 ? oran : null;
      }
    }
  }
  return null;
}

// Türkiye 2016'dan beri kalıcı UTC+3'te (DST yok), Python'daki
// zoneinfo("Europe/Istanbul") ile eşdeğer sabit ofset kullanılabilir.
function toIstanbulIso(date) {
  const ist = new Date(date.getTime() + 3 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())}` +
    `T${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}+03:00`
  );
}

async function bultenCek() {
  const resp = await fetch(BULTEN_URL, { headers: HEADERS });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  return resp.json();
}

function maclariIsle(veri) {
  const sg = veri.sg || {};
  const etkinlikler = sg.EA || [];
  const ligler = sg.LA || [];
  const simdi = Date.now();

  const maclar = [];
  for (const e of etkinlikler) {
    if (e.GT !== 1) continue;

    const evSahibi = String(e.HN ?? "").trim();
    const deplasman = String(e.AN ?? "").trim();
    if (!evSahibi || !deplasman) continue;

    const macZamaniDate = esdToDate(e.ESD);
    if (!macZamaniDate || macZamaniDate.getTime() < simdi) continue;

    const ma = e.MA || [];
    const msKg = oranBul(ma, 38, 0.0, 1);
    const altUst6 = oranBul(ma, 43, 0.0, 4);
    const iymsKg = oranBul(ma, 801, 0.0, 3);

    let onerilen = false;
    let tutma = null;
    let toplam = null;
    let tutmaOrani = null;
    let guven = null;

    if (iymsKg !== null && altUst6 !== null) {
      const ciftAnahtari = `${Math.floor(iymsKg)},${Math.floor(altUst6)}`;
      const istatistik = gecmis[ciftAnahtari];
      if (istatistik) {
        tutma = istatistik.tutma;
        toplam = istatistik.toplam;
        tutmaOrani = tutma / toplam;
        onerilen = true;
        guven = toplam >= 3 && tutmaOrani === 1.0 ? "kesin" : "olasi";
      }
    }

    maclar.push({
      id: String(e.C ?? ""),
      lig: ligAdiBul(ligler, e.LC),
      evSahibi,
      deplasman,
      macZamani: toIstanbulIso(macZamaniDate),
      msKg,
      altUst6,
      iymsKg,
      onerilen,
      tutma,
      toplam,
      tutmaOrani,
      guven,
    });
  }

  maclar.sort((a, b) => a.macZamani.localeCompare(b.macZamani));
  return maclar;
}

function jsonResponse(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...(extraHeaders || {}),
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).origin + "/kg-tahmin-odds", request);

    const cached = await cache.match(cacheKey);
    if (cached) {
      const body = await cached.text();
      return jsonResponse(JSON.parse(body), 200, { "X-Cache": "HIT" });
    }

    let maclar = [];
    try {
      const veri = await bultenCek();
      maclar = maclariIsle(veri);
    } catch (err) {
      return jsonResponse({ hata: String(err && err.message ? err.message : err) }, 502);
    }

    const cikti = {
      guncellemeZamani: toIstanbulIso(new Date()),
      macSayisi: maclar.length,
      maclar,
    };

    const response = new Response(JSON.stringify(cikti), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
        ...CORS_HEADERS,
      },
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
