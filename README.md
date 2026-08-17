# KG Tahmin

Nesine.com'un genel (giriş gerektirmeyen) bülten API'sinden futbol maçlarını çeker;
**MS Karşılıklı Gol**, **6+ Gol** ve **İY/MS Karşılıklı Gol** oranlarına bakarak
"Karşılıklı Gol oynanabilir" olarak işaretlenen maçları ayrı bir listede gösterir.

Canlı site: `https://drms02.github.io/kg-tahmin/` (GitHub Pages'te yayınlandıktan sonra aktif olur)

## Nasıl çalışır

- `scraper.py`, Nesine'nin `getprebultenfull` uç noktasından ham bülteni çeker ve
  `data/odds.json` dosyasına yazar.
- `.github/workflows/update-and-deploy.yml` bu script'i **her 10 dakikada bir**
  (ve her `main`'e push'ta) otomatik çalıştırır, veriyi commit'ler ve siteyi
  GitHub Pages'e deploy eder.
- `index.html` tamamen statiktir; önce `worker/` altındaki Cloudflare Worker
  proxy'sinden (bkz. aşağıdaki bölüm) taze veri çekmeyi dener, erişilemezse
  `data/odds.json` / `data/live.json`'a düşer. Sayfa görünür olduğunda ve her
  1 dakikada bir kendini yeniler. Sunucu/backend yoktur (Worker hariç).

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
MS KG (karşılıklı gol) çıktığıdır.

Canlı bir maçın İY/MS KG ve 6+ Gol oranları küsüratsız hale getirilip bu
tabloda aranır:

- Çift tabloda **yoksa** → maç önerilmez (geçmiş veri yok).
- Çift tabloda **varsa** → maç listelenir, o çiftin geçmiş tutma oranıyla
  (`tutma/toplam`) etiketlenir.

Eşleşen maçlar iki güven seviyesine ayrılır (`scraper.py` → `guven` alanı):

- **Kesin**: çift en az 3 kez denenmiş VE hepsinde (%100) tutmuş.
- **Olası**: çift geçmişte var ama ya 3'ten az denenmiş ya da %100'ün altında tutmuş.

Site bu ikisini ayrı sekmelerde gösterir (artı "Tüm Bülten" — geçmiş verisi
olsun olmasın bültendeki her maç), her sekmede lig filtresi ve sıralama
seçeneği (tutma oranı, oran değeri, saat) vardır. Bu tamamen kullanıcının
kendi Excel analizine dayanan sezgisel bir sınıflandırmadır, istatistiksel
bir garanti değildir — özellikle "Olası" sekmesindeki düşük örnekli çiftlerin
oranı güvenilir olmayabilir.

`data/historical_stats.json` statik bir anlık görüntüdür; Excel tablosu
güncellendikçe yeniden üretilip commit'lenmesi gerekir (otomatik değildir,
çünkü OneDrive'a kimlik doğrulamalı erişim CI'da yoktur).

## Canlı Maçlar

Site ayrı bir **Canlı** sekmesinde, o an oynanmakta olan maçları oynanan
dakika ve güncel skorla birlikte listeler (en son başlayan üstte).

- `scraper.py`, `getlivebultenv3` uç noktasından canlı futbol maçlarını,
  `ls.nesine.com/.../GetLiveBetResultsWithVersion` uç noktasından da
  durum/skor verisini çekip maç kimliğine (`C`) göre eşleştirir, sonucu
  `data/live.json`'a yazar.
- Dakika, Nesine'nin gönderdiği devre başlangıç zaman damgalarından
  (`MDT`: ilk yarı/devre arası/ikinci yarı/maç sonu) hesaplanır; skor ise
  devre bazlı gol sayılarının (`ES`) toplamıdır.
- Canlı bültende **KG / 6+ Gol / İY-MS KG oranları henüz gösterilmiyor** —
  incelemede bu marketlerin (MTID 38/43/801) in-play akışta hiç sunulmadığı
  görüldü (yalnızca farklı, doğrulanmamış market kodlarıyla sınırlı bir
  canlı bahis menüsü var). Bu yüzden canlı sekmesi şimdilik yalnızca
  dakika + skor gösterir, tahmin/kupon sistemine dahil değildir.
- Aynı mantık `worker/src/index.js`'in `/canli` rotasında da JS'e taşınmıştır;
  `index.html` önce oradan (CORS'a açık, ~30sn edge cache) taze veri çekmeyi
  dener, erişilemezse `data/live.json`'a (GitHub Actions'ın periyodik yazdığı,
  dakikalarca gecikmeli olabilen dosya) düşer.

## Market kodları (MTID)

Nesine market kimliklerini resmi olarak yayınlamıyor; aşağıdaki eşleşmeler
canlı bülten verisindeki oran şekilleri (kaç seçenek olduğu, hangisinin favori/
nadir olduğu) analiz edilerek çıkarıldı:

| Market | MTID | SOV | Seçenek (N) |
|---|---|---|---|
| Maç Sonu Karşılıklı Gol – Var | 38 | 0.0 | 1 |
| Toplam Gol Aralığı – "6+" | 43 | 0.0 | 4 |
| İY + MS Karşılıklı Gol – "Evet/Evet" | 801 | 0.0 | 3 |

Nesine site yapısını değiştirirse `scraper.py` içindeki bu eşleşmelerin
güncellenmesi gerekebilir.

## Cloudflare Worker (canlı proxy)

Nesine'nin API'leri tarayıcıdan doğrudan erişime (CORS) kapalı; bu yüzden
GitHub Actions'ın periyodik yazdığı statik dosyalar tek başına dakikalarca
gecikmeli kalıyordu. `worker/src/index.js`, `scraper.py`'daki bülten çekme/
eşleştirme mantığının bir Cloudflare Worker portudur:

- `GET /` → ön-maç bülteni (`data/odds.json` ile aynı şema), 60sn edge cache.
- `GET /canli` → canlı maçlar (`data/live.json` ile aynı şema), 30sn edge cache.

`index.html` her zaman önce bu Worker'ı dener, erişilemezse statik dosyalara
düşer (bkz. yukarıdaki bölümler). Deploy için:

```bash
cd worker
npx wrangler login        # bir kereye mahsus, Cloudflare hesabına bağlar
npx wrangler deploy
```

`wrangler.toml` içindeki `account_id` ve worker adı (`kg-tahmin-bulten`)
sabit; `index.html`'deki `LIVE_ENDPOINT` sabiti bu worker'ın URL'siyle
eşleşmelidir.

## Lokalde çalıştırma

```bash
pip install -r requirements.txt
python scraper.py        # data/odds.json ve data/live.json'ı üretir
python -m http.server     # sonra localhost'ta index.html'i aç
```

## Not

Oranlar yalnızca bilgilendirme amaçlıdır, yatırım/bahis tavsiyesi değildir.
