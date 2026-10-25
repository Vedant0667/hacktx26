"use client";
// Race Night phone no-call freeze (P09NoCall): the replay is paused for other cars. Says so on the team slab,
// shows why it froze (car code + trigger), the room grid (Thinking for players who owe a call, Called once in,
// Watching for the rest) and the countdown until the replay resumes. Same props as RacePlay's NoCall.
import "./phone.css";
import { COPY } from "@/lib/copy";
import type { BlindFreeze } from "@/lib/client/api";
import { CALL_WINDOW_S } from "@/lib/client/race";
import { raceCarOf, type RaceLobby } from "@/lib/client/raceLobby";
import { Label, Logo, Num, RNRoot, SkewChip } from "../kit";
import { RN_PHONE_COPY as C } from "./copy";

export function RNNoCall({
  race,
  me,
  car,
  freeze,
  loading,
  left,
  teamColour,
}: {
  race: RaceLobby;
  me: string;
  car: string | null;
  freeze: Record<string, BlindFreeze | null> | null;
  loading: boolean;
  left: number;
  teamColour?: string | null; // extra: RacePlay's `colour` (already computed there for fieldStyle)
}) {
  const r = race.race;
  const need = r.calls_needed ?? [];
  if (loading)
    return (
      <RNRoot team={teamColour} neutral={!teamColour}>
        <main className="rnp">
          <p style={{ padding: "96px 24px 0", fontSize: 18, fontWeight: 700 }}>{COPY.race.loading}</p>
        </main>
      </RNRoot>
    );
  const owes = (name: string) => {
    const c = raceCarOf(race, name);
    return c != null && need.includes(c);
  };
  const owing = race.players.filter((p) => owes(p.name));
  const waiting = owing.filter((p) => !r.called.includes(p.name)).length;
  const total = CALL_WINDOW_S;
  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <RNRoot team={teamColour} neutral={!teamColour}>
      <main className="rnp">
        <div aria-hidden style={{ height: 6, background: "#22C55E", flexShrink: 0 }} />
        <header className="rnp-head">
          <Logo size="phone" />
          <span className="rnp-cond" style={{ fontSize: 18, fontWeight: 800 }}>
            {COPY.race.lapTag(r.freeze_lap ?? 0, r.total_laps)}
          </span>
        </header>
        <div className="rnp-hero" style={{ minHeight: 0 }}>
          <span className="rnp-label">{COPY.race.freezeTag(r.freeze_index + 1, r.freeze_count)}</span>
          <h1 className="rnp-cond" style={{ fontSize: 50, fontWeight: 900, lineHeight: 0.95, marginTop: 10, textTransform: "uppercase", overflowWrap: "anywhere" }}>
            {car ? COPY.race.noCallTitle(car) : COPY.race.watching}
          </h1>
        </div>
        <div className="rnp-body" style={{ paddingTop: 24, gap: 14 }}>
          {need.length > 0 && <Label>{COPY.race.callFor(need)}</Label>}
          {need.map((c) => {
            const f = freeze?.[c];
            if (!f) return null;
            return (
              <div key={c} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {f.triggers.map((t, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <SkewChip tone="panel" size="phone">
                      {c}
                    </SkewChip>
                    <span style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.25 }}>{t.info}</span>
                  </div>
                ))}
              </div>
            );
          })}
          <p style={{ fontSize: 15, color: "#A9AEB8" }}>{COPY.race.noCallSub}</p>
          <div className="rnp-row" style={{ marginTop: 8, borderBottomColor: "#2A2F37" }}>
            <Label>{C.room}</Label>
            <Label>{C.calling(waiting)}</Label>
          </div>
          <ol style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: 24 }}>
            {race.players.map((p) => {
              const o = owes(p.name);
              const done = r.called.includes(p.name);
              return (
                <li key={p.name} className="rnp-row" aria-current={p.name === me || undefined}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, flexShrink: 0, color: o && !done ? "#FFD43B" : o ? "#22C55E" : "#A9AEB8" }}>
                    {o ? (done ? C.called : C.thinking) : C.watching}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="rnp-foot" style={{ position: "relative", flexDirection: "column", alignItems: "stretch", gap: 12 }} aria-live="polite">
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
            <div>
              <Label>{C.resumesIn}</Label>
              <p style={{ marginTop: 4, fontSize: 15, color: "#C9CDD4" }}>{left === 0 ? COPY.freeze.timeUp : COPY.freeze.waitingOn(waiting)}</p>
            </div>
            <span aria-label={`${left} s`}>
              <Num value={mm} size={64} weight={900} />
            </span>
          </div>
          <div aria-hidden style={{ height: 4, background: "#1F232A" }}>
            <div style={{ height: 4, background: "#fff", width: `${Math.round((1 - Math.min(total, left) / total) * 100)}%`, transition: "width 1s linear" }} />
          </div>
        </div>
      </main>
    </RNRoot>
  );
}
