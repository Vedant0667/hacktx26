"""Build replay frames, ground truth and engine calls for each decision point.

Reads data/jolpica/, data/manual/ and (if present) data/openf1/. Writes public/data/.
Run: python3 engine/build.py
"""
import json
import statistics
from pathlib import Path

import engine as eng

ROOT = Path(__file__).resolve().parent.parent
JOL = ROOT / "data" / "jolpica"
MAN = ROOT / "data" / "manual"
OF1 = ROOT / "data" / "openf1"
OUT = ROOT / "public" / "data"

DECISIONS = [
    {
        "id": "qatar-2025-l7", "race_key": "2025-qatar", "race": "2025 Qatar GP", "lap": 7, "trigger": "SC",
        "title": "Qatar 2025, lap 7: safety car. Box Piastri?",
        "player": {"team": "McLaren", "driver": "Piastri", "number": 81, "id": "piastri"},
        "window": [7, 10],                      # laps under SC where a stop counts as "took the cheap stop"
        "pit_loss_from": ("2024-qatar", None),   # prior-season race, pre-race knowledge
        "factors": ["tyre_age", "cheap_stop_under_sc", "similar_cars_pitted", "track_position"],
    },
    {
        "id": "singapore-2026-vsc", "race_key": "2026-singapore", "race": "2026 Singapore GP", "lap": 39, "trigger": "VSC",
        "title": "Singapore 2026, lap 39: VSC. Box Hamilton?",
        "player": {"team": "Ferrari", "driver": "Hamilton", "number": 44, "id": "hamilton"},
        "window": [38, 40],
        "pit_loss_from": ("2026-singapore", 38),  # same race, green stops completed before lap 38
        "factors": ["tyre_age", "cheap_stop_under_vsc", "similar_cars_pitted", "track_position"],
    },
]
COHORT_AGE_BAND = 7  # ground-truth cohort: cars whose tyre age is within +/-7 laps of the player's



# Swatch colours for the timing tower (data markers only, never livery artwork). Keyed by Jolpica constructor name.
TEAM_COLOURS = {
    "McLaren": "#FF8000", "Red Bull": "#3671C6", "Ferrari": "#E8002D", "Mercedes": "#27F4D2",
    "Aston Martin": "#229971", "Alpine F1 Team": "#0093CC", "Williams": "#64C4FF", "RB F1 Team": "#6692FF",
    "Sauber": "#52E252", "Audi": "#BB0A30", "Haas F1 Team": "#B6BABD", "Cadillac F1 Team": "#C9A75D",
}

def secs(t):
    if ":" in t:
        m, s = t.split(":")
        return int(m) * 60 + float(s)
    return float(t)


def load_race(key):
    d = JOL / key
    laps = json.loads((d / "laps.json").read_text())["Laps"]
    pits = json.loads((d / "pitstops.json").read_text())["PitStops"]
    res_path = d / "results.json"
    results = json.loads(res_path.read_text())["Results"] if res_path.exists() else []
    times = {}   # driverId -> {lap: seconds}
    pos = {}     # driverId -> {lap: position}
    for l in laps:
        n = int(l["number"])
        for t in l["Timings"]:
            times.setdefault(t["driverId"], {})[n] = secs(t["time"])
            pos.setdefault(t["driverId"], {})[n] = int(t["position"])
    stops = {}
    for p in pits:
        stops.setdefault(p["driverId"], []).append(int(p["lap"]))
    for v in stops.values():
        v.sort()
    return {"times": times, "pos": pos, "stops": stops, "results": results, "n_laps": max(int(l["number"]) for l in laps)}


def green_pit_loss(race, before_lap=None):
    """Median green-flag pit loss: (in-lap + out-lap) - 2 x driver's median clean lap nearby."""
    n = race["n_laps"]
    med = {k: statistics.median([race["times"][d][k] for d in race["times"] if k in race["times"][d]]) for k in range(1, n + 1)}
    base = statistics.median(med.values())
    green = {k for k, v in med.items() if v < base * 1.04}
    losses = []
    for d, sl in race["stops"].items():
        for p in sl:
            if before_lap is not None and p + 3 >= before_lap:
                continue
            if not {p - 2, p - 1, p, p + 1, p + 2}.issubset(green):
                continue
            t = race["times"].get(d, {})
            ref = [t[k] for k in (p - 3, p - 2, p - 1, p + 2, p + 3) if k in t and k not in sl and k - 1 not in sl]
            if len(ref) < 3 or p not in t or p + 1 not in t:
                continue
            losses.append(t[p] + t[p + 1] - 2 * statistics.median(ref))
    return round(statistics.median(losses), 1), len(losses)


def manual_compounds(key):
    f = MAN / f"{key}.json"
    m = json.loads(f.read_text()) if f.exists() else {}
    return {(c["driver"], c["stint"]): c["compound"] for c in m.get("compounds", [])}, m


def openf1_dir(key):
    for d in OF1.glob("*"):
        if d.is_dir() and d.name.startswith(key):
            if (d / "stints.json").exists():
                return d
    return None


def build_frames(race, results, comps, sc_laps, vsc_laps):
    info = {r["Driver"]["driverId"]: {"code": r["Driver"]["code"], "number": int(r["number"]),
                                       "team": r["Constructor"]["name"]} for r in results}
    cum = {}
    frames = []
    for lap in range(1, race["n_laps"] + 1):
        status = "SC" if lap in sc_laps else "VSC" if lap in vsc_laps else "GREEN"
        rows = []
        for d, t in race["times"].items():
            if lap not in t:
                continue
            cum[d] = cum.get(d, 0.0) + t[lap]
            sl = race["stops"].get(d, [])
            done = [p for p in sl if p < lap]
            stint = len(done) + 1
            last = done[-1] if done else 0
            rows.append({**info[d], "id": d, "position": race["pos"][d][lap], "_cum": cum[d],
                         "compound": comps.get((d, stint)), "stint": stint, "tyre_age": lap - last,
                         "pitted_this_lap": lap in sl})
        rows.sort(key=lambda r: r["position"])
        lead = rows[0]["_cum"]
        for r in rows:
            r["gap_to_leader_s"] = round(r.pop("_cum") - lead, 3)
        frames.append({"lap": lap, "track_status": status, "drivers": rows})
    return frames


def ground_truth(race, results, frames, dp):
    """Split cars by option in the window; compare mean places gained from baseline to end lap."""
    w0, w1 = dp["window"]
    base_lap = w0 - 1
    base = {d["id"]: d for d in frames[base_lap - 1]["drivers"]}
    running_at_L = {d["id"] for d in frames[dp["lap"] - 1]["drivers"]}
    final = {r["Driver"]["driverId"]: int(r["position"]) for r in results}
    n = race["n_laps"]
    box, stay = [], []
    for d in base:
        if d not in running_at_L:
            continue
        sl = race["stops"].get(d, [])
        (box if any(w0 <= p <= w1 for p in sl) else stay).append(d)
    # end lap: one lap after every car's next stop following the decision (BOX cars' next stop is in the window).
    # A car with no further stop runs to the flag, so the comparison runs to the flag.
    end = 0
    for d in stay:
        nxt = [p for p in race["stops"].get(d, []) if p > w1 - 1]
        end = max(end, nxt[0] + 1 if nxt else n)
    end = min(end, n)

    def pos_at_end(d):
        if end == n:
            return final[d]
        t = race["pos"][d]
        return t.get(end)

    def gains(group):
        out = {}
        for d in group:
            e = pos_at_end(d)
            if e is not None:
                out[d] = base[d]["position"] - e
        return out

    def summarise(gb, gs):
        mb = statistics.mean(gb.values()) if gb else 0.0
        ms = statistics.mean(gs.values()) if gs else 0.0
        return {"box_mean_gain": round(mb, 2), "stay_mean_gain": round(ms, 2), "n_box": len(gb), "n_stay": len(gs),
                "correct": "BOX" if mb > ms else "STAY" if ms > mb else "TIE", "swing_places": round(abs(mb - ms), 2),
                "box": gb, "stay": gs}

    field = summarise(gains(box), gains(stay))
    pid = dp["player"]["id"]
    pa = base[pid]["tyre_age"]
    cohort = {d for d in base if abs(base[d]["tyre_age"] - pa) <= COHORT_AGE_BAND}
    coh = summarise({k: v for k, v in gains(box).items() if k in cohort},
                    {k: v for k, v in gains(stay).items() if k in cohort})
    return {"baseline_lap": base_lap, "end_lap": end, "window": [w0, w1], "player_tyre_age_at_baseline": pa,
            "cohort_rule": f"tyre age within +/-{COHORT_AGE_BAND} laps of the player's at lap {base_lap}",
            "field": field, "cohort": coh}


def time_ground_truth(race, frames, dp):
    """Seconds-based ground truth (lib/types.ts swing_s).

    Comparison set S = cars within +/-3 positions of the player at the start of lap L (end of lap L-1).
    A = cars in S that made the player's call, B = cars in S that made the other call (stop inside the window).
    For every pair (a, b): delta = [cum(a) - cum(b)] at end lap E  -  [cum(a) - cum(b)] at end of lap L-1.
    Positive delta = a lost time to b. Player row = mean over b of delta(player, b).
    swing_s = |mean over all pairs|; the call whose group gained time is correct.
    E = one lap after every car in S has made its next stop after L-1; a car with no further stop runs to the flag.
    """
    L = dp["lap"]
    w0, w1 = dp["window"]
    n = race["n_laps"]
    start = frames[L - 2]
    pid = dp["player"]["id"]
    me = next(d for d in start["drivers"] if d["id"] == pid)
    running_at_L = {d["id"] for d in frames[L - 1]["drivers"]}
    S = [d for d in start["drivers"] if abs(d["position"] - me["position"]) <= 3 and d["id"] in running_at_L]
    took_box = lambda d: any(w0 <= p <= w1 for p in race["stops"].get(d, []))
    player_call = "BOX" if took_box(pid) else "STAY"
    A = [d["id"] for d in S if (took_box(d["id"]) == (player_call == "BOX"))]
    B = [d["id"] for d in S if d["id"] not in A]
    end = 0
    for d in A + B:
        nxt = [p for p in race["stops"].get(d, []) if p >= L - 1 and not (w0 <= p <= w1)]
        if took_box(d):
            nxt = [p for p in nxt if p > w1]
            end = max(end, w1 + 1)  # BOX cars: their next stop is the window stop
        else:
            end = max(end, nxt[0] + 1 if nxt else n)
    end = min(end, n)

    def cum(d, lap):
        t = race["times"][d]
        if any(k not in t for k in range(1, lap + 1)):
            return None
        return sum(t[k] for k in range(1, lap + 1))

    pairs, missing = [], []
    for a in A:
        for b in B:
            c = [cum(a, L - 1), cum(b, L - 1), cum(a, end), cum(b, end)]
            if None in c:
                missing.append([a, b])
                continue
            g0, g1 = c[0] - c[1], c[2] - c[3]
            pairs.append({"a": a, "b": b, "gap_start_s": round(g0, 3), "gap_end_s": round(g1, 3), "delta_s": round(g1 - g0, 3)})
    mean = statistics.mean(p["delta_s"] for p in pairs) if pairs else 0.0
    player_pairs = [p for p in pairs if p["a"] == pid]
    pmean = statistics.mean(p["delta_s"] for p in player_pairs) if player_pairs else None
    other = "STAY" if player_call == "BOX" else "BOX"
    correct = other if mean > 0 else player_call
    return {"method": "seconds, +/-3 positions, pairwise gap change", "start_lap_end": L - 1, "end_lap": end,
            "player_call": player_call, "group_player_call": A, "group_other_call": B,
            "pairs": pairs, "pairs_missing_laps": missing,
            "mean_delta_s_player_call_vs_other": round(mean, 2),
            "player_only_mean_delta_s": None if pmean is None else round(pmean, 2),
            "correct": correct, "swing_s": round(abs(mean), 1)}


def blind_title(frames, dp):
    L = dp["lap"]
    pid = dp["player"]["id"]
    me = next(d for d in frames[L - 1]["drivers"] if d["id"] == pid)
    prev = next(d for d in frames[L - 2]["drivers"] if d["id"] == pid)
    trig = {"SC": "Safety car", "VSC": "Virtual safety car"}[dp["trigger"]]
    if me["compound"]:
        return f"Lap {L}. {trig}. You're in P{prev['position']} on {me['tyre_age']}-lap-old {me['compound'].lower()}s."
    return f"Lap {L}. {trig}. You're in P{prev['position']}, tyres {me['tyre_age']} laps old."


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    index, engine_calls = [], {}
    for dp in DECISIONS:
        key = dp["race_key"]
        if not (JOL / key / "laps.json").exists():
            print(f"SKIP {dp['id']}: no Jolpica data")
            continue
        race = load_race(key)
        results = race["results"]
        comps, man = manual_compounds(key)
        of1 = openf1_dir(key)
        if of1:
            print(f"NOTE {dp['id']}: OpenF1 data present at {of1} (compounds/race control not yet merged; TODO)")
        ts = man.get("track_status", {})
        sc = set(ts.get("SC", {}).get("laps", []))
        vsc = set(ts.get("VSC", {}).get("laps", []))
        frames = build_frames(race, results, comps, sc, vsc)

        gt = ground_truth(race, results, frames, dp)   # positions method, kept for reference
        tg = time_ground_truth(race, frames, dp)        # seconds method, the one used

        src_key, before = dp["pit_loss_from"]
        loss, n_loss = green_pit_loss(load_race(src_key), before)
        track = {"normal_pit_loss_s": loss, "total_laps": race["n_laps"],
                 "max_stint_laps": man.get("rules", {}).get("max_stint_laps")}
        pcode = next(r["Driver"]["code"] for r in results if r["Driver"]["driverId"] == dp["player"]["id"])
        e = eng.decide(frames[:dp["lap"]], dp["lap"], pcode, track)

        team = man.get("team_call", {})
        decision = {
            "id": dp["id"], "race": dp["race"], "blind_title": blind_title(frames, dp),
            "lap": dp["lap"], "trigger": dp["trigger"],
            "player_role": {k: dp["player"][k] for k in ("team", "driver", "number")},
            "options": ["BOX", "STAY"],
            "replay_from_lap": 1,
            "reveal_to_lap": tg["end_lap"],
            "ground_truth": {"correct": tg["correct"], "swing_s": tg["swing_s"]},
            "factors": dp["factors"],
            "team": {"call": team.get("call"), "reasons": team.get("reasons", [])},
            "engine": {"call": e["call"], "confidence": e["confidence"], "reasons": e["reasons"]},
        }
        d = OUT / dp["id"]
        d.mkdir(parents=True, exist_ok=True)
        (d / "decision.json").write_text(json.dumps(decision, indent=1))
        clean = [{"lap": f["lap"], "track_status": f["track_status"],
                  "drivers": [{**{k: r[k] for k in ("code", "number", "team", "position", "gap_to_leader_s",
                                                    "compound", "tyre_age", "pitted_this_lap")},
                               "team_colour": TEAM_COLOURS.get(r["team"])} for r in f["drivers"]]}
                 for f in frames]
        (d / "frames.json").write_text(json.dumps(clean, separators=(",", ":")))
        (d / "ground_truth.json").write_text(json.dumps({"seconds": tg, "positions_reference": gt,
                                                          "pit_loss": {"normal_s": loss, "n_stops": n_loss, "from": src_key}}, indent=1))
        engine_calls[dp["id"]] = {**decision["engine"], "inputs": e["inputs"]}
        index.append({"id": dp["id"], "race": dp["race"], "lap": dp["lap"], "title": dp["title"]})

        print(f"\n== {dp['id']}  [positions reference] baseline lap {gt['baseline_lap']} -> end lap {gt['end_lap']}  window {gt['window']}")
        for name in ("field", "cohort"):
            g = gt[name]
            print(f"  {name:6s}: BOX n={g['n_box']} mean {g['box_mean_gain']:+.2f} | STAY n={g['n_stay']} mean {g['stay_mean_gain']:+.2f}"
                  f" -> {g['correct']} swing {g['swing_places']:.2f}")
            print(f"          box {g['box']}\n          stay {g['stay']}")
        print(f"  SECONDS (used): set at end of lap {tg['start_lap_end']} -> end lap {tg['end_lap']}; player call {tg['player_call']}")
        print(f"    group {tg['player_call']}: {tg['group_player_call']}  vs other: {tg['group_other_call']}")
        for pr in tg["pairs"]:
            print(f"    {pr['a']:>15s} vs {pr['b']:<15s} gap {pr['gap_start_s']:+8.3f} -> {pr['gap_end_s']:+8.3f}  delta {pr['delta_s']:+8.3f} s")
        if tg["pairs_missing_laps"]:
            print(f"    missing lap times for pairs: {tg['pairs_missing_laps']}")
        print(f"    mean delta (player's call vs other) {tg['mean_delta_s_player_call_vs_other']:+.2f} s; player only {tg['player_only_mean_delta_s']}")
        print(f"    -> correct {tg['correct']}, swing_s {tg['swing_s']}")
        print(f"  pit loss: {loss} s green (median of {n_loss} stops, {src_key})")
        print(f"  engine: {e['call']} conf {e['confidence']}  inputs {e['inputs']}")
        for r in e["reasons"]:
            print(f"    - {r}")

    (OUT / "index.json").write_text(json.dumps(index, indent=1))
    (OUT / "engine_calls.json").write_text(json.dumps(engine_calls, indent=1))


if __name__ == "__main__":
    main()
