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
"""
import json
import logging
import math
import sys
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
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json",
}
OUT_PATH = Path(__file__).parent / "data" / "odds.json"

# Tahmin eşikleri: küsürat atılır (int()), tam sayı kısmına bakılır.
IYMS_KG_ESIK = 14
ALT_UST_6_ESIK = 13


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


def maclari_isle(veri):
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

        onerilen = (
            iyms_kg is not None and alt_ust_6 is not None
            and math.floor(iyms_kg) >= IYMS_KG_ESIK
            and math.floor(alt_ust_6) >= ALT_UST_6_ESIK
        )

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
        })

    maclar.sort(key=lambda m: m["macZamani"])
    return maclar


def main():
    try:
        veri = bulten_cek()
    except requests.exceptions.RequestException as hata:
        log.error("Bülten çekilemedi: %s", hata)
        if OUT_PATH.exists():
            log.info("Mevcut data/odds.json korunuyor.")
            sys.exit(0)
        veri = None

    maclar = maclari_isle(veri) if veri else []

    cikti = {
        "guncellemeZamani": datetime.now(tz=ISTANBUL_TZ).isoformat(),
        "macSayisi": len(maclar),
        "maclar": maclar,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(cikti, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Yazıldı: %s (%d maç, %d önerilen)", OUT_PATH, len(maclar),
              sum(1 for m in maclar if m["onerilen"]))


if __name__ == "__main__":
    main()
