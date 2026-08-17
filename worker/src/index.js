// scraper.py'daki bülten çekme/eşleştirme mantığının Cloudflare Worker portu.
// Amaç: tarayıcının CORS engeline takılmadan Nesine'den canlı veri çekip
// data/odds.json ile aynı şemada JSON dönmek, edge'de 60sn cache'leyerek
// yoğun "Yenile" trafiğinde bile Nesine'ye dakikada 1'den fazla istek gitmesini önlemek.

import gecmisData from "../../data/historical_stats.json";
import indexHtml from "../../index.html";

const BULTEN_URL = "https://cdnbulten.nesine.com/api/bulten/getprebultenfull";
const LIVE_BULTEN_URL = "https://bulten.nesine.com/api/bulten/getlivebultenv3?eventVersion=0&oddVersion=0";
const LIVE_SCORE_URL = "https://ls.nesine.com/api/v2/Bet/GetLiveBetResultsWithVersion?v=0";
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

// Bir etkinliğin MA (market) listesinden KG tahmin alanlarını (msKg, altUst6,
// iymsKg, onerilen, tutma, toplam, tutmaOrani, guven) çıkarır. Hem ön-maç hem
// canlı (henüz ön-bültenden düşmemiş, donmuş oranlı) maçlarda ortak kullanılır.
function tahminAlanlariCikar(ma) {
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

  return { msKg, altUst6, iymsKg, onerilen, tutma, toplam, tutmaOrani, guven };
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

    maclar.push({
      id: String(e.C ?? ""),
      lig: ligAdiBul(ligler, e.LC),
      evSahibi,
      deplasman,
      macZamani: toIstanbulIso(macZamaniDate),
      ...tahminAlanlariCikar(e.MA || []),
    });
  }

  maclar.sort((a, b) => a.macZamani.localeCompare(b.macZamani));
  return maclar;
}

async function canliBultenCek() {
  const resp = await fetch(LIVE_BULTEN_URL, { headers: HEADERS });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  return resp.json();
}

async function canliSkorCek() {
  const resp = await fetch(LIVE_SCORE_URL, { headers: HEADERS });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  return resp.json();
}

// Nesine'nin MDT alanındaki devre başlangıç/bitiş zaman damgalarını T koduna göre eşler:
// 1=ilk yarı başlangıcı, 2=devre arası başlangıcı, 3=ikinci yarı başlangıcı, 4=maç sonu.
function mdtZamanlari(kayit) {
  const zamanlar = {};
  for (const m of kayit.MDT || []) {
    if (!m.value) continue;
    const d = new Date(m.value);
    if (!isNaN(d.getTime())) zamanlar[m.T] = d;
  }
  return zamanlar;
}

// Canlı skor kaydından oynanan dakikayı (veya devre arası/maç sonu gibi durumu)
// çıkarır. Maç henüz başlamamışsa veya bitmişse null döner.
function dakikaHesapla(kayit, simdiMs) {
  const st = (kayit.ST || "").trim();
  if (st === "MS") return null;
  const z = mdtZamanlari(kayit);
  const t1 = z[1], t2 = z[2], t3 = z[3], t4 = z[4];

  if (t4) return null;
  if (t3) {
    const dakika = 45 + Math.floor((simdiMs - t3.getTime()) / 60000) + 1;
    return Math.min(dakika, 120) + "'";
  }
  if (t2) return "Devre Arası";
  if (t1) {
    const dakika = Math.floor((simdiMs - t1.getTime()) / 60000) + 1;
    return Math.min(dakika, 45) + "'";
  }
  if (st && st !== "Başlamadı.") return st; // futbol dışı / standart olmayan durum metni
  return null;
}

function canliSkorHesapla(kayit) {
  let toplamEv = 0, toplamDep = 0, goruldu = false;
  for (const es of kayit.ES || []) {
    if (es.T === 1 || es.T === 2 || es.T === 3) {
      const h = Number(es.H ?? 0), a = Number(es.A ?? 0);
      if (Number.isFinite(h) && Number.isFinite(a)) {
        toplamEv += h; toplamDep += a; goruldu = true;
      }
    }
  }
  return goruldu ? [toplamEv, toplamDep] : [null, null];
}

function canliMaclariIsle(canliBultenVerisi, canliSkorVerisi) {
  const sg = canliBultenVerisi.sg || {};
  const etkinlikler = sg.EA || [];
  const ligler = sg.LA || [];
  const simdiMs = Date.now();

  const skorMap = new Map();
  for (const kayit of (canliSkorVerisi && canliSkorVerisi.d) || []) {
    const c = kayit.C ?? kayit.NID;
    if (c != null) skorMap.set(c, kayit);
  }

  const maclar = [];
  for (const e of etkinlikler) {
    if (e.GT !== 1) continue; // sadece futbol

    const skorKayit = skorMap.get(e.C);
    if (!skorKayit) continue;

    const dakika = dakikaHesapla(skorKayit, simdiMs);
    if (dakika == null) continue; // henüz başlamamış ya da bitmiş

    const evSahibi = String(e.HN ?? "").trim();
    const deplasman = String(e.AN ?? "").trim();
    if (!evSahibi || !deplasman) continue;

    const macZamaniDate = esdToDate(e.ESD);

    const [skorEv, skorDep] = canliSkorHesapla(skorKayit);

    maclar.push({
      id: String(e.C ?? ""),
      lig: ligAdiBul(ligler, e.LC),
      evSahibi,
      deplasman,
      macZamani: macZamaniDate ? toIstanbulIso(macZamaniDate) : null,
      dakika,
      skorEv,
      skorDep,
    });
  }

  maclar.sort((a, b) => (b.macZamani || "").localeCompare(a.macZamani || "")); // yeni başlayan üstte
  return maclar;
}

// Canlı bültende KG/6+Gol/İY-MS-KG marketleri hiç sunulmuyor (Nesine'nin
// in-play market kataloğunda yoklar). Bu yüzden her maçın başlamasından
// hemen önceki son ön-maç oranı `snapshotAlVeYaz` tarafından KV'ye yazılır;
// burada o donmuş anlık görüntü okunup maça eklenir ve aynı geçmiş-veri
// tablosuyla Kesin/Olası hesaplanır.
async function canliyaTahminEkle(maclar, env) {
  const bosTahmin = {
    msKg: null, altUst6: null, iymsKg: null,
    onerilen: false, tutma: null, toplam: null, tutmaOrani: null, guven: null,
    tahminZamani: null,
  };
  return Promise.all(maclar.map(async (m) => {
    if (!env || !env.KG_SNAPSHOTS) return { ...m, ...bosTahmin };
    try {
      const ham = await env.KG_SNAPSHOTS.get(m.id);
      if (!ham) return { ...m, ...bosTahmin };
      const anlik = JSON.parse(ham);
      return {
        ...m,
        msKg: anlik.msKg, altUst6: anlik.altUst6, iymsKg: anlik.iymsKg,
        onerilen: anlik.onerilen, tutma: anlik.tutma, toplam: anlik.toplam,
        tutmaOrani: anlik.tutmaOrani, guven: anlik.guven,
        tahminZamani: anlik.tahminZamani || null,
      };
    } catch (err) {
      return { ...m, ...bosTahmin };
    }
  }));
}

// Her dakika (bkz. wrangler.toml [triggers]) çalışır: ön-maç bültenini çekip
// kickoff'a 2 dakikadan az kalmış (ya da yeni başlamış) maçların o anki
// KG/6+Gol/İY-MS-KG oranlarını KV'ye yazar — canlıya geçtiklerinde bu
// "maç öncesi son oran" anlık görüntüsü kullanılabilsin diye.
async function snapshotAlVeYaz(env) {
  if (!env || !env.KG_SNAPSHOTS) return;
  let veri;
  try {
    veri = await bultenCek();
  } catch (err) {
    return; // sessizce vazgeç, bir dakika sonra tekrar denenecek
  }
  const maclar = maclariIsle(veri);
  const simdiMs = Date.now();

  const yazmalar = [];
  for (const m of maclar) {
    if (m.msKg == null && m.altUst6 == null && m.iymsKg == null) continue; // hiç market yoksa saklamaya değmez
    const macMs = new Date(m.macZamani).getTime();
    if (!Number.isFinite(macMs)) continue;
    const kalanDk = (macMs - simdiMs) / 60000;
    if (kalanDk < 0 || kalanDk > 2) continue; // sadece kickoff'a en fazla 2 dk kalan maçlar
    const kayit = { ...m, tahminZamani: toIstanbulIso(new Date()) };
    yazmalar.push(env.KG_SNAPSHOTS.put(m.id, JSON.stringify(kayit), { expirationTtl: 6 * 3600 }));
  }
  await Promise.all(yazmalar);
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

    const pathname = new URL(request.url).pathname;

    // Statik site: aynı worker hem sayfayı hem veri API'sini sunar (tek domain,
    // tek deploy — Cloudflare Pages'e ayrıca ihtiyaç yok).
    if (pathname === "/" || pathname === "/index.html") {
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (pathname !== "/api/bulten" && pathname !== "/api/canli") {
      return new Response("Not found", { status: 404 });
    }

    const canliMi = pathname === "/api/canli";
    const cacheSaniye = canliMi ? 30 : 60; // canlı maçlarda dakika/skor daha sık değiştiği için daha kısa TTL

    const cache = caches.default;
    const cacheKey = new Request(
      new URL(request.url).origin + (canliMi ? "/kg-tahmin-canli" : "/kg-tahmin-odds"),
      request
    );

    const cached = await cache.match(cacheKey);
    if (cached) {
      const body = await cached.text();
      return jsonResponse(JSON.parse(body), 200, { "X-Cache": "HIT" });
    }

    let cikti;
    try {
      if (canliMi) {
        const [canliBulten, canliSkorVerisi] = await Promise.all([canliBultenCek(), canliSkorCek()]);
        const hamMaclar = canliMaclariIsle(canliBulten, canliSkorVerisi);
        const maclar = await canliyaTahminEkle(hamMaclar, env);
        cikti = { guncellemeZamani: toIstanbulIso(new Date()), macSayisi: maclar.length, maclar };
      } else {
        const veri = await bultenCek();
        const maclar = maclariIsle(veri);
        cikti = { guncellemeZamani: toIstanbulIso(new Date()), macSayisi: maclar.length, maclar };
      }
    } catch (err) {
      return jsonResponse({ hata: String(err && err.message ? err.message : err) }, 502);
    }

    const response = new Response(JSON.stringify(cikti), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=" + cacheSaniye,
        ...CORS_HEADERS,
      },
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(snapshotAlVeYaz(env));
  },
};
