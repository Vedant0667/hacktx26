"use client";
// The home builder's state and actions, the same logic as components/HomeScreen.tsx (data loads, create lobby,
// join room), shaped into the display props RNHomeView takes. HomeScreen keeps its own copy for the classic UI.
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { COPY } from "@/lib/copy";
import { ApiError, api, data, type BlindDecision, type BlindDriver, type DriverMode, type RaceEntry } from "@/lib/client/api";
import { createErrorText, createLobby, createRaceLobby } from "@/lib/client/session";
import type { DecisionIndexEntry, DriverFrame } from "@/lib/types";
import { RN_HOME_COPY as C } from "./copy";
import type { HomeCard, HomeDriver, HomeMode, RNHomeViewProps } from "./RNHomeView";

type Roster = { def: string; drivers: BlindDriver[]; at: Map<number, DriverFrame> };

// "2025 Qatar GP" -> "Qatar 2025"
export function cardTitle(name: string): string {
  const year = name.match(/\d{4}/)?.[0] ?? "";
  const circuit = name.replace(year, "").replace(/\bGP\b|Grand Prix/i, "").trim();
  return `${circuit} ${year}`.trim();
}

export function useHomeBuilder(index: DecisionIndexEntry[]): RNHomeViewProps {
  const router = useRouter();
  const [mode, setMode] = useState<HomeMode>("race");
  const [decision, setDecision] = useState(index[0]?.id ?? "");
  const [raceKey, setRaceKey] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [driverMode, setDriverMode] = useState<DriverMode>("same");
  const [roster, setRoster] = useState<Record<string, Roster | "error">>({});
  const [blinds, setBlinds] = useState<Record<string, BlindDecision>>({});
  const [races, setRaces] = useState<RaceEntry[] | "error" | null>(null);
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

  const drivers: HomeDriver[] | "loading" | "error" =
    mode === "race"
      ? races === "error"
        ? "error"
        : race
          ? race.drivers.map((d) => ({ code: d.code, number: d.number, name: d.name, team: d.team, team_colour: d.team_colour, meta: COPY.homeUi.calls(d.freeze_count), calls: d.freeze_count }))
          : "loading"
      : r === "error"
        ? "error"
        : momentRoster
          ? momentRoster.drivers.map((d) => {
              const at = momentRoster.at.get(d.number);
              return { code: d.code, number: d.number, name: d.name, team: d.team, team_colour: d.team_colour, meta: at ? COPY.mode.position(at.position) : null, calls: null };
            })
          : "loading";
  const defCode = mode === "race" ? (race?.default_driver ?? null) : (momentRoster?.def ?? null);
  const driverCode = picked[key] ?? defCode;
  const current = Array.isArray(drivers) ? (drivers.find((d) => d.code === driverCode) ?? null) : null;

  const cards: HomeCard[] | "loading" | "error" =
    mode === "race"
      ? races === null
        ? "loading"
        : races === "error"
          ? "error"
          : raceList.map((x) => {
              const sel = x.race_key === race?.race_key;
              const calls = sel && driverMode === "same" && current?.calls != null ? current.calls : null;
              return { key: x.race_key, trackId: x.race_key, title: cardTitle(x.name), sub: C.raceSub(x.total_laps, calls) };
            })
      : index.map((d) => {
          const b = blinds[d.id];
          return { key: d.id, trackId: d.id, title: cardTitle(d.race), sub: C.momentSub(b?.lap ?? d.lap, b?.total_laps ?? null, b?.trigger ?? null) };
        });

  const ready = mode === "race" ? !!race : !!decision;

  async function onCreate(e?: FormEvent) {
    e?.preventDefault();
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

  async function onJoin(e?: FormEvent) {
    e?.preventDefault();
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

  return {
    mode,
    onMode: setMode,
    cards,
    selectedCard: mode === "race" ? (race?.race_key ?? null) : decision,
    onPickCard: (k) => (mode === "race" ? setRaceKey(k) : setDecision(k)),
    driverMode,
    onDriverMode: setDriverMode,
    drivers,
    driverCode,
    onPickDriver: (c) => setPicked((m) => ({ ...m, [key]: c })),
    ready,
    busy,
    createErr,
    onCreate,
    code,
    onCode: setCode,
    joinErr,
    onJoin,
    dataError: COPY.error.data,
  };
}
