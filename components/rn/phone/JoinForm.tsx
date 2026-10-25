"use client";
// Race Night phone join (P01Join) + driver pick (P02PickDriver). Neutral: no team colour until a driver row is
// selected. Same props and the same join logic as components/play/PlayScreen.tsx JoinForm, so the container
// can swap it in place; `pickers` (optional) lists lobby players so a row can say who already picked it.
import "./phone.css";
import { useState, type FormEvent, type ReactNode } from "react";
import { COPY } from "@/lib/copy";
import { ApiError, type BlindDriver, type JoinResponse } from "@/lib/client/api";
import { canRejoin, isLobbyFull, joinErrorText, joinLobby } from "@/lib/client/session";
import type { LapFrame } from "@/lib/types";
import { Check } from "@/components/ui";
import { Logo, RNRoot, SkewButton, teamVars, TyreBadge } from "../kit";
import { RN_PHONE_COPY as C } from "./copy";

export type RNPicker = { name: string; driver_code?: string | null };

export function RNJoinForm({
  code,
  players,
  choose,
  drivers,
  frames,
  initialName,
  onRemoved,
  onJoined,
  metaFor,
  pickers,
}: {
  code: string;
  players: number;
  choose: boolean;
  drivers: BlindDriver[] | null;
  frames: LapFrame[] | null;
  initialName: string;
  onRemoved: () => void;
  onJoined: (name: string, state: JoinResponse) => void;
  metaFor?: (code: string) => ReactNode;
  pickers?: RNPicker[];
}) {
  const [name, setName] = useState(initialName);
  const [pick, setPick] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join(n: string) {
    setErr(null);
    setTaken(null);
    setBusy(true);
    try {
      onJoined(n, await joinLobby(code, n, consent, choose ? pick : null));
    } catch (e) {
      // 403 on join: the host removed this name or this device from the lobby.
      if (e instanceof ApiError && e.status === 403) return onRemoved();
      setErr(joinErrorText(e, code, n));
      if (e instanceof ApiError && e.status === 409 && !isLobbyFull(e)) setTaken(n);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setErr(COPY.home.nameMissing);
    if (!consent) return setErr(COPY.play.consentMissing);
    if (choose && !pick) return setErr(COPY.drivers.pick);
    void join(n);
  }

  const rejoinable = taken ? canRejoin(code, taken) : false;
  const need = !name.trim() ? COPY.play.need.name : !consent ? COPY.play.need.consent : choose && !pick ? COPY.play.need.driver : null;

  return (
    <RNRoot neutral>
      <form onSubmit={submit} className="rnp [&_label]:scroll-mb-28" noValidate>
        <header className="rnp-head">
          <Logo size="phone" />
          <span className="rnp-room">{COPY.room.heading(code)}</span>
        </header>
        <div className="rnp-hero" style={{ minHeight: 200 }}>
          <span className="rnp-label">{C.joinRoom}</span>
          <div className="rnp-cond" aria-label={COPY.room.heading(code)} style={{ fontSize: 112, fontWeight: 900, lineHeight: 0.9, marginTop: 10, letterSpacing: "-0.01em" }}>
            {code}
          </div>
        </div>
        <div className="rnp-body" style={{ paddingTop: 36 }}>
          <label htmlFor="nick" className="rnp-label">
            {COPY.phone.nickname}
          </label>
          <input
            id="nick"
            value={name}
            maxLength={24}
            autoComplete="nickname"
            placeholder={COPY.home.namePlaceholder}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!err || undefined}
            aria-describedby="join-err"
            className="rnp-input"
            style={{ marginTop: 10 }}
          />
          <p style={{ marginTop: 8, fontSize: 14, color: "#A9AEB8" }}>{C.nickHint}</p>
          <label style={{ marginTop: 24, display: "flex", alignItems: "flex-start", gap: 16, cursor: "pointer", fontSize: 16, lineHeight: 1.4 }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="sr-only" />
            <span aria-hidden className="rnp-check">
              <span>{consent && <Check />}</span>
            </span>
            <span>{COPY.play.consent}</span>
          </label>

          {choose ? (
            <RNDriverPicker drivers={drivers} frames={frames} pick={pick} onPick={setPick} metaFor={metaFor} pickers={pickers} />
          ) : (
            <ol style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid #1F232A", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              {C.steps.map((s, i) => (
                <li key={s}>
                  <div className="rnp-cond" style={{ fontSize: 22, fontWeight: 900 }}>
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.3, color: "#C9CDD4" }}>{s}</div>
                </li>
              ))}
            </ol>
          )}

          <div id="join-err" role="alert" className="rnp-err" style={{ marginTop: 16, minHeight: 24 }}>
            {err}
          </div>
          {taken && rejoinable && (
            <SkewButton variant="secondary" size="phone-sm" full onClick={() => consent && void join(taken)} style={{ marginTop: 8 }}>
              {COPY.play.rejoin(taken)}
            </SkewButton>
          )}
        </div>
        <div className="rnp-dock">
          <SkewButton type="submit" variant="primary" size="phone" full disabled={busy} aria-busy={busy || undefined}>
            {busy ? COPY.play.joining : (need ?? COPY.play.join)}
          </SkewButton>
          <p className="rnp-label" style={{ marginTop: 10, textAlign: "center", fontSize: 12 }}>
            {COPY.tele.inRoom(players)}
          </p>
        </div>
      </form>
    </RNRoot>
  );
}

// Driver picker for "choose" lobbies: skewed rows, team colour only on the selected row and car numbers.
// Several players may share a car: never blocked, the row just says who picked it.
export function RNDriverPicker({
  drivers,
  frames,
  pick,
  onPick,
  metaFor,
  pickers,
}: {
  drivers: BlindDriver[] | null;
  frames: LapFrame[] | null;
  pick: string | null;
  onPick: (c: string) => void;
  metaFor?: (code: string) => ReactNode;
  pickers?: RNPicker[];
}) {
  const moment = frames?.[frames.length - 1];
  return (
    <fieldset style={{ marginTop: 30 }}>
      <legend className="rnp-cond" style={{ fontSize: 34, fontWeight: 900, textTransform: "uppercase", lineHeight: 1 }}>
        {COPY.drivers.pickTitle}
      </legend>
      <p style={{ marginTop: 8, fontSize: 15, color: "#A9AEB8" }}>{metaFor ? COPY.drivers.pickHintRace : COPY.drivers.pickHint}</p>
      {!drivers ? (
        <p style={{ marginTop: 12, fontWeight: 700 }}>{COPY.drivers.loading}</p>
      ) : (
        <div role="radiogroup" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {drivers.map((d) => {
            const f = moment?.drivers.find((x) => x.code === d.code);
            const on = pick === d.code;
            const who = (pickers ?? []).filter((p) => p.driver_code === d.code).map((p) => p.name);
            return (
              <label key={d.code} className="rnp-drv" data-on={on} style={on ? teamVars(d.team_colour) : undefined}>
                <input type="radio" name="driver" value={d.code} checked={on} onChange={() => onPick(d.code)} className="sr-only" />
                <span aria-hidden className="rnp-check">
                  <span>{on && <Check />}</span>
                </span>
                <span className="rnp-cond" style={{ fontSize: 22, fontWeight: 900, textAlign: "right", color: on ? undefined : (d.team_colour ?? undefined) }}>
                  {d.number}
                </span>
                <b className="rnp-cond" style={{ fontSize: 26, fontWeight: 900 }}>
                  {d.code}
                </b>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.name}>{d.team || d.name}</span>
                  {who.length > 0 && <span style={{ display: "block", fontSize: 13, fontWeight: 700, opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{C.pickedBy(who)}</span>}
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, opacity: 0.8 }}>
                  {metaFor ? metaFor(d.code) : f?.compound ? <TyreBadge compound={f.compound} age={f.tyre_age ?? undefined} /> : f ? `P${f.position}` : null}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
