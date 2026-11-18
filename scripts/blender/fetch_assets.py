"""Download the CC0 Poly Haven models used by the Blender renders (glTF + textures) into scripts/blender/assets/.

    python scripts/blender/fetch_assets.py [1k|2k|4k]

Standard library only (runs on any machine with Python 3). Already-downloaded files are skipped.
Writes assets/credits.json (name, authors, licence, URL) for the app's credits.
"""
import json
import pathlib
import sys
import urllib.request

ASSETS = {
    # ground cover (summit grassland, savanna, regrowth)
    "grass_medium_02": "grass", "grass_bermuda_01": "grass",
    "shrub_01": "shrub", "shrub_02": "shrub", "shrub_03": "shrub", "shrub_04": "shrub",
    "fern_02": "fern", "calathea_orbifolia_01": "herb", "pachira_aquatica_01": "shrub",
    # rocks (summit outcrops, mine benches)
    "boulder_01": "rock", "rock_07": "rock", "rock_09": "rock", "rock_moss_set_01": "rock", "stone_01": "rock",
    # broadleaf trees (generic stand-ins, not Nimba species)
    "island_tree_01": "tree", "island_tree_02": "tree", "island_tree_03": "tree", "tree_small_02": "tree",
}
API = "https://api.polyhaven.com"
OUT = pathlib.Path(__file__).resolve().parent / "assets"
UA = {"User-Agent": "nimba-3d-blender-fetch"}


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def main(res: str = "1k") -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    credits = {}
    for aid, role in ASSETS.items():
        files = json.loads(get(f"{API}/files/{aid}"))
        info = json.loads(get(f"{API}/info/{aid}"))
        g = files["gltf"].get(res) or files["gltf"]["1k"]
        entry = g["gltf"]
        d = OUT / aid
        d.mkdir(exist_ok=True)
        todo = [(d / f"{aid}.gltf", entry["url"])] + [(d / p, f["url"]) for p, f in entry.get("include", {}).items()]
        # the glTF points its transparency at the colour JPEG (no alpha): fetch the separate alpha masks too
        for key, maps in files.items():
            if "alpha" in key.lower() and isinstance(maps, dict):
                m = (maps.get(res) or maps.get("1k") or {}).get("jpg")
                if m:
                    todo.append((d / "textures" / m["url"].rsplit("/", 1)[-1], m["url"]))
        for path, url in todo:
            if path.exists() and path.stat().st_size > 0:
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(get(url))
        credits[aid] = {
            "name": info.get("name", aid), "role": role, "authors": list(info.get("authors", {}).keys()),
            "licence": "CC0 1.0", "url": f"https://polyhaven.com/a/{aid}",
        }
        print(f"{aid:24s} {role:6s} ok")
    (OUT / "credits.json").write_text(json.dumps(credits, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "1k")
