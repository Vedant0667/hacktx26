"""Pit-wall engine: BOX or STAY at a neutralised lap, from timing data up to and including lap L.

Inputs are frames (see build.py) cut at lap L. Nothing after lap L may be passed in;
`decide` raises if it sees a later lap.

Signals
1. State-matched field signal: among rivals, weight each by similarity to our car in
   tyre age, compound and position; the weighted share that pitted on lap L.
2. Pit-loss discount: normal green-flag pit loss for the track vs the loss under SC (~50%)
   or VSC (~75%). Source for the ratios: https://flowracers.com/blog/f1-free-pit-stop/
   ("just 10 seconds, rather than 20" under SC; "15 behind a VSC").
3. Tyre state: our tyre age vs the field, and whether a stop is still owed before the flag.
4. Team radio: TODO hook, `radio_adjustment`, takes tagged signals once Muse is wired up.
"""
import math

SC_FACTOR = {"SC": 0.5, "VSC": 0.75, "GREEN": 1.0}

# Weights for the logistic score. Hand-set, documented, not fitted.
W_FIELD = 4.0      # weighted share of similar cars that pitted, centred at 0.5
W_DISCOUNT = 3.0   # seconds saved / normal loss
W_TYRE = 1.5       # tyre age vs field (and stop owed)
W_PLACES = 0.6     # per place at risk from cars behind that stayed out


def _sim(me, other):
    """Similarity weight in [0, 1] between our car and a rival."""
    age = math.exp(-abs((me["tyre_age"] or 0) - (other["tyre_age"] or 0)) / 6.0)
    if me["compound"] and other["compound"]:
        comp = 1.0 if me["compound"] == other["compound"] else 0.6
    else:
        comp = 0.8  # unknown compound: neutral-ish
    pos = math.exp(-abs(me["position"] - other["position"]) / 6.0)
    return age * comp * pos


def radio_adjustment(signals):
    """TODO(Muse): map tagged team-radio signals to a score shift.

    signals: list of dicts like {"type": "tyre_complaint"|"grip"|"weather"|"driver_preference",
    "direction": "BOX"|"STAY", "confidence": 0..1, "quote": str}. Returns (delta_score, reason|None).
    Until transcripts exist this returns no adjustment.
    """
    if not signals:
        return 0.0, None
    delta = 0.0
    for s in signals:
        sign = 1.0 if s.get("direction") == "BOX" else -1.0
        delta += 0.5 * sign * float(s.get("confidence", 0.5))
    return delta, None


def decide(frames, lap, player_code, track, radio_signals=None):
    """frames: list of per-lap dicts for laps 1..lap. track: {"normal_pit_loss_s", "total_laps", "max_stint_laps"|None}.

    Returns {"call", "confidence", "reasons", "inputs"}.
    """
    if any(f["lap"] > lap for f in frames):
        raise ValueError("lookahead: frames beyond decision lap passed to engine")
    now = next(f for f in frames if f["lap"] == lap)
    prev = next(f for f in frames if f["lap"] == lap - 1)
    status = now["track_status"]
    before = {d["code"]: d for d in prev["drivers"]}   # state at the start of lap L
    pitted_now = {d["code"] for d in now["drivers"] if d["pitted_this_lap"]}
    me = before[player_code]
    running = {d["code"] for d in now["drivers"]}
    rivals = [d for c, d in before.items() if c != player_code and c in running]

    # 1. field signal
    wsum = sum(_sim(me, r) for r in rivals)
    wpit = sum(_sim(me, r) for r in rivals if r["code"] in pitted_now)
    field_share = wpit / wsum if wsum else 0.0
    n_pit, n_riv = sum(1 for r in rivals if r["code"] in pitted_now), len(rivals)
    similar = sorted(rivals, key=lambda r: -_sim(me, r))[:5]
    sim_pit = sum(1 for r in similar if r["code"] in pitted_now)

    # 2. pit-loss discount
    normal = track["normal_pit_loss_s"]
    reduced = normal * SC_FACTOR[status]
    saving = normal - reduced

    # 3. tyre state
    # tyre age on lap L (laps on the set including this one), matching how pit walls quote it
    now_by = {d["code"]: d for d in now["drivers"]}
    ages = sorted(now_by[r["code"]]["tyre_age"] or 0 for r in rivals)
    med_age = ages[len(ages) // 2]
    laps_left = track["total_laps"] - lap
    cap = track.get("max_stint_laps")
    my_age = now_by[player_code]["tyre_age"] or 0
    if cap:
        stops_owed = math.ceil(max(0, my_age + laps_left - cap) / cap)
        tyre_term = 1.0 if stops_owed >= 1 else 0.0
    else:
        stops_owed = None
        tyre_term = max(-1.0, min(1.0, (my_age - med_age) / 10.0))

    # places at risk: cars behind within the reduced loss that did not pit this lap
    my_gap = me["gap_to_leader_s"]
    at_risk = 0
    if my_gap is not None:
        for r in rivals:
            g = r["gap_to_leader_s"]
            if r["position"] > me["position"] and g is not None and g - my_gap < reduced and r["code"] not in pitted_now:
                at_risk += 1

    score = (W_FIELD * (field_share - 0.5) + W_DISCOUNT * (saving / normal)
             + W_TYRE * tyre_term - W_PLACES * at_risk)
    r_delta, r_reason = radio_adjustment(radio_signals or [])
    score += r_delta
    p_box = 1.0 / (1.0 + math.exp(-score))
    call = "BOX" if p_box >= 0.5 else "STAY"
    confidence = round(p_box if call == "BOX" else 1 - p_box, 2)

    # reasons, pit-wall voice
    label = {"SC": "SC", "VSC": "VSC", "GREEN": "green"}[status]
    reasons = []
    reasons.append(f"{n_pit} of {n_riv} cars pitted under the {label}, {sim_pit} of the 5 most similar.")
    reasons.append(f"{label} stop costs {reduced:.1f} s, green-flag stop {normal:.1f} s.")
    if cap:
        reasons.append(f"Tyres {my_age} laps old, {laps_left} laps left, {cap}-lap cap: "
                       f"{stops_owed} more stop{'s' if stops_owed != 1 else ''} owed.")
    else:
        reasons.append(f"Tyres {my_age} laps old, field median {med_age}, {laps_left} laps left.")
    if r_reason:
        reasons.append(r_reason)

    return {
        "call": call,
        "confidence": confidence,
        "reasons": reasons[:3],
        "inputs": {
            "track_status": status, "field_share_weighted": round(field_share, 3),
            "pitted_count": n_pit, "rivals": n_riv, "similar_top5_pitted": sim_pit,
            "normal_pit_loss_s": round(normal, 1), "reduced_pit_loss_s": round(reduced, 1),
            "tyre_age": my_age, "field_median_tyre_age": med_age, "laps_left": laps_left,
            "stops_owed": stops_owed, "places_at_risk": at_risk, "score": round(score, 3),
            "p_box": round(p_box, 3), "radio_delta": r_delta,
        },
    }
