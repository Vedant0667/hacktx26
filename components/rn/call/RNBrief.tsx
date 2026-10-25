"use client";
// The call pad's race picture (P05/P06): ahead/behind rows and a mini map with the rejoin ghost next to the
// "If you box" block. Reads only the blind brief from getBrief(decision, frames).
import { COPY } from "@/lib/copy";
import type { BlindDecision } from "@/lib/client/api";
import { leaderFractionFor, placeCars, trackFor } from "@/lib/tracks";
import type { Brief } from "@/components/DecisionBrief";
import { GapValue, Label, Num, TyreBadge } from "../kit";
import { TrackMap } from "../TrackMap";
import { RN_CALL_COPY as T } from "./copy";

function Trend({ rate }: { rate: number | null }) {
  if (rate == null || !Number.isFinite(rate) || Math.abs(rate) < 0.05) return <span className="rnc-trend" />;
  const closing = rate < 0;
  return (
    <span className="rnc-trend">
      <span aria-hidden>{closing ? "▼" : "▲"}</span> {closing ? T.closing : T.growing} {Math.abs(rate).toFixed(1)}
    </span>
  );
}

export function NeighbourRows({ brief }: { brief: Brief }) {
  const t = brief.tele;
  if (!t) return null;
  const rows = [
    { key: "ahead", label: T.ahead, car: t.neighbours.ahead, gap: t.gapAhead, sign: -1 },
    { key: "behind", label: T.behind, car: t.neighbours.behind, gap: t.gapBehind, sign: 1 },
  ];
  return (
    <div className="rnc-nb">
      {rows.map((r) =>
        r.car ? (
          <div key={r.key} className="rnc-nb-row">
            <Label>{r.label}</Label>
            <span className="rn-d rnc-nb-code">{r.car.code}</span>
            <TyreBadge compound={r.car.compound} age={r.car.age} />
            <GapValue delta={r.gap?.now != null ? r.sign * Math.abs(r.gap.now) : null} size={24} />
            <Trend rate={r.gap?.rate ?? null} />
          </div>
        ) : null,
      )}
    </div>
  );
}

export function MapAndBox({ brief, decision }: { brief: Brief; decision: BlindDecision }) {
  const track = trackFor(decision.id);
  const frame = brief.frame;
  const me = frame?.drivers.find((d) => d.number === decision.player_role.number);
  const leader = frame?.drivers.find((d) => d.position === 1);
  const lapTimeS = leader?.lap_time_s ?? me?.lap_time_s ?? 100;
  const leaderFraction = me?.gap_to_leader_s != null ? leaderFractionFor(0.22, me.gap_to_leader_s, lapTimeS) : 0;
  const opts = { lapTimeS, leaderFraction };
  const cars = frame ? placeCars(frame.drivers, opts) : [];
  const near = [brief.tele?.neighbours.ahead?.code, brief.tele?.neighbours.behind?.code].filter((c): c is string => !!c);
  const rj = brief.rejoin;
  const ghost = rj ? { fraction: placeCars([{ code: "GHOST", gap_to_leader_s: rj.gapToLeader }], opts)[0]?.fraction ?? 0, label: `P${rj.pos}` } : null;
  const loss = brief.loss;
  return (
    <div className="rnc-mapbox">
      {track && me && (
        <TrackMap
          track={track}
          cars={cars}
          followed={me.code}
          near={near}
          ghost={ghost}
          caution={decision.trigger !== "GREEN"}
          size="phone"
          width={190}
          ariaLabel={T.mapLabel(me.code, rj?.pos ?? null)}
          className="rnc-map"
        />
      )}
      <div className="rnc-ifbox">
        {rj && (
          <>
            <Label>{T.ifYouBox}</Label>
            <Num value={`P${rj.pos}`} size={44} weight={900} className="rnc-ifbox-p" />
            {rj.ahead && <p className="rnc-ifbox-sub">{T.behindCar(rj.ahead.gap, rj.ahead.code)}</p>}
          </>
        )}
        {loss && (
          <>
            <Label className="rnc-ifbox-lbl">{COPY.tele.pitLoss}</Label>
            <Num value={loss.under.toFixed(1)} unit="s" size={26} weight={900} />
            {decision.trigger !== "GREEN" && <p className="rnc-ifbox-sub">{T.atGreen(loss.normal)}</p>}
          </>
        )}
      </div>
    </div>
  );
}
