"""Run: python3 engine/test_triggers.py  (reads data/ only; no network)."""
import copy
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import triggers as T  # noqa: E402

CTXS = T.prepare()


def scrambled(ctx, L, seed):
    """Copy of ctx with everything from lap L on replaced by noise: lap times, positions, stops (including the
    car's own real stop), compounds of stints that start at L or later, rain, and SC/VSC periods after L.
    Known at L and kept: the SC/VSC deployment message on lap L itself (trigger 1, by design)."""
    rnd = random.Random(seed)
    c = {k: v for k, v in ctx.items() if not k.startswith("_")}   # drop caches
    race = copy.deepcopy(ctx["race"])
    for d, t in race["times"].items():
        for k in list(t):
            if k >= L:
                t[k] = rnd.uniform(60, 200)
    for d, p in race["pos"].items():
        for k in list(p):
            if k >= L:
                p[k] = rnd.randint(1, 22)
    tyres = dict(ctx["tyres"])
    for d in race["stops"]:
        keep = [p for p in race["stops"][d] if p < L]
        extra = sorted(rnd.sample(range(L, race["n_laps"] + 1), rnd.randint(0, 2)))
        race["stops"][d] = keep + extra
        cur = len(keep) + 1
        for i in range(cur + 1, cur + 4):
            tyres[(d, i)] = (rnd.choice(T.COMPOUNDS), rnd.randint(0, 10))
    c["race"], c["tyres"] = race, tyres
    c["rain"] = {k: (v if k < L else rnd.randint(0, 1)) for k, v in ctx["rain"].items()}
    c["rain"].update({k: rnd.randint(0, 1) for k in range(L, race["n_laps"] + 1)})
    periods = [(k, a, (b if b is None or b < L else rnd.randint(L, race["n_laps"]))) for k, a, b in ctx["periods"] if a <= L]
    periods.append(("SC", min(L + 2, race["n_laps"]), None))
    c["periods"] = periods
    return c


def strip(det):
    return {d: (sorted((t["type"], t["info"]) for t in v["triggers"]), v["compound"], v["age"]) for d, v in det.items()}


def test_no_lookahead():
    """Scrambling laps >= L never changes which cars trigger at L, on which trigger, or the numbers shown."""
    checked = 0
    for ctx in CTXS:
        for L in range(3, ctx["n_laps"] - T.GT_WINDOW):
            base = strip(T.detect(ctx, L))
            for seed in (1, 2):
                got = strip(T.detect(scrambled(ctx, L, seed * 1000 + L), L))
                assert got == base, (ctx["spec"]["key"], L, seed, set(got) ^ set(base))
            checked += 1
    assert checked > 100, checked


def test_split_is_build_time_only():
    """The split check does look ahead (laps L..L+2), which is why it only filters candidates: changing a
    future stop can change eligibility, while detect() at the same lap stays the same (test above)."""
    ctx = next(c for c in CTXS if c["spec"]["key"] == "2025-qatar")
    frames = T.B.build_frames(ctx["race"], ctx["results"], {}, set(), set())
    pia = "piastri"
    j = T.judge(ctx, frames, 7, pia)
    assert j["split"] and j["correct"] == "BOX" and j["real"] == "STAY", j
    c = scrambled(ctx, 7, 0)
    for d in c["race"]["stops"]:
        c["race"]["stops"][d] = [p for p in c["race"]["stops"][d] if p < 7]   # nobody stops from lap 7 on
    frames2 = T.B.build_frames(c["race"], c["results"], {}, set(), set())
    assert not T.judge(c, frames2, 7, pia)["split"]


def test_qatar_sc_matches_shipped_decision():
    """Lap 7 SC at Qatar 2025 fires for both McLarens; Piastri's seconds answer matches public decision (BOX)."""
    ctx = next(c for c in CTXS if c["spec"]["key"] == "2025-qatar")
    det = T.detect(ctx, 7)
    for d in ("piastri", "norris"):
        assert any(t["type"] == "SC" for t in det[d]["triggers"]), det.get(d)


def test_persistent_triggers_fire_once():
    for ctx in CTXS:
        prev = {}
        for L in range(3, ctx["n_laps"] - T.GT_WINDOW):
            det = T.detect(ctx, L)
            for d, v in det.items():
                for t in v["triggers"]:
                    if t["type"] in T.EDGE:
                        assert t["type"] not in prev.get(d, set()), (ctx["spec"]["key"], L, d, t["type"])
            prev = {d: {t["type"] for t in v["triggers"]} for d, v in det.items()}


def test_filters():
    cands = [{"lap": l, "swing": s} for l, s in [(5, 1.0), (7, 9.0), (9, 2.0), (12, 3.0), (20, 4.0), (26, 5.0),
                                                 (31, 6.0), (40, 7.0), (50, 8.0)]]
    out = T.select(cands)
    laps = [c["lap"] for c in out]
    assert len(out) == T.MAX_FREEZES, out
    assert all(b - a >= T.MIN_GAP_LAPS for a, b in zip(laps, laps[1:])), laps
    assert 7 in laps and 5 not in laps and 9 not in laps   # 7 has the largest swing in that cluster


def test_both_answers_exist():
    for ctx in CTXS:
        final, _, _ = T.run_race(ctx, verbose=False)
        answers = {j["correct"] for fl in final.values() for c in fl for _, _, j in c["elig"]}
        assert answers == {"BOX", "STAY"}, (ctx["spec"]["key"], answers)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
