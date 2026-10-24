"use client";
// `/`: join a lobby with its 4-letter code, or create one on a decision point. Phone first: join sits on
// top because most people arrive holding a phone; the host block follows under a 2 px rule.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { COPY } from "@/lib/copy";
import { ApiError, api } from "@/lib/client/api";
import { createErrorText, createLobby } from "@/lib/client/session";
import type { DecisionIndexEntry } from "@/lib/types";
import { Button, ErrorText, Field, FieldLabel } from "./ui";

export function HomeScreen({ index }: { index: DecisionIndexEntry[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [decision, setDecision] = useState(index[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setCreateErr(COPY.home.nameMissing);
    setCreateErr(null);
    setBusy("create");
    try {
      // Stores the host token (shown once) so this browser can advance the lobby's phases.
      const lobby = await createLobby(decision, n);
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

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-[1440px] grid-cols-4 content-start gap-x-4 pb-[max(24px,env(safe-area-inset-bottom))] md:grid-cols-12 md:gap-x-6 md:px-14 md:pb-12">
      <div className="meta col-span-4 flex h-13 items-center justify-between px-5 md:col-span-12 md:h-24 md:px-0 md:text-lg">
        {/* Wordmark: plain text, never a logo. */}
        <span className="font-sans text-lg font-black normal-case tracking-tight md:text-2xl">{COPY.home.title}</span>
        <Link href="/leaderboard" className="underline decoration-2 underline-offset-4 hover:decoration-ink-3">
          {COPY.homeUi.leaderboardTitle}
        </Link>
      </div>

      <header className="col-span-4 flex flex-col gap-4 px-5 pt-4 md:col-span-8 md:px-0 md:pt-6">
        <h1 className="display text-3xl md:text-5xl">{COPY.homeUi.joinTitle}.</h1>
        <p className="max-w-[36ch] text-md md:text-xl">{COPY.home.subtitle}</p>
      </header>

      <section className="col-span-4 mt-8 flex flex-col md:col-span-5 md:mt-14">
        <form onSubmit={join} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-2 px-5 md:px-0">
            <FieldLabel htmlFor="room-code">{COPY.home.joinLabel}</FieldLabel>
            <CodeBoxes value={code} invalid={!!joinErr} onChange={setCode} />
            <p id="join-hint" className="text-sm text-ink-2">
              {COPY.homeUi.joinHint}
            </p>
            <ErrorText id="join-err">{joinErr}</ErrorText>
          </div>
          <Button type="submit" size="lg" className="h-24! w-full justify-between! px-6 text-2xl! font-black" busy={busy === "join"}>
            {COPY.home.join}
            <span className="nums text-xs font-medium text-[#bdbdbd]">{code.padEnd(4, "·")}</span>
          </Button>
        </form>
      </section>

      <section className="col-span-4 mt-12 flex flex-col px-5 md:col-span-6 md:col-start-7 md:mt-14 md:px-0">
        <form onSubmit={create} className="flex flex-col gap-6 border-t-2 border-ink pt-4" noValidate>
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-black tracking-tight md:text-2xl">{COPY.homeUi.hostTitle}</h2>
            <p className="text-sm text-ink-2 md:text-base">{COPY.homeUi.hostHint}</p>
          </div>
          <fieldset className="flex flex-col">
            <legend className="meta mb-2 text-ink-2">{COPY.home.decisionLabel}</legend>
            <div role="radiogroup" className="flex flex-col border-t border-line">
              {index.map((d) => {
                const on = d.id === decision;
                return (
                  <label
                    key={d.id}
                    className={`flex min-h-16 cursor-pointer items-center gap-4 border-b px-3 transition-colors duration-150 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink ${
                      on ? "border-ink bg-ink text-white" : "border-line hover:bg-soft"
                    }`}
                  >
                    <input type="radio" name="decision" value={d.id} checked={on} onChange={() => setDecision(d.id)} className="sr-only" />
                    <span className="nums w-12 shrink-0 text-sm font-bold">{d.race.match(/\d{4}/)?.[0]}</span>
                    <span className="min-w-0 flex-1 text-base font-bold leading-snug">{d.title}</span>
                    <span aria-hidden className={`size-4 shrink-0 border-2 ${on ? "border-white bg-white" : "border-ink"}`} />
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="host-name">{COPY.home.nameLabel}</FieldLabel>
            <Field
              id="host-name"
              value={name}
              maxLength={24}
              autoComplete="nickname"
              placeholder={COPY.home.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!createErr || undefined}
              aria-describedby="create-err"
            />
          </div>
          <ErrorText id="create-err">{createErr}</ErrorText>
          <Button type="submit" variant="secondary" size="lg" className="w-full md:w-auto md:self-start" busy={busy === "create"} busyLabel={COPY.home.creating} disabled={!decision}>
            {COPY.home.create}
          </Button>
        </form>
      </section>

      <footer className="col-span-4 mt-12 border-t border-line px-5 pt-4 md:col-span-12 md:mt-16 md:px-0">
        <p className="text-xs text-ink-2">{COPY.home.footer}</p>
      </footer>
    </main>
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
          className={`nums grid h-21 place-items-center border-ink text-4xl font-bold transition-[border-width] duration-100 ${
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
