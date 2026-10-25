"use client";
// Race Night phone "calls locked" beat (race reveal_freeze, ~5 s; the P08Locked look). Every phone sees it after
// a freeze, whether or not its car had a call: calls are sealed, the race goes on, answers come at the flag.
// The start lights go out as the replay comes back; the foot counts down like the no-call screen's.
// Same data as RacePlay's Locked, plus the team colour.
import { COPY } from "@/lib/copy";
import { REVEAL_HOLD_MS } from "@/lib/client/raceLobby";
import { Countdown, Label, Logo, RNRoot, StartLights } from "../kit";
import { RN_CALL_COPY } from "../call/copy";
import { RN_PHONE_COPY as C } from "./copy";
import "../call/call.css";
import "./locked.css";

const HOLD_S = Math.ceil(REVEAL_HOLD_MS / 1000);

export function RNPhoneLocked({ left, teamColour }: { left: number; teamColour?: string | null }) {
  const done = Math.max(0, Math.min(1, 1 - left / HOLD_S));
  return (
    <RNRoot as="main" team={teamColour ?? null} neutral={!teamColour} className="rnc rnpl">
      <header className="rnc-top rnpl-top">
        <Logo size="phone" />
      </header>
      <section className="rnc-hero rnc-hero-lock rnpl-hero">
        <div className="rnc-hero-slab" aria-hidden />
        <div className="rnc-hero-in">
          <Label tone="ink">✓ {C.freezeOver}</Label>
          <h1 className="rn-d rnc-lock-title rnpl-title">{COPY.end.lockedTitle}</h1>
          <p className="rnc-lock-sub">{C.raceGoesOn}</p>
        </div>
      </section>
      <div className="rnc-lock-body">
        <div>
          <h2 className="rn-d rnc-h2">{RN_CALL_COPY.answersTitle}</h2>
          <p className="rnc-muted">{RN_CALL_COPY.answersSub}</p>
        </div>
      </div>
      <footer className="rnpl-foot">
        <Label>{C.resumesIn}</Label>
        <div className="rnpl-foot-row">
          <StartLights left={left} total={HOLD_S} size="host-md" />
          <Countdown left={left} size="phone" className="rnpl-count" />
        </div>
        <div className="rnpl-bar" aria-hidden>
          <i style={{ width: `${Math.round(done * 100)}%` }} />
        </div>
      </footer>
    </RNRoot>
  );
}
