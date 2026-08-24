// scraper.py'daki bülten çekme/eşleştirme mantığının Cloudflare Worker portu.
// Amaç: tarayıcının CORS engeline takılmadan Nesine'den canlı veri çekip
// data/odds.json ile aynı şemada JSON dönmek, edge'de 60sn cache'leyerek
// yoğun "Yenile" trafiğinde bile Nesine'ye dakikada 1'den fazla istek gitmesini önlemek.

import gecmisData from "../../data/historical_stats.json";
import indexHtml from "../../index.html";

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

// Nesine bülteni tek çekimde 100+ lig ve 100+ maç içerebiliyor; her maç için
// lig dizisinde baştan tarama yapmak (O(maç×lig)) CPU'yu gereksiz yere
// zorluyor. Bunun yerine LID -> isim haritası bir kez kurulup O(1) ile
// aranıyor (bkz. ligHaritasiOlustur, maclariIsle/canliMaclariIsle'da
// döngüden önce bir kez çağrılır).
function ligHaritasiOlustur(ligler) {
  const harita = new Map();
  for (const lig of ligler || []) {
    harita.set(String(lig.LID ?? ""), lig.N || "Bilinmiyor");
  }
  return harita;
}

function ligAdiBul(ligHaritasi, lc) {
  return ligHaritasi.get(String(lc ?? "")) || "Bilinmiyor";
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

// oranBul'un canlı-maç versiyonu: O==1.0'ı "askıya alınmış/geçersiz" saymaz,
// çünkü canlıda bir taraf zaten kesin öndeyse (ör. 3 farkla) Nesine o seçeneği
// gerçekten 1.00 fiyatlar — bu geçerli bir "kesinleşmiş" fiyattır, pre-match'te
// hemen hemen hiç görülmeyen ama canlıda normal olan bir durum. Sadece market/
// seçenek bültende hiç yoksa ya da sayısal değilse null döner.
function canliOranBul(maListesi, mtid, sov, n) {
  for (const market of maListesi || []) {
    if (market.MTID !== mtid) continue;
    if (Number(market.SOV ?? 0) !== sov) continue;
    for (const opsiyon of market.OCA || []) {
      if (opsiyon.N === n) {
        const oran = Number(opsiyon.O ?? 0);
        return Number.isFinite(oran) && oran >= 1.0 ? oran : null;
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

// ============================================================
// BÜLTEN PUSH (kırmızı bot -> Worker), 2026-08-22
// Nesine'nin ~7-8MB'lık getprebultenfull JSON'unu Worker'ın kendisi ARTIK
// ÇEKMİYOR — Cloudflare Workers free plan'ın istek/cron-tick başına 10ms
// CPU süresi limitine takılıyordu (sadece JSON.parse ~30ms sürüyor). Bunun
// yerine kırmızı bot (DigitalOcean, CPU süresi sınırı yok) bülteni çekip
// futbol maçlarını (id, lig, evSahibi, deplasman, macZamani, msKg, altUst6,
// iymsKg) çıkarıp her 60sn'de POST /api/bulten-guncelle ile buraya gönderir;
// biz KV'ye yazıp hem GET /api/bulten'de hem cron'daki snapshot/havuz/günlük
// bülten mantığında oradan okuruz. guven (Kesin/Olası) hesaplaması (küçük
// veri üzerinde ucuz) burada, guvenHesapla() ile yapılır.
const BULTEN_KV_ANAHTARI = "bulten:guncel";
const BULTEN_MAX_YAS_MS = 15 * 60 * 1000;
// 2026-08-24: Kırmızı bot da (kg_bulten_pusher.py) artık TR 03:00-09:00
// arası uyuyor (KV günlük 1000 yazma kotasını aşmamak için — bkz. proje
// notu). O pencerede yeni push gelmeyeceği için 15dk'lık normal tazelik
// eşiği aşılır ve /api/bulten hataya düşerdi. Bu saatlerde eşik genişletilip
// son bilinen (biraz bayat ama var olan) veri gösterilmeye devam edilir —
// zaten o saatte oran neredeyse hiç değişmiyor. Aktif saatlerde (09:00-03:00)
// eşik değişmedi: gerçek bir arıza olursa hâlâ hızlıca fark edilsin diye.
const BULTEN_MAX_YAS_UYKU_MS = 7 * 3600 * 1000;

function trUykuSaatiMi(simdiMs) {
  const trSaat = (new Date(simdiMs).getUTCHours() + 3) % 24; // TR sabit UTC+3, DST yok
  return trSaat >= 3 && trSaat < 9;
}

async function bultenGuncelleIsle(request, env) {
  const anahtar = request.headers.get("X-Bulten-Key");
  if (!env.BULTEN_ANAHTARI || anahtar !== env.BULTEN_ANAHTARI) {
    return jsonResponse({ hata: "yetkisiz" }, 401);
  }
  let govde;
  try {
    govde = await request.json();
  } catch (err) {
    return jsonResponse({ hata: "gecersiz govde" }, 400);
  }
  const maclar = govde && govde.maclar;
  if (!Array.isArray(maclar)) {
    return jsonResponse({ hata: "maclar dizisi zorunlu" }, 400);
  }
  if (maclar.length > 5000) {
    return jsonResponse({ hata: "mac sayisi cok fazla" }, 400);
  }
  const kayit = {
    guncellemeZamani: govde.guncellemeZamani || toIstanbulIso(new Date()),
    alinmaZamaniMs: Date.now(),
    maclar,
  };
  if (!env.KG_SNAPSHOTS) return jsonResponse({ hata: "KV yapilandirilmamis" }, 500);
  await env.KG_SNAPSHOTS.put(BULTEN_KV_ANAHTARI, JSON.stringify(kayit));
  return jsonResponse({ alindi: true, macSayisi: maclar.length });
}

// KV'den kırmızı bot'un pushladığı en güncel maç listesini okur. Veri hiç
// yoksa ya da 15dk'dan eskiyse null döner (bulten:guncel bayat/kayıp demek).
async function guncelMaclariAl(env) {
  if (!env.KG_SNAPSHOTS) return null;
  let ham;
  try {
    ham = await env.KG_SNAPSHOTS.get(BULTEN_KV_ANAHTARI);
  } catch (err) {
    return null;
  }
  if (!ham) return null;
  let kayit;
  try {
    kayit = JSON.parse(ham);
  } catch (err) {
    return null;
  }
  const simdiMs = Date.now();
  const esikMs = trUykuSaatiMi(simdiMs) ? BULTEN_MAX_YAS_UYKU_MS : BULTEN_MAX_YAS_MS;
  if (simdiMs - (kayit.alinmaZamaniMs || 0) > esikMs) return null;
  return { maclar: kayit.maclar || [], guncellemeZamani: kayit.guncellemeZamani };
}

// KG/6+Gol/İY-MS-KG oranlarından (zaten çıkarılmış) güven sınıflandırmasını
// hesaplar — hem kırmızı bot'tan gelen ham oranlar hem de (canlı sekmesinde
// hâlâ kullanılan) MA dizisinden çıkarılan oranlar için ortak kullanılır.
//
// 2026-08-24: "Kesin" artık SADECE kombinasyon geçmişine değil, lig'e de
// bakıyor. Sebep: 13 izinli lig dışındaki maçlarda kombinasyon arşivi %100
// tutsa bile gerçekte tutma oranı düşük (kullanıcı gözlemi) — havuz zaten
// sadece bu 13 ligden besleniyor (bkz. ligIzinliMi), yani arşivin kendisi de
// bu liglere göre kurulu; onun dışındaki bir maça aynı arşivi uygulamak
// yanıltıcı. Lig 13'ün dışındaysa kombinasyon ne kadar iyi olursa olsun en
// fazla "olasi" verilir.
function guvenHesapla(msKg, altUst6, iymsKg, lig) {
  let onerilen = false;
  let tutma = null;
  let toplam = null;
  let tutmaOrani = null;
  let guven = null;
  let ligUygun = null;
  if (iymsKg !== null && altUst6 !== null) {
    const ciftAnahtari = `${Math.floor(iymsKg)},${Math.floor(altUst6)}`;
    const istatistik = gecmis[ciftAnahtari];
    if (istatistik) {
      tutma = istatistik.tutma;
      toplam = istatistik.toplam;
      tutmaOrani = tutma / toplam;
      onerilen = true;
      ligUygun = ligIzinliMi(lig);
      guven = ligUygun && toplam >= 3 && tutmaOrani === 1.0 ? "kesin" : "olasi";
    }
  }
  return { msKg, altUst6, iymsKg, onerilen, tutma, toplam, tutmaOrani, guven, ligUygun };
}

// NOT (2026-08-22): Nesine'nin canlı uç noktaları ara sıra ciddi şekilde
// yavaşlıyor/tıkanıyor (gözlemlendi: getlivebultenv3 header'ları hızlı dönüp
// gövdeyi hiç akıtmaması — bağlantı açık kalıyor, veri gelmiyor). fetch()'in
// kendisinde hiç zaman aşımı yoktu — Worker isteği SONSUZA KADAR bekliyordu.
// ÖNEMLİ: AbortController'ın signal'i sadece `fetch()` çağrısını değil,
// `resp.json()` (gövdeyi okuma) aşamasını da kapsamalı — ilk denemede
// clearTimeout'u fetch() resolve olur olmaz (header geldiğinde) çağırmıştım,
// bu da gövde okuma aşamasını korumasız bırakıp aynı sonsuz-bekleme hatasını
// tekrarlıyordu. Şimdi tek fonksiyon, tek controller: 8sn'lik üst sınır
// fetch+parse'ın TAMAMINI kapsıyor.
const FETCH_ZAMAN_ASIMI_MS = 8000;

async function zamanAsimliJsonFetch(url, opts) {
  const controller = new AbortController();
  const zamanlayici = setTimeout(() => controller.abort(), FETCH_ZAMAN_ASIMI_MS);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.json();
  } finally {
    clearTimeout(zamanlayici);
  }
}

async function canliBultenCek() {
  return zamanAsimliJsonFetch(LIVE_BULTEN_URL, { headers: HEADERS });
}

async function canliSkorCek() {
  return zamanAsimliJsonFetch(LIVE_SCORE_URL, { headers: HEADERS });
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

// DÜZELTME (2026-08-22): Nesine'nin canlı skor feed'indeki ES alanı, gerçek
// veriyle ölçülerek doğrulandı — T=1/2/3 BİRBİRİNİN TOPLANACAĞI parçalar
// DEĞİL, aynı skorun farklı "an"lardaki kopyaları:
//   T=1: o ana kadarki/nihai TOPLAM skor (canlı günceller, maç bitince nihai kalır)
//   T=2: sadece ilk yarı bitince beliren, bir daha değişmeyen İY skoru
//   T=3: ikinci yarı bitince beliren, T=1 ile AYNI (nihai) skor
// Eski kod bunları TOPLUYORDU (T1+T2+T3) — bu, biten bir maçta gerçek skoru
// 2-3 katına çıkarıyordu (ör. gerçek 0:4 → kaydedilen 0:11 gibi saçma
// sonuçlar; "kişisel veri havuzu"nda görülen anomalinin kök nedeni buydu).
// Artık MS (nihai/güncel) skor için sadece T=1 okunuyor, toplama yok.
function canliSkorHesapla(kayit) {
  for (const es of kayit.ES || []) {
    if (es.T === 1) {
      const h = Number(es.H ?? 0), a = Number(es.A ?? 0);
      if (Number.isFinite(h) && Number.isFinite(a)) return [h, a];
    }
  }
  return [null, null];
}

// İlk yarı (İY) skoru için T=2 okunur — T=1 DEĞİL (T=1 güncel/nihai toplam
// skordur, İY değil; eski kod yanlışlıkla T=1'i "İY" sanıyordu). Maç henüz
// ilk yarıyı bitirmediyse (T=2 hiç yoksa) [null, null] döner.
function ilkYariSkorHesapla(kayit) {
  for (const es of kayit.ES || []) {
    if (es.T === 2) {
      const h = Number(es.H ?? 0), a = Number(es.A ?? 0);
      if (Number.isFinite(h) && Number.isFinite(a)) return [h, a];
    }
  }
  return [null, null];
}

function canliMaclariIsle(canliBultenVerisi, canliSkorVerisi) {
  const sg = canliBultenVerisi.sg || {};
  const etkinlikler = sg.EA || [];
  const ligHaritasi = ligHaritasiOlustur(sg.LA || []);
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
      lig: ligAdiBul(ligHaritasi, e.LC),
      evSahibi,
      deplasman,
      macZamani: macZamaniDate ? toIstanbulIso(macZamaniDate) : null,
      dakika,
      skorEv,
      skorDep,
      // Nesine canlıda "Karşılıklı Gol" marketini ön-maçtakinden (MTID 38)
      // FARKLI bir kod altında (MTID 287) sunuyor — 6+ Gol ve İY/MS KG'nin
      // aksine bunun gerçek bir canlı karşılığı var, doğrulandı. Bu değer
      // maç boyunca güncel kalır (donmuş snapshot DEĞİL).
      canliMsKg: oranBul(e.MA || [], 287, 0.0, 1),
    });
  }

  maclar.sort((a, b) => (b.macZamani || "").localeCompare(a.macZamani || "")); // yeni başlayan üstte
  return maclar;
}

// Canlı bültende 6+ Gol ve İY/MS KG marketleri hiç sunulmuyor (Nesine'nin
// in-play market kataloğunda yoklar) — bu yüzden Kesin/Olası sınıflandırması
// (bu iki oranın çiftine dayandığından) canlıda hesaplanamaz; her maçın
// başlamasından hemen önceki son ön-maç oranı `snapshotAlVeYaz` tarafından
// KV'ye yazılır, burada o donmuş anlık görüntü okunup maça eklenir ve aynı
// geçmiş-veri tablosuyla Kesin/Olası hesaplanır. (Ayrıntı: bu maçlar zaten
// KESİN etiketini maç öncesi almıştı; sınıflandırma sonradan değişmez.)
// Karşılıklı Gol (MS KG) marketi ise canlıda GERÇEKTEN var (farklı MTID,
// bkz. canliMaclariIsle) — o değer `m.canliMsKg` üzerinden zaten güncel
// geliyor, burada dokunulmuyor/ezilmiyor.
async function canliyaTahminEkle(maclar, env) {
  const bosTahmin = {
    msKg: null, altUst6: null, iymsKg: null,
    onerilen: false, tutma: null, toplam: null, tutmaOrani: null, guven: null, ligUygun: null,
    tahminZamani: null,
  };
  return Promise.all(maclar.map(async (m) => {
    if (!env || !env.KG_SNAPSHOTS) return { ...m, ...bosTahmin, kirmiziSinyal: null };

    let tahminAlanlari = bosTahmin;
    try {
      const ham = await env.KG_SNAPSHOTS.get(m.id);
      if (ham) {
        const anlik = JSON.parse(ham);
        tahminAlanlari = {
          msKg: anlik.msKg, altUst6: anlik.altUst6, iymsKg: anlik.iymsKg,
          onerilen: anlik.onerilen, tutma: anlik.tutma, toplam: anlik.toplam,
          tutmaOrani: anlik.tutmaOrani, guven: anlik.guven, ligUygun: anlik.ligUygun ?? null,
          tahminZamani: anlik.tahminZamani || null,
        };
      }
    } catch (err) { /* bosTahmin ile devam */ }

    let kirmiziSinyal = null;
    try {
      const sinyalHam = await env.KG_SNAPSHOTS.get("sinyal:" + m.id);
      if (sinyalHam) kirmiziSinyal = JSON.parse(sinyalHam);
    } catch (err) { /* sinyal yok say */ }

    return { ...m, ...tahminAlanlari, kirmiziSinyal };
  }));
}

// Kişisel veri havuzuna sadece bu 13 ligden maçlar eklenir — yabancı kupa/
// playoff organizasyonları (ör. "Kazakistan Kupası", "Güney Kore Federasyon
// Kupası") hariç tutulur. Nesine'nin "lig" alanı (bkz. ligAdiBul) sezon
// aşamasına göre sona ek yapabiliyor (ör. "Norveç Eliteserien, Düş./Yük.",
// "Finlandiya Veikkausliiga, Şamp. Gr.") — bu yüzden virgülden önceki kısım
// baz alınıp karşılaştırılıyor. Hollanda Eredivisie, Portekiz Premier Lig ve
// Güney Kore K Lig için Nesine'nin tam yazımı canlı bültenden doğrulanamadı
// (fetch anında bu liglerden maç yoktu); bu üçü daha toleranslı anahtar
// kelime eşleşmesiyle kontrol ediliyor — ilk kayıt oluştuğunda gerçek "lig"
// değeri gözden geçirilip gerekirse ligIzinliMi kesinleştirilmeli.
const IZIN_VERILEN_LIG_TEMEL_ADLARI = new Set([
  "türkiye süper ligi",
  "ingiltere premier lig",
  "ispanya la liga",
  "italya serie a",
  "fransa ligue 1",
  "suudi arabistan pro lig",
  "isveç allsvenskan",
  "norveç eliteserien",
  "finlandiya veikkausliiga",
  "çin süper lig",
]);
const IZIN_VERILEN_LIG_ANAHTAR_KELIMELERI = [
  ["hollanda", "eredivisie"],
  ["portekiz", "premier"],
  ["güney kore", "k lig"],
];

// 2026-08-24: "Hollanda Eredivisie Kadınlar" gibi kadın/altyapı/yedek
// liglerinin ["hollanda","eredivisie"] gibi gevşek anahtar-kelime
// eşleşmesinden (sadece iki kelimenin metinde geçmesine bakıyor, aralarına
// başka kelime girmesini engellemiyordu) sızıp ana veriye yazıldığı görüldü.
// Bu liglerin hiçbiri 13 izinli erkek A takımı ligi değil — isimde bu tür bir
// işaret varsa erken çıkılıp fuzzy eşleşme hiç denenmiyor.
const IZIN_VERILMEYEN_LIG_ISARETLERI = /kad[ıi]n|bayan|women|female|u1[0-9]\b|u2[0-9]\b|rezerv|yedek|b tak[ıi]m/;

function ligIzinliMi(lig) {
  const temel = String(lig || "").split(",")[0].replace(/\s+/g, " ").trim().toLocaleLowerCase("tr");
  if (!temel) return false;
  if (IZIN_VERILMEYEN_LIG_ISARETLERI.test(temel)) return false;
  if (IZIN_VERILEN_LIG_TEMEL_ADLARI.has(temel)) return true;
  return IZIN_VERILEN_LIG_ANAHTAR_KELIMELERI.some(([a, b]) => temel.includes(a) && temel.includes(b));
}

// Kickoff'tan itibaren bir lig maçının (uzatma/penaltı yok) büyük ihtimalle
// bitmiş olacağı süre. havuzGuncelle bir maçı bu süre dolmadan hiç kontrol
// etmez — donmuş maç öncesi oran zaten snapshot'a yazıldığından maçı canlıyken
// dakika dakika izlemenin bir faydası yok.
const MAC_TAHMINI_SURE_MS = 125 * 60 * 1000;

// Her dakika (bkz. wrangler.toml [triggers]) çalışır: kırmızı bot'un push
// ettiği güncel maç listesini (KV, bkz. guncelMaclariAl) okuyup kickoff'a 2
// dakikadan az kalmış (ya da yeni başlamış) maçların o anki KG/6+Gol/
// İY-MS-KG oranlarını KV'ye yazar — canlıya geçtiklerinde bu "maç öncesi son
// oran" anlık görüntüsü kullanılabilsin diye. `maclar` parametresi scheduled()
// tarafından bir kez okunup hem buraya hem gunlukBultenEkle'ye paslanır —
// aynı KV değeri iki kez okunmaz.
async function snapshotAlVeYaz(env, maclar) {
  if (!env || !env.KG_SNAPSHOTS || !maclar) return;
  const simdiMs = Date.now();

  const yazmalar = [];
  const yeniAdaylar = [];
  for (const m of maclar) {
    const tahmin = guvenHesapla(m.msKg, m.altUst6, m.iymsKg, m.lig);
    if (tahmin.msKg == null && tahmin.altUst6 == null && tahmin.iymsKg == null) continue; // hiç market yoksa saklamaya değmez
    const macMs = new Date(m.macZamani).getTime();
    if (!Number.isFinite(macMs)) continue;
    const kalanDk = (macMs - simdiMs) / 60000;
    if (kalanDk < 0 || kalanDk > 2) continue; // sadece kickoff'a en fazla 2 dk kalan maçlar

    // 2026-08-24: Aynı maç kickoff'a 0-2dk'lık pencerede (tick'ler 1dk arayla
    // çalıştığı için) genelde 2 ayrı tick'e denk geliyordu — eskiden HER
    // tick'te tekrar tekrar yazılıyordu. Bu, günlük 1000 KV yazma kotasını
    // zorlayan ana kaynaklardan biriydi (bkz. proje notu). Artık önce zaten
    // donmuş mu diye bakılıyor; varsa bir daha dokunulmuyor (zaten donmuş
    // oranın "değişmemesi" amaçlanıyordu, bu hem doğru hem ucuz).
    yazmalar.push((async () => {
      let mevcut = null;
      try {
        mevcut = await env.KG_SNAPSHOTS.get(m.id);
      } catch (err) { /* okunamadıysa güvenli tarafta kal, yine de yaz */ }
      if (mevcut) return;
      const kayit = { ...m, ...tahmin, tahminZamani: toIstanbulIso(new Date()) };
      try {
        await env.KG_SNAPSHOTS.put(m.id, JSON.stringify(kayit), { expirationTtl: 6 * 3600 });
      } catch (err) { /* sessizce vazgeç, gelecek dakika tekrar denenir */ }
    })());
    // 2026-08-24: "ana veri"ye yazma şartı sadeleştirildi — artık SADECE
    // 13 izinli ligden biri olması yeterli, "Kesin" (guven==="kesin") şartı
    // KALDIRILDI. Amaç: sadece nadir görülen Kesin eşleşmeleri değil, bu
    // liglerdeki HER maçın sonucunu (tutsun/tutmasın) biriktirip veri
    // havuzunu daha sağlıklı büyütmek — günlük bültende zaten uygulanan
    // "hepsini kaydet" felsefesiyle tutarlı.
    if (ligIzinliMi(m.lig)) {
      yeniAdaylar.push({ id: m.id, lig: m.lig, evSahibi: m.evSahibi, deplasman: m.deplasman, macZamani: m.macZamani });
    }
  }
  await Promise.all(yazmalar);
  await havuzBekleyenEkle(env, yeniAdaylar);
}

// Kişisel veri havuzu: izin verilen 13 ligden birinde olan maçları
// havuz:bekleyen listesine ekler — her maça, tahmini bitiş saatini
// (kontrolZamani) de damgalar. havuzGuncelle bir maçı bu saat gelmeden hiç
// sorgulamaz. Id bazlı dedupe ile aynı maç iki kez eklenmez.
async function havuzBekleyenEkle(env, yeniler) {
  if (!env || !env.KG_SNAPSHOTS || !yeniler || yeniler.length === 0) return;
  try {
    const ham = await env.KG_SNAPSHOTS.get("havuz:bekleyen");
    const mevcut = ham ? JSON.parse(ham) : [];
    const idSeti = new Set(mevcut.map((k) => k.id));
    let degisti = false;
    for (const y of yeniler) {
      if (!idSeti.has(y.id)) {
        const macMs = new Date(y.macZamani).getTime();
        mevcut.push({ ...y, kontrolZamani: Number.isFinite(macMs) ? macMs + MAC_TAHMINI_SURE_MS : null });
        idSeti.add(y.id);
        degisti = true;
      }
    }
    if (degisti) {
      await env.KG_SNAPSHOTS.put("havuz:bekleyen", JSON.stringify(mevcut));
    }
  } catch (err) { /* sessizce vazgeç, gelecek dakika tekrar denenir */ }
}

// Her dakika snapshotAlVeYaz'dan sonra çalışır. havuz:bekleyen listesindeki
// (izin verilen 13 ligden) maçları kickoff'tan itibaren dakika dakika
// İZLEMEZ — donmuş maç öncesi oran zaten snapshot'a yazılmış olduğundan, bir
// maçın tahmini bitiş saati (kontrolZamani, bkz. havuzBekleyenEkle) gelmeden ona hiç dokunmaz ve
// canlı skor API'sini çağırmaz. O saat geldiğinde TEK bir kontrol yapılır:
// maç gerçekten bitmişse gerçek sonucu (İY/MS skoru + maç öncesi son oran +
// KG var mı) kg-tahmin'in kendi veri-havuzu sitesiyle (ayrı proje, GitHub'a
// bağlı değil) paylaşılan HAVUZ_KV namespace'ine kalıcı olarak ekler —
// kg-tahmin sitesinde bu veriye public erişim yok. Skor verisi eksik/
// geçersizse ya da maç öncesi oran snapshot'ı bulunamıyorsa o maç sessizce
// atlanır — yarım/hatalı kayıt asla yazılmaz. Mükerrer kayıt engeli (macId
// dedupe) tamamen KG_SNAPSHOTS içinde (havuz:yazilanIdler), paylaşılan
// veriye macId hiç sızmaz.
async function havuzGuncelle(env, canliSkorVerisi) {
  if (!env || !env.KG_SNAPSHOTS || !env.HAVUZ_KV || !canliSkorVerisi) return;

  let bekleyen;
  try {
    const ham = await env.KG_SNAPSHOTS.get("havuz:bekleyen");
    bekleyen = ham ? JSON.parse(ham) : [];
  } catch (err) {
    return;
  }
  if (!Array.isArray(bekleyen) || bekleyen.length === 0) return;

  const simdiMs = Date.now();
  // Tahmini bitiş saati henüz gelmemiş maçlara hiç dokunma.
  const siraGelenler = bekleyen.filter((b) => b.kontrolZamani != null && simdiMs >= b.kontrolZamani);
  if (siraGelenler.length === 0) return;
  const siraGelenSet = new Set(siraGelenler);

  const skorMap = new Map();
  for (const kayit of canliSkorVerisi.d || []) {
    const c = kayit.C ?? kayit.NID;
    if (c != null) skorMap.set(String(c), kayit);
  }

  const kalanlar = bekleyen.filter((b) => !siraGelenSet.has(b)); // sırası gelmeyenler değişmeden kalır
  const tamamlananlar = [];

  for (const bek of siraGelenler) {
    try {
      const skorKayit = skorMap.get(String(bek.id));
      if (!skorKayit) {
        const macMs = new Date(bek.macZamani).getTime();
        if (Number.isFinite(macMs) && simdiMs - macMs > 6 * 3600 * 1000) {
          continue; // kickoff'tan 6 saat geçti, sonuç hiç gelmedi — vazgeç
        }
        kalanlar.push(bek); // canlı bültende yok (gecikme/ertelenme olabilir), tekrar denenecek
        continue;
      }

      const dakika = dakikaHesapla(skorKayit, simdiMs);
      if (dakika !== null) {
        kalanlar.push(bek); // tahmini süreye rağmen hâlâ oynanıyor (uzayan maç), tekrar denenecek
        continue;
      }

      // Maç bitti (dakikaHesapla null döndü) — sonucu hesapla. Skor verisi bu
      // tikte eksik/gecikmeli gelmiş olabilir (Nesine tarafında anlık bir
      // gecikme) — kalıcı olarak vazgeçmek yerine bekleyen listesinde bırakıp
      // gelecek dakika tekrar deneriz; 6 saatlik zaman aşımı zaten kalıcı
      // kaybolan maçları temizliyor.
      const [skorEv, skorDep] = canliSkorHesapla(skorKayit);
      if (!Number.isInteger(skorEv) || !Number.isInteger(skorDep) || skorEv < 0 || skorDep < 0) {
        kalanlar.push(bek);
        continue;
      }

      const snapHam = await env.KG_SNAPSHOTS.get(bek.id);
      if (!snapHam) continue; // maç öncesi son oran snapshot'ı yok, oransız kayıt yazma
      let snap;
      try {
        snap = JSON.parse(snapHam);
      } catch (err) {
        continue;
      }

      const [iyEv, iyDep] = ilkYariSkorHesapla(skorKayit);
      // Kişisel tablo (Excel) İY/MS KG ve 6+ Gol oranlarını küsüratsız (tam
      // sayı) tutuyor — tıpkı tahminAlanlariCikar'ın çift anahtarı için
      // yaptığı gibi (Math.floor). Aynı formata uymak için burada da floor'luyoruz.
      const iymsKgOran = typeof snap.iymsKg === "number" ? Math.floor(snap.iymsKg) : null;
      const altiGolOran = typeof snap.altUst6 === "number" ? Math.floor(snap.altUst6) : null;
      // Paylaşılan veri-havuzu sitesinin gösterdiği alanlarla birebir aynı —
      // macId/evSahibi/deplasman/eklenmeZamani gibi iç muhasebe alanları
      // paylaşılan veriye hiç yazılmaz.
      const kayitYeni = {
        hafta: (bek.macZamani || "").slice(0, 10) || null,
        lig: bek.lig,
        iy: Number.isInteger(iyEv) && Number.isInteger(iyDep) ? `${iyEv}:${iyDep}` : null,
        ms: `${skorEv}:${skorDep}`,
        iymsKgOran,
        altiGolOran,
        kgVar: skorEv > 0 && skorDep > 0,
        eklenmeZamani: toIstanbulIso(new Date()),
      };
      tamamlananlar.push({ bek, kayitYeni });
    } catch (err) {
      kalanlar.push(bek); // bu tick'te işlenemedi, tekrar denenecek
    }
  }

  if (tamamlananlar.length > 0) {
    // İki ayrı yazma adımı VAR: (1) paylaşılan HAVUZ_KV'ye gerçek kayıt,
    // (2) kg-tahmin'in kendi iç "yazıldı" listesi (dedupe). Bunları TEK
    // try/catch'te birleştirmek mükerrer kayda yol açabilir: (1) başarılı
    // olup (2) başarısız olursa, eskiden ikisi de "başarısız" sayılıp maç
    // bekleyen listesine geri konuyordu — gelecek dakika (2) hâlâ eski
    // olduğu için dedupe bunu YENİ sanıp HAVUZ_KV'ye İKİNCİ KEZ yazardı.
    // Şimdi: (1) başarısızsa güvenle geri koy (hiçbir şey yazılmadı);
    // (1) başarılı ama (2) başarısızsa GERİ KOYMA — kayıt zaten yazıldı,
    // sadece iç dedupe listesi bir sonraki başarılı çalışmaya kadar eksik
    // kalır, bu zararsızdır (aynı maç bekleyen listesinde tekrar yok zaten).
    let veriYazildi = false;
    let yazilacaklar = [];
    let yazilanIdler = new Set();
    try {
      const idlerHam = await env.KG_SNAPSHOTS.get("havuz:yazilanIdler");
      yazilanIdler = new Set(idlerHam ? JSON.parse(idlerHam) : []);
      yazilacaklar = tamamlananlar.filter((t) => !yazilanIdler.has(t.bek.id));

      if (yazilacaklar.length > 0) {
        const ham = await env.HAVUZ_KV.get("veri");
        const havuz = ham ? JSON.parse(ham) : [];
        for (const t of yazilacaklar) havuz.push(t.kayitYeni);
        await env.HAVUZ_KV.put("veri", JSON.stringify(havuz));
      }
      veriYazildi = true;
    } catch (err) {
      // HAVUZ_KV'ye (ya da dedupe listesinin okunmasına) yazılamadı — hiçbir
      // şey yazılmadı, güvenle tekrar denenebilir.
      for (const t of tamamlananlar) kalanlar.push(t.bek);
      tamamlananlar.length = 0;
    }

    if (veriYazildi && yazilacaklar.length > 0) {
      try {
        for (const t of yazilacaklar) yazilanIdler.add(t.bek.id);
        await env.KG_SNAPSHOTS.put("havuz:yazilanIdler", JSON.stringify([...yazilanIdler]));
      } catch (err) {
        // Kayıt zaten HAVUZ_KV'ye yazıldı; sadece iç dedupe listesi
        // güncellenemedi. Bilerek bekleyen listesine geri KOYULMUYOR —
        // geri koysak mükerrer kayıt riski doğar.
      }
    }
  }

  try {
    await env.KG_SNAPSHOTS.put("havuz:bekleyen", JSON.stringify(kalanlar));
  } catch (err) { /* sessizce vazgeç, gelecek dakika tekrar denenir */ }
}

// ============================================================
// GÜNLÜK BÜLTEN (2026-08-22, "haftalık" bölümü 2026-08-23'te iptal edilip
// buraya birleştirildi)
// "Ana veri" (yukarıdaki havuzGuncelle) sadece 13 izinli ligden maçları
// takip ediyor (2026-08-24'ten beri "Kesin" şartı yok, tüm sonuçlar
// tutuluyor). Bunun yanına, TÜM liglerden TÜM maçları (lig şartı
// yok, sadece iki oranın da mevcut olması şart) kapsayan KALICI bir "günlük
// bülten" eklendi — adının aksine artık silinmiyor: KG çıksın çıkmasın her
// maçın sonucu + oranları kalıcı olarak tutuluyor, veri havuzu bu şekilde
// büyütülüyor. Veri HAVUZ_KV'de "gunluk" (obje, macId -> kayıt) anahtarında;
// veri-havuzu-drms sitesi "Oynanıyor/Bekliyor" ve "Tamamlanan" olarak iki
// grupta gösterir.
// ============================================================

// snapshotAlVeYaz ile AYNI `maclar` listesi üzerinden (scheduled() bir kez
// okuyup paslar) çalışır: kickoff'a <=2dk kalan (ve henüz dondurulmamış) HER
// futbol maçını (lig şartı yok — "ana veri"den farklı olarak) günlük bültene
// ekler.
async function gunlukBultenEkle(env, maclar) {
  if (!env || !env.HAVUZ_KV || !maclar) return;
  let gunluk;
  try {
    const ham = await env.HAVUZ_KV.get("gunluk");
    gunluk = ham ? JSON.parse(ham) : {};
  } catch (err) {
    return;
  }

  const simdiMs = Date.now();
  let degisti = false;
  for (const m of maclar) {
    const macMs = new Date(m.macZamani).getTime();
    if (!Number.isFinite(macMs)) continue;
    const kalanDk = (macMs - simdiMs) / 60000;
    if (kalanDk < 0 || kalanDk > 2) continue;
    if (gunluk[m.id]) continue; // zaten donduruldu
    // İkisi de yoksa bu maç için cift anahtarı hiç kurulamaz — günlük
    // bültene (dolayısıyla kalıcı veri havuzuna) hiç eklenmesin.
    if (typeof m.iymsKg !== "number" || typeof m.altUst6 !== "number") continue;

    gunluk[m.id] = {
      id: m.id,
      lig: m.lig,
      evSahibi: m.evSahibi,
      deplasman: m.deplasman,
      macZamani: m.macZamani,
      iymsKgOran: typeof m.iymsKg === "number" ? Math.floor(m.iymsKg) : null,
      altiGolOran: typeof m.altUst6 === "number" ? Math.floor(m.altUst6) : null,
      durum: "bekliyor",
      sonuc: null,
      eklenmeZamani: toIstanbulIso(new Date()),
    };
    degisti = true;
  }
  if (degisti) {
    try {
      await env.HAVUZ_KV.put("gunluk", JSON.stringify(gunluk));
    } catch (err) { /* sessizce vazgeç, gelecek dakika tekrar denenir */ }
  }
}

// Her dakika günlük bültendeki maçların durumunu ilerletir:
//   bekliyor  -> kickoff saati geldi                -> oynanıyor
//   oynanıyor -> canlı skor feed'inde ST==="MS" oldu -> tamamlandı
// Tamamlanan kayıtlar KALICI — silinmez, ne olursa olsun (KG var/yok/veri
// yok) veri havuzunda kalır; "haftalık"a ayrıca yazma yok (o bölüm iptal
// edildi, günlük bültenin "tamamlandı" grubu artık aynı işlevi görüyor).
async function gunlukBultenGuncelle(env, canliSkorVerisi) {
  if (!env || !env.HAVUZ_KV) return;
  let gunluk;
  try {
    const ham = await env.HAVUZ_KV.get("gunluk");
    gunluk = ham ? JSON.parse(ham) : {};
  } catch (err) {
    return;
  }
  if (!gunluk || Object.keys(gunluk).length === 0) return;

  const skorMap = new Map();
  if (canliSkorVerisi) {
    for (const kayit of canliSkorVerisi.d || []) {
      const c = kayit.C ?? kayit.NID;
      if (c != null) skorMap.set(String(c), kayit);
    }
  }

  const simdiMs = Date.now();
  let degisti = false;

  for (const [id, kayit] of Object.entries(gunluk)) {
    if (kayit.durum === "tamamlandi") continue; // sonuçlanmış, kalıcı — dokunma

    const macMs = new Date(kayit.macZamani).getTime();

    if (kayit.durum === "bekliyor" && Number.isFinite(macMs) && simdiMs >= macMs) {
      kayit.durum = "oynanıyor";
      degisti = true;
    }

    const skorKayit = skorMap.get(id);
    if (!skorKayit) {
      // Kickoff'tan 6 saat geçmesine rağmen hiç skor verisi gelmediyse vazgeç
      // (ertelenme/veri kaybı) — "veri_yok" ile işaretlenip kalıcı olarak kalır.
      if (Number.isFinite(macMs) && simdiMs - macMs > 6 * 3600 * 1000) {
        kayit.durum = "tamamlandi";
        kayit.sonuc = { durum: "veri_yok" };
        degisti = true;
      }
      continue;
    }

    const dakika = dakikaHesapla(skorKayit, simdiMs);
    if (dakika !== null) continue; // hâlâ oynanıyor

    const [msEv, msDep] = canliSkorHesapla(skorKayit);
    if (!Number.isInteger(msEv) || !Number.isInteger(msDep) || msEv < 0 || msDep < 0) {
      continue; // skor verisi bu tikte eksik/gecikmeli, gelecek dakika tekrar denenir
    }
    const [iyEv, iyDep] = ilkYariSkorHesapla(skorKayit);
    const kgVar = msEv > 0 && msDep > 0; // sadece MS'e bakılır, İY şartı yok

    kayit.durum = "tamamlandi";
    kayit.sonuc = {
      durum: "tamamlandi",
      iy: Number.isInteger(iyEv) && Number.isInteger(iyDep) ? `${iyEv}:${iyDep}` : null,
      ms: `${msEv}:${msDep}`,
      kgVar,
    };
    degisti = true;
  }

  if (degisti) {
    try {
      await env.HAVUZ_KV.put("gunluk", JSON.stringify(gunluk));
    } catch (err) { /* sessizce vazgeç, gelecek dakika tekrar denenir */ }
  }
}

// ============================================================
// KIRMIZI BOT ENTEGRASYONU
// Kırmızı bot (ayrı repo, DigitalOcean'da 7/24 çalışan Mackolik tabanlı
// canlı sinyal botu) her yeni taktik sinyalinde buraya POST atar. Burada
// takım isimleri Nesine'nin canlı bültenindeki isimlerle bulanık (fuzzy)
// eşleştirilir; eşleşme bulunursa (yani maç gerçekten Nesine'de varsa)
// sinyal KV'ye yazılır ve /api/canli o maçın altında gösterir.
// TODO (bu akşam canlı maç verisiyle tamamlanacak): market-özel oran
// kontrolü — şu an sadece "maç Nesine'de var mı" doğrulanıyor, taktiğin
// karşılık geldiği spesifik oranın (MS/İY Alt-Üst, Maç Sonucu) açık/kapalı
// olup olmadığı henüz kontrol edilmiyor (MTID eşlemeleri netleşince eklenecek).
// ============================================================

const _TURKCE_HARF_ESLEME = { "ı": "i", "İ": "i", "ğ": "g", "ş": "s", "ç": "c", "ö": "o", "ü": "u" };
const _TAKIM_GURULTU_KELIMELER = /\b(fc|cf|sk|ac|afc|cd|fk|sc|ssd|ud|kf|us|sv|bk|if|aif|cfr|res|reserves?|u\d{2})\b/g;

function normalizeTakimAdi(s) {
  if (!s) return "";
  let t = String(s).toLocaleLowerCase("tr-TR");
  t = t.replace(/[ıİğşçöü]/g, (c) => _TURKCE_HARF_ESLEME[c] || c);
  t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  t = t.replace(/[^a-z0-9\s]/g, " ");
  t = t.replace(_TAKIM_GURULTU_KELIMELER, " ");
  return t.replace(/\s+/g, " ").trim();
}

function _takimTokenSeti(s) {
  return new Set(normalizeTakimAdi(s).split(" ").filter((w) => w.length > 1));
}

// Basit bulanık benzerlik: tam eşleşme / alt-dize içerme / kelime kümesi kesişimi (Jaccard).
// Mackolik ve Nesine takım isimleri farklı formatlarda olabildiği için (kısaltma,
// ek kelime vb.) tam string eşitliği yeterli değil.
function takimBenzerlikSkoru(a, b) {
  const na = normalizeTakimAdi(a), nb = normalizeTakimAdi(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const ta = _takimTokenSeti(a), tb = _takimTokenSeti(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let ortak = 0;
  for (const w of ta) if (tb.has(w)) ortak++;
  return ortak / Math.max(ta.size, tb.size);
}

const SINYAL_ESLESME_ESIGI = 0.55;

// Kırmızı bot'tan gelen (home, away) çiftini Nesine'nin canlı bültenindeki
// futbol etkinlikleriyle eşleştirmeye çalışır. En iyi skoru eşik üzerinde
// olan etkinliği döner, yoksa null.
async function sinyalMacinaEslestir(homeMack, awayMack) {
  let canliBulten;
  try {
    canliBulten = await canliBultenCek();
  } catch (err) {
    return null;
  }
  const etkinlikler = (canliBulten.sg && canliBulten.sg.EA) || [];
  let enIyiEtkinlik = null;
  let enIyiSkor = 0;
  for (const e of etkinlikler) {
    if (e.GT !== 1) continue;
    const evSahibi = String(e.HN ?? "").trim();
    const deplasman = String(e.AN ?? "").trim();
    if (!evSahibi || !deplasman) continue;
    const skor = (takimBenzerlikSkoru(homeMack, evSahibi) + takimBenzerlikSkoru(awayMack, deplasman)) / 2;
    if (skor > enIyiSkor) {
      enIyiSkor = skor;
      enIyiEtkinlik = e;
    }
  }
  if (enIyiEtkinlik && enIyiSkor >= SINYAL_ESLESME_ESIGI) {
    return { etkinlik: enIyiEtkinlik, skor: enIyiSkor };
  }
  return null;
}

// MTID eşlemeleri, Nesine'nin canlı bahis sitesindeki ETİKETLİ market
// panelleriyle (nesine.com/iddaa → bir canlı maçın "Genel"/"Alt-Üst"
// sekmeleri) birebir oran karşılaştırması yapılarak doğrulandı — istatistiksel
// tahmin değil, doğrudan görsel kaynak eşleştirmesi:
//   MTID=53  SOV=0.0  → "Maç Sonucu" (1-X-2)
//   MTID=208 SOV=0.5  → "MAÇ SONUCU ALT/ÜST" bölümünde "0,5 Gol Alt/Üst" (tam maç)
//   MTID=66  SOV=1.5  → "MAÇ SONUCU ALT/ÜST" bölümünde "1,5 Gol Alt/Üst" (tam maç)
//   MTID=67  SOV=2.5  → "MAÇ SONUCU ALT/ÜST" bölümünde "2,5 Gol Alt/Üst" (tam maç)
//   MTID=68  SOV=3.5  → "MAÇ SONUCU ALT/ÜST" bölümünde "3,5 Gol Alt/Üst" (tam maç)
//   MTID=156 SOV=4.5  → "MAÇ SONUCU ALT/ÜST" bölümünde "4,5 Gol Alt/Üst" (tam maç)
//   MTID=69  SOV=0.5  → "YARI ALT/ÜST" bölümünde "1. Yarı 0,5 Alt/Üst"
//   MTID=70  SOV=1.5  → "YARI ALT/ÜST" bölümünde "1. Yarı 1,5 Alt/Üst"
// Tüm bu marketlerde N=1 Alt, N=2 Üst. Kırmızı bot'un tüm taktikleri bu
// eşlemelerle kapsanıyor artık.
const MS_ALT_UST_MTID = { 0.5: 208, 1.5: 66, 2.5: 67, 3.5: 68, 4.5: 156 };
const IY_ALT_UST_MTID = { 0.5: 69, 1.5: 70 };

function taktikOraniniKontrolEt(taktik, ma, skorEv, skorDep) {
  if (taktik === "TB") {
    if (skorEv == null || skorDep == null || skorEv === skorDep) return null; // beraberlikte kazanan belli değil, kontrol edilemez
    const n = skorEv > skorDep ? 1 : 3; // 1=ev kazanır, 3=deplasman kazanır (Maç Sonucu N kodu)
    const oran = canliOranBul(ma, 53, 0.0, n);
    return { market: "Maç Sonucu", pazarAcik: oran != null, oran };
  }

  // MS (tam maç) Toplam Gol Üst taktikleri — 0.5/1.5/2.5/3.5/4.5 çizgilerinin
  // hepsi doğrulandı (bkz. MS_ALT_UST_MTID yorumu).
  const MS_UST_HARITASI = {
    TH: 1.5, TB_OVER: 1.5,
    TC: 2.5, TC_CASCADE: 2.5, T_IY11: 2.5,
    TA: 3.5, T1: 3.5, TE: 3.5, TA_CASCADE: 3.5,
    T3: 4.5, T3_CASCADE: 4.5, T_CIFT_YUK: 4.5,
  };
  if (taktik in MS_UST_HARITASI) {
    const cizgi = MS_UST_HARITASI[taktik];
    const mtid = MS_ALT_UST_MTID[cizgi];
    const oran = canliOranBul(ma, mtid, cizgi, 2); // N=2 = Üst
    return { market: `MS ${cizgi} Üst`, pazarAcik: oran != null, oran };
  }

  // MS (tam maç) Toplam Gol Alt taktiği.
  if (taktik === "T_ERKEN_MS_35_ALT") {
    const oran = canliOranBul(ma, MS_ALT_UST_MTID[3.5], 3.5, 1); // N=1 = Alt
    return { market: "MS 3.5 Alt", pazarAcik: oran != null, oran };
  }

  // İY (ilk yarı) Toplam Gol Üst taktikleri — 0.5/1.5 çizgileri doğrulandı.
  const IY_UST_HARITASI = {
    T_IY_LIG: 0.5, T_U_IY: 0.5, T_TEMPO_IY05: 0.5,
    TH_IY: 1.5, T_TEMPO_IY15: 1.5,
  };
  if (taktik in IY_UST_HARITASI) {
    const cizgi = IY_UST_HARITASI[taktik];
    const mtid = IY_ALT_UST_MTID[cizgi];
    const oran = canliOranBul(ma, mtid, cizgi, 2); // N=2 = Üst
    return { market: `İY ${cizgi} Üst`, pazarAcik: oran != null, oran };
  }

  return null; // bilinmeyen taktik kodu
}

async function sinyalIsle(request, env) {
  const anahtar = request.headers.get("X-Sinyal-Key");
  if (!env.SINYAL_ANAHTARI || anahtar !== env.SINYAL_ANAHTARI) {
    return jsonResponse({ hata: "yetkisiz" }, 401);
  }

  let govde;
  try {
    govde = await request.json();
  } catch (err) {
    return jsonResponse({ hata: "gecersiz govde" }, 400);
  }

  const { home, away, lig, taktik, dk, skorEv, skorDep, tahmin, minOran, guven } = govde || {};
  if (!home || !away || !taktik) {
    return jsonResponse({ hata: "home, away, taktik alanlari zorunlu" }, 400);
  }

  const eslesme = await sinyalMacinaEslestir(home, away);
  if (!eslesme) {
    return jsonResponse({ eslesti: false });
  }

  const nesineMacId = String(eslesme.etkinlik.C ?? "");
  if (!nesineMacId) {
    return jsonResponse({ eslesti: false });
  }

  const oranDurumu = taktikOraniniKontrolEt(taktik, eslesme.etkinlik.MA || [], skorEv, skorDep);
  if (oranDurumu && !oranDurumu.pazarAcik) {
    // Market-özel kontrol yapılabilen bir taktik ve oran kapalı/yok — sinyal reddedilir.
    return jsonResponse({ eslesti: true, oranAcik: false, market: oranDurumu.market });
  }

  const kayit = {
    taktik,
    tahmin: tahmin ?? null,
    minOran: minOran ?? null,
    guven: guven ?? null,
    dk: dk ?? null,
    skorEv: skorEv ?? null,
    skorDep: skorDep ?? null,
    macMack: `${home} - ${away}`,
    ligMack: lig ?? null,
    eslesmeSkoru: eslesme.skor,
    oranDurumu,
    gonderilisZamani: toIstanbulIso(new Date()),
  };

  if (env.KG_SNAPSHOTS) {
    await env.KG_SNAPSHOTS.put("sinyal:" + nesineMacId, JSON.stringify(kayit), { expirationTtl: 4 * 3600 });
  }

  return jsonResponse({ eslesti: true, oranAcik: oranDurumu ? oranDurumu.pazarAcik : null, nesineMacId, eslesmeSkoru: eslesme.skor });
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

    if (pathname === "/api/sinyal" && request.method === "POST") {
      return sinyalIsle(request, env);
    }

    if (pathname === "/api/bulten-guncelle" && request.method === "POST") {
      return bultenGuncelleIsle(request, env);
    }


    if (pathname === "/api/bulten") {
      const guncel = await guncelMaclariAl(env);
      if (!guncel) {
        return jsonResponse({ hata: "veri henuz yok, kirmizi bot ilk push'u bekleniyor" }, 503);
      }
      const maclar = guncel.maclar.map((m) => ({ ...m, ...guvenHesapla(m.msKg ?? null, m.altUst6 ?? null, m.iymsKg ?? null, m.lig ?? null) }));
      return jsonResponse({ guncellemeZamani: guncel.guncellemeZamani, macSayisi: maclar.length, maclar });
    }

    if (pathname !== "/api/canli") {
      return new Response("Not found", { status: 404 });
    }

    const cacheSaniye = 30; // canlı maçlarda dakika/skor sık değiştiği için kısa TTL

    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).origin + "/kg-tahmin-canli", request);

    const cached = await cache.match(cacheKey);
    if (cached) {
      const body = await cached.text();
      return jsonResponse(JSON.parse(body), 200, { "X-Cache": "HIT" });
    }

    let cikti;
    try {
      const [canliBulten, canliSkorVerisi] = await Promise.all([canliBultenCek(), canliSkorCek()]);
      const hamMaclar = canliMaclariIsle(canliBulten, canliSkorVerisi);
      const maclar = await canliyaTahminEkle(hamMaclar, env);
      cikti = { guncellemeZamani: toIstanbulIso(new Date()), macSayisi: maclar.length, maclar };
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
    ctx.waitUntil(
      (async () => {
        // Kırmızı bot'un pushladığı güncel maç listesi (7-8MB Nesine bültenini
        // Worker artık hiç çekmiyor) bir kez okunup snapshot + günlük bültene paslanır.
        const guncel = await guncelMaclariAl(env);
        if (guncel) {
          await snapshotAlVeYaz(env, guncel.maclar);
          await gunlukBultenEkle(env, guncel.maclar);
        }
        // Canlı skor feed'i (~767KB, tam bültenden çok daha küçük) de bir kez
        // çekilip hem "ana veri" hem "günlük bülten/haftalık" tarafından paylaşılır.
        let canliSkorVerisi = null;
        try {
          canliSkorVerisi = await canliSkorCek();
        } catch (err) { /* sessizce vazgeç, gelecek dakika tekrar denenir */ }
        if (canliSkorVerisi) {
          await havuzGuncelle(env, canliSkorVerisi);
          await gunlukBultenGuncelle(env, canliSkorVerisi);
        }
      })()
    );
  },
};
