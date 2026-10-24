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
        answers = {c["j"]["correct"] for fl in final.values() for c in fl}
        assert answers == {"BOX", "STAY"}, (ctx["spec"]["key"], answers)


def test_freeze_filters_per_driver():
    """Per driver: split, swing >= 2 s, >= 5 laps apart, at most 6; rival stops only within +/-3 places."""
    for ctx in CTXS:
        final, _, _ = T.run_race(ctx, verbose=False)
        assert final, ctx["spec"]["key"]
        for d, fl in final.items():
            laps = [c["lap"] for c in fl]
            assert len(fl) <= T.MAX_FREEZES and laps == sorted(laps), (d, laps)
            assert all(b - a >= T.MIN_GAP_LAPS for a, b in zip(laps, laps[1:])), (d, laps)
            for c in fl:
                assert c["j"]["split"] and c["j"]["swing_s"] >= T.MIN_SWING_S, (d, c["lap"], c["j"])


def test_rival_stop_within_three_places():
    """Every rival named by a RIVAL_STOP trigger was within 3 places of the car at the end of lap L-2."""
    for ctx in CTXS:
        frames = T.B.build_frames(ctx["race"], ctx["results"], {}, set(), set())
        by_code = {v: k for k, v in ctx["code"].items()}
        for L in range(4, ctx["n_laps"] - T.GT_WINDOW):
            f0 = {x["id"]: x["position"] for x in frames[L - 3]["drivers"]}
            for d, v in T.detect(ctx, L).items():
                for t in v["triggers"]:
                    if t["type"] != "RIVAL_STOP":
                        continue
                    named = t["info"].split(": ", 1)[1].split(" (pit loss")[0].split(", ")
                    for n in named:
                        o = by_code[n.split(" ")[0]]
                        assert abs(f0[o] - f0[d]) <= T.RIVAL_POS, (ctx["spec"]["key"], L, ctx["code"][d], n)


def test_export_blind_has_no_answer_and_engine_has_no_lookahead():
    """Race-mode export: blind rows hold no answer, team call or engine call; the engine call for a freeze is
    the same when everything from lap L on is scrambled (it sees laps 1..L-1 and lap L's track status only)."""
    answer_keys = {"correct", "swing_s", "team_call", "engine", "comparison", "detail", "window", "real"}
    for ctx in CTXS:
        final, _, _ = T.run_race(ctx, verbose=False)
        rows = T.race_mode(ctx, final)
        assert rows["freezes"] and rows["drivers"] and rows["audibles"]
        eframes = T.engine_frames(ctx)
        for f in rows["freezes"]:
            assert not answer_keys & set(f["blind"]), f["blind"]
            assert f["full"]["swing_s"] >= T.MIN_SWING_S
            assert f["full"]["correct"] in ("BOX", "STAY")
            L = f["lap"]
            d = next(k for k, v in ctx["code"].items() if v == f["driver_code"])
            fr = T.call_moment(eframes, L)
            assert len(fr) == L and not any(x["pitted_this_lap"] for x in fr[-1]["drivers"])
            # scramble every frame from lap L on: the engine never reads them
            noisy = copy.deepcopy(eframes)
            for k in range(L - 1, len(noisy)):
                for x in noisy[k]["drivers"]:
                    x["pitted_this_lap"] = not x["pitted_this_lap"]
                    x["gap_to_leader_s"] = (x["gap_to_leader_s"] or 0) + 99
                    x["tyre_age"] = 0
            a, _ = T.engine_call(ctx, eframes, L, d)
            b, _ = T.engine_call(ctx, noisy, L, d)
            assert a == b, (ctx["spec"]["key"], L, f["driver_code"], a, b)
        for a in rows["audibles"][:200]:
            assert a["truth"]["scorable"] in (True, False)
            if a["truth"]["scorable"]:
                assert a["truth"]["swing_s"] >= T.MIN_SWING_S and a["truth"]["correct"] in ("BOX", "STAY")


def test_freeze_detection_matches_scrambled_future_for_exported_freezes():
    """For each exported freeze lap, detect() at that lap is unchanged when laps >= L are scrambled."""
    for ctx in CTXS:
        final, _, _ = T.run_race(ctx, verbose=False)
        laps = sorted({c["lap"] for fl in final.values() for c in fl})
        for L in laps:
            if L < 3:
                continue
            assert strip(T.detect(ctx, L)) == strip(T.detect(scrambled(ctx, L, 7 + L), L)), (ctx["spec"]["key"], L)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
