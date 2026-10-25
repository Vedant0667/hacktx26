"use client";
// Race Night call pad. Same props as components/play/CallPad.tsx; all state, voice, timer and send logic comes
// from useCallPad (lib/client/useCallPad.ts). RNCallPadView is pure presentation over the hook's return value,
// so the preview can render every state from fixtures.
import type { CSSProperties } from "react";
import { COPY, VOICE_COPY } from "@/lib/copy";
import { VOICE_NOTE_MAX_S } from "@/lib/client/race";
import { METER_SEGMENTS } from "@/lib/client/recorder";
import { useCallPad, type CallPadProps, type CallPadState } from "@/lib/client/useCallPad";
import type { Call } from "@/lib/types";
import { RejoinSentence } from "@/components/DecisionBrief";
import { IntervalTable, PitLoss, UndercutClock } from "@/components/Telemetry";
import { MapAndBox, NeighbourRows } from "./RNBrief";
import { MicGlyph, clockText } from "@/components/ui";
import { Banner, Label, Logo, ModeTabs, RNRoot, StartLights, Countdown } from "../kit";
import { RN_CALL_COPY as T } from "./copy";
import "./call.css";

export function RNCallPad(props: CallPadProps) {
  const s = useCallPad(props);
  return <RNCallPadView props={props} s={s} />;
}

// The subset of the hook's return value the view reads (fixtures in the preview build this shape).
export type RNCallPadViewState = Pick<
  CallPadState,
  | "call" | "why" | "sending" | "queued" | "locked" | "err" | "setWhy" | "inputRef" | "voice" | "busy" | "recording"
  | "talkMs" | "recSecs" | "micDown" | "showTyping" | "tooLate" | "hasNote" | "left" | "urgent" | "alreadyIn" | "brief"
  | "team" | "myCode" | "pos" | "adv" | "typing" | "helper" | "onSubmit" | "choose" | "toggleTyping"
>;

function bannerFor(trigger: string): "sc" | "vsc" | "green" {
  return trigger === "SC" ? "sc" : trigger === "VSC" ? "vsc" : "green";
}

export function RNCallPadView({ props, s }: { props: CallPadProps; s: RNCallPadViewState }) {
  const { me, decision, players, submittedNames, mode, setMode } = props;
  const { call, why, sending, queued, locked, err, setWhy, inputRef, voice, busy, recording, talkMs, recSecs, micDown, showTyping, tooLate, hasNote, left, alreadyIn, brief, team, myCode, pos, adv, typing, helper, onSubmit, choose, toggleTyping } = s;
  const kind = bannerFor(decision.trigger);
  const bannerText = COPY.replay.flags[decision.trigger];
  const who = myCode && pos ? `${myCode} P${pos}` : me;

  const banner = <Banner kind={kind} size="phone" text={bannerText} />;

  if (locked || alreadyIn) {
    const inCount = players.filter((p) => submittedNames.includes(p)).length;
    const title = locked?.call ? COPY.freeze.options[locked.call] : locked ? COPY.freeze.noCall : COPY.freeze.timeUp;
    const sub = locked?.call === "BOX" && brief?.rejoin ? COPY.phone.out(brief.rejoin.pos) : null;
    return (
      <RNRoot as="main" team={team} className="rnc">
        {banner}
        <header className="rnc-top">
          <StartLights left={left} size="phone" />
          <Countdown left={left} size="phone" className="rnc-clock" />
          <span className="rnc-who rn-d">{who}</span>
        </header>
        <section className="rnc-hero rnc-hero-lock">
          <div className="rnc-hero-slab" aria-hidden />
          <div className="rnc-hero-in">
            <div className="rnc-hero-row">
              <Label tone="ink">{locked?.call ? `✓ ${T.lockedIn}` : locked ? COPY.freeze.timeUp : ""}</Label>
              <Logo size="phone" />
            </div>
            <h1 className={`rn-d rnc-lock-title ${locked?.call ? "" : "rnc-lock-small"}`}>{title}</h1>
            {sub && <p className="rnc-lock-sub">{sub}</p>}
          </div>
        </section>
        <div className="rnc-lock-body">
          {why && (
            <div>
              <Label>{T.yourReason}</Label>
              <q className="rnc-quote">{why}</q>
            </div>
          )}
          <div>
            <h2 className="rn-d rnc-h2">{T.answersTitle}</h2>
            <p className="rnc-muted">{T.answersSub}</p>
          </div>
          <div>
            <div className="rnc-room-head">
              <Label>{T.room}</Label>
              <Label>{T.calledOf(inCount, players.length)}</Label>
            </div>
            <ul className="rnc-room">
              {players.map((p) => {
                const inn = submittedNames.includes(p);
                return (
                  <li key={p}>
                    <span className="rnc-room-name">{p}</span>
                    <span className={inn ? "rnc-called" : "rnc-thinking"}>{inn ? `✓ ${T.called}` : `● ${T.thinking}`}</span>
                  </li>
                );
              })}
            </ul>
            <p className="sr-only" aria-live="polite">
              {left === 0 ? "" : COPY.freeze.waitingOn(Math.max(0, players.length - submittedNames.length))}
            </p>
          </div>
        </div>
      </RNRoot>
    );
  }

  const ctx = brief?.ctx;
  const choice = (c: Call) => {
    const on = call === c;
    const sub =
      c === "STAY"
        ? ctx
          ? COPY.phone.keepTyres(ctx.pos, ctx.age, ctx.compound ? (COPY.compounds[ctx.compound] ?? ctx.compound) : null)
          : ""
        : brief?.rejoin
          ? COPY.phone.out(brief.rejoin.pos)
          : "";
    return (
      <button key={c} type="button" onClick={() => choose(c)} aria-pressed={on} className="rnc-choice" data-on={on}>
        <span className="rnc-cs">
          <span className="rnc-box" aria-hidden>
            {on ? "✓" : ""}
          </span>
          <span className="rn-d rnc-choice-word">{COPY.freeze.options[c]}</span>
          <span className="rnc-choice-sub">{on ? COPY.phone.selected : sub}</span>
        </span>
      </button>
    );
  };

  const micDisabled = left === 0 || tooLate || micDown || queued || voice.status === "starting" || voice.status === "transcribing";
  const micLabel = recording ? VOICE_COPY.stop : voice.status === "starting" ? VOICE_COPY.starting : voice.status === "transcribing" ? VOICE_COPY.transcribingShort : hasNote ? VOICE_COPY.again : T.radioIn;

  return (
    <RNRoot as="main" team={team} className="rnc">
      {banner}
      <header className="rnc-top">
        <StartLights left={left} size="phone" />
        <Countdown left={left} size="phone" className="rnc-clock" />
        <ModeTabs mode={mode} onChange={setMode} variant="split" className="rnc-mode" />
      </header>
      <div className="rnc-scroll">
        <section className={`rnc-hero ${adv ? "rnc-hero-adv" : ""}`}>
          <div className="rnc-hero-slab" aria-hidden />
          <div className="rnc-hero-in">
            <div className="rnc-hero-row">
              <Label tone="ink">{COPY.phone.status(decision.trigger, decision.lap, decision.total_laps)}</Label>
              <Logo size="phone" />
            </div>
            <h1 className="rn-d rnc-q">{COPY.freeze.question}</h1>
          </div>
        </section>
        <div className="rnc-brief">
          {brief && <NeighbourRows brief={brief} />}
          {brief && <MapAndBox brief={brief} decision={decision} />}
          {brief && !brief.tele && <RejoinSentence brief={brief} withCost={adv} withLaps={adv} className="rnc-rejoin" caveatClass="rnc-caveat" />}
          {adv && brief?.tele && (
            <div className="rnc-adv">
              {brief.tele.undercut.length > 0 && (
                <section>
                  <UndercutClock t={brief.tele} mode={mode} />
                </section>
              )}
              <section>
                <Label as="h2">{COPY.tele.intervals}</Label>
                <IntervalTable t={brief.tele} />
              </section>
              {brief.loss && (
                <section>
                  <Label as="h2">{COPY.tele.pitLoss}</Label>
                  <PitLoss under={brief.loss.under} normal={brief.loss.normal} trigger={decision.trigger} />
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={onSubmit} className="rnc-dock" noValidate>
        <div role="group" aria-label={COPY.freeze.question} className="rnc-choices">
          {choice("STAY")}
          {choice("BOX")}
        </div>
        {showTyping && (
          <div className="rnc-type">
            <label htmlFor="why" className="sr-only">
              {COPY.freeze.typedLabel}
            </label>
            <input id="why" ref={inputRef} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={COPY.freeze.typedPlaceholder} maxLength={400} enterKeyHint="send" autoFocus={typing} />
          </div>
        )}
        {(helper || err) && (
          <div className="rnc-helper" aria-live="polite" data-err={!!err}>
            {err ? <p role="alert">{err}</p> : <p>{helper}</p>}
            {!err && voice.canRetry && !busy && (
              <button type="button" onClick={voice.retry} className="rnc-retry">
                {VOICE_COPY.retry}
              </button>
            )}
          </div>
        )}
        <div className="rnc-actions">
          <button
            type="button"
            onClick={voice.toggle}
            onContextMenu={(e) => e.preventDefault()}
            disabled={micDisabled}
            aria-pressed={recording}
            aria-busy={voice.status === "transcribing" || undefined}
            aria-label={micLabel === T.radioIn ? VOICE_COPY.tap : undefined}
            className="rnc-act rnc-mic"
            data-rec={recording}
            style={{ ["--rec" as string]: `${(talkMs / (VOICE_NOTE_MAX_S * 1000)) * 100}%` } as CSSProperties}
          >
            <span className="rnc-cs">
              {recording ? <span className="rnc-dot" aria-hidden /> : <MicGlyph className="rnc-mic-g" />}
              <span className="rnc-mic-txt">
                <span className="rn-d rnc-mic-l">{micLabel}</span>
                {(recording || recSecs > 0) && (
                  <span className="rnc-mic-meta">
                    {recording && (
                      <span className="rnc-meter" aria-hidden>
                        {Array.from({ length: METER_SEGMENTS }, (_, i) => (
                          <span key={i} data-on={i < voice.level} />
                        ))}
                      </span>
                    )}
                    <span className="rn-num">
                      {clockText(recSecs)} / {clockText(VOICE_NOTE_MAX_S)}
                    </span>
                  </span>
                )}
              </span>
            </span>
          </button>
          <button type="button" onClick={toggleTyping} aria-expanded={showTyping} aria-controls="why" className="rnc-act rnc-kb">
            <span className="rnc-cs rn-d">{showTyping && !micDown ? COPY.phone.hideTyping : COPY.phone.typeInstead}</span>
          </button>
          <button type="submit" disabled={sending || queued || !call} aria-busy={sending || queued || undefined} className="rnc-act rnc-send">
            <span className="rnc-cs rn-d">{COPY.phone.send}</span>
          </button>
        </div>
      </form>
    </RNRoot>
  );
}
