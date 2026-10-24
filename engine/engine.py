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
W_PLACES = 0.6     # per place at risk from cars behind predicted to stay out
RIVAL_PIT_THRESHOLD = 1.5  # a rival is predicted to pit when its discount + tyre terms exceed this


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
    me = before[player_code]
    # Everyone who started lap L; a retirement during lap L isn't known at the call.
    rivals = [d for c, d in before.items() if c != player_code]
    # At the moment of the call we only see stops by cars ahead on the road: they reach pit entry first.
    ahead = [r for r in rivals if r["position"] < me["position"]]
    pitted_now = {d["code"] for d in now["drivers"] if d["pitted_this_lap"]} & {r["code"] for r in ahead}

    # 1. field signal, from the cars ahead; neutral when nobody is ahead
    wsum = sum(_sim(me, r) for r in ahead)
    wpit = sum(_sim(me, r) for r in ahead if r["code"] in pitted_now)
    field_share = wpit / wsum if wsum else 0.5
    n_pit, n_riv = len(pitted_now), len(ahead)
    similar = sorted(ahead, key=lambda r: -_sim(me, r))[:5]
    sim_pit = sum(1 for r in similar if r["code"] in pitted_now)

    # 2. pit-loss discount
    normal = track["normal_pit_loss_s"]
    reduced = normal * SC_FACTOR[status]
    saving = normal - reduced

    # 3. tyre state
    # tyre age on lap L (laps on the set including this one), matching how pit walls quote it
    now_by = {d["code"]: d for d in now["drivers"]}

    def age_on_lap(code):
        # A car that retires during lap L has no lap-L row; carry its tyres one lap on.
        if code in now_by:
            return now_by[code]["tyre_age"] or 0
        return (before[code]["tyre_age"] or 0) + 1
    ages = sorted(age_on_lap(r["code"]) for r in rivals)
    med_age = ages[len(ages) // 2]
    laps_left = track["total_laps"] - lap
    cap = track.get("max_stint_laps")
    my_age = now_by[player_code]["tyre_age"] or 0
    def tyre_need(age):
        """(tyre term, stops owed) for a car on `age`-lap tyres."""
        if cap:
            owed = math.ceil(max(0, age + laps_left - cap) / cap)
            return (1.0 if owed >= 1 else 0.0), owed
        return max(-1.0, min(1.0, (age - med_age) / 10.0)), None

    tyre_term, stops_owed = tyre_need(my_age)

    # places at risk: cars behind within the reduced loss whose own state says their team stays out.
    # We can't see their stops yet, so we predict each one with the same pit-cost and tyre logic.
    my_gap = me["gap_to_leader_s"]
    at_risk = 0
    expected_pit = 0
    if my_gap is not None:
        for r in rivals:
            g = r["gap_to_leader_s"]
            if r["position"] > me["position"] and g is not None and g - my_gap < reduced:
                r_tyre, _ = tyre_need(age_on_lap(r["code"]))
                if W_DISCOUNT * (saving / normal) + W_TYRE * r_tyre > RIVAL_PIT_THRESHOLD:
                    expected_pit += 1
                else:
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
    if n_riv:
        reasons.append(f"{n_pit} of {n_riv} cars ahead pitted under the {label}, {sim_pit} of the {len(similar)} most similar.")
    else:
        reasons.append(f"Leading under the {label}. {expected_pit} of {expected_pit + at_risk} cars within "
                       f"{reduced:.1f} s behind expected to pit.")
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
            "stops_owed": stops_owed, "places_at_risk": at_risk, "behind_expected_to_pit": expected_pit, "score": round(score, 3),
            "p_box": round(p_box, 3), "radio_delta": r_delta,
        },
    }
