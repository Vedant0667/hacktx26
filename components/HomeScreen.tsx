"use client";
// `/`: join a room (the black panel, first on phones) or host one with a short builder: mode (Moment or Race),
// then the moment or race, then drivers. A live preview shows the lobby's decision field in the picked driver's
// team colour, and the one primary action, Create lobby, takes that colour too.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { COPY } from "@/lib/copy";
import { ApiError, api, data, type BlindDecision, type BlindDriver, type DriverMode, type RaceEntry } from "@/lib/client/api";
import { fieldColours, fieldStyle } from "@/lib/client/field";
import { createErrorText, createLobby, createRaceLobby } from "@/lib/client/session";
import type { DecisionIndexEntry, DriverFrame } from "@/lib/types";
import { Brand, ErrorText, Figures, ScChip, TrackStrip, TyreChip } from "./ui";

type Mode = "moment" | "race";
type Roster = { def: string; drivers: BlindDriver[]; at: Map<number, DriverFrame> };
// One tile in the driver grid, whichever mode it came from.
type Tile = { code: string; number: number; name: string; team_colour: string | null; meta: string | null; at?: DriverFrame };

// "2025 Qatar GP" -> { year: "2025", circuit: "Qatar" }
function splitRace(name: string) {
  const year = name.match(/\d{4}/)?.[0] ?? "";
  const circuit = name.replace(year, "").replace(/\bGP\b|Grand Prix/i, "").trim();
  return { year, circuit };
}

export function HomeScreen({ index }: { index: DecisionIndexEntry[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("moment");
  const [decision, setDecision] = useState(index[0]?.id ?? "");
  const [raceKey, setRaceKey] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [driverMode, setDriverMode] = useState<DriverMode>("same");
  // Per moment: the pickable cars (blind) and each car's row in the call-moment frame (position, tyre).
  const [roster, setRoster] = useState<Record<string, Roster | "error">>({});
  // Blind decisions for the moment cards (trigger, lap, total laps). Nothing about the answer.
  const [blinds, setBlinds] = useState<Record<string, BlindDecision>>({});
  const [races, setRaces] = useState<RaceEntry[] | "error" | null>(null);
  // Picked car per moment id or race key.
  const [picked, setPicked] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    for (const d of index)
      data
        .decision(d.id)
        .then((b) => alive && setBlinds((m) => ({ ...m, [d.id]: b })))
        .catch(() => {});
    data
      .races()
      .then((r) => alive && setRaces(r))
      .catch(() => alive && setRaces("error"));
    return () => {
      alive = false;
    };
  }, [index]);

  useEffect(() => {
    if (!decision || roster[decision]) return;
    let alive = true;
    Promise.all([data.drivers(decision), data.frames(decision)])
      .then(([d, frames]) => {
        if (!alive) return;
        const last = frames[frames.length - 1];
        setRoster((m) => ({ ...m, [decision]: { def: d.default_driver, drivers: d.drivers, at: new Map((last?.drivers ?? []).map((x) => [x.number, x])) } }));
      })
      .catch(() => alive && setRoster((m) => ({ ...m, [decision]: "error" })));
    return () => {
      alive = false;
    };
  }, [decision, roster]);

  const raceList = Array.isArray(races) ? races : [];
  const race = raceList.find((r) => r.race_key === raceKey) ?? raceList[0] ?? null;
  const r = roster[decision];
  const momentRoster = r && r !== "error" ? r : null;

  const key = mode === "race" ? (race?.race_key ?? "") : decision;
  const tiles: Tile[] | null =
    mode === "race"
      ? race
        ? race.drivers.map((d) => ({ code: d.code, number: d.number, name: d.name, team_colour: d.team_colour, meta: COPY.homeUi.calls(d.freeze_count) }))
        : null
      : momentRoster
        ? momentRoster.drivers.map((d) => {
            const at = momentRoster.at.get(d.number);
            return { code: d.code, number: d.number, name: d.name, team_colour: d.team_colour, meta: at ? COPY.mode.position(at.position) : null, at };
          })
        : null;
  const defCode = mode === "race" ? (race?.default_driver ?? null) : (momentRoster?.def ?? null);
  const driverCode = picked[key] ?? defCode;
  const tile = tiles?.find((t) => t.code === driverCode) ?? null;
  const colour = driverMode === "same" ? (tile?.team_colour ?? null) : null;
  const blind = blinds[decision];
  const raceDriver = race?.drivers.find((d) => d.code === driverCode);
  const ready = mode === "race" ? !!race : !!decision;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setCreateErr(null);
    setBusy("create");
    try {
      // Stores the host token (shown once) so this browser can advance the lobby's phases.
      const lobby =
        mode === "race"
          ? await createRaceLobby(race!.race_key, driverMode, driverMode === "same" ? driverCode : null)
          : await createLobby(decision, "", driverMode, driverMode === "same" ? driverCode : null);
      router.push(`/host/${lobby.code}`);
    } catch (err) {
      setBusy(null);
      setCreateErr(createErrorText(err));
    }
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return setJoinErr(COPY.home.codeMissing);
    setJoinErr(null);
    setBusy("join");
    try {
      await api.lobby(c);
      router.push(`/play/${c}`);
    } catch (err) {
      setBusy(null);
      setJoinErr(
        err instanceof ApiError && err.status === 404
          ? COPY.home.codeNotFound(c)
          : err instanceof ApiError && err.status === 429
            ? COPY.error.rateLimited(err.retryAfter)
            : COPY.error.connectionLost,
      );
    }
  }

  const { field, ink } = fieldColours(colour);
  const createStyle = colour ? { backgroundColor: field, color: ink } : undefined;

  return (
    <main className="grid min-h-dvh w-full md:h-dvh md:grid-cols-[440px_minmax(0,1fr)] md:overflow-hidden">
      {/* Join: the black panel. First on phones, where most people arrive. */}
      <section className="on-dark flex flex-col bg-ink px-5 pb-8 text-white md:px-14 md:pb-10 md:pt-10">
        <div className="flex h-14 items-center justify-between md:h-auto">
          <span className="md:hidden">
            <Brand kind="wordmark" height={20} />
          </span>
          <span className="hidden md:inline-flex">
            <Brand kind="wordmark" height={30} label={false} />
          </span>
          <Link href="/leaderboard" className="meta underline decoration-2 underline-offset-4 hover:decoration-[#8c8c8c] md:hidden">
            {COPY.homeUi.leaderboardTitle}
          </Link>
        </div>
        <h1 className="display mt-7 text-[3rem] leading-[0.9] md:mt-auto md:text-[4.5rem]">{COPY.homeUi.joinTitle}.</h1>
        <p className="mt-4 max-w-[30ch] text-md leading-snug text-[#cfcfcf] md:text-xl">{COPY.home.subtitle}</p>
        <form onSubmit={join} className="mt-8 flex flex-col gap-3 md:mt-12" noValidate>
          <label htmlFor="room-code" className="meta text-[#bdbdbd]">
            {COPY.home.joinLabel}
          </label>
          <CodeBoxes value={code} invalid={!!joinErr} onChange={setCode} />
          <p id="join-hint" className="text-sm text-[#bdbdbd]">
            {COPY.homeUi.joinSub}
          </p>
          <ErrorText id="join-err">{joinErr}</ErrorText>
          <button
            type="submit"
            disabled={busy === "join"}
            aria-busy={busy === "join" || undefined}
            className="mt-2 flex h-20 w-full items-center justify-between bg-white px-6 text-[1.75rem] font-black tracking-tight text-ink transition-colors duration-150 hover:bg-soft disabled:text-ink-3 md:h-24 md:text-[2rem]"
          >
            {COPY.home.join}
            <span className="nums text-sm font-bold text-ink-2">{code.padEnd(4, "·")}</span>
          </button>
        </form>
        <p className="mt-10 text-xs text-[#9a9a9a] md:mt-auto md:pt-10">{COPY.home.footer}</p>
      </section>

      {/* Host: mode, moment or race, drivers; preview and Create on the right. */}
      <section className="flex min-h-0 flex-col px-5 pb-8 pt-10 md:px-14 md:py-10">
        <header className="flex items-end justify-between gap-6 border-b-2 border-ink pb-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-[2rem] font-black leading-none tracking-[-0.03em] md:text-[2.5rem]">{COPY.homeUi.hostTitle}</h2>
            <p className="text-sm text-ink-2 md:text-base">{COPY.homeUi.hostSub}</p>
          </div>
          <Link href="/leaderboard" className="meta hidden pb-1 underline decoration-2 underline-offset-4 hover:decoration-ink-3 md:inline">
            {COPY.homeUi.leaderboardTitle}
          </Link>
        </header>

        <div className="mt-6 grid min-h-0 flex-1 gap-8 md:grid-cols-[minmax(0,1fr)_320px] md:gap-10">
          <form id="host-form" onSubmit={create} className="flex min-h-0 flex-col gap-6 md:-mr-3 md:overflow-y-auto md:pr-3" noValidate>
            <Step label={COPY.homeUi.stepMode}>
              <div role="radiogroup" aria-label={COPY.homeUi.stepMode} className="grid grid-cols-2 border-2 border-ink">
                {(["moment", "race"] as const).map((m) => {
                  const on = mode === m;
                  return (
                    <label
                      key={m}
                      className={`flex min-h-[92px] cursor-pointer flex-col justify-between gap-2 px-4 py-3 transition-colors duration-150 has-[:focus-visible]:outline-3 has-[:focus-visible]:-outline-offset-4 has-[:focus-visible]:outline-white md:px-5 ${
                        on ? "on-dark bg-ink text-white" : "hover:bg-soft"
                      } ${m === "race" ? "border-l-2 border-ink" : ""}`}
                    >
                      <input type="radio" name="mode" value={m} checked={on} onChange={() => setMode(m)} className="sr-only" />
                      <span className="text-[1.75rem] font-black leading-none tracking-[-0.03em]">{COPY.homeUi.modes[m].name}</span>
                      <span className={`text-sm leading-snug ${on ? "text-[#cfcfcf]" : "text-ink-2"}`}>{COPY.homeUi.modes[m].hint}</span>
                    </label>
                  );
                })}
              </div>
            </Step>

            <Step label={mode === "race" ? COPY.homeUi.stepRace : COPY.homeUi.stepMoment}>
              <div role="radiogroup" aria-label={mode === "race" ? COPY.homeUi.stepRace : COPY.homeUi.stepMoment} className="grid grid-cols-2 gap-3">
                {mode === "moment" &&
                  index.map((d) => {
                    const { year, circuit } = splitRace(d.race);
                    const b = blinds[d.id];
                    return (
                      <Card key={d.id} name="moment" on={d.id === decision} onPick={() => setDecision(d.id)} year={year} circuit={circuit} chip={b ? <ScChip status={b.trigger} /> : null}>
                        {b ? COPY.homeUi.momentCard(b.lap, b.total_laps) : COPY.replay.lap(d.lap, 0).replace("/0", "")}
                      </Card>
                    );
                  })}
                {mode === "race" &&
                  (races === null ? (
                    <p className="meta col-span-2 text-ink-2">{COPY.homeUi.racesLoading}</p>
                  ) : races === "error" ? (
                    <p className="meta col-span-2 text-ink-2">{COPY.error.data}</p>
                  ) : (
                    raceList.map((x) => {
                      const { year, circuit } = splitRace(x.name);
                      return (
                        <Card key={x.race_key} name="race" on={x.race_key === race?.race_key} onPick={() => setRaceKey(x.race_key)} year={year} circuit={circuit} chip={<span className="meta">{COPY.homeUi.raceCard(x.total_laps)}</span>}>
                          {COPY.homeUi.raceCars(x.drivers.length)}
                        </Card>
                      );
                    })
                  ))}
              </div>
            </Step>

            <Step label={COPY.homeUi.stepDrivers}>
              <div role="radiogroup" aria-label={COPY.drivers.modeLabel} className="grid grid-cols-2 border-2 border-ink">
                {(["same", "choose"] as const).map((m) => {
                  const on = driverMode === m;
                  return (
                    <label
                      key={m}
                      className={`flex min-h-12 cursor-pointer items-center px-4 py-2 text-sm font-bold leading-snug transition-colors duration-150 has-[:focus-visible]:outline-3 has-[:focus-visible]:-outline-offset-4 has-[:focus-visible]:outline-white md:text-base ${
                        on ? "on-dark bg-ink text-white" : "hover:bg-soft"
                      } ${m === "choose" ? "border-l-2 border-ink" : ""}`}
                    >
                      <input type="radio" name="driver-mode" value={m} checked={on} onChange={() => setDriverMode(m)} className="sr-only" />
                      {m === "same" ? COPY.drivers.sameMode : COPY.drivers.chooseMode}
                    </label>
                  );
                })}
              </div>
              {driverMode === "choose" && tiles && <p className="mt-3 text-sm text-ink-2">{COPY.homeUi.choosePool(tiles.length)}</p>}
              {tiles ? (
                  <div role={driverMode === "same" ? "radiogroup" : "list"} aria-label={COPY.drivers.pickTitle} className={`mt-3 grid grid-cols-3 border-l border-t border-line ${mode === "race" ? "sm:grid-cols-4 lg:grid-cols-5" : ""}`}>
                    {tiles.map((d) => {
                      const pick = driverMode === "same";
                      const on = pick && d.code === driverCode;
                      const Tag = pick ? "label" : "div";
                      return (
                        <Tag
                          key={d.code}
                          role={pick ? undefined : "listitem"}
                          className={`flex ${mode === "race" ? "h-[68px]" : "h-24"} ${pick ? "cursor-pointer" : ""} flex-col justify-between border-b border-r px-2.5 py-2 transition-colors duration-150 has-[:focus-visible]:outline-3 has-[:focus-visible]:-outline-offset-3 has-[:focus-visible]:outline-ink ${
                            on ? "on-dark border-ink bg-ink text-white" : pick ? "border-line hover:bg-soft" : "border-line"
                          }`}
                        >
                          {pick && <input type="radio" name="driver" value={d.code} checked={on} onChange={() => setPicked((m) => ({ ...m, [key]: d.code }))} className="sr-only" />}
                          <span className="flex items-baseline justify-between gap-1">
                            <span className={`${mode === "race" ? "text-[1.375rem]" : "text-[2rem]"} font-black leading-none tracking-tight`}>{d.code}</span>
                            {d.meta && <span className="nums whitespace-nowrap text-[11px] font-bold">{d.meta}</span>}
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5 text-xs">
                            <span aria-hidden className="h-3.5 w-1 shrink-0" style={{ backgroundColor: d.team_colour ?? "currentColor" }} />
                            <span className="min-w-0 flex-1 truncate">{d.name}</span>
                            {d.at?.compound && <TyreChip compound={d.at.compound} age={d.at.tyre_age} size="sm" />}
                          </span>
                        </Tag>
                      );
                    })}
                  </div>
                ) : (
                  <p className="meta mt-3 text-ink-2">{mode === "moment" && r === "error" ? COPY.error.data : COPY.drivers.loading}</p>
                )}
            </Step>
          </form>

          {/* Live preview: the decision field this lobby will flood with, then the one primary action. */}
          <aside className="flex min-h-0 flex-col gap-4">
            <span className="meta text-ink-2">{COPY.homeUi.preview}</span>
            <div style={fieldStyle(colour)} className="flex min-h-[280px] flex-1 flex-col bg-field text-on-field transition-colors duration-200">
              {mode === "moment" && blind && blind.trigger !== "GREEN" && <TrackStrip status={blind.trigger} />}
              <div className="flex h-10 items-center justify-between gap-3 px-4">
                <span className="meta">
                  {mode === "race" ? (race ? COPY.homeUi.previewRaceStatus(race.total_laps) : "") : blind ? COPY.phone.status(blind.trigger, blind.lap, blind.total_laps) : ""}
                </span>
                <span className="meta">{driverMode === "same" && tile ? `#${tile.number}` : ""}</span>
              </div>
              <div className="flex-1 px-4 pb-5 pt-1">
                <p className="display text-[2.25rem] leading-[0.95]">
                  {driverMode === "choose"
                    ? COPY.homeUi.previewChoose
                    : !tile
                      ? " "
                      : mode === "race"
                        ? COPY.homeUi.previewRaceLead(tile.code)
                        : COPY.homeUi.previewMomentLead(tile.code, tile.at?.position ?? null)}
                </p>
                <p className="mt-3 text-base font-medium leading-snug">
                  {driverMode === "choose"
                    ? COPY.homeUi.previewChooseSub
                    : mode === "race"
                      ? raceDriver
                        ? COPY.homeUi.previewRaceSub(raceDriver.freeze_count)
                        : ""
                      : (momentRoster?.drivers.find((d) => d.code === driverCode)?.blind_title ?? COPY.freeze.question)}
                </p>
              </div>
              <div className="grid grid-cols-2" aria-hidden>
                <span className="flex h-11 items-center bg-white px-4 text-lg font-black text-ink">{COPY.freeze.options.STAY}</span>
                <span className="flex h-11 items-center bg-ink px-4 text-lg font-black text-white">{COPY.freeze.options.BOX}</span>
              </div>
            </div>
            <Figures
              size="sm"
              rows={[
                { label: COPY.homeUi.summary.mode, value: COPY.homeUi.modes[mode].name },
                mode === "race"
                  ? { label: COPY.homeUi.summary.race, value: race?.name ?? "–" }
                  : { label: COPY.homeUi.summary.moment, value: index.find((d) => d.id === decision)?.race ?? "–" },
                { label: COPY.homeUi.summary.drivers, value: driverMode === "same" ? (driverCode ? COPY.homeUi.driversSame(driverCode) : "–") : COPY.homeUi.driversChoose },
                { label: COPY.homeUi.summary.players, value: COPY.homeUi.playersMax },
              ]}
            />
            <ErrorText id="create-err">{createErr}</ErrorText>
            <button
              type="submit"
              form="host-form"
              disabled={!ready || busy === "create"}
              aria-busy={busy === "create" || undefined}
              aria-describedby="create-err"
              style={createStyle}
              className={`flex h-20 w-full shrink-0 items-center justify-between px-6 text-[1.75rem] font-black tracking-tight transition-[filter,background-color] duration-150 hover:brightness-95 disabled:opacity-60 md:h-24 md:text-[2rem] ${
                colour ? "" : "on-dark bg-ink text-white"
              }`}
            >
              {busy === "create" ? COPY.home.creating : COPY.home.create}
              <span className="meta">{COPY.homeUi.modes[mode].name}</span>
            </button>
          </aside>
        </div>
      </section>
    </main>
  );
}

function Step({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col">
      <legend className="meta mb-2 text-ink-2">{label}</legend>
      {children}
    </fieldset>
  );
}

// A moment or race as a large selectable card: year and chip, circuit, one line of facts. Selected: inverted.
function Card({ name, on, onPick, year, circuit, chip, children }: { name: string; on: boolean; onPick: () => void; year: string; circuit: string; chip: ReactNode; children: ReactNode }) {
  return (
    <label
      className={`flex min-h-[112px] cursor-pointer flex-col justify-between gap-2 border-2 px-4 py-3 transition-colors duration-150 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink ${
        on ? "on-dark border-ink bg-ink text-white" : "border-line hover:border-ink"
      }`}
    >
      <input type="radio" name={name} checked={on} onChange={onPick} className="sr-only" />
      <span className="flex items-center justify-between gap-2">
        <span className="nums text-sm font-bold">{year}</span>
        {chip}
      </span>
      <span className="text-[1.75rem] font-black leading-none tracking-[-0.03em] md:text-[2rem]">{circuit}</span>
      <span className="nums text-sm">{children}</span>
    </label>
  );
}

// Four square cells over one real input: typing, paste, autofill and screen readers all hit the input.
function CodeBoxes({ value, invalid, onChange }: { value: string; invalid: boolean; onChange: (v: string) => void }) {
  const [focus, setFocus] = useState(false);
  return (
    <div className="relative grid grid-cols-4 gap-2">
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          aria-hidden
          className={`nums grid h-20 place-items-center border-current text-4xl font-bold transition-[border-width] duration-100 md:h-[88px] ${
            invalid || (focus && i === Math.min(value.length, 3)) ? "border-4" : "border-2"
          }`}
        >
          {value[i] ?? ""}
        </div>
      ))}
      <input
        id="room-code"
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent"
        value={value}
        maxLength={4}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        inputMode="text"
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onChange={(e) => onChange(e.target.value.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 4))}
        aria-invalid={invalid || undefined}
        aria-describedby="join-err join-hint"
      />
    </div>
  );
}
