"use client";
// Race Night phone "scoring the calls" wait: shown at the flag while the server grades, before the summary.
// Same data as the legacy phone Scoring in components/EndScreen.tsx (elapsed time, failed flag) and the same
// failed text. No team colour here: the container has none at this point.
import { COPY } from "@/lib/copy";
import { Banner, Label, Logo, RNRoot } from "../kit";
import { PHONE_END_COPY as T } from "./copy";
import "./scoring.css";

export function RNPhoneScoring({ elapsedMs, failed }: { elapsedMs: number; failed: boolean }) {
  const secs = Math.max(0, Math.floor(elapsedMs / 1000));
  return (
    <RNRoot as="main" className="rnps" aria-live="polite" aria-busy={failed ? undefined : "true"}>
      <Banner kind="chequered" size="phone" />
      <header className="rnps-head">
        <Logo size="phone" />
        <Label>{COPY.end.final}</Label>
      </header>
      <div className="rnps-body">
        <h1 className="rn-d rnps-title">
          {/* The display face is upper case; the plain-case copy stays in the DOM for screen readers. */}
          <span aria-hidden>
            <span className="rnps-top">{T.scoringTop}</span>
            <span className="rnps-big">{T.scoringBig}</span>
          </span>
          <span className="rn-sr">{COPY.end.scoring}</span>
        </h1>
        <p className="rnps-sub" data-failed={failed || undefined}>
          {failed ? COPY.end.retry : T.scoringSub}
        </p>
        <span className="rnps-bar" aria-hidden data-failed={failed || undefined}>
          <i />
        </span>
        <p className="rnps-foot">
          {T.credit} · <span className="rn-num">{COPY.end.scoringFor(secs)}</span>
        </p>
      </div>
    </RNRoot>
  );
}
