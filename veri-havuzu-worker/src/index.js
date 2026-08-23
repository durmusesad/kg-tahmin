var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var VARSAYILAN_KULLANICI = "drms";
var VARSAYILAN_PAROLA = "0022";
var OTURUM_TTL_SANIYE = 30 * 24 * 3600;
function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
__name(jsonResponse, "jsonResponse");
__name2(jsonResponse, "jsonResponse");
function htmlResponse(html, status) {
  return new Response(html, {
    status: status || 200,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}
__name(htmlResponse, "htmlResponse");
__name2(htmlResponse, "htmlResponse");
async function hashParola(parola) {
  const veri = new TextEncoder().encode(parola);
  const digest = await crypto.subtle.digest("SHA-256", veri);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashParola, "hashParola");
__name2(hashParola, "hashParola");
function cerezleriAyristir(request) {
  const header = request.headers.get("Cookie") || "";
  const cerezler = {};
  for (const parca of header.split(";")) {
    const esIndex = parca.indexOf("=");
    if (esIndex === -1) continue;
    const ad = parca.slice(0, esIndex).trim();
    const deger = parca.slice(esIndex + 1).trim();
    if (ad) {
      try {
        cerezler[ad] = decodeURIComponent(deger);
      } catch (err) {
        cerezler[ad] = deger;
      }
    }
  }
  return cerezler;
}
__name(cerezleriAyristir, "cerezleriAyristir");
__name2(cerezleriAyristir, "cerezleriAyristir");
async function oturumGecerliMi(request, env) {
  const cerezler = cerezleriAyristir(request);
  const token = cerezler["oturum"];
  if (!token) return false;
  try {
    const deger = await env.HAVUZ_KV.get("oturum:" + token);
    return deger != null;
  } catch (err) {
    return false;
  }
}
__name(oturumGecerliMi, "oturumGecerliMi");
__name2(oturumGecerliMi, "oturumGecerliMi");
async function hesapGetir(env) {
  try {
    const ham = await env.HAVUZ_KV.get("hesap");
    if (ham) return JSON.parse(ham);
  } catch (err) {
  }
  const hesap = { kullaniciAdi: VARSAYILAN_KULLANICI, parolaHash: await hashParola(VARSAYILAN_PAROLA) };
  try {
    await env.HAVUZ_KV.put("hesap", JSON.stringify(hesap));
  } catch (err) {
  }
  return hesap;
}
__name(hesapGetir, "hesapGetir");
__name2(hesapGetir, "hesapGetir");
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}
__name(escapeHtml, "escapeHtml");
__name2(escapeHtml, "escapeHtml");
var ORTAK_STIL = `
  :root{ --bg:#f4f1ea; --card:#ffffff; --ink:#1f1b16; --ink-soft:#6b6255; --border:#e3ddd0; --accent:#8a6d3b; --gri:#b7b7b7; --yesil:#8bc34a; }
  *{box-sizing:border-box;}
  body{margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--ink);}
`;
function girisSayfasiHtml(hataMesaji) {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Veri Havuzu \u2014 Giri\u015F</title>
<style>
${ORTAK_STIL}
  body{min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px;}
  .kart{background:var(--card); border:1px solid var(--border); border-radius:14px; padding:26px 22px; width:100%; max-width:340px; box-shadow:0 2px 10px rgba(0,0,0,.08);}
  h1{font-size:18px; margin:0 0 4px;}
  p.alt{font-size:12px; color:var(--ink-soft); margin:0 0 18px;}
  label{display:block; font-size:12px; color:var(--ink-soft); margin:12px 0 4px;}
  input{width:100%; padding:11px; border:1.5px solid var(--border); border-radius:9px; font-size:15px; background:#fff; color:var(--ink);}
  input:focus{outline:none; border-color:var(--accent);}
  button{width:100%; margin-top:20px; padding:12px; border:none; border-radius:9px; background:var(--accent); color:#fff; font-weight:700; font-size:14px; cursor:pointer;}
  .hata{color:#b3261e; font-size:12.5px; margin-top:12px; text-align:center;}
</style>
</head>
<body>
  <form class="kart" method="POST" action="/giris" autocomplete="off">
    <h1>Veri Havuzu</h1>
    <p class="alt">Devam etmek i\xE7in giri\u015F yap\u0131n.</p>
    <label for="k">Kullan\u0131c\u0131 Ad\u0131</label>
    <input type="text" id="k" name="kullaniciAdi" autocomplete="username" required autofocus>
    <label for="p">Parola</label>
    <input type="password" id="p" name="parola" autocomplete="current-password" required>
    <button type="submit">Giri\u015F Yap</button>
    ${hataMesaji ? `<div class="hata">${escapeHtml(hataMesaji)}</div>` : ""}
  </form>
</body>
</html>`;
}
__name(girisSayfasiHtml, "girisSayfasiHtml");
__name2(girisSayfasiHtml, "girisSayfasiHtml");
function tabloSayfasiHtml() {
  let secenekler = "";
  for (let i = 1; i <= 34; i++) secenekler += `<option value="${i}">${i}</option>`;
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Veri Havuzu</title>
<style>
${ORTAK_STIL}
  .top{display:flex; align-items:center; justify-content:space-between; gap:10px; padding:14px 16px; border-bottom:1px solid var(--border); flex-wrap:wrap;}
  .top h1{font-size:16px; margin:0;}
  .top .sag{display:flex; align-items:center; gap:10px; font-size:12px;}
  #sayac{color:var(--ink-soft);}
  .link-btn{background:none; border:none; color:var(--accent); font-weight:700; font-size:12.5px; cursor:pointer; padding:4px 0;}
  .wrap{padding:12px 16px 40px;}
  .filtreler{display:flex; gap:10px; margin-bottom:12px; flex-wrap:wrap;}
  .filtreler div{flex:1; min-width:140px;}
  .filtreler label{display:block; font-size:11px; color:var(--ink-soft); margin-bottom:3px;}
  select{width:100%; padding:8px 9px; border:1.5px solid var(--border); border-radius:8px; font-size:13.5px; background:#fff; color:var(--ink);}
  .tablo-kutu{overflow-x:auto; border:1px solid var(--border); border-radius:10px; background:var(--card);}
  table{border-collapse:collapse; width:100%; min-width:620px; font-size:13px;}
  thead th{background:var(--gri); color:#1f1b16; font-weight:800; padding:9px 8px; text-align:center; white-space:nowrap; position:sticky; top:0;}
  tbody td{padding:7px 8px; text-align:center; border-bottom:1px solid var(--border); white-space:nowrap;}
  tbody td.lig{text-align:left; font-weight:600;}
  tbody td.ms-yesil{background:var(--yesil); font-weight:700;}
  tbody tr:last-child td{border-bottom:none;}
  th.kebab-th, td.kebab-td{width:62px; padding:2px 4px;}
  td.kebab-td{display:flex; align-items:center; justify-content:center; gap:2px; border-bottom:1px solid var(--border);}
  tbody tr:last-child td.kebab-td{border-bottom:none;}
  .kebab-btn{background:none; border:none; cursor:pointer; font-size:15px; line-height:1; color:var(--ink-soft); padding:5px 7px; border-radius:6px;}
  .kebab-btn:hover, .kebab-btn.aktif{background:#0000000f; color:var(--ink);}
  .sil-btn:hover{background:#b3261e1a; color:#b3261e;}
  .kebab-menu{position:fixed; background:var(--card); border:1px solid var(--border); border-radius:9px; box-shadow:0 6px 20px rgba(0,0,0,.2); min-width:150px; z-index:80; padding:5px; font-size:13px;}
  .kebab-menu button{display:block; width:100%; text-align:left; background:none; border:none; padding:8px 10px; border-radius:6px; cursor:pointer; font-size:13px; color:var(--ink); font-weight:600;}
  .kebab-menu button:hover{background:#0000000f;}
  .kebab-menu button.tehlike{color:#b3261e;}
  .kebab-menu .kebab-onay{padding:6px 10px 8px; font-size:12.5px; color:var(--ink-soft);}
  .overlay[hidden]{display:none;}
  .overlay{position:fixed; inset:0; background:rgba(31,27,22,.4); display:flex; align-items:center; justify-content:center; z-index:90; padding:16px;}
  .duzenle-kart{background:var(--card); border-radius:14px; padding:22px; width:100%; max-width:360px; max-height:88vh; overflow:auto; box-shadow:0 8px 30px rgba(0,0,0,.25);}
  .duzenle-kart h2{font-size:15px; margin:0 0 14px;}
  .duzenle-kart label{display:block; font-size:11.5px; color:var(--ink-soft); margin:10px 0 3px;}
  .duzenle-kart input[type=text], .duzenle-kart input[type=number]{width:100%; padding:9px; border:1.5px solid var(--border); border-radius:8px; font-size:13.5px; background:#fff; color:var(--ink);}
  .duzenle-kart .checkbox-satir{display:flex; align-items:center; gap:8px; margin-top:14px; font-size:13px;}
  .duzenle-kart .checkbox-satir input{width:auto;}
  .duzenle-aksiyonlar{display:flex; gap:8px; margin-top:18px;}
  .duzenle-aksiyonlar button{flex:1; padding:10px; border:none; border-radius:8px; font-weight:700; font-size:13px; cursor:pointer;}
  .duzenle-aksiyonlar button[type=submit]{background:var(--accent); color:#fff;}
  .duzenle-aksiyonlar button.ikincil{background:#0000000f; color:var(--ink);}
  .hesap-panel{margin-top:16px; border:1px solid var(--border); border-radius:10px; background:var(--card); padding:14px; max-width:360px;}
  .hesap-panel h2{font-size:13px; margin:0 0 10px;}
  .hesap-panel label{display:block; font-size:11.5px; color:var(--ink-soft); margin:8px 0 3px;}
  .hesap-panel input{width:100%; padding:8px 9px; border:1.5px solid var(--border); border-radius:8px; font-size:13.5px;}
  .hesap-panel button{margin-top:12px; padding:9px 14px; border:none; border-radius:8px; background:var(--accent); color:#fff; font-weight:700; font-size:12.5px; cursor:pointer;}
  .hesap-mesaj{font-size:12px; margin-top:8px;}
  .hesap-mesaj.basarili{color:#2e7d32;}
  .hesap-mesaj.hata{color:#b3261e;}
  .bos{padding:24px; text-align:center; color:var(--ink-soft); font-size:13px;}
  .sekmeler{display:flex; gap:4px; padding:0 16px; border-bottom:1px solid var(--border); background:var(--card);}
  .sekme-btn{background:none; border:none; padding:11px 14px; font-size:13px; font-weight:700; color:var(--ink-soft); cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px;}
  .sekme-btn.aktif{color:var(--accent); border-bottom-color:var(--accent);}
  .panel[hidden]{display:none;}
  .alt-baslik{font-size:13px; font-weight:800; color:var(--ink-soft); margin:18px 0 8px; text-transform:uppercase; letter-spacing:.02em;}
  .alt-baslik:first-child{margin-top:0;}
  .durum-etiket{display:inline-block; padding:2px 8px; border-radius:20px; font-size:11.5px; font-weight:700;}
  .durum-bekliyor{background:#0000000f; color:var(--ink-soft);}
  .durum-oynaniyor{background:#fff3cd; color:#8a6d1a;}
  .durum-kg-var{background:var(--yesil); color:#1f1b16;}
  .durum-kg-yok{background:#0000000f; color:var(--ink-soft);}
  .durum-veri-yok{background:#f5d0d0; color:#8a2f2f;}
  @media (max-width:480px){ .top{padding:12px;} .wrap{padding:10px 10px 30px;} .sekmeler{padding:0 10px;} }
</style>
</head>
<body>
  <div class="top">
    <h1>Veri Havuzu</h1>
    <div class="sag">
      <span id="sayac">\u2013</span>
      <button type="button" class="link-btn" id="hesapAcBtn">Hesap Ayarlar\u0131</button>
      <form method="POST" action="/cikis"><button type="submit" class="link-btn">\xC7\u0131k\u0131\u015F Yap</button></form>
    </div>
  </div>
  <div class="sekmeler">
    <button type="button" class="sekme-btn aktif" data-sekme="ana">Ana Veri</button>
    <button type="button" class="sekme-btn" data-sekme="gunluk">G\xFCnl\xFCk B\xFClten</button>
    <button type="button" class="sekme-btn" data-sekme="haftalik">Haftal\u0131k</button>
  </div>
  <div class="wrap">
    <div class="panel" id="panelAna">
      <div class="filtreler">
        <div>
          <label for="filtreKg">\u0130Y/MS KG EVET</label>
          <select id="filtreKg"><option value="">T\xFCm\xFC</option>${secenekler}</select>
        </div>
        <div>
          <label for="filtreGol">6+ GOL</label>
          <select id="filtreGol"><option value="">T\xFCm\xFC</option>${secenekler}</select>
        </div>
        <div>
          <label for="siralama">S\u0131rala</label>
          <select id="siralama">
            <option value="eklenme_yeni" selected>Son Eklenenler \xD6nce</option>
            <option value="eklenme_eski">\u0130lk Eklenenler \xD6nce</option>
            <option value="varsayilan">Varsay\u0131lan S\u0131ra</option>
          </select>
        </div>
      </div>
      <div class="tablo-kutu">
        <table>
          <thead>
            <tr><th>HAFTA</th><th>L\u0130G</th><th>\u0130Y</th><th>MS</th><th>\u0130Y/MS KG EVET</th><th>6+ GOL</th><th>Eklendi</th><th class="kebab-th"></th></tr>
          </thead>
          <tbody id="govde"><tr><td colspan="8" class="bos">Y\xFCkleniyor\u2026</td></tr></tbody>
        </table>
      </div>

      <div class="hesap-panel" id="hesapPanel" hidden>
        <h2>Hesap Ayarlar\u0131</h2>
        <form id="hesapForm" autocomplete="off">
          <label for="mevcutParola">Mevcut Parola</label>
          <input type="password" id="mevcutParola" name="mevcutParola" required>
          <label for="yeniKullaniciAdi">Yeni Kullan\u0131c\u0131 Ad\u0131 (opsiyonel)</label>
          <input type="text" id="yeniKullaniciAdi" name="yeniKullaniciAdi">
          <label for="yeniParola">Yeni Parola (opsiyonel, en az 4 karakter)</label>
          <input type="password" id="yeniParola" name="yeniParola">
          <button type="submit">Kaydet</button>
          <div class="hesap-mesaj" id="hesapMesaj"></div>
        </form>
      </div>
    </div>

    <div class="panel" id="panelGunluk" hidden>
      <div class="alt-baslik">Oynan\u0131yor / Bekliyor</div>
      <div class="tablo-kutu">
        <table>
          <thead>
            <tr><th>L\u0130G</th><th>EV SAHiBi</th><th>DEPLASMAN</th><th>MA\xC7 SAATi</th><th>\u0130Y/MS KG EVET</th><th>6+ GOL</th><th>DURUM</th></tr>
          </thead>
          <tbody id="govdeGunlukAktif"><tr><td colspan="7" class="bos">Y\xFCkleniyor\u2026</td></tr></tbody>
        </table>
      </div>
      <div class="alt-baslik">Tamamlanan</div>
      <div class="tablo-kutu">
        <table>
          <thead>
            <tr><th>L\u0130G</th><th>EV SAHiBi</th><th>DEPLASMAN</th><th>MA\xC7 SAATi</th><th>\u0130Y</th><th>MS</th><th>SONU\xC7</th></tr>
          </thead>
          <tbody id="govdeGunlukTamamlanan"><tr><td colspan="7" class="bos">Y\xFCkleniyor\u2026</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="panel" id="panelHaftalik" hidden>
      <div class="tablo-kutu">
        <table>
          <thead>
            <tr><th>HAFTA</th><th>L\u0130G</th><th>EV SAHiBi</th><th>DEPLASMAN</th><th>\u0130Y</th><th>MS</th><th>\u0130Y/MS KG EVET</th><th>6+ GOL</th><th>Eklendi</th></tr>
          </thead>
          <tbody id="govdeHaftalik"><tr><td colspan="9" class="bos">Y\xFCkleniyor\u2026</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="overlay" id="duzenleOverlay" hidden>
    <div class="duzenle-kart">
      <h2>Kayd\u0131 D\xFCzenle</h2>
      <form id="duzenleForm" autocomplete="off">
        <label for="dHafta">Hafta</label>
        <input type="text" id="dHafta" name="hafta">
        <label for="dLig">Lig</label>
        <input type="text" id="dLig" name="lig">
        <label for="dIy">\u0130Y</label>
        <input type="text" id="dIy" name="iy">
        <label for="dMs">MS</label>
        <input type="text" id="dMs" name="ms">
        <label for="dKgOran">\u0130Y/MS KG EVET oran\u0131</label>
        <input type="number" id="dKgOran" name="iymsKgOran">
        <label for="dGolOran">6+ GOL oran\u0131</label>
        <input type="number" id="dGolOran" name="altiGolOran">
        <div class="checkbox-satir">
          <input type="checkbox" id="dKgVar" name="kgVar">
          <label for="dKgVar" style="margin:0;">Kar\u015F\u0131l\u0131kl\u0131 gol var (MS)</label>
        </div>
        <div class="duzenle-aksiyonlar">
          <button type="button" class="ikincil" id="duzenleVazgecBtn">Vazge\xE7</button>
          <button type="submit">Kaydet</button>
        </div>
        <div class="hesap-mesaj" id="duzenleMesaj"></div>
      </form>
    </div>
  </div>

<script>
(function(){
  "use strict";
  function $(id){ return document.getElementById(id); }
  function escapeHtml(s){
    var harita = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return harita[c]; });
  }

  var TUM_KAYITLAR = [];

  function eklenmeGoster(k){
    if (!k.eklenmeZamani) return "";
    // "2026-08-19T13:29:22+03:00" -> "2026-08-19 13:29" (regex yerine dilimleme,
    // template literal icinde kacis karakteri kaybi riskini onlemek icin)
    var s = String(k.eklenmeZamani);
    if (s.length >= 16 && s.charAt(10) === "T") {
      return s.slice(0, 10) + " " + s.slice(11, 16);
    }
    return escapeHtml(s);
  }

  function satirHtml(k){
    var msSinif = k.kgVar === true ? "ms-yesil" : "";
    return "<tr>" +
      "<td>" + escapeHtml(k.hafta) + "</td>" +
      "<td class='lig'>" + escapeHtml(k.lig) + "</td>" +
      "<td>" + escapeHtml(k.iy) + "</td>" +
      "<td class='" + msSinif + "'>" + escapeHtml(k.ms) + "</td>" +
      "<td>" + (k.iymsKgOran != null ? k.iymsKgOran : "") + "</td>" +
      "<td>" + (k.altiGolOran != null ? k.altiGolOran : "") + "</td>" +
      "<td>" + eklenmeGoster(k) + "</td>" +
      "<td class='kebab-td'>" +
        "<button type='button' class='kebab-btn sil-btn' data-sil='" + k._idx + "' title='Sil'>\u{1F5D1}</button>" +
        "<button type='button' class='kebab-btn' data-kebap='" + k._idx + "' title='Di\u011Fer i\u015Flemler'>\u22EE</button>" +
      "</td>" +
      "</tr>";
  }

  function listele(){
    var kg = $("filtreKg").value;
    var gol = $("filtreGol").value;
    var sira = $("siralama").value;
    var liste = TUM_KAYITLAR.slice();
    if (kg !== "") liste = liste.filter(function(k){ return String(k.iymsKgOran) === kg; });
    if (gol !== "") liste = liste.filter(function(k){ return String(k.altiGolOran) === gol; });
    if (sira === "eklenme_yeni" || sira === "eklenme_eski"){
      liste = liste.filter(function(k){ return !!k.eklenmeZamani; });
      liste.sort(function(a, b){
        var fark = String(a.eklenmeZamani).localeCompare(String(b.eklenmeZamani));
        return sira === "eklenme_yeni" ? -fark : fark;
      });
    }
    $("govde").innerHTML = liste.length
      ? liste.map(satirHtml).join("")
      : '<tr><td colspan="8" class="bos">Kriterlere uyan kay\u0131t yok.</td></tr>';
    $("sayac").textContent = liste.length + " / " + TUM_KAYITLAR.length + " kay\u0131t";
  }

  $("filtreKg").addEventListener("change", listele);
  $("filtreGol").addEventListener("change", listele);
  $("siralama").addEventListener("change", listele);

  // --- Sekmeler: G\xFCnl\xFCk B\xFClten / Haftal\u0131k -----------------------------------
  var SEKME_YUKLENDI = { gunluk: false, haftalik: false };

  function eklenmeGosterGenel(zaman){
    if (!zaman) return "";
    var s = String(zaman);
    if (s.length >= 16 && s.charAt(10) === "T") return s.slice(0, 10) + " " + s.slice(11, 16);
    return escapeHtml(s);
  }

  function gunlukSatirAktifHtml(k){
    var durumSinif = k.durum === "oynan\u0131yor" ? "durum-oynaniyor" : "durum-bekliyor";
    return "<tr>" +
      "<td class='lig'>" + escapeHtml(k.lig) + "</td>" +
      "<td>" + escapeHtml(k.evSahibi) + "</td>" +
      "<td>" + escapeHtml(k.deplasman) + "</td>" +
      "<td>" + eklenmeGosterGenel(k.macZamani) + "</td>" +
      "<td>" + (k.iymsKgOran != null ? k.iymsKgOran : "") + "</td>" +
      "<td>" + (k.altiGolOran != null ? k.altiGolOran : "") + "</td>" +
      "<td><span class='durum-etiket " + durumSinif + "'>" + escapeHtml(k.durum) + "</span></td>" +
      "</tr>";
  }

  function gunlukSatirTamamlananHtml(k){
    var sonuc = k.sonuc || {};
    var etiket, sinif;
    if (sonuc.durum === "veri_yok") { etiket = "Veri al\u0131namad\u0131"; sinif = "durum-veri-yok"; }
    else if (sonuc.kgVar) { etiket = "KG \xE7\u0131kt\u0131 \u2192 haftal\u0131\u011fa yaz\u0131ld\u0131"; sinif = "durum-kg-var"; }
    else { etiket = "KG yok"; sinif = "durum-kg-yok"; }
    return "<tr>" +
      "<td class='lig'>" + escapeHtml(k.lig) + "</td>" +
      "<td>" + escapeHtml(k.evSahibi) + "</td>" +
      "<td>" + escapeHtml(k.deplasman) + "</td>" +
      "<td>" + eklenmeGosterGenel(k.macZamani) + "</td>" +
      "<td>" + escapeHtml(sonuc.iy || "") + "</td>" +
      "<td>" + escapeHtml(sonuc.ms || "") + "</td>" +
      "<td><span class='durum-etiket " + sinif + "'>" + etiket + "</span></td>" +
      "</tr>";
  }

  function gunlukYukle(){
    fetch("/api/gunluk", { cache: "no-store" })
      .then(function(r){ if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function(data){
        var kayitlar = data.kayitlar || [];
        var aktif = kayitlar.filter(function(k){ return k.durum !== "tamamlandi"; });
        var tamam = kayitlar.filter(function(k){ return k.durum === "tamamlandi"; });
        $("govdeGunlukAktif").innerHTML = aktif.length
          ? aktif.map(gunlukSatirAktifHtml).join("")
          : '<tr><td colspan="7" class="bos">Bekleyen/oynanan ma\xE7 yok.</td></tr>';
        $("govdeGunlukTamamlanan").innerHTML = tamam.length
          ? tamam.map(gunlukSatirTamamlananHtml).join("")
          : '<tr><td colspan="7" class="bos">Tamamlanan ma\xE7 yok.</td></tr>';
        SEKME_YUKLENDI.gunluk = true;
      })
      .catch(function(){
        $("govdeGunlukAktif").innerHTML = '<tr><td colspan="7" class="bos">Veri y\xFCklenemedi.</td></tr>';
        $("govdeGunlukTamamlanan").innerHTML = "";
      });
  }

  function haftalikSatirHtml(k){
    return "<tr>" +
      "<td>" + escapeHtml(k.hafta) + "</td>" +
      "<td class='lig'>" + escapeHtml(k.lig) + "</td>" +
      "<td>" + escapeHtml(k.evSahibi) + "</td>" +
      "<td>" + escapeHtml(k.deplasman) + "</td>" +
      "<td>" + escapeHtml(k.iy) + "</td>" +
      "<td class='ms-yesil'>" + escapeHtml(k.ms) + "</td>" +
      "<td>" + (k.iymsKgOran != null ? k.iymsKgOran : "") + "</td>" +
      "<td>" + (k.altiGolOran != null ? k.altiGolOran : "") + "</td>" +
      "<td>" + eklenmeGosterGenel(k.eklenmeZamani) + "</td>" +
      "</tr>";
  }

  function haftalikYukle(){
    fetch("/api/haftalik", { cache: "no-store" })
      .then(function(r){ if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function(data){
        // Lig bazlı grupla (aynı lig alt alta), lig i\xE7inde en son eklenen \xFCstte.
        var kayitlar = (data.kayitlar || []).slice().sort(function(a, b){
          var ligFark = String(a.lig || "").localeCompare(String(b.lig || ""), "tr");
          if (ligFark !== 0) return ligFark;
          return String(b.eklenmeZamani || "").localeCompare(String(a.eklenmeZamani || ""));
        });
        $("govdeHaftalik").innerHTML = kayitlar.length
          ? kayitlar.map(haftalikSatirHtml).join("")
          : '<tr><td colspan="9" class="bos">Hen\xFCz KG \xE7\u0131kan ma\xE7 yok.</td></tr>';
        SEKME_YUKLENDI.haftalik = true;
      })
      .catch(function(){
        $("govdeHaftalik").innerHTML = '<tr><td colspan="9" class="bos">Veri y\xFCklenemedi.</td></tr>';
      });
  }

  var SEKME_BUTONLARI = document.querySelectorAll(".sekme-btn");
  for (var si = 0; si < SEKME_BUTONLARI.length; si++) {
    SEKME_BUTONLARI[si].addEventListener("click", function(ev){
      var hedef = ev.target.getAttribute("data-sekme");
      for (var j = 0; j < SEKME_BUTONLARI.length; j++) SEKME_BUTONLARI[j].classList.remove("aktif");
      ev.target.classList.add("aktif");
      $("panelAna").hidden = hedef !== "ana";
      $("panelGunluk").hidden = hedef !== "gunluk";
      $("panelHaftalik").hidden = hedef !== "haftalik";
      if (hedef === "gunluk" && !SEKME_YUKLENDI.gunluk) gunlukYukle();
      if (hedef === "haftalik" && !SEKME_YUKLENDI.haftalik) haftalikYukle();
    });
  }

  fetch("/api/veri", { cache: "no-store" })
    .then(function(r){ if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function(data){
      TUM_KAYITLAR = (data.kayitlar || []).map(function(k, i){ k._idx = i; return k; });
      listele();
    })
    .catch(function(){
      $("govde").innerHTML = '<tr><td colspan="8" class="bos">Veri y\xFCklenemedi.</td></tr>';
      $("sayac").textContent = "\u2013";
    });

  // --- Sat\u0131r men\xFCs\xFC (\u22EE): D\xFCzenle / Sil ---------------------------------
  var AKTIF_MENU_BUTON = null;
  var AKTIF_DUZENLE_KAYIT = null;

  function temizKayit(k){
    return {
      hafta: k.hafta, lig: k.lig, iy: k.iy, ms: k.ms,
      iymsKgOran: k.iymsKgOran, altiGolOran: k.altiGolOran,
      kgVar: k.kgVar, eklenmeZamani: k.eklenmeZamani,
    };
  }

  function menuKapat(){
    var eski = document.getElementById("kebapMenu");
    if (eski) eski.remove();
    if (AKTIF_MENU_BUTON) AKTIF_MENU_BUTON.classList.remove("aktif");
    AKTIF_MENU_BUTON = null;
    document.removeEventListener("click", disariTiklandi, true);
  }

  function disariTiklandi(ev){
    var menu = document.getElementById("kebapMenu");
    if (!menu) return;
    if (!menu.contains(ev.target) && !ev.target.closest("[data-kebap]") && !ev.target.closest("[data-sil]")) {
      menuKapat();
    }
  }

  function menuBaslat(buton){
    menuKapat();
    var dikdortgen = buton.getBoundingClientRect();
    var menu = document.createElement("div");
    menu.className = "kebab-menu";
    menu.id = "kebapMenu";
    menu.style.top = (dikdortgen.bottom + 4) + "px";
    menu.style.left = Math.max(8, dikdortgen.right - 150) + "px";
    document.body.appendChild(menu);
    buton.classList.add("aktif");
    AKTIF_MENU_BUTON = buton;
    setTimeout(function(){ document.addEventListener("click", disariTiklandi, true); }, 0);
    return menu;
  }

  function menuAc(buton, kayit){
    var menu = menuBaslat(buton);
    menu.innerHTML =
      '<button type="button" data-aksiyon="duzenle">D\xFCzenle</button>' +
      '<button type="button" data-aksiyon="sil" class="tehlike">Sil</button>';
    menu.querySelector('[data-aksiyon="duzenle"]').addEventListener("click", function(){
      menuKapat();
      duzenleAc(kayit);
    });
    menu.querySelector('[data-aksiyon="sil"]').addEventListener("click", function(){
      silOnaySor(menu, kayit);
    });
  }

  function silMenuAc(buton, kayit){
    var menu = menuBaslat(buton);
    silOnaySor(menu, kayit);
  }

  function silOnaySor(menu, kayit){
    menu.innerHTML =
      '<div class="kebab-onay">Bu kay\u0131t silinsin mi?</div>' +
      '<button type="button" data-aksiyon="vazgec">Vazge\xE7</button>' +
      '<button type="button" data-aksiyon="evet" class="tehlike">Evet, sil</button>';
    menu.querySelector('[data-aksiyon="vazgec"]').addEventListener("click", menuKapat);
    menu.querySelector('[data-aksiyon="evet"]').addEventListener("click", function(){
      silGonder(kayit);
    });
  }

  function silGonder(kayit){
    menuKapat();
    fetch("/api/kayit-sil", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index: kayit._idx, kayit: temizKayit(kayit) }),
    })
      .then(function(r){ return r.json().then(function(sonuc){ return { ok: r.ok, sonuc: sonuc }; }); })
      .then(function(res){
        if (res.ok && res.sonuc.basarili){
          TUM_KAYITLAR = TUM_KAYITLAR.filter(function(k){ return k !== kayit; });
          TUM_KAYITLAR.forEach(function(k, i){ k._idx = i; });
          listele();
        } else {
          alert(res.sonuc.hata || "Silinemedi, sayfay\u0131 yenileyip tekrar deneyin.");
        }
      })
      .catch(function(){ alert("Ba\u011Flant\u0131 hatas\u0131."); });
  }

  $("govde").addEventListener("click", function(ev){
    var silBtn = ev.target.closest("[data-sil]");
    if (silBtn){
      ev.stopPropagation();
      if (AKTIF_MENU_BUTON === silBtn) { menuKapat(); return; }
      var silIdx = Number(silBtn.getAttribute("data-sil"));
      var silKayit = TUM_KAYITLAR[silIdx];
      if (!silKayit) return;
      silMenuAc(silBtn, silKayit);
      return;
    }
    var btn = ev.target.closest("[data-kebap]");
    if (!btn) return;
    ev.stopPropagation();
    if (AKTIF_MENU_BUTON === btn) { menuKapat(); return; }
    var idx = Number(btn.getAttribute("data-kebap"));
    var kayit = TUM_KAYITLAR[idx];
    if (!kayit) return;
    menuAc(btn, kayit);
  });

  // --- D\xFCzenleme modal\u0131 ---------------------------------------------------
  function duzenleAc(kayit){
    AKTIF_DUZENLE_KAYIT = kayit;
    $("dHafta").value = kayit.hafta || "";
    $("dLig").value = kayit.lig || "";
    $("dIy").value = kayit.iy || "";
    $("dMs").value = kayit.ms || "";
    $("dKgOran").value = kayit.iymsKgOran != null ? kayit.iymsKgOran : "";
    $("dGolOran").value = kayit.altiGolOran != null ? kayit.altiGolOran : "";
    $("dKgVar").checked = kayit.kgVar === true;
    $("duzenleMesaj").textContent = "";
    $("duzenleMesaj").className = "hesap-mesaj";
    $("duzenleOverlay").hidden = false;
  }

  function duzenleKapat(){
    $("duzenleOverlay").hidden = true;
    AKTIF_DUZENLE_KAYIT = null;
  }

  $("duzenleVazgecBtn").addEventListener("click", duzenleKapat);
  $("duzenleOverlay").addEventListener("click", function(ev){
    if (ev.target === $("duzenleOverlay")) duzenleKapat();
  });

  $("duzenleForm").addEventListener("submit", function(ev){
    ev.preventDefault();
    if (!AKTIF_DUZENLE_KAYIT) return;
    var mesajEl = $("duzenleMesaj");
    mesajEl.textContent = "";
    mesajEl.className = "hesap-mesaj";
    var kgOranStr = $("dKgOran").value;
    var golOranStr = $("dGolOran").value;
    var duzenlenenKayit = AKTIF_DUZENLE_KAYIT;
    var yeni = {
      hafta: $("dHafta").value.trim(),
      lig: $("dLig").value.trim(),
      iy: $("dIy").value.trim(),
      ms: $("dMs").value.trim(),
      iymsKgOran: kgOranStr === "" ? null : Number(kgOranStr),
      altiGolOran: golOranStr === "" ? null : Number(golOranStr),
      kgVar: $("dKgVar").checked,
    };
    fetch("/api/kayit-duzenle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index: duzenlenenKayit._idx, kayit: temizKayit(duzenlenenKayit), yeni: yeni }),
    })
      .then(function(r){ return r.json().then(function(sonuc){ return { ok: r.ok, sonuc: sonuc }; }); })
      .then(function(res){
        if (res.ok && res.sonuc.basarili){
          var idx = duzenlenenKayit._idx;
          var guncel = res.sonuc.kayit || Object.assign({}, duzenlenenKayit, yeni);
          guncel._idx = idx;
          TUM_KAYITLAR[idx] = guncel;
          duzenleKapat();
          listele();
        } else {
          mesajEl.textContent = res.sonuc.hata || "Kaydedilemedi.";
          mesajEl.className = "hesap-mesaj hata";
        }
      })
      .catch(function(){
        mesajEl.textContent = "Ba\u011Flant\u0131 hatas\u0131.";
        mesajEl.className = "hesap-mesaj hata";
      });
  });

  $("hesapAcBtn").addEventListener("click", function(){
    var panel = $("hesapPanel");
    panel.hidden = !panel.hidden;
  });

  $("hesapForm").addEventListener("submit", function(ev){
    ev.preventDefault();
    var mesajEl = $("hesapMesaj");
    mesajEl.textContent = "";
    mesajEl.className = "hesap-mesaj";
    var govde = {
      mevcutParola: $("mevcutParola").value,
      yeniKullaniciAdi: $("yeniKullaniciAdi").value || null,
      yeniParola: $("yeniParola").value || null,
    };
    fetch("/api/hesap-degistir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(govde),
    })
      .then(function(r){ return r.json().then(function(sonuc){ return { ok: r.ok, sonuc: sonuc }; }); })
      .then(function(res){
        if (res.ok && res.sonuc.basarili){
          mesajEl.textContent = "G\xFCncellendi.";
          mesajEl.className = "hesap-mesaj basarili";
          $("hesapForm").reset();
        } else {
          mesajEl.textContent = res.sonuc.hata || "G\xFCncellenemedi.";
          mesajEl.className = "hesap-mesaj hata";
        }
      })
      .catch(function(){
        mesajEl.textContent = "Ba\u011Flant\u0131 hatas\u0131.";
        mesajEl.className = "hesap-mesaj hata";
      });
  });
})();
<\/script>
</body>
</html>`;
}
__name(tabloSayfasiHtml, "tabloSayfasiHtml");
__name2(tabloSayfasiHtml, "tabloSayfasiHtml");
async function girisIsle(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return htmlResponse(girisSayfasiHtml("Ge\xE7ersiz istek."), 400);
  }
  const kullaniciAdi = String(form.get("kullaniciAdi") || "").trim();
  const parola = String(form.get("parola") || "");
  const hesap = await hesapGetir(env);
  const girilenHash = await hashParola(parola);
  if (kullaniciAdi !== hesap.kullaniciAdi || girilenHash !== hesap.parolaHash) {
    return htmlResponse(girisSayfasiHtml("Kullan\u0131c\u0131 ad\u0131 veya parola hatal\u0131."), 401);
  }
  const token = crypto.randomUUID();
  try {
    await env.HAVUZ_KV.put("oturum:" + token, "1", { expirationTtl: OTURUM_TTL_SANIYE });
  } catch (err) {
    return htmlResponse(girisSayfasiHtml("Oturum olu\u015Fturulamad\u0131, tekrar deneyin."), 500);
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/",
      "Set-Cookie": `oturum=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${OTURUM_TTL_SANIYE}; Path=/`
    }
  });
}
__name(girisIsle, "girisIsle");
__name2(girisIsle, "girisIsle");
async function cikisIsle(request, env) {
  const cerezler = cerezleriAyristir(request);
  const token = cerezler["oturum"];
  if (token) {
    try {
      await env.HAVUZ_KV.delete("oturum:" + token);
    } catch (err) {
    }
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/",
      "Set-Cookie": "oturum=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/"
    }
  });
}
__name(cikisIsle, "cikisIsle");
__name2(cikisIsle, "cikisIsle");
async function hesapDegistir(request, env) {
  let govde;
  try {
    govde = await request.json();
  } catch (err) {
    return jsonResponse({ basarili: false, hata: "Ge\xE7ersiz istek." }, 400);
  }
  const mevcutParola = govde && govde.mevcutParola;
  const yeniKullaniciAdi = govde && govde.yeniKullaniciAdi;
  const yeniParola = govde && govde.yeniParola;
  if (!mevcutParola) {
    return jsonResponse({ basarili: false, hata: "Mevcut parolan\u0131z\u0131 girin." }, 400);
  }
  const hesap = await hesapGetir(env);
  const mevcutHash = await hashParola(String(mevcutParola));
  if (mevcutHash !== hesap.parolaHash) {
    return jsonResponse({ basarili: false, hata: "Mevcut parola yanl\u0131\u015F." }, 401);
  }
  const yeni = { kullaniciAdi: hesap.kullaniciAdi, parolaHash: hesap.parolaHash };
  if (yeniKullaniciAdi && String(yeniKullaniciAdi).trim()) {
    yeni.kullaniciAdi = String(yeniKullaniciAdi).trim();
  }
  if (yeniParola && String(yeniParola).length > 0) {
    if (String(yeniParola).length < 4) {
      return jsonResponse({ basarili: false, hata: "Yeni parola en az 4 karakter olmal\u0131." }, 400);
    }
    yeni.parolaHash = await hashParola(String(yeniParola));
  }
  try {
    await env.HAVUZ_KV.put("hesap", JSON.stringify(yeni));
  } catch (err) {
    return jsonResponse({ basarili: false, hata: "Kaydedilemedi, tekrar deneyin." }, 500);
  }
  return jsonResponse({ basarili: true });
}
__name(hesapDegistir, "hesapDegistir");
__name2(hesapDegistir, "hesapDegistir");
function kayitEslesiyorMu(a, b) {
  if (!a || !b) return false;
  const alanlar = ["hafta", "lig", "iy", "ms", "iymsKgOran", "altiGolOran", "kgVar", "eklenmeZamani"];
  return alanlar.every((alan) => a[alan] === b[alan] || a[alan] == null && b[alan] == null);
}
__name(kayitEslesiyorMu, "kayitEslesiyorMu");
__name2(kayitEslesiyorMu, "kayitEslesiyorMu");
async function kayitlariOku(env) {
  const ham = await env.HAVUZ_KV.get("veri");
  const kayitlar = ham ? JSON.parse(ham) : [];
  return Array.isArray(kayitlar) ? kayitlar : [];
}
__name(kayitlariOku, "kayitlariOku");
__name2(kayitlariOku, "kayitlariOku");
async function kayitSil(request, env) {
  let govde;
  try {
    govde = await request.json();
  } catch (err) {
    return jsonResponse({ basarili: false, hata: "Ge\xE7ersiz istek." }, 400);
  }
  const index = govde && Number.isInteger(govde.index) ? govde.index : null;
  if (index == null || index < 0) {
    return jsonResponse({ basarili: false, hata: "Ge\xE7ersiz kay\u0131t." }, 400);
  }
  let kayitlar;
  try {
    kayitlar = await kayitlariOku(env);
  } catch (err) {
    return jsonResponse({ basarili: false, hata: "Veri okunamad\u0131." }, 500);
  }
  if (index >= kayitlar.length || !kayitEslesiyorMu(kayitlar[index], govde.kayit)) {
    return jsonResponse({ basarili: false, hata: "Kay\u0131t de\u011Fi\u015Fmi\u015F, sayfay\u0131 yenileyip tekrar deneyin." }, 409);
  }
  kayitlar.splice(index, 1);
  try {
    await env.HAVUZ_KV.put("veri", JSON.stringify(kayitlar));
  } catch (err) {
    return jsonResponse({ basarili: false, hata: "Kaydedilemedi." }, 500);
  }
  return jsonResponse({ basarili: true });
}
__name(kayitSil, "kayitSil");
__name2(kayitSil, "kayitSil");
async function kayitDuzenle(request, env) {
  let govde;
  try {
    govde = await request.json();
  } catch (err) {
    return jsonResponse({ basarili: false, hata: "Ge\xE7ersiz istek." }, 400);
  }
  const index = govde && Number.isInteger(govde.index) ? govde.index : null;
  const yeni = govde && govde.yeni;
  if (index == null || index < 0 || !yeni || typeof yeni !== "object") {
    return jsonResponse({ basarili: false, hata: "Ge\xE7ersiz istek." }, 400);
  }
  let kayitlar;
  try {
    kayitlar = await kayitlariOku(env);
  } catch (err) {
    return jsonResponse({ basarili: false, hata: "Veri okunamad\u0131." }, 500);
  }
  if (index >= kayitlar.length || !kayitEslesiyorMu(kayitlar[index], govde.kayit)) {
    return jsonResponse({ basarili: false, hata: "Kay\u0131t de\u011Fi\u015Fmi\u015F, sayfay\u0131 yenileyip tekrar deneyin." }, 409);
  }
  const sayiyaCevir = /* @__PURE__ */ __name((v) => v === null || v === void 0 || v === "" ? null : Number(v), "sayiyaCevir");
  const guncellenmis = {
    ...kayitlar[index],
    hafta: String(yeni.hafta ?? "").trim() || null,
    lig: String(yeni.lig ?? "").trim() || null,
    iy: String(yeni.iy ?? "").trim() || null,
    ms: String(yeni.ms ?? "").trim() || null,
    iymsKgOran: sayiyaCevir(yeni.iymsKgOran),
    altiGolOran: sayiyaCevir(yeni.altiGolOran),
    kgVar: yeni.kgVar === true
  };
  kayitlar[index] = guncellenmis;
  try {
    await env.HAVUZ_KV.put("veri", JSON.stringify(kayitlar));
  } catch (err) {
    return jsonResponse({ basarili: false, hata: "Kaydedilemedi." }, 500);
  }
  return jsonResponse({ basarili: true, kayit: guncellenmis });
}
__name(kayitDuzenle, "kayitDuzenle");
__name2(kayitDuzenle, "kayitDuzenle");
var index_default = {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/giris" && request.method === "POST") {
      return girisIsle(request, env);
    }
    if (pathname === "/cikis" && request.method === "POST") {
      return cikisIsle(request, env);
    }
    if (pathname === "/api/veri" && request.method === "GET") {
      if (!await oturumGecerliMi(request, env)) {
        return jsonResponse({ hata: "yetkisiz" }, 401);
      }
      let kayitlar = [];
      try {
        const ham = await env.HAVUZ_KV.get("veri");
        kayitlar = ham ? JSON.parse(ham) : [];
      } catch (err) {
        kayitlar = [];
      }
      return jsonResponse({ kayitlar });
    }
    // Günlük bülten: HAVUZ_KV "gunluk" anahtarı bir obje (macId -> kayıt).
    // Sekme için diziye çevrilip, maç saatine göre sıralanıp dönülür.
    if (pathname === "/api/gunluk" && request.method === "GET") {
      if (!await oturumGecerliMi(request, env)) {
        return jsonResponse({ hata: "yetkisiz" }, 401);
      }
      let kayitlar = [];
      try {
        const ham = await env.HAVUZ_KV.get("gunluk");
        const obj = ham ? JSON.parse(ham) : {};
        kayitlar = Object.values(obj || {});
        kayitlar.sort((a, b) => String(a.macZamani || "").localeCompare(String(b.macZamani || "")));
      } catch (err) {
        kayitlar = [];
      }
      return jsonResponse({ kayitlar });
    }
    // Haftalık: HAVUZ_KV "haftalik" anahtarı bir dizi (KG çıkan tüm maçların
    // ham kaydı) — ana veri ile aynı formatta, sadece evSahibi/deplasman ekli.
    if (pathname === "/api/haftalik" && request.method === "GET") {
      if (!await oturumGecerliMi(request, env)) {
        return jsonResponse({ hata: "yetkisiz" }, 401);
      }
      let kayitlar = [];
      try {
        const ham = await env.HAVUZ_KV.get("haftalik");
        kayitlar = ham ? JSON.parse(ham) : [];
      } catch (err) {
        kayitlar = [];
      }
      return jsonResponse({ kayitlar });
    }
    if (pathname === "/api/hesap-degistir" && request.method === "POST") {
      if (!await oturumGecerliMi(request, env)) {
        return jsonResponse({ basarili: false, hata: "yetkisiz" }, 401);
      }
      return hesapDegistir(request, env);
    }
    if (pathname === "/api/kayit-sil" && request.method === "POST") {
      if (!await oturumGecerliMi(request, env)) {
        return jsonResponse({ basarili: false, hata: "yetkisiz" }, 401);
      }
      return kayitSil(request, env);
    }
    if (pathname === "/api/kayit-duzenle" && request.method === "POST") {
      if (!await oturumGecerliMi(request, env)) {
        return jsonResponse({ basarili: false, hata: "yetkisiz" }, 401);
      }
      return kayitDuzenle(request, env);
    }
    if (pathname === "/" && request.method === "GET") {
      const girisli = await oturumGecerliMi(request, env);
      return htmlResponse(girisli ? tabloSayfasiHtml() : girisSayfasiHtml(null));
    }
    return new Response("Not found", { status: 404 });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
