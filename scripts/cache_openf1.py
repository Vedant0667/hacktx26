"""Cache OpenF1 data for demo races to data/openf1/. Retries while the free tier is locked by a live session."""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path

BASE = "https://api.openf1.org/v1"
OUT = Path(__file__).resolve().parent.parent / "data" / "openf1"
# (year, country_name, session_name)
RACES = [(2025, "Qatar", "Race"), (2026, "Singapore", "Race")]
ENDPOINTS = ["drivers", "laps", "stints", "pit", "position", "intervals", "race_control", "weather", "team_radio"]


def get(path):
    with urllib.request.urlopen(f"{BASE}/{path}", timeout=60) as r:
        return json.load(r)


def fetch(path):
    while True:
        try:
            return get(path)
        except urllib.error.HTTPError as e:
            if e.code in (401, 429):
                print(f"{time.strftime('%H:%M:%S')} {e.code} on {path}; retry in 120s", flush=True)
                time.sleep(120)
                continue
            raise


def main():
    for year, country, name in RACES:
        sessions = fetch(f"sessions?year={year}&country_name={country}&session_name={name}")
        if not sessions:
            print(f"no session for {year} {country} {name}", flush=True)
            continue
        s = sessions[0]
        key = s["session_key"]
        d = OUT / f"{year}-{country.lower()}-{name.lower()}"
        d.mkdir(parents=True, exist_ok=True)
        (d / "session.json").write_text(json.dumps(s, indent=1))
        for ep in ENDPOINTS:
            f = d / f"{ep}.json"
            if f.exists() and f.stat().st_size > 2:
                continue
            data = fetch(f"{ep}?session_key={key}")
            f.write_text(json.dumps(data))
            print(f"{time.strftime('%H:%M:%S')} saved {f.relative_to(OUT)} ({len(data)} rows)", flush=True)
            time.sleep(1)
    print("DONE", flush=True)


if __name__ == "__main__":
    sys.exit(main())
