# KG Tahmin

Nesine.com'un genel (giriş gerektirmeyen) bülten API'sinden futbol maçlarını çeker;
**MS Karşılıklı Gol**, **6+ Gol** ve **İY/MS Karşılıklı Gol** oranlarına bakarak
"Karşılıklı Gol oynanabilir" olarak işaretlenen maçları ayrı bir listede gösterir.

Canlı site: **https://kg-tahmin-bulten.durmusesad568.workers.dev**

## Mimari — tamamen Cloudflare üzerinde

Sistem tek bir Cloudflare Worker üzerinde çalışır (`worker/src/index.js`).
GitHub Actions/Pages **kullanılmıyor** — GitHub sadece kod deposu (kaynak
kontrolü) olarak kullanılıyor, herhangi bir otomasyon/deploy GitHub üzerinden
tetiklenmiyor.

Worker tek domainde hem sayfayı hem veriyi sunar:

- `GET /` → `index.html`'i doğrudan döner (statik sayfa).
- `GET /api/bulten` → ön-maç bülteni + KG/6+ Gol/İY-MS-KG tahmini, 60sn edge cache.
- `GET /api/canli` → o an oynanan maçlar (dakika, skor), 30sn edge cache.

`index.html` bu iki API'yi aynı origin'den (relative path, `/api/bulten` ve
`/api/canli`) çeker; sayfa görünür olduğunda ve her 1 dakikada bir kendini
yeniler. Statik dosya/fallback yoktur — Worker çalışmıyorsa "Bülten
yüklenemedi" mesajı gösterilir.

Nesine'nin API'leri tarayıcıdan doğrudan erişime (CORS) kapalı olduğu için
bu proxy gerekiyor; Worker Nesine'den anlık veri çekip edge'de kısa süreli
cache'ler, böylece hem CORS aşılıyor hem Nesine'ye aşırı istek gitmiyor.

### Deploy

```bash
cd worker
CLOUDFLARE_API_TOKEN=... npx wrangler deploy
```

Token'a **Account → Workers Scripts → Edit** ve **Account → Workers KV
Storage → Edit** izinleri gerekli (ikincisi `KG_SNAPSHOTS` KV namespace'i
için — bkz. "Canlı Maçlar" bölümü). `wrangler.toml` içindeki `account_id`,
worker adı (`kg-tahmin-bulten`) ve `kv_namespaces` id'si sabittir; bunlar
değişirse site URL'si veya canlı tahmin verisi de değişir/kaybolur.

## Kupon (kazanç hesaplayıcı)

Nesine mobil uygulamasındaki kupon deneyimine benzer, tamamen istemci
tarafında çalışan bir hesaplayıcı: bir maçın detayını açıp "Kupona Ekle"ye
basınca o maç "Karşılıklı Gol · Var" seçimiyle kupona eklenir, ekranın altında
maç sayısı ve toplam oranı gösteren bir çubuk belirir, çubuğa dokununca
Nesine'deki gibi bir alt sekme (bottom sheet) açılır. Orada sadece bir
**tutar** girilir ve **olası kazanç** hesaplanır — tekli/kombine/sistem
oyunu ayrımı ya da kupon adedi yoktur, sadece basit bir kazanç tahmini.

Kupondaki oranlar sitenin geri kalanında kullanılan ham Nesine oranı
**değildir** — iddaa.com'un (resmi İddaa sitesi) aynı maçlarda Nesine'den
ortalama %3,7 daha yüksek oran gösterdiği gözlemine dayanarak her oran
`× 1.037` ile çarpılıp gösterilir (`IDDAA_CARPAN` sabiti, `index.html`
içinde). Kupon `localStorage`'da tutulur, sayfa yenilense de kaybolmaz.

## Tahmin mantığı

`data/historical_stats.json`, kullanıcının "UFUK CİVAŞ 2026 MODEL İDDAA" adlı
Excel tablosundan (493 geçmiş maç) türetilmiş bir bakış tablosudur: İY/MS KG
ve 6+ Gol oranlarının **küsüratsız (tam sayı) çifti** anahtar olarak kullanılır
(ör. `"14,13"`), değeri de o çiftin geçmişte kaç kez denenip kaçında gerçekten
MS KG (karşılıklı gol) çıktığıdır. Bu dosya `worker/src/index.js` tarafından
build sırasında doğrudan import edilir (`import gecmisData from
"../../data/historical_stats.json"`), yani **silinmemeli/taşınmamalı**.

Canlı bir maçın İY/MS KG ve 6+ Gol oranları küsüratsız hale getirilip bu
tabloda aranır:

- Çift tabloda **yoksa** → maç önerilmez (geçmiş veri yok).
- Çift tabloda **varsa** → maç listelenir, o çiftin geçmiş tutma oranıyla
  (`tutma/toplam`) etiketlenir.

Eşleşen maçlar iki güven seviyesine ayrılır (`guven` alanı):

- **Kesin**: çift en az 3 kez denenmiş VE hepsinde (%100) tutmuş.
- **Olası**: çift geçmişte var ama ya 3'ten az denenmiş ya da %100'ün altında tutmuş.

Site bu ikisini ayrı sekmelerde gösterir (artı "Tüm Bülten" — geçmiş verisi
olsun olmasın bültendeki her maç), her sekmede lig filtresi ve sıralama
seçeneği (tutma oranı, oran değeri, saat) vardır. Bu tamamen kullanıcının
kendi Excel analizine dayanan sezgisel bir sınıflandırmadır, istatistiksel
bir garanti değildir — özellikle "Olası" sekmesindeki düşük örnekli çiftlerin
oranı güvenilir olmayabilir.

`data/historical_stats.json` statik bir anlık görüntüdür; Excel tablosu
güncellendikçe yeniden üretilip commit'lenmesi ve worker'ın yeniden deploy
edilmesi gerekir (otomatik değildir).

## Canlı Maçlar

Site ayrı bir **Canlı** sekmesinde, o an oynanmakta olan maçları oynanan
dakika ve güncel skorla birlikte listeler (en son başlayan üstte); alt
filtre olarak **Tümü / Kesin / Olası** ayrımı da vardır — tıpkı maç önü
tahminindeki gibi.

- `worker/src/index.js`'in `/api/canli` rotası, Nesine'nin `getlivebultenv3`
  uç noktasından canlı futbol maçlarını, `ls.nesine.com/.../
  GetLiveBetResultsWithVersion` uç noktasından da durum/skor verisini çekip
  maç kimliğine (`C`) göre eşleştirir.
- Dakika, Nesine'nin gönderdiği devre başlangıç zaman damgalarından
  (`MDT`: ilk yarı/devre arası/ikinci yarı/maç sonu) hesaplanır; skor ise
  devre bazlı gol sayılarının (`ES`) toplamıdır.
- Canlı bültende **KG / 6+ Gol / İY-MS KG oranları hiç sunulmuyor** —
  incelemede bu marketlerin (MTID 38/43/801) in-play akışta, maçın en
  market-zengin anında (ilk yarının başı) bile hiç bulunmadığı doğrulandı.
  Bunun yerine **"maç öncesi son oran"** yakalanıp kullanılır:

  - `wrangler.toml`'daki `[triggers]` ile worker'a bağlı bir **Cron
    Trigger** her dakika `scheduled()` handler'ını (`snapshotAlVeYaz`)
    çalıştırır; o an kickoff'a ≤2 dakika kalmış ve KG/6+ Gol/İY-MS-KG
    oranı olan her maçın o anki oranı + `guven` (Kesin/Olası) hesabı bir
    **Workers KV** namespace'ine (`KG_SNAPSHOTS`, maç id'sine göre, 6 saat
    TTL ile) yazılır.
  - `/api/canli` bir maçı listelerken KV'den o maçın son yazılmış anlık
    görüntüsünü okur (`canliyaTahminEkle`); varsa oran + tier chip'leri
    ve "bu oran maç öncesi son değerdir, canlı güncellenmez" notuyla
    gösterilir, yoksa "son oranı yakalanamadı" notu gösterilir.
  - Bu snapshot'lar **kupona eklenemez** — donmuş/bayat oran olduğu için
    gerçek bahis kararına temel oluşturmaması amaçlanmıştır, sadece
    bilgilendiricidir.
  - KV yazma bütçesi: günde ~250 maç × maçın kickoff'a ≤2dk kaldığı ~2
    cron tik'i ⇒ günlük ~500 yazma, Workers KV free plan'ın (1000/gün)
    altında kalacak şekilde tasarlandı.

## Market kodları (MTID)

Nesine market kimliklerini resmi olarak yayınlamıyor; aşağıdaki eşleşmeler
canlı bülten verisindeki oran şekilleri (kaç seçenek olduğu, hangisinin favori/
nadir olduğu) analiz edilerek çıkarıldı:

| Market | MTID | SOV | Seçenek (N) |
|---|---|---|---|
| Maç Sonu Karşılıklı Gol – Var | 38 | 0.0 | 1 |
| Toplam Gol Aralığı – "6+" | 43 | 0.0 | 4 |
| İY + MS Karşılıklı Gol – "Evet/Evet" | 801 | 0.0 | 3 |

Nesine site yapısını değiştirirse `worker/src/index.js` içindeki bu
eşleşmelerin güncellenmesi gerekebilir.

## scraper.py (artık kullanılmıyor, referans amaçlı)

`scraper.py`, worker'ın JS mantığının orijinal Python taslağıydı. Artık
hiçbir otomasyon onu çalıştırmıyor — tüm mantık `worker/src/index.js`'e
taşındı. Sadece lokalde mantığı Python'da denemek/hata ayıklamak isteyenler
için repoda bırakıldı:

```bash
pip install -r requirements.txt
python scraper.py
```

## Not

Oranlar yalnızca bilgilendirme amaçlıdır, yatırım/bahis tavsiyesi değildir.
