"""Run: python3 engine/test_engine.py  (needs public/data built by engine/build.py)."""
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import engine as eng  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "public" / "data"
QATAR_TRACK = {"normal_pit_loss_s": 28.3, "total_laps": 57, "max_stint_laps": 25}


def load(dp_id):
    return (json.loads((DATA / dp_id / "frames.json").read_text()),
            json.loads((DATA / dp_id / "decision.json").read_text()))


def test_no_lookahead():
    frames, _ = load("qatar-2025-l7")
    try:
        eng.decide(frames[:8], 7, "PIA", QATAR_TRACK)
    except ValueError:
        pass
    else:
        raise AssertionError("engine accepted a frame after the decision lap")
    # scrambling every lap after L must not change the call
    base = eng.decide(frames[:7], 7, "PIA", QATAR_TRACK)
    scrambled = copy.deepcopy(frames)
    for f in scrambled[7:]:
        for d in f["drivers"]:
            d["position"], d["pitted_this_lap"], d["tyre_age"] = 99, True, 0
    assert eng.decide(scrambled[:7], 7, "PIA", QATAR_TRACK) == base
    # stops on lap L by cars behind us happen after our pit entry, so they must not change the call either
    lap7 = copy.deepcopy(frames)
    start = {d["code"]: d["position"] for d in lap7[5]["drivers"]}
    for d in lap7[6]["drivers"]:
        if start.get(d["code"], 99) > start["PIA"]:
            d["pitted_this_lap"] = not d["pitted_this_lap"]
    assert eng.decide(lap7[:7], 7, "PIA", QATAR_TRACK) == base


def test_qatar_engine_box():
    frames, dec = load("qatar-2025-l7")
    e = eng.decide(frames[:7], 7, "PIA", QATAR_TRACK)
    assert e["call"] == "BOX" and e["confidence"] >= 0.7, e
    assert dec["engine"]["call"] == "BOX"
    assert len(dec["engine"]["reasons"]) == 3


def test_qatar_ground_truth_box():
    _, dec = load("qatar-2025-l7")
    assert dec["ground_truth"]["correct"] == "BOX"
    assert dec["ground_truth"]["swing_s"] > 0
    assert dec["team"]["call"] == "STAY"


def test_contract_keys():
    want = {"id", "race", "blind_title", "lap", "trigger", "player_role", "options", "replay_from_lap",
            "reveal_to_lap", "ground_truth", "factors", "team", "engine"}
    index = json.loads((DATA / "index.json").read_text())
    assert isinstance(index, list) and index
    for entry in index:
        frames, dec = load(entry["id"])
        assert set(dec) == want, set(dec) ^ want
        assert set(dec["ground_truth"]) == {"correct", "swing_s"}
        assert {f["lap"] for f in frames} == set(range(1, len(frames) + 1))
        for d in frames[0]["drivers"]:
            assert set(d) == {"code", "number", "team", "team_colour", "position", "gap_to_leader_s", "compound", "tyre_age", "pitted_this_lap"}


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
