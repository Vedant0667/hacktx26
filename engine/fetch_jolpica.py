"""Fetch laps, pitstops and results from Jolpica (Ergast successor) into data/jolpica/<race>/.

Run once with network; the app and engine only read the cached files.
"""
import json
import time
import urllib.request
from pathlib import Path

BASE = "https://api.jolpi.ca/ergast/f1"
OUT = Path(__file__).resolve().parent.parent / "data" / "jolpica"
RACES = {"2025-qatar": (2025, 23), "2026-singapore": (2026, 17)}
PAGE = 100


def get(url):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "pit-wall-party/0.1 (HackTX 2026)"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            raise
        finally:
            time.sleep(0.35)
    raise RuntimeError(f"gave up on {url}")


def paged(path, key):
    """Return the list of Races[0] items for `key`, merging pages (laps/pitstops are split across pages)."""
    offset, total, merged = 0, None, None
    while total is None or offset < total:
        d = get(f"{BASE}/{path}/?limit={PAGE}&offset={offset}")["MRData"]
        total = int(d["total"])
        races = d["RaceTable"]["Races"]
        if races:
            items = races[0].get(key, [])
            if merged is None:
                merged = races[0]
            elif key == "Laps":
                byn = {l["number"]: l for l in merged["Laps"]}
                for l in items:
                    if l["number"] in byn:
                        byn[l["number"]]["Timings"].extend(l["Timings"])
                    else:
                        merged["Laps"].append(l)
                        byn[l["number"]] = l
            else:
                merged[key].extend(items)
        offset += PAGE
    return merged, total


def main():
    for name, (year, rnd) in RACES.items():
        d = OUT / name
        d.mkdir(parents=True, exist_ok=True)
        for ep, key in (("results", "Results"), ("pitstops", "PitStops"), ("laps", "Laps")):
            data, total = paged(f"{year}/{rnd}/{ep}", key)
            if data is None:
                print(f"{name} {ep}: no data")
                continue
            (d / f"{ep}.json").write_text(json.dumps(data, indent=1))
            print(f"{name} {ep}: total={total} items={len(data.get(key, []))}")


if __name__ == "__main__":
    main()
