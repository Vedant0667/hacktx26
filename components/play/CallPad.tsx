"use client";
// The call screen. The page becomes the player's team-colour field: countdown, question and the rejoin line
// (Simple stops there; Advanced adds telemetry and the undercut clock) above three full-width bands in the
// thumb zone: Stay out, Box, tap to say why (+ Type, Send). Voice status sits right above the mic band.
import { COPY, VOICE_COPY } from "@/lib/copy";
import { fieldStyle } from "@/lib/client/field";
import { VOICE_NOTE_MAX_S } from "@/lib/client/race";
import { METER_SEGMENTS } from "@/lib/client/recorder";
import { useCallPad, type CallPadProps } from "@/lib/client/useCallPad";
import type { Call } from "@/lib/types";
import { RejoinSentence } from "../DecisionBrief";
import { FieldTyres, IntervalTable, LapChart, NeighbourList, Note, UndercutClock, PitLoss, RejoinStrip, Sec, StintTable, intervalNote } from "../Telemetry";
import { Check, ErrorText, MicGlyph, ModeToggle, TrackStrip, clockText } from "../ui";

// State, effects, voice note and send logic live in lib/client/useCallPad.ts (shared with the Race Night pad).
export function CallPad(props: CallPadProps) {
  const { me, decision, players, submittedNames, mode, setMode } = props;
  const {
    call,
    why,
    sending,
    queued,
    locked,
    err,
    setWhy,
    inputRef,
    voice,
    busy,
    recording,
    talkMs,
    recSecs,
    micDown,
    showTyping,
    tooLate,
    hasNote,
    left,
    urgent,
    alreadyIn,
    brief,
    team,
    myCode,
    pos,
    adv,
    typing,
    helper,
    onSubmit,
    choose,
    toggleTyping,
  } = useCallPad(props);

  const status = (
    <header className="flex h-[52px] shrink-0 items-center justify-between gap-3 px-5">
      <span className="nums shrink-0 text-sm font-bold tracking-[-0.01em]">{COPY.phone.status(decision.trigger, decision.lap, decision.total_laps)}</span>
      <span className="flex min-w-0 items-baseline gap-1.5 text-sm font-semibold">
        <span className="truncate opacity-80">{me}</span>
        {myCode && pos ? <span className="nums shrink-0 font-bold">· {myCode} P{pos}</span> : null}
      </span>
    </header>
  );

  const countdown = (
    <span
      key={urgent ? left : "n"}
      className={`nums inline-block font-extrabold leading-[0.9] tracking-[-0.035em] ${mode === "advanced" ? "text-[3.5rem]" : "text-[4.75rem]"} ${urgent ? "tick bg-on-field px-2 text-field" : ""}`}
      aria-live="polite"
      aria-label={`${left} s`}
    >
      {clockText(left)}
    </span>
  );

  if (locked || alreadyIn) {
    const waitingOn = Math.max(0, players.length - submittedNames.length);
    return (
      <main style={fieldStyle(team)} className="flood mx-auto flex h-dvh w-full max-w-[480px] flex-col bg-field text-on-field">
        {brief?.frame && <TrackStrip status={brief.frame.track_status} />}
        {status}
        <div className="flex flex-1 flex-col px-5 pt-6">
          {countdown}
          <h1 className="display mt-6 text-3xl">
            {locked?.call ? COPY.phone.lockedTitle(locked.call) : locked ? COPY.freeze.noCall : COPY.freeze.timeUp}
          </h1>
          {why && <q className="mt-5 text-lg font-medium leading-snug">{why}</q>}
        </div>
        <div className="on-dark bg-ink px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5 text-white">
          <p className="nums text-lg font-semibold">{left === 0 ? COPY.freeze.timeUp : COPY.freeze.waitingOn(waitingOn)}</p>
          <ol className="mt-3 flex flex-wrap gap-2">
            {players.map((p) => {
              const inn = submittedNames.includes(p);
              return (
                <li key={p} className={`inline-flex h-8 max-w-[14ch] items-center truncate px-2.5 text-sm font-black ${inn ? "bg-white text-ink" : "bg-white/10 shadow-[inset_0_-2px_0_rgba(255,255,255,0.55)]"}`}>
                  {p}
                </li>
              );
            })}
          </ol>
        </div>
      </main>
    );
  }

  const band = (c: Call) => {
    const on = call === c;
    const other = call !== null && !on;
    const base = c === "STAY" ? "bg-white text-ink" : "on-dark bg-ink text-white";
    const ctx = brief?.ctx;
    const sub =
      c === "STAY"
        ? ctx
          ? COPY.phone.keepTyres(ctx.pos, ctx.age, ctx.compound ? (COPY.compounds[ctx.compound] ?? ctx.compound) : null)
          : ""
        : brief?.rejoin
          ? COPY.phone.out(brief.rejoin.pos)
          : "";
    return (
      <button
        key={c}
        type="button"
        onClick={() => choose(c)}
        aria-pressed={on}
        className={`flex h-[5.25rem] w-full items-center justify-between px-6 text-left transition-[background-color,color,opacity] duration-150 ${
          other ? "bg-soft text-ink-2" : base
        } ${c === "BOX" ? "border-t border-white/10" : ""}`}
      >
        <span className="text-[1.875rem] font-black leading-none tracking-[-0.025em]">{COPY.freeze.options[c]}</span>
        <span className="nums flex items-center gap-2 text-[15px] font-semibold opacity-80">
          {on ? (
            <>
              <Check />
              {COPY.phone.selected}
            </>
          ) : (
            sub
          )}
        </span>
      </button>
    );
  };


  return (
    <main style={fieldStyle(team)} className="flood mx-auto flex h-dvh w-full max-w-[480px] flex-col bg-field text-on-field">
      {brief?.frame && <TrackStrip status={brief.frame.track_status} />}
      {status}
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
        <div className="flex items-end justify-between gap-3 pt-1">
          {countdown}
          <div className="mb-2.5">
            <ModeToggle mode={mode} onChange={setMode} size="sm" onField />
          </div>
        </div>
        <h1 className={`display ${adv ? "mt-2 text-[1.875rem] leading-[0.98]" : "mt-3 text-[2.625rem] leading-[0.95]"}`}>{COPY.freeze.question}</h1>
        {brief && !adv && <RejoinSentence brief={brief} withCost={false} className="nums mt-3.5 text-[1.1875rem] font-medium leading-[1.32]" caveatClass="mt-2 text-[15px] font-semibold leading-snug opacity-85" />}
        {brief && adv && <RejoinSentence brief={brief} withLaps className="nums mt-2.5 text-base font-medium leading-[1.4]" caveatClass="mt-1.5 text-sm font-semibold leading-snug opacity-85" />}
        {brief?.tele && adv && (
          <div className="mt-5 flex flex-col">
            <Sec label={COPY.tele.stintLapTimes} meta={COPY.tele.lapRange(brief.tele.stintLaps[0] ?? 1, brief.tele.stintLaps[brief.tele.stintLaps.length - 1] ?? 1)}>
              <LapChart laps={brief.tele.stintLaps} cars={[brief.tele.stint.me, brief.tele.stint.ahead, brief.tele.stint.behind]} height={124} axis values={false} status={brief.tele.status} />
            </Sec>
            <div className="pb-5 pt-1">
              <NeighbourList t={brief.tele} />
            </div>
            <UndercutClock t={brief.tele} mode={mode} />
            <Sec label={COPY.tele.intervals} meta={COPY.tele.intervalsMeta}>
              <IntervalTable t={brief.tele} />
              <Note>{intervalNote(brief.tele)}</Note>
            </Sec>
            <Sec label={COPY.tele.fieldTyres} meta={COPY.tele.fieldMeta(brief.tele.compounds.length, brief.adv?.median ?? null)}>
              <FieldTyres t={brief.tele} me={decision.player_role.number} />
            </Sec>
            {brief.loss && (
              <Sec label={COPY.tele.pitLoss} meta={COPY.tele.pitMeta}>
                <PitLoss under={brief.loss.under} normal={brief.loss.normal} trigger={decision.trigger} />
              </Sec>
            )}
            <Sec label={COPY.tele.stint} meta={COPY.tele.stintMeta(myCode, decision.player_role.number)}>
              <StintTable t={brief.tele} normal={decision.pit_loss?.normal_s ?? null} />
            </Sec>
            {brief.frame && (
              <Sec label={COPY.tele.rejoinTitle} meta={COPY.tele.rejoinMeta}>
                <RejoinStrip t={brief.tele} frameCars={brief.frame.drivers.filter((d) => d.number !== decision.player_role.number).map((d) => ({ code: d.code, gap: d.gap_to_leader_s, number: d.number }))} />
              </Sec>
            )}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="shrink-0" noValidate>
        <div role="group" aria-label={COPY.freeze.question}>
          {band("STAY")}
          {band("BOX")}
        </div>
        {showTyping && (
          <div className="flex items-center gap-3 bg-white px-5 py-2 text-ink">
            <label htmlFor="why" className="sr-only">
              {COPY.freeze.typedLabel}
            </label>
            <input
              id="why"
              ref={inputRef}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder={COPY.freeze.typedPlaceholder}
              maxLength={400}
              enterKeyHint="send"
              autoFocus={typing}
              className="h-12 min-w-0 flex-1 border-b-2 border-ink bg-transparent text-base font-bold outline-none"
            />
          </div>
        )}
        {(helper || err) && (
          <div className="border-t border-line bg-white px-5 py-2.5 text-sm font-semibold text-ink" aria-live="polite">
            {err ? (
              <ErrorText>{err}</ErrorText>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <p className="line-clamp-2">{helper}</p>
                {voice.canRetry && !busy && (
                  <button type="button" onClick={voice.retry} className="shrink-0 border-b-2 border-current font-black">
                    {VOICE_COPY.retry}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <div className="on-dark relative flex h-24 items-stretch border-t border-white/15 bg-ink pb-[env(safe-area-inset-bottom)] text-white">
          {recording && <div className="absolute inset-x-0 top-0 h-1 bg-field transition-[width] duration-200" style={{ width: `${(talkMs / (VOICE_NOTE_MAX_S * 1000)) * 100}%` }} aria-hidden />}
          {/* A plain click: iOS opens audio only inside a tap, so toggle() must run in this handler. */}
          <button
            type="button"
            onClick={voice.toggle}
            onContextMenu={(e) => e.preventDefault()}
            disabled={left === 0 || tooLate || micDown || queued || voice.status === "starting" || voice.status === "transcribing"}
            aria-pressed={recording}
            aria-busy={voice.status === "transcribing" || undefined}
            className="flex min-w-0 flex-1 select-none items-center gap-3 pl-5 pr-2 text-left [-webkit-touch-callout:none] disabled:text-white/50"
          >
            {recording ? <span className="rec-dot size-3 shrink-0 rounded-full bg-white" aria-hidden /> : <MicGlyph className="shrink-0" />}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[1.0625rem] font-bold tracking-[-0.01em]">
                {recording ? VOICE_COPY.stop : voice.status === "starting" ? VOICE_COPY.starting : voice.status === "transcribing" ? VOICE_COPY.transcribingShort : hasNote ? VOICE_COPY.again : VOICE_COPY.tap}
              </span>
              <span className="mt-1 flex items-center gap-2">
                {recording && (
                  <span className="flex gap-0.5" aria-hidden>
                    {Array.from({ length: METER_SEGMENTS }, (_, i) => (
                      <span key={i} className={`h-2 w-2 ${i < voice.level ? "bg-white" : "bg-white/25"}`} />
                    ))}
                  </span>
                )}
                <span className="nums text-xs font-medium text-white/70">
                  {clockText(recSecs)} / {clockText(VOICE_NOTE_MAX_S)}
                </span>
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={toggleTyping}
            aria-expanded={showTyping}
            aria-controls="why"
            className="w-[4.25rem] shrink-0 border-l border-white/15 text-sm font-bold hover:bg-white/10"
          >
            {showTyping && !micDown ? COPY.phone.hideTyping : COPY.phone.typeInstead}
          </button>
          <button
            type="submit"
            disabled={sending || queued || !call}
            aria-busy={sending || queued || undefined}
            className="w-[5.5rem] shrink-0 bg-field text-base font-black text-on-field transition-opacity duration-150 disabled:bg-white/10 disabled:text-white/50"
          >
            {COPY.phone.send}
          </button>
        </div>
      </form>
    </main>
  );
}
