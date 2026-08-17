"""
Nesine.com pre-bülten API'sinden futbol bültenini çeker, üç market'i çıkarır
(MS KG, 6+ Gol, İY/MS KG) ve data/odds.json dosyasına yazar.

Market kodları (MTID = Nesine market tipi id'si, canlı veriyle doğrulandı):
  38  (SOV 0.0) -> Maç Sonu Karşılıklı Gol (Var/Yok)     N=1 Var, N=2 Yok
  43  (SOV 0.0) -> Toplam Gol Aralığı (0-1/2-3/4-5/6+)    N=4 "6+"
  801 (SOV 0.0) -> İlk Yarı + Maç Sonu Karşılıklı Gol     N=3 "Evet/Evet" (en nadir/en yüksek oran)

Nesine resmi bir API dokümantasyonu yayınlamıyor; bu eşleşmeler binlerce
canlı maçın oran şekli (kaç seçenek, hangisinin favori/nadir olduğu) analiz
edilerek çıkarıldı. Nesine site yapısını değiştirirse burası güncellenmelidir.

Tahmin mantığı: data/historical_stats.json içindeki geçmiş maç verisine
(kullanıcının "UFUK CİVAŞ 2026 MODEL İDDAA" Excel tablosu) bakılır. Canlı
maçın İY/MS KG ve 6+ Gol oranlarının küsüratsız (tam sayı) çifti, o çiftin
geçmişte kaç kez denenip kaçında gerçekten KG (MS'de her iki takım da gol
attı) çıktığıyla eşleştirilir. Çift geçmiş veride hiç yoksa maç önerilmez.

Ayrıca `getlivebultenv3` (canlı futbol maçları) ve `ls.nesine.com`'un
`GetLiveBetResultsWithVersion` uç noktasını (dakika/skor) birleştirip
data/live.json'a yazar; bkz. canli_maclari_isle().
"""
import json
import logging
import math
from datetime import datetime, timezone
from pathlib import Path

import requests

try:
    from zoneinfo import ZoneInfo
    ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")
except ImportError:
    import pytz
    ISTANBUL_TZ = pytz.timezone("Europe/Istanbul")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

BULTEN_URL = "https://cdnbulten.nesine.com/api/bulten/getprebultenfull"
LIVE_BULTEN_URL = "https://bulten.nesine.com/api/bulten/getlivebultenv3"
LIVE_SCORE_URL = "https://ls.nesine.com/api/v2/Bet/GetLiveBetResultsWithVersion"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json",
}
OUT_PATH = Path(__file__).parent / "data" / "odds.json"
LIVE_OUT_PATH = Path(__file__).parent / "data" / "live.json"
STATS_PATH = Path(__file__).parent / "data" / "historical_stats.json"


def gecmis_istatistikleri_yukle():
    veri = json.loads(STATS_PATH.read_text(encoding="utf-8"))
    return veri.get("ciftler", {})


def _lig_adi_bul(ligler, lc):
    lc_str = str(lc)
    for lig in ligler:
        if str(lig.get("LID", "")) == lc_str:
            return lig.get("N", "Bilinmiyor")
    return "Bilinmiyor"


def _esd_to_dt(esd_ms):
    try:
        return datetime.fromtimestamp(int(esd_ms) / 1000, tz=timezone.utc).astimezone(ISTANBUL_TZ)
    except (TypeError, ValueError, OSError):
        return None


def _oran_bul(ma_listesi, mtid, sov, n):
    for market in ma_listesi:
        if market.get("MTID") != mtid:
            continue
        try:
            if float(market.get("SOV", 0)) != sov:
                continue
        except (TypeError, ValueError):
            continue
        for opsiyon in market.get("OCA", []):
            if opsiyon.get("N") == n:
                try:
                    oran = float(opsiyon.get("O", 0))
                except (TypeError, ValueError):
                    return None
                return oran if oran > 1.0 else None
    return None


def bulten_cek():
    resp = requests.get(BULTEN_URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.json()


def canli_bulten_cek():
    resp = requests.get(
        LIVE_BULTEN_URL, headers=HEADERS,
        params={"eventVersion": 0, "oddVersion": 0}, timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def canli_skor_cek():
    resp = requests.get(LIVE_SCORE_URL, headers=HEADERS, params={"v": 0}, timeout=15)
    resp.raise_for_status()
    return resp.json()


def _mdt_zamanlari(kayit):
    """Nesine'nin MDT alanındaki devre başlangıç/bitiş zaman damgalarını T koduna göre eşler:
    1=ilk yarı başlangıcı, 2=devre arası başlangıcı, 3=ikinci yarı başlangıcı, 4=maç sonu."""
    zamanlar = {}
    for m in kayit.get("MDT", []) or []:
        deger = m.get("value")
        t = m.get("T")
        if not deger:
            continue
        try:
            zamanlar[t] = datetime.fromisoformat(deger.replace("Z", "+00:00"))
        except ValueError:
            continue
    return zamanlar


def _dakika_hesapla(kayit, simdi):
    """Canlı skor kaydından oynanan dakikayı (veya devre arası/maç sonu gibi durumu) çıkarır.
    Maç henüz başlamamışsa veya bitmişse None döner (canlı listesine girmemesi için)."""
    st = (kayit.get("ST") or "").strip()
    if st == "MS":
        return None
    zamanlar = _mdt_zamanlari(kayit)
    t1, t2, t3, t4 = zamanlar.get(1), zamanlar.get(2), zamanlar.get(3), zamanlar.get(4)

    if t4:
        return None  # maç bitmiş
    if t3:
        dakika = 45 + int((simdi - t3).total_seconds() // 60) + 1
        return f"{min(dakika, 120)}'"
    if t2:
        return "Devre Arası"
    if t1:
        dakika = int((simdi - t1).total_seconds() // 60) + 1
        return f"{min(dakika, 45)}'"
    if st and st != "Başlamadı.":
        return st  # futbol dışı / standart olmayan durum metni
    return None  # henüz başlamamış


def _canli_skor(kayit):
    toplam_ev = toplam_dep = 0
    goruldu = False
    for es in kayit.get("ES", []) or []:
        if es.get("T") in (1, 2, 3):
            try:
                toplam_ev += int(es.get("H", 0))
                toplam_dep += int(es.get("A", 0))
                goruldu = True
            except (TypeError, ValueError):
                pass
    return (toplam_ev, toplam_dep) if goruldu else (None, None)


def canli_maclari_isle(canli_bulten_verisi, canli_skor_verisi):
    sg = canli_bulten_verisi.get("sg", {})
    etkinlikler = sg.get("EA", [])
    ligler = sg.get("LA", [])
    simdi = datetime.now(tz=timezone.utc)

    skor_map = {}
    for kayit in (canli_skor_verisi or {}).get("d", []) or []:
        c = kayit.get("C") or kayit.get("NID")
        if c is not None:
            skor_map[c] = kayit

    maclar = []
    for e in etkinlikler:
        if e.get("GT") != 1:  # sadece futbol
            continue

        skor_kayit = skor_map.get(e.get("C"))
        if not skor_kayit:
            continue

        dakika = _dakika_hesapla(skor_kayit, simdi)
        if dakika is None:
            continue  # henüz başlamamış ya da bitmiş

        ev_sahibi = str(e.get("HN", "")).strip()
        deplasman = str(e.get("AN", "")).strip()
        if not ev_sahibi or not deplasman:
            continue

        mac_zamani = _esd_to_dt(e.get("ESD"))
        skor_ev, skor_dep = _canli_skor(skor_kayit)

        maclar.append({
            "id": str(e.get("C", "")),
            "lig": _lig_adi_bul(ligler, e.get("LC")),
            "evSahibi": ev_sahibi,
            "deplasman": deplasman,
            "macZamani": mac_zamani.isoformat() if mac_zamani else None,
            "dakika": dakika,
            "skorEv": skor_ev,
            "skorDep": skor_dep,
        })

    maclar.sort(key=lambda m: m["macZamani"] or "", reverse=True)  # yeni başlayan üstte
    return maclar


def maclari_isle(veri, gecmis):
    sg = veri.get("sg", {})
    etkinlikler = sg.get("EA", [])
    ligler = sg.get("LA", [])
    simdi = datetime.now(tz=ISTANBUL_TZ)

    maclar = []
    for e in etkinlikler:
        if e.get("GT") != 1:
            continue

        ev_sahibi = str(e.get("HN", "")).strip()
        deplasman = str(e.get("AN", "")).strip()
        if not ev_sahibi or not deplasman:
            continue

        mac_zamani = _esd_to_dt(e.get("ESD"))
        if mac_zamani is None or mac_zamani < simdi:
            continue  # başlamış / geçmiş maçları listeleme

        ma = e.get("MA", [])
        ms_kg = _oran_bul(ma, 38, 0.0, 1)
        alt_ust_6 = _oran_bul(ma, 43, 0.0, 4)
        iyms_kg = _oran_bul(ma, 801, 0.0, 3)

        onerilen = False
        tutma = None
        toplam = None
        tutma_orani = None
        guven = None  # "kesin" | "olasi" | None
        if iyms_kg is not None and alt_ust_6 is not None:
            cift_anahtari = f"{math.floor(iyms_kg)},{math.floor(alt_ust_6)}"
            istatistik = gecmis.get(cift_anahtari)
            if istatistik:
                tutma = istatistik["tutma"]
                toplam = istatistik["toplam"]
                tutma_orani = tutma / toplam
                onerilen = True
                # "Kesin": en az 3 geçmiş örnek ve hepsi tutmuş (%100).
                # Daha az örnekli veya %100'ün altındaki her şey "olası".
                guven = "kesin" if (toplam >= 3 and tutma_orani == 1.0) else "olasi"

        maclar.append({
            "id": str(e.get("C", "")),
            "lig": _lig_adi_bul(ligler, e.get("LC")),
            "evSahibi": ev_sahibi,
            "deplasman": deplasman,
            "macZamani": mac_zamani.isoformat(),
            "msKg": ms_kg,
            "altUst6": alt_ust_6,
            "iymsKg": iyms_kg,
            "onerilen": onerilen,
            "tutma": tutma,
            "toplam": toplam,
            "tutmaOrani": tutma_orani,
            "guven": guven,
        })

    maclar.sort(key=lambda m: m["macZamani"])
    return maclar


def main():
    gecmis = gecmis_istatistikleri_yukle()

    try:
        veri = bulten_cek()
        onceki_bulten_korunuyor = False
    except requests.exceptions.RequestException as hata:
        log.error("Bülten çekilemedi: %s", hata)
        veri = None
        onceki_bulten_korunuyor = OUT_PATH.exists()

    if onceki_bulten_korunuyor:
        log.info("Mevcut data/odds.json korunuyor.")
    else:
        maclar = maclari_isle(veri, gecmis) if veri else []
        cikti = {
            "guncellemeZamani": datetime.now(tz=ISTANBUL_TZ).isoformat(),
            "macSayisi": len(maclar),
            "maclar": maclar,
        }
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(json.dumps(cikti, ensure_ascii=False, indent=2), encoding="utf-8")
        log.info("Yazıldı: %s (%d maç, %d önerilen)", OUT_PATH, len(maclar),
                  sum(1 for m in maclar if m["onerilen"]))

    try:
        canli_bulten = canli_bulten_cek()
        canli_skor = canli_skor_cek()
        canli_maclar = canli_maclari_isle(canli_bulten, canli_skor)
    except requests.exceptions.RequestException as hata:
        log.error("Canlı bülten çekilemedi: %s", hata)
        canli_maclar = None

    if canli_maclar is not None:
        canli_cikti = {
            "guncellemeZamani": datetime.now(tz=ISTANBUL_TZ).isoformat(),
            "macSayisi": len(canli_maclar),
            "maclar": canli_maclar,
        }
        LIVE_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        LIVE_OUT_PATH.write_text(json.dumps(canli_cikti, ensure_ascii=False, indent=2), encoding="utf-8")
        log.info("Yazıldı: %s (%d canlı maç)", LIVE_OUT_PATH, len(canli_maclar))
    elif LIVE_OUT_PATH.exists():
        log.info("Mevcut data/live.json korunuyor.")


if __name__ == "__main__":
    main()
