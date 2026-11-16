#!/usr/bin/env python3
"""Download the openly licensed Wikimedia Commons photos listed in PHOTOS, resize them
(max 1600 px long edge, JPEG q82) plus 480 px thumbnails, and write assets/photos/credits.json.
Usage: python3 scripts/fetch_photos.py   (needs: pip install pillow)
Only Commons files with CC BY / CC BY-SA licences are used. Re-verify licences before launch."""
import json, re, io, os, sys, time, urllib.request, urllib.parse
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "photos"); os.makedirs(os.path.join(OUT, "thumb"), exist_ok=True)
UA = {"User-Agent": "nimba-demo-kit/1.0 (Dean Diallo; research)"}

# id -> (Commons title, what we verified, used_for)
PHOTOS = {
 "hero-massif": ("Mount Nimba Strict Nature Reserve-108450.jpg", "UNESCO-provided photo, file title and UNESCO page name Mount Nimba; green massif rising above savanna (viewed)", ["massif-overview","unesco-inscription"]),
 "grassland-valley": ("Mount Nimba Strict Nature Reserve-123989.jpg", "UNESCO-provided; montane grass slopes under cloud (viewed)", ["montane-grassland"]),
 "peak-green": ("Mount Nimba Strict Nature Reserve-108445.jpg", "UNESCO-provided; green peak above grassland (viewed)", ["richard-molard"]),
 "forest-canopy": ("Mount Nimba Strict Nature Reserve-108448.jpg", "UNESCO-provided; forest canopy (viewed)", ["lowland-forest"]),
 "forest-stream": ("Mount Nimba Strict Nature Reserve-108453.jpg", "UNESCO-provided; forest stream under a rock overhang (viewed)", ["water-tower","otter-shrew"]),
 "biosphere-sign": ("Mount Nimba Strict Nature Reserve-108442.jpg", "UNESCO-provided; sign reading Reserve de la Biosphere des Monts Nimba, Aire centrale, Site du Patrimoine mondial, Defense d'entrer (viewed)", ["unesco-inscription","danger-list"]),
 "montane-grassland": ("Nimba montanegrassland.jpg", "Commons caption: Mount Nimba - montane grassland (2016-11-23); viewed", ["montane-grassland","viviparous-toad"]),
 "protea-bushland": ("Nimba proteabush.jpg", "Commons caption: Mount Nimba - Protea bushland (2016-11-23); viewed", ["montane-grassland"]),
 "cloud-forest": ("Mount Nimba - cloud forests.jpg", "Commons caption: Mount Nimba - cloud forests (2016-11-23); viewed", ["cloud-forest"]),
 "rainforest-stream": ("Mount Nimba rainforest.jpg", "Commons: Photo by Manfred Schweda, 2006-11-28, Nzerekore trek page; stream in rainforest (viewed)", ["gallery-forest","water-tower"]),
 "savanna": ("Nimba savana.jpg", "Commons caption: Mount Nimba - surrounding savanna (2016-11-22); viewed", ["savanna-fire"]),
 "reserve-edge-ridge": ("Nimba mountainridge.jpg", "Commons caption: Mount Nimba - border of the reserve (2016-11-20); viewed", ["savanna-fire","transboundary"]),
 "grassland-above-forest": ("Mount Nimba high-altidtude grasslands above forest zone.jpg", "Commons: Photo by Manfred Schweda, 2006-11-28; high grassland above forest (viewed)", ["montane-grassland"]),
 "peak-strata": ("Monts Nimba 22.jpg", "Commons category Monts Nimba, 2021-06-27; peak with terraced slopes (viewed); exact peak not identified", ["massif-overview"]),
 "peak-cloudcap": ("Mont Nimba 01.jpg", "Commons title Mont Nimba, 2021-06-27; cloud-capped peak (viewed); exact peak not identified", ["massif-overview"]),
 "valley-view": ("Vue des Mont Nimba.jpg", "Commons title Vue des Mont Nimba, 2021-06-27; viewed", ["massif-overview"]),
 "liberia-side-summit": ("Atop Mount Nimba.jpg", "Commons caption: Atop Mount Nimba, at Nimba county (Liberia), 2020-03-06; viewed", ["transboundary"]),
 "liberia-pit-road": ("The Mount Nimba frontal view.jpg", "Commons caption says Atop Mount Nimba, Nimba county, Liberia, but the image (viewed) shows a dirt road into a terraced open-pit/quarry-like landscape with a pond: use only as Liberian-side mining-landscape, caption ambiguity flagged", ["mining-enclave"]),
 "toad-gestating-female": ("Nimbaphrynoides occidentalis gestating female.jpg", "Scientific-paper photo, species named in file title and description (Sandberger-Loua et al. 2017); viewed", ["viviparous-toad"]),
 "toad-amplexus": ("Nimbaphrynoides occidentalis female and male in amplexus.jpg", "Same source and authors; viewed", ["viviparous-toad"]),
 "toad-young-female": ("Nimbaphrynoides occidentalis young female.jpg", "Same source and authors; viewed", ["viviparous-toad"]),
 "chimp-bossou-1": ("Chimpanzé de Bossou 15.jpg", "Uploader label Chimpanze de Bossou (2021-06-28); chimpanzee visible; location from uploader label only", ["bossou-chimpanzees"]),
 "chimp-bossou-2": ("Chimpanzé de Bossou 27.jpg", "Uploader label Chimpanze de Bossou (2021-06-28); chimpanzee visible; location from uploader label only", ["bossou-chimpanzees"]),
 "chimp-nimba-lowland": ("Nimba westernchimps.jpg", "Commons caption: Mount Nimba - Western chimpanzees in lowland rainforest (2016-11-24); chimpanzee visible (viewed)", ["bossou-chimpanzees"]),
 "oil-palm-fruit": ("Fruit pour les chimpanzé de Bossou.jpg", "Uploader caption: fruit for the Bossou chimpanzees (2021-06-27); bunch of red palm fruits (viewed)", ["bossou-chimpanzees"]),
 "bossou-village": ("Village de Bossou.jpg", "Commons title Village de Bossou, 2021-06-28; viewed", ["bossou-village"]),
 "ireb-building": ("IREB de Bossou.jpg", "Commons geotag 7.64446, -8.50299; IREB building (viewed)", ["ireb-bossou"]),
 "ireb-sign": ("Plaque de l'IREB.jpg", "Commons geotag 7.64520, -8.50436; sign reads Institut de Recherche Environnementale de Bossou (viewed)", ["ireb-bossou"]),
 "bossou-market": ("Marché de Bossou.jpg", "Commons title Marche de Bossou, 2021-06-28; viewed", ["bossou-village"]),
 "corridor-planting": ("Transplantation au corridor.jpg", "Uploader caption: reforestation of the chimpanzee migration corridor (2019-05-28); viewed", ["green-corridor"]),
 "corridor-seedlings": ("Les plantules.jpg", "Uploader caption: nursery of plants used to restore the corridor (2021-06-28); viewed", ["green-corridor"]),
 "lamco-mine-1976": ("ASC Leiden - F. van der Kraaij Collection - 13 - 001 - LAMCO J.V. A landscape with open pit mining for iron ore. Excavators and lorries - Yekepa, Nimba county, Liberia - 1976.jpg", "Archival photo, ASC Leiden; open-pit iron-ore mining at Yekepa, Liberia, 1976 (title and description)", ["mining-enclave","transboundary"]),
}

def api(**p):
    p["format"] = "json"
    u = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(p)
    return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60))

def clean(s): return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).strip()

titles = ["File:" + v[0] for v in PHOTOS.values()]
info = {}
for i in range(0, len(titles), 40):
    r = api(action="query", titles="|".join(titles[i:i+40]), prop="imageinfo", iiprop="url|size|extmetadata", iiurlwidth="1600")
    for p in r["query"]["pages"].values():
        info[p["title"]] = p["imageinfo"][0]

credits = []
for pid, (title, verified, used) in PHOTOS.items():
    ii = info["File:" + title]; e = ii["extmetadata"]
    g = lambda k: clean(e.get(k, {}).get("value", ""))
    lic = g("LicenseShortName")
    if not lic.upper().startswith(("CC BY", "CC-BY", "PUBLIC DOMAIN", "CC0")):
        print("SKIP non-open licence", title, lic); continue
    url = ii.get("thumburl") or ii["url"]
    data = None
    for k in range(5):
        try: data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90).read(); break
        except Exception as ex: time.sleep(3 + 3 * k)
    if data is None: print("FAILED", title); continue
    im = Image.open(io.BytesIO(data)).convert("RGB")
    im.thumbnail((1600, 1600)); fn = pid + ".jpg"
    im.save(os.path.join(OUT, fn), "JPEG", quality=82, optimize=True, progressive=True)
    t = im.copy(); t.thumbnail((480, 480)); t.save(os.path.join(OUT, "thumb", fn), "JPEG", quality=78, optimize=True)
    author = g("Artist")
    page = "https://commons.wikimedia.org/wiki/" + urllib.parse.quote("File:" + title.replace(" ", "_"))
    credits.append({
        "file": "assets/photos/" + fn, "thumb": "assets/photos/thumb/" + fn, "width": im.width, "height": im.height,
        "commons_title": "File:" + title, "source_url": page, "original_url": ii["url"],
        "author": author, "license": lic, "license_url": g("LicenseUrl"),
        "attribution": f'"{os.path.splitext(title)[0]}" by {author}, {lic}, via Wikimedia Commons ({page})',
        "date": g("DateTimeOriginal"), "description": g("ImageDescription")[:240],
        "verified_as": verified, "hotspots": used, "modified": "resized and recompressed for web",
    })
    print("ok", fn, im.size, lic)
    time.sleep(0.5)
cj = os.path.join(ROOT, "public", "data", "content.json")
if os.path.exists(cj):   # link photos to hotspots using content.json (single source of truth)
    used = {}
    for h in json.load(open(cj))["hotspots"]:
        for ph in h.get("photos", []): used.setdefault(ph, []).append(h["id"])
    for c in credits: c["hotspots"] = used.get(os.path.splitext(os.path.basename(c["file"]))[0], [])
json.dump(credits, open(os.path.join(OUT, "credits.json"), "w"), ensure_ascii=False, indent=2)
print(len(credits), "photos written")
