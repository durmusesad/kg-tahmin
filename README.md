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
- `index.html` tamamen statiktir; `data/odds.json`'ı okuyup listeler, sayfa
  görünür olduğunda ve her 3 dakikada bir kendini yeniler. Sunucu/backend yoktur.

## Tahmin mantığı

Bir maç şu ikisi de sağlanırsa "KG Oynanabilir" olarak işaretlenir:

- İY/MS Karşılıklı Gol oranının tam kısmı ≥ 14
- 6+ Gol oranının tam kısmı ≥ 13

Bu tamamen kullanıcı tarafından belirlenmiş bir sezgisel eşiktir, istatistiksel
bir garanti değildir. `scraper.py` içindeki `IYMS_KG_ESIK` ve `ALT_UST_6_ESIK`
sabitlerinden değiştirilebilir.

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

## Lokalde çalıştırma

```bash
pip install -r requirements.txt
python scraper.py        # data/odds.json'ı üretir
python -m http.server     # sonra localhost'ta index.html'i aç
```

## Not

Oranlar yalnızca bilgilendirme amaçlıdır, yatırım/bahis tavsiyesi değildir.
