"""Race mode: freezes per driver (docs/09-race-mode.md).

Run: python3 engine/triggers.py

Rule zero, no tells. A trigger at lap L is computed by `detect(ctx, L)` from a view of the race cut at the
end of lap L-1 (`truncate`): lap times, positions and stops for laps 1..L-1, stints that started by lap L-1,
race-control messages up to lap L-1 (plus the SC/VSC deployment message on lap L itself, see trigger 1), and
weather up to the end of lap L-1. Every derived number (pit loss, expected stint life, fuel trend, fast-deg
threshold, fresh-tyre gain) is recomputed from that view, so a freeze lap is always chosen from pre-L state.
The real team's call is never an input.

Build-time only (never shown to players, never used to pick the lap):
- Split filter: looks at stops on laps L-2..L+2 among comparison cars. It decides whether a fair seconds-based
  answer exists, so it is an eligibility check, not a trigger.
- Ground truth: build.time_ground_truth, reused with window [L, L+2] (or the SC/VSC laps) and any car.

Triggers (end of lap L-1)
1. SC/VSC deployed: race-control "SAFETY CAR DEPLOYED"/"VSC DEPLOYED" with lap_number L. The pit wall hears this
   before the car reaches pit entry on lap L, same as the existing qatar-2025-l7 decision. Both cars.
2. Rival stop: a car within one green pit loss and within +/-3 positions, ahead or behind (gap and positions at
   the end of lap L-2, before the rival's in-lap), pitted on lap L-1.
3. Undercut window: gap to the car ahead < 2 x fresh-tyre gain per lap, and that car's tyres are older.
4. Fast degradation: mean fuel-corrected time of the car's last 3 laps minus its stint baseline (median of the
   stint's first 3 clean laps) is above the fast-deg threshold.
5. Tyre window: tyre age (including laps before the race) reaches the expected life for the compound on lap L
   (age at end of L-1, plus lap L). With Qatar's 25-lap cap, life = min(expected, cap - 1): the last lap with a
   real choice. A car whose cap forces a stop at the end of lap L gets no call on any trigger.
6. Rain starts or stops (weather rainfall).
"""
import copy
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build as B  # noqa: E402

RACES = [
    # key, OpenF1 dir, pre-race source for the pit-loss / fresh-tyre-gain prior (an earlier race only)
    {"key": "2025-qatar", "of1": "2025-qatar-race", "prior_race": "2024-qatar"},
    {"key": "2026-singapore", "of1": "2026-singapore-race", "prior_race": "2025-qatar"},
]
COMPOUNDS = ["SOFT", "MEDIUM", "HARD"]
GT_WINDOW = 2            # BOX = stop on laps L..L+2 (green); STAY = no stop on laps L-2..L+2
SPLIT_POS = 3            # comparison cars: within +/-3 positions at end of lap L-1 (same as time_ground_truth)
SPLIT_AGE = 3            # ... or tyre age within +/-3 laps (hand-set, mirrors the position band)
MIN_GAP_LAPS = 5
MIN_FREEZES, MAX_FREEZES = 3, 6
MIN_SWING_S = 2.0        # a freeze needs a measured swing of at least 2 s, or the "right" call is noise
RIVAL_POS = 3            # rival-stop trigger: only rivals within +/-3 positions count
AUDIBLE_WINDOW = 3       # audible at visible lap A: comparison cars that stop on A+1..A+3 vs stay out
# Hand-set, documented: stints this short, or ending on laps 1-2, are damage/penalty stops, not tyre wear.
MIN_WEAR_STINT = 5
DEG_MIN_STOPS = 5        # stops needed before the stop-based fast-deg threshold is used
MIN_INRACE_STINTS = 2    # completed in-race stints of a compound needed to replace its prior
DEG_FIELD_PCTL = 0.95    # fallback threshold: 95th percentile of the field's deg delta so far
DEG_MIN_OBS = 30


# ---------------------------------------------------------------- data loading (reuses build.py)

def load_of1(name, f):
    return json.loads((B.OF1 / name / f).read_text())


def sc_periods(rc):
    """[(kind, deployed_lap, ending_lap)] from race control."""
    out, open_ = [], {}
    for m in sorted(rc, key=lambda m: m["date"]):
        if m["category"] != "SafetyCar":
            continue
        msg = m["message"]
        kind = "VSC" if "VSC" in msg or "VIRTUAL" in msg else "SC"
        if "DEPLOYED" in msg:
            open_[kind] = m["lap_number"]
        elif ("ENDING" in msg or "IN THIS LAP" in msg) and kind in open_:
            out.append((kind, open_.pop(kind), m["lap_number"]))
    for kind, l0 in open_.items():
        out.append((kind, l0, None))
    return out


def red_flags(rc):
    """Laps with a red flag shown, from race control (flag RED, or a RED FLAG message)."""
    return sorted({m["lap_number"] for m in rc if m.get("lap_number")
                   and (m.get("flag") == "RED" or "RED FLAG" in (m.get("message") or "").upper())})


# ---------------------------------------------------------------- luck (Round 9, build-time only)

def luck_events(periods, reds, rain, L, end, own=()):
    """Events nobody could know at a call on lap L that happened before its measurement ended (lap `end`):
    an SC or VSC deployed, a red flag, or rainfall starting or stopping, on laps L..end. A deployment on lap L
    that is the moment's own trigger (`own`, e.g. {"SC"}) was known at the call and is not luck. Rain changes
    count from lap L: the RAIN trigger already sees a change on lap L-1. Returns [{lap, kind}] by lap."""
    ev = []
    for kind, a, _ in periods:
        if L <= a <= end and not (a == L and kind in own):
            ev.append({"lap": a, "kind": kind})
    for k in reds:
        if L <= k <= end:
            ev.append({"lap": k, "kind": "RED_FLAG"})
    for k in range(max(L, 2), end + 1):
        before, now = rain.get(k - 1, 0), rain.get(k, 0)
        if before != now:
            ev.append({"lap": k, "kind": "RAIN_START" if now else "RAIN_STOP"})
    return sorted(ev, key=lambda e: (e["lap"], e["kind"]))


def luck_after(events, periods, stops_by_code, cars):
    """Post-call context for each luck event: for an SC/VSC, its laps and which of `cars` stopped under it."""
    out = []
    for e in events:
        if e["kind"] in ("SC", "VSC"):
            span = next(([a, b or a] for k, a, b in periods if k == e["kind"] and a == e["lap"]), [e["lap"], e["lap"]])
            hit = sorted(c for c in cars if any(span[0] <= p <= span[1] for p in stops_by_code.get(c, [])))
            out.append({**e, "laps": span, "stopped_under_it": hit})
        else:
            out.append(dict(e))
    return out


def lap_of_time(of1_laps):
    """Leader lap start times -> function(date) -> lap number in progress."""
    starts = {}
    for l in of1_laps:
        if l.get("date_start"):
            n = l["lap_number"]
            starts[n] = min(starts.get(n, l["date_start"]), l["date_start"])
    seq = sorted(starts.items())

    def f(date):
        lap = 0
        for n, s in seq:
            if s <= date:
                lap = n
        return lap
    return f


def stint_tyres(race, results, of1_stints):
    """(driverId, stint) -> (compound|None, tyre_age_at_start). Stint boundaries come from Jolpica stops (as in
    build_frames). OpenF1 compound is used only when its stint ends agree with Jolpica's stops for that driver;
    otherwise the compound is unknown (Singapore 2026 cars 6, 14, 18 have a spurious 1-lap OpenF1 stint)."""
    by_number = {int(r["number"]): r["Driver"]["driverId"] for r in results}
    of = {}
    for s in of1_stints:
        d = by_number.get(s["driver_number"])
        if d:
            of.setdefault(d, []).append(s)
    out, bad = {}, []
    for d, sl in of.items():
        sl.sort(key=lambda s: s["stint_number"])
        ends = [s["lap_end"] for s in sl][:-1]
        if ends != race["stops"].get(d, []):
            bad.append(d)
            continue
        for i, s in enumerate(sl, start=1):
            c = s.get("compound")
            out[(d, i)] = (c if c and c != "UNKNOWN" else None, s.get("tyre_age_at_start") or 0)
    return out, bad


def rain_by_lap(spec):
    """lap -> 1 if any weather sample during that lap (leader's lap) reported rainfall, else 0."""
    lap_at = lap_of_time(load_of1(spec["of1"], "laps.json"))
    rain = {}
    for w in load_of1(spec["of1"], "weather.json"):
        k = lap_at(w["date"])
        rain[k] = max(rain.get(k, 0), 1 if w["rainfall"] else 0)
    return rain


def luck_source(key):
    """SC/VSC periods, red-flag laps and rain by lap for a cached race (engine/build.py's moment decisions)."""
    spec = next((s for s in RACES if s["key"] == key), None)
    if spec is None:
        return None
    rc = load_of1(spec["of1"], "race_control.json")
    return {"periods": sc_periods(rc), "reds": red_flags(rc), "rain": rain_by_lap(spec)}


def load_ctx(spec):
    race = B.load_race(spec["key"])
    results = race["results"]
    _, man = B.manual_compounds(spec["key"])
    tyres, bad = stint_tyres(race, results, load_of1(spec["of1"], "stints.json"))
    rc = load_of1(spec["of1"], "race_control.json")
    rain = rain_by_lap(spec)
    team = {r["Driver"]["driverId"]: r["Constructor"]["name"] for r in results}
    code = {r["Driver"]["driverId"]: r["Driver"]["code"] for r in results}
    return {"spec": spec, "race": race, "results": results, "tyres": tyres, "bad_compound": bad,
            "rc": rc, "periods": sc_periods(rc), "reds": red_flags(rc), "rain": rain, "team": team, "code": code,
            "cap": man.get("rules", {}).get("max_stint_laps"), "n_laps": race["n_laps"]}


def neutralised(periods, upto):
    """Laps under SC/VSC known by end of lap `upto` (an open period runs to `upto`)."""
    out = {}
    for kind, a, b in periods:
        if a > upto:
            continue
        for k in range(a, min(b if b is not None else upto, upto) + 1):
            out[k] = kind
    return out


def truncate(race, upto):
    """Race view with laps 1..upto only: what the pit wall knows at the end of lap `upto`."""
    return {"times": {d: {k: v for k, v in t.items() if k <= upto} for d, t in race["times"].items()},
            "pos": {d: {k: v for k, v in t.items() if k <= upto} for d, t in race["pos"].items()},
            "stops": {d: [p for p in sl if p <= upto] for d, sl in race["stops"].items()},
            "results": race["results"], "n_laps": upto}


# ---------------------------------------------------------------- derived quantities (all from a truncated view)

def field_trend(view, sc):
    """Fuel/track trend, s per lap: slope of the field-median lap time over green laps (in/out laps excluded)."""
    pts = []
    for k in range(2, view["n_laps"] + 1):
        if k in sc or k - 1 in sc:
            continue
        ts = [t[k] for d, t in view["times"].items()
              if k in t and k not in view["stops"].get(d, []) and k - 1 not in view["stops"].get(d, [])]
        if len(ts) >= 5:
            pts.append((k, statistics.median(ts)))
    if len(pts) < 5:
        return 0.0, len(pts)
    mx = statistics.mean(p[0] for p in pts)
    my = statistics.mean(p[1] for p in pts)
    sxx = sum((x - mx) ** 2 for x, _ in pts)
    slope = sum((x - mx) * (y - my) for x, y in pts) / sxx
    # drop outlier laps (slow traffic laps, yellows) once, then refit
    res = [abs(y - (my + slope * (x - mx))) for x, y in pts]
    cut = statistics.median(res) * 4 + 1e-9
    pts = [p for p, r in zip(pts, res) if r <= cut]
    mx = statistics.mean(p[0] for p in pts)
    my = statistics.mean(p[1] for p in pts)
    sxx = sum((x - mx) ** 2 for x, _ in pts)
    return sum((x - mx) * (y - my) for x, y in pts) / sxx, len(pts)


def clean(view, d, k, sc):
    """Is lap k a clean racing lap for driver d (green, not in/out lap, not lap 1)?"""
    sl = view["stops"].get(d, [])
    return k >= 2 and k in view["times"].get(d, {}) and k not in sc and k - 1 not in sc and k not in sl and k - 1 not in sl


def corrected(view, d, k, trend):
    return view["times"][d][k] - trend * k


def stint_start(view, d, lap):
    """First lap of the stint the driver is on during `lap` (stops <= lap-1)."""
    done = [p for p in view["stops"].get(d, []) if p < lap]
    return (done[-1] + 1 if done else 1), len(done) + 1


def deg_delta(view, d, upto, sc, trend):
    """(delta_s, s_per_lap, baseline_laps, last3) for the car's current stint at end of lap `upto`, or None."""
    s0, _ = stint_start(view, d, upto + 1)
    base = [k for k in range(s0, upto + 1) if clean(view, d, k, sc)][:3]
    last = [upto - 2, upto - 1, upto]
    if len(base) < 3 or any(k < s0 or not clean(view, d, k, sc) for k in last) or base[-1] >= last[0]:
        return None
    b = statistics.median(corrected(view, d, k, trend) for k in base)
    m = statistics.mean(corrected(view, d, k, trend) for k in last)
    span = statistics.mean(last) - statistics.mean(base)
    return m - b, (m - b) / span, base, last


def deg_threshold(view, sc, trend):
    """Fast-deg threshold. Primary: median deg delta of cars on their in-lap-1 (last 3 green laps before a green
    stop) for stops completed so far: 'as worn as cars whose teams boxed them'. Fallback: field 90th pct."""
    at_stop = []
    for d, sl in view["stops"].items():
        for p in sl:
            if p in sc or p - 1 in sc:
                continue
            r = deg_delta(view, d, p - 1, sc, trend)
            if r:
                at_stop.append(r[0])
    if len(at_stop) >= DEG_MIN_STOPS and statistics.median(at_stop) > 0:
        return statistics.median(at_stop), f"median deg delta before {len(at_stop)} green stops so far"
    # a non-positive median means teams were stopping for reasons other than wear (stint cap, strategy)
    obs = []
    for d in view["times"]:
        for k in range(4, view["n_laps"] + 1):
            r = deg_delta(view, d, k, sc, trend)
            if r:
                obs.append(r[0])
    if len(obs) >= DEG_MIN_OBS:
        obs.sort()
        why = f"stop-based median {statistics.median(at_stop):+.2f}s <= 0" if len(at_stop) >= DEG_MIN_STOPS else f"only {len(at_stop)} stops so far"
        return obs[int(DEG_FIELD_PCTL * (len(obs) - 1))], f"p95 of field deg delta ({len(obs)} car-laps); {why}"
    return None, f"not enough data ({len(at_stop)} stops, {len(obs)} car-laps)"


def fresh_gain(view, sc, trend):
    """Fresh-tyre gain, s/lap: for each green stop on lap p, mean corrected time of laps p-2, p-1 (old set)
    minus laps p+2, p+3 (first two flying laps on the new set). Returns (median, n)."""
    g = []
    for d, sl in view["stops"].items():
        t = view["times"].get(d, {})
        for p in sl:
            old, new = [p - 2, p - 1], [p + 2, p + 3]
            if any(not clean(view, d, k, sc) for k in old + new):
                continue
            g.append(statistics.mean(corrected(view, d, k, trend) for k in old)
                     - statistics.mean(corrected(view, d, k, trend) for k in new))
    return (statistics.median(g), len(g)) if g else (None, 0)


def green_laps_by_pace(race):
    """For a past race without race-control data: laps whose field median is within 4% of the race median
    (the same rule build.green_pit_loss uses)."""
    n = race["n_laps"]
    med = {k: statistics.median([t[k] for t in race["times"].values() if k in t]) for k in range(1, n + 1)}
    base = statistics.median(med.values())
    return {k for k, v in med.items() if v >= base * 1.04}


def pit_loss(ctx, L, view):
    """Green pit loss known at end of lap L-1: build.green_pit_loss on the truncated view; prior = earlier race."""
    try:
        loss, n = B.green_pit_loss(view, before_lap=L)
        return loss, f"median of {n} green stops this race before lap {L}"
    except statistics.StatisticsError:
        loss, n = ctx["prior_loss"]
        return loss, f"prior: {n} green stops, {ctx['spec']['prior_race']}"


def stint_records(race, tyres, sc_laps, upto, n_total, cap):
    """Completed and censored stints by end of lap `upto`: (compound, laps on set incl. pre-race, completed?)."""
    out = []
    for d, sl in race["stops"].items():
        done = [p for p in sl if p <= upto]
        last_lap = max(race["times"].get(d, {}).keys(), default=0)
        prev = 0
        for i, p in enumerate(done, start=1):
            comp, age0 = tyres.get((d, i), (None, 0))
            length = p - prev + age0
            wear = p > 2 and (p - prev) >= MIN_WEAR_STINT and p not in sc_laps and p - 1 not in sc_laps
            capped = cap is not None and length >= cap - 1
            if comp and wear:
                out.append((comp, length, not capped))
            prev = p
        # stint still running (or run to the flag / retirement): censored observation
        if upto >= n_total:
            comp, age0 = tyres.get((d, len(done) + 1), (None, 0))
            if comp:
                out.append((comp, min(last_lap, upto) - prev + age0, False))
    return out


def life_prior(ctxs, ctx):
    """Per-compound prior, as laps at this race: from the OTHER cached races (whole race, both are past races
    for the purpose of compound behaviour). Completed green wear stints as a fraction of that race's distance;
    a compound with none uses its longest censored stint (a lower bound). Then soft <= medium <= hard."""
    pr, src = {}, {}
    for c in COMPOUNDS:
        comp, cens = [], []
        for o in ctxs:
            if o is ctx:
                continue
            sc = set(neutralised(o["periods"], o["n_laps"]))
            for cc, ln, done in stint_records(o["race"], o["tyres"], sc, o["n_laps"], o["n_laps"], o["cap"]):
                if cc == c:
                    (comp if done else cens).append(ln / o["n_laps"])
                    tag = o["spec"]["key"]
        if comp:
            pr[c] = statistics.median(comp) * ctx["n_laps"]
            src[c] = f"median of {len(comp)} completed green {c.lower()} stints, {tag}, as share of race distance"
        elif cens:
            pr[c] = max(cens) * ctx["n_laps"]
            src[c] = f"no completed {c.lower()} stint elsewhere; longest censored {c.lower()} stint ({len(cens)}), {tag}"
    prev = 0
    for c in COMPOUNDS:
        if c not in pr:
            pr[c], src[c] = prev, f"no {c.lower()} data; set to softer compound's prior"
        elif pr[c] < prev:
            src[c] += f" ({pr[c]:.0f}, raised to softer compound's {prev:.0f} for soft<=medium<=hard)"
            pr[c] = prev
        prev = pr[c]
    return {c: round(v) for c, v in pr.items()}, src


def expected_life(ctx, view, sc, L):
    """compound -> (laps, source). Uses only stints completed (pit on a green lap) before lap L."""
    recs = stint_records(view, ctx["tyres"], set(sc), L - 1, ctx["n_laps"], ctx["cap"])
    out = {}
    for c in COMPOUNDS:
        done = [ln for cc, ln, ok in recs if cc == c and ok]
        capped = [ln for cc, ln, ok in recs if cc == c and not ok]
        if len(done) >= MIN_INRACE_STINTS:
            v, s = statistics.median(done), f"in-race n={len(done)}"
        else:
            v, s = ctx["prior"][c], "prior"
            if capped:
                s += f" ({len(capped)} capped stints)"
        if ctx["cap"]:
            v = min(v, ctx["cap"] - 1)   # the last lap with a real choice is one before the forced stop
        out[c] = (round(v), s)
    return out


# ---------------------------------------------------------------- detection

def conditions(ctx, L):
    """Cached wrapper for _conditions."""
    cache = ctx.setdefault("_cond", {})
    if L not in cache:
        cache[L] = _conditions(ctx, L)
    return cache[L]


def _conditions(ctx, L):
    """Trigger conditions per car at lap L, from end-of-lap-(L-1) state only. Returns {driverId: {...}}."""
    race = ctx["race"]
    view = truncate(race, L - 1)
    sc = neutralised(ctx["periods"], L - 1)
    frames = B.build_frames(view, ctx["results"], {}, set(), set())
    prev = {r["id"]: r for r in frames[L - 2]["drivers"]}
    trend, _ = field_trend(view, sc)
    loss, loss_src = pit_loss(ctx, L, view)
    life = expected_life(ctx, view, sc, L)
    thr, thr_src = deg_threshold(view, sc, trend)
    gain, n_gain = fresh_gain(view, sc, trend)
    gain_src = f"median of {n_gain} green stops this race"
    if gain is None:
        gain, gain_src = ctx["prior_gain"], f"prior {ctx['spec']['prior_race']} ({ctx['prior_gain_n']} stops)"
    undercut = 2 * gain
    deployed = [(k, a) for k, a, _ in ctx["periods"] if a == L]
    rain_now, rain_before = ctx["rain"].get(L - 1, 0), ctx["rain"].get(L - 2, 0)
    green_prev = (L - 1) not in sc

    def tyre(d):
        s0, i = stint_start(view, d, L)
        comp, age0 = ctx["tyres"].get((d, i), (None, 0))
        return comp, age0 + (L - 1) - s0 + 1   # laps on the set at end of lap L-1

    out = {}
    order = sorted(prev.values(), key=lambda r: r["position"])
    for r in order:
        d = r["id"]
        if L - 1 in view["stops"].get(d, []):
            continue  # just boxed: on its out-lap at L, no call
        comp, age = tyre(d)
        if ctx["cap"] and age + 1 >= ctx["cap"]:
            continue  # the stint cap forces a stop at the end of lap L: not a decision
        trig = []
        for kind, _ in deployed:
            trig.append({"type": kind, "info": f"{kind} deployed lap {L}"})
        near = []
        for o in order:
            if o["id"] != d and L - 1 in view["stops"].get(o["id"], []):
                # gap before the rival's in-lap (end of L-2); its in-lap time would inflate the gap
                f0 = {x["id"]: x for x in frames[L - 3]["drivers"]} if L >= 3 else {}
                if d in f0 and o["id"] in f0:
                    g = f0[o["id"]]["gap_to_leader_s"] - f0[d]["gap_to_leader_s"]
                    dpos = f0[o["id"]]["position"] - f0[d]["position"]
                else:
                    g = o["gap_to_leader_s"] - r["gap_to_leader_s"]
                    dpos = o["position"] - r["position"]
                if abs(g) < loss and abs(dpos) <= RIVAL_POS:
                    near.append(f"{ctx['code'][o['id']]} {'+' if g > 0 else ''}{g:.1f}s")
        if near and green_prev:
            trig.append({"type": "RIVAL_STOP", "info": f"pitted lap {L-1}: {', '.join(near)} (pit loss {loss:.1f}s, {loss_src})"})
        if green_prev and r["position"] > 1:
            ahead = order[[x["id"] for x in order].index(d) - 1]
            gap = r["gap_to_leader_s"] - ahead["gap_to_leader_s"]
            a_comp, a_age = tyre(ahead["id"])
            if gap < undercut and a_age > age and L - 1 not in view["stops"].get(ahead["id"], []):
                trig.append({"type": "UNDERCUT", "info": f"{gap:.1f}s behind {ctx['code'][ahead['id']]} "
                             f"(tyres {a_age} vs our {age} laps) < 2-lap fresh gain {undercut:.1f}s ({gain:.2f}s/lap, {gain_src})"})
        dd = deg_delta(view, d, L - 1, sc, trend) if green_prev else None
        if dd and thr is not None and dd[0] > max(thr, 0.0):
            trig.append({"type": "FAST_DEG", "info": f"last 3 laps +{dd[0]:.2f}s vs stint base laps {dd[2]} "
                         f"({dd[1]:+.3f}s/lap), threshold {thr:.2f}s ({thr_src}); fuel trend {trend:+.3f}s/lap"})
        if comp in life:
            lf, lsrc = life[comp]
            # fire once per stint: the first lap the set reaches its expected life
            # reaches its life on lap L: a stop at the end of lap L would retire the set at age+1 = expected life
            if age + 1 >= lf:
                trig.append({"type": "TYRE_WINDOW", "info": f"{comp.lower()} {age} laps (+1 this lap) vs expected {lf} ({lsrc})"})
        if rain_now != rain_before and L >= 3:
            trig.append({"type": "RAIN", "info": f"rainfall {rain_before}->{rain_now} on lap {L-1}"})
        if trig:
            out[d] = {"triggers": trig, "pos": r["position"], "compound": comp, "age": age}
    return out


EDGE = {"UNDERCUT", "FAST_DEG", "TYRE_WINDOW"}   # persistent conditions: fire on the lap they become true


def detect(ctx, L):
    """Freezable triggers per car at lap L. Persistent conditions fire only on the lap they first hold (true at
    end of L-1, false at end of L-2), so a long run behind a car or on worn tyres yields one candidate, chosen
    from pre-L state rather than by the later swing. Both lookups are pre-L."""
    now = conditions(ctx, L)
    before = conditions(ctx, L - 1) if L > 2 else {}
    out = {}
    for d, v in now.items():
        had = {t["type"] for t in before.get(d, {}).get("triggers", [])}
        trig = [t for t in v["triggers"] if not (t["type"] in EDGE and t["type"] in had)]
        if trig:
            out[d] = {**v, "triggers": trig}
    return out


# ---------------------------------------------------------------- build-time checks: split + ground truth

def gt_window(ctx, L):
    for kind, a, b in ctx["periods"]:
        if a == L:
            return [L, max(L, b or L)], kind
    return [L, L + GT_WINDOW], None


def judge(ctx, frames, L, d, window=None):
    """Split check and seconds ground truth for car d at lap L. Build-time only (looks at laps L-2..end).
    window: [w0, w1] override (audibles use a plain green window even under SC)."""
    race = ctx["race"]
    (w0, w1) = window if window else gt_window(ctx, L)[0]
    stops = lambda x: race["stops"].get(x, [])
    boxed = lambda x: any(w0 <= p <= w1 for p in stops(x))
    already = lambda x: any(L - GT_WINDOW <= p <= L - 1 for p in stops(x))   # made their call before L
    start = frames[L - 2]
    running = {x["id"] for x in frames[L - 1]["drivers"]}
    if d not in running or d not in {x["id"] for x in start["drivers"]}:   # retired: nothing to score
        return {"split": False, "n_box": 0, "n_stay": 0, "real": "DNF", "note": "not running on lap L"}
    me = next(x for x in start["drivers"] if x["id"] == d)

    def age(x):
        s0, i = stint_start(race, x, L)
        return ctx["tyres"].get((x, i), (None, 0))[1] + (L - 1) - s0 + 1
    my_age = age(d)
    pool = [x for x in start["drivers"] if x["id"] in running and (x["id"] == d or not already(x["id"]))]
    near = lambda x: abs(x["position"] - me["position"]) <= SPLIT_POS
    counts = lambda S: (sum(1 for x in S if x["id"] != d and boxed(x["id"])),
                        sum(1 for x in S if x["id"] != d and not boxed(x["id"])))
    # +/-3 positions first (what time_ground_truth and the shipped decisions use); widen to similar tyre age only
    # when the position band has no split. Widening always would put the whole field in at a lap-7 SC.
    S = [x for x in pool if near(x)]
    nb, ns = counts(S)
    widened = False
    if not (nb and ns):
        S = [x for x in pool if near(x) or abs(age(x["id"]) - my_age) <= SPLIT_AGE]
        nb, ns = counts(S)
        widened = True
    me_box = boxed(d)
    split = nb > 0 and ns > 0
    real = f"BOX L{min(p for p in stops(d) if w0 <= p <= w1)}" if me_box else "STAY"
    if not split:
        return {"split": False, "n_box": nb, "n_stay": ns, "real": real}
    # reuse build.time_ground_truth: frames at L-1 limited to the comparison set S defined above
    # time_ground_truth selects by +/-3 positions; tyre-age matches outside that band get the player's position
    # in this throwaway copy so they stay in. Positions are not used in its pairwise seconds maths.
    fr = list(frames)
    fr[L - 2] = {**start, "drivers": [x if abs(x["position"] - me["position"]) <= SPLIT_POS
                                      else {**x, "position": me["position"]} for x in S]}
    tg = B.time_ground_truth(race, fr, {"lap": L, "window": [w0, w1], "player": {"id": d}})
    if not tg["pairs"]:
        return {"split": False, "n_box": nb, "n_stay": ns, "real": real, "note": "no complete pairs"}
    others = [x["id"] for x in S if x["id"] != d]
    return {"split": True, "n_box": nb, "n_stay": ns, "real": real, "correct": tg["correct"],
            "swing_s": tg["swing_s"], "end_lap": tg["end_lap"], "window": [w0, w1], "widened": widened,
            "boxed": [x for x in others if boxed(x)], "stayed": [x for x in others if not boxed(x)], "tg": tg}


# ---------------------------------------------------------------- filters

def select(cands):
    """cands: list of {lap, swing, ...} for one driver, already eligible. 5-lap spacing, keep largest swing, max 6."""
    keep = []
    for c in sorted(cands, key=lambda c: -c["swing"]):
        if len(keep) < MAX_FREEZES and all(abs(c["lap"] - k["lap"]) >= MIN_GAP_LAPS for k in keep):
            keep.append(c)
    return sorted(keep, key=lambda c: c["lap"])


# ---------------------------------------------------------------- main

def prepare():
    ctxs = [load_ctx(s) for s in RACES]
    for ctx in ctxs:
        pr = B.load_race(ctx["spec"]["prior_race"])
        ctx["prior_loss"] = B.green_pit_loss(pr)
        green = set(range(1, pr["n_laps"] + 1)) - green_laps_by_pace(pr)
        sc_like = {k: "SC" for k in range(1, pr["n_laps"] + 1) if k not in green}
        tr, _ = field_trend(pr, sc_like)
        g, n = fresh_gain(pr, sc_like, tr)
        # a negative prior (new tyres slower, e.g. traffic after the stop) means no undercut: clamp to 0
        ctx["prior_gain"], ctx["prior_gain_n"] = max(0.0, g), n
        ctx["prior_gain_raw"] = g
        ctx["prior"], ctx["prior_src"] = life_prior(ctxs, ctx)
    return ctxs


def run_race(ctx, verbose=True):
    """Per driver: every detected trigger with its split check, then the freeze filters (split, swing >= 2 s,
    5-lap spacing, at most 6 by largest swing). Returns (final {driverId: [cand]}, trigger counts, all cands)."""
    n = ctx["n_laps"]
    frames = B.build_frames(ctx["race"], ctx["results"], {}, set(), set())
    cands = {d: [] for d in ctx["code"]}
    counts = {}
    for L in range(2, n - GT_WINDOW):
        for d, v in detect(ctx, L).items():
            j = judge(ctx, frames, L, d)
            ok = j["split"] and j["swing_s"] >= MIN_SWING_S
            for tr in v["triggers"]:
                counts.setdefault(tr["type"], [0, 0])
                counts[tr["type"]][0] += 1
                counts[tr["type"]][1] += 1 if ok else 0
            cands[d].append({"lap": L, "d": d, "v": v, "j": j, "ok": ok, "swing": j.get("swing_s", 0.0)})
            if verbose:
                types = "+".join(sorted({x["type"] for x in v["triggers"]}))
                gt = (f"correct {j['correct']} swing {j['swing_s']:.1f}s (box {j['n_box']} v stay {j['n_stay']}"
                      f"{', +age-matched' if j['widened'] else ''}; win {j['window']}, to L{j['end_lap']})"
                      if j["split"] else f"no split (box {j['n_box']}, stay {j['n_stay']})")
                print(f"  {ctx['spec']['key']} | {ctx['code'][d]} P{v['pos']} {v['compound'] or '?'} {v['age']}L "
                      f"| L{L} | {types} | eligible={'Y' if ok else 'N'} | {gt} | real {j['real']}")
                for x in v["triggers"]:
                    print(f"      {x['type']}: {x['info']}")
    final = {d: select([c for c in cs if c["ok"]]) for d, cs in cands.items()}
    return {d: fl for d, fl in final.items() if fl}, counts, cands


# ---------------------------------------------------------------- race-mode export (rows for scripts/seed-db.mjs)

TRIGGER_WORDS = {"SC": "Safety car", "VSC": "Virtual safety car", "RIVAL_STOP": "Rival stop",
                 "UNDERCUT": "Undercut window", "FAST_DEG": "Tyres fading", "TYRE_WINDOW": "Tyre window",
                 "RAIN": "Rain"}
TRIGGER_ORDER = ["SC", "VSC", "RAIN", "RIVAL_STOP", "UNDERCUT", "FAST_DEG", "TYRE_WINDOW"]


def freeze_title(L, types, pos, comp, age):
    words = [TRIGGER_WORDS[t] for t in TRIGGER_ORDER if t in types]
    phrase = words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]
    phrase = phrase[0] + phrase[1:].lower()
    tyres = f"on {age}-lap-old {comp.lower()}s" if comp else f"tyres {age} laps old"
    return f"Lap {L}. {phrase}. You're in P{pos} {tyres}."


def freeze_factors(types):
    f = []
    if "SC" in types:
        f.append("cheap_stop_under_sc")
    elif "VSC" in types:
        f.append("cheap_stop_under_vsc")
    return f + ["tyre_age", "similar_cars_pitted", "track_position"]


def engine_frames(ctx):
    """Frames with compounds and SC/VSC track status, as engine/build.py builds them for the engine."""
    key = ctx["spec"]["key"]
    comps, man = B.manual_compounds(key)
    of1 = B.openf1_dir(key)
    if of1:
        comps = {**comps, **B.openf1_compounds(of1, ctx["results"])}
    ts = man.get("track_status", {})
    return B.build_frames(ctx["race"], ctx["results"], comps, set(ts.get("SC", {}).get("laps", [])),
                          set(ts.get("VSC", {}).get("laps", [])))


def call_moment(frames, L):
    """Laps 1..L-1 plus the lap-L call-moment frame: end of lap L-1 order and gaps, tyre ages +1, lap L's track
    status, and no lap-L stop for any car (security-contract Round 4.8 / Round 6). The engine sees nothing else."""
    prev = frames[L - 2]
    cm = {"lap": L, "track_status": frames[L - 1]["track_status"],
          "drivers": [{**x, "tyre_age": x["tyre_age"] + 1, "pitted_this_lap": False} for x in prev["drivers"]]}
    return frames[:L - 1] + [cm]


def engine_call(ctx, eframes, L, d):
    view = truncate(ctx["race"], L - 1)
    loss, _ = pit_loss(ctx, L, view)
    track = {"normal_pit_loss_s": loss, "total_laps": ctx["n_laps"], "max_stint_laps": ctx["cap"]}
    e = B.eng.decide(call_moment(eframes, L), L, ctx["code"][d], track)
    return {"call": e["call"], "confidence": e["confidence"], "reasons": e["reasons"]}, e["inputs"]


def race_mode(ctx, final):
    """Rows for race mode: drivers (picker), freezes (blind + full per driver and lap) and audible truth
    (per driver and lap, the seconds answer for a BOX audible). Answers live only in `full` / `truth`."""
    key = ctx["spec"]["key"]
    eframes = engine_frames(ctx)
    frames = B.build_frames(ctx["race"], ctx["results"], {}, set(), set())
    code = ctx["code"]
    res = {r["Driver"]["driverId"]: r for r in ctx["results"]}
    colour = lambda d: B.TEAM_COLOURS.get(ctx["team"][d])
    start_pos = {x["id"]: x["position"] for x in frames[0]["drivers"]}
    ident = lambda d: {"code": code[d], "number": int(res[d]["number"]),
                       "name": res[d]["Driver"].get("familyName") or code[d], "team": ctx["team"][d],
                       "team_colour": colour(d)}
    freezes, drivers = [], []
    for d, fl in final.items():
        drivers.append({"race_key": key, **ident(d), "start_position": start_pos.get(d, 99), "freeze_count": len(fl)})
        for c in fl:
            L, v, j = c["lap"], c["v"], c["j"]
            types = sorted({t["type"] for t in v["triggers"]}, key=TRIGGER_ORDER.index)
            view = truncate(ctx["race"], L - 1)
            loss, loss_src = pit_loss(ctx, L, view)
            blind = {"driver_code": code[d], "lap": L, "blind_title": freeze_title(L, types, v["pos"], v["compound"], v["age"]),
                     "triggers": [{"type": t["type"], "info": t["info"]} for t in v["triggers"]],
                     "position": v["pos"], "compound": v["compound"], "tyre_age": v["age"],
                     "pit_loss": {"normal_s": loss, "source": loss_src}, "options": ["BOX", "STAY"],
                     "factors": freeze_factors(types)}
            eng_call, eng_inputs = engine_call(ctx, eframes, L, d)
            real_box = j["real"].startswith("BOX")
            real_lap = int(j["real"][5:]) if real_box else None
            w0, w1 = j["window"]
            tg = {**j["tg"], "group_player_call": [code[x] for x in j["tg"]["group_player_call"]],
                  "group_other_call": [code[x] for x in j["tg"]["group_other_call"]],
                  "pairs": [{**pr, "a": code[pr["a"]], "b": code[pr["b"]]} for pr in j["tg"]["pairs"]],
                  "pairs_missing_laps": [[code[a], code[b]] for a, b in j["tg"]["pairs_missing_laps"]]}
            full = {"correct": j["correct"], "swing_s": j["swing_s"], "window": [w0, w1],
                    "comparison": {"boxed": [code[x] for x in j["boxed"]], "stayed": [code[x] for x in j["stayed"]],
                                   "widened_by_tyre_age": j["widened"]},
                    "team_call": {"call": "BOX" if real_box else "STAY", "lap": real_lap,
                                  "reasons": [f"Pitted on lap {real_lap}."] if real_box else [f"Stayed out on laps {w0}-{w1}."]},
                    "engine": eng_call, "engine_inputs": eng_inputs, "detail": tg}
            # Round 9: luck between the call and the end of the measurement (full only, never blind).
            end = max(w1, j["end_lap"])
            full["luck_events"] = luck_events(ctx["periods"], ctx["reds"], ctx["rain"], L, end, set(types))
            if full["luck_events"]:
                stops_by_code = {code[x]: sl for x, sl in ctx["race"]["stops"].items()}
                cars = [code[x] for x in [d] + j["boxed"] + j["stayed"]]
                full["luck_facts"] = {
                    "call": B.call_facts(eframes, L, code[d], eng_inputs, ctx["race"]["stops"], n_laps=ctx["n_laps"],
                                         triggers=types, cap=ctx["cap"]),
                    "after_call": luck_after(full["luck_events"], ctx["periods"], stops_by_code, cars),
                    "measured": B.measured_facts(j["correct"], j["swing_s"], [w0, w1], end,
                                                 full["comparison"]["boxed"], full["comparison"]["stayed"]),
                }
            freezes.append({"race_key": key, "driver_code": code[d], "lap": L, "triggers": types, "blind": blind, "full": full})
    # Audible truth for every car on every lap it could press "box now" (visible lap A): the stop happens
    # after what the player has seen, so judge at L' = A+1 with the window A+1..A+3; the baseline is the
    # end of lap A and cars that stopped on or before lap A don't count as comparisons.
    audibles = []
    n = ctx["n_laps"]
    for d in code:
        for A in range(2, n - AUDIBLE_WINDOW):
            Lp = A + 1
            win = [A + 1, A + AUDIBLE_WINDOW]
            j = judge(ctx, frames, Lp, d, window=win)
            if j.get("note", "").startswith("not running"):
                continue
            scorable = j["split"] and j["swing_s"] >= MIN_SWING_S
            truth = {"scorable": scorable, "correct": j.get("correct"), "swing_s": j.get("swing_s"),
                     "window": win, "n_box": j["n_box"], "n_stay": j["n_stay"],
                     "reason": None if scorable else ("no comparison cars on both calls" if not j["split"] else "swing under 2.0 s")}
            if j["split"]:
                truth["comparison"] = {"boxed": [code[x] for x in j["boxed"]], "stayed": [code[x] for x in j["stayed"]]}
            audibles.append({"race_key": key, "driver_code": code[d], "lap": A, "truth": truth})
    drivers.sort(key=lambda r: r["start_position"])
    return {"drivers": drivers, "freezes": freezes, "audibles": audibles}


def export(verbose=False):
    """Race-mode rows for every cached race (engine/build.py adds them to load.json)."""
    out = {"race_drivers": [], "race_freezes": [], "race_audibles": []}
    for ctx in prepare():
        final, _, _ = run_race(ctx, verbose=False)
        rows = race_mode(ctx, final)
        out["race_drivers"] += rows["drivers"]
        out["race_freezes"] += rows["freezes"]
        out["race_audibles"] += rows["audibles"]
    return out


def print_header(ctx):
    k = ctx["spec"]["key"]
    print(f"\n==================== {k} ({ctx['n_laps']} laps, stint cap {ctx['cap']})")
    print(f"SC/VSC periods from race control: {ctx['periods']}; rain laps: {sorted(l for l, v in ctx['rain'].items() if v)}")
    if ctx["bad_compound"]:
        print(f"Compound unknown (OpenF1 stints disagree with Jolpica stops): {[ctx['code'][d] for d in ctx['bad_compound']]}")
    print("Expected stint life priors (laps at this race; replaced in-race once a green stint of that compound finishes):")
    for c in COMPOUNDS:
        print(f"  {c:6s} {ctx['prior'][c]:3d}  <- {ctx['prior_src'][c]}")
    print(f"Pit-loss prior: {ctx['prior_loss'][0]} s, median of {ctx['prior_loss'][1]} green stops in {ctx['spec']['prior_race']} (build.green_pit_loss)")
    print(f"Fresh-tyre gain prior: {ctx['prior_gain']:.2f} s/lap (raw {ctx['prior_gain_raw']:+.2f}, clamped at 0) from {ctx['prior_gain_n']} green stops in {ctx['spec']['prior_race']} "
          f"(old laps p-2,p-1 minus new laps p+2,p+3, fuel-corrected); undercut range = 2 x gain")
    # show how in-race derived values evolve
    print("In-race derived values (end of lap L-1):")
    for L in range(10, ctx["n_laps"], 10):
        view = truncate(ctx["race"], L - 1)
        sc = neutralised(ctx["periods"], L - 1)
        tr, ntr = field_trend(view, sc)
        thr, src = deg_threshold(view, sc, tr)
        g, ng = fresh_gain(view, sc, tr)
        lf = expected_life(ctx, view, sc, L)
        loss, lsrc = pit_loss(ctx, L, view)
        print(f"  L{L}: fuel trend {tr:+.3f}s/lap ({ntr} green laps); fast-deg thr "
              f"{'n/a' if thr is None else f'{thr:.2f}s'} ({src}); fresh gain {'n/a' if g is None else f'{g:.2f}s/lap'} "
              f"(n={ng}); pit loss {loss}s ({lsrc}); life {{{', '.join(f'{c[0]}:{v[0]} {v[1]}' for c, v in lf.items())}}}")


def main():
    ctxs = prepare()
    summary = []
    for ctx in ctxs:
        print_header(ctx)
        print("Candidates (car | lap | triggers | eligible | seconds ground truth | real team):")
        final, counts, cands = run_race(ctx, verbose="-v" in sys.argv)
        print(f"\nTrigger counts {ctx['spec']['key']} (car-laps fired, of which eligible): "
              + ", ".join(f"{k} {v[0]}/{v[1]}" for k, v in sorted(counts.items())))
        for t in ("SC", "VSC", "RIVAL_STOP", "UNDERCUT", "FAST_DEG", "TYRE_WINDOW", "RAIN"):
            if t not in counts:
                print(f"  {t}: never fired")
        print(f"\nFINAL freezes per driver {ctx['spec']['key']}:")
        nbox = nstay = 0
        for d, fl in sorted(final.items(), key=lambda kv: ctx["code"][kv[0]]):
            flag = "" if len(fl) >= MIN_FREEZES else f"   (only {len(fl)}: below the {MIN_FREEZES} minimum)"
            print(f" {ctx['code'][d]} ({ctx['team'][d]}){flag}")
            for c in fl:
                j, v = c["j"], c["v"]
                types = "+".join(sorted({x["type"] for x in v["triggers"]}))
                print(f"   L{c['lap']:>2} {types:24s} correct {j['correct']:4s} swing {j['swing_s']:5.1f}s  real {j['real']}")
                nbox += j["correct"] == "BOX"
                nstay += j["correct"] == "STAY"
        print(f" Correct-answer distribution {ctx['spec']['key']}: BOX {nbox}, STAY {nstay}")
        summary.append((ctx["spec"]["key"], nbox, nstay))
    print("\nSUMMARY BOX/STAY per race:", summary)


if __name__ == "__main__":
    main()
