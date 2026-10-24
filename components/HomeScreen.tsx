"use client";
// `/`: create a lobby on a decision point, or join one with a 4-letter code.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { COPY } from "@/lib/copy";
import { ApiError, api } from "@/lib/client/api";
import { rememberName } from "@/lib/client/identity";
import type { DecisionIndexEntry } from "@/lib/types";
import { Button, Label } from "./ui";

const inputCls =
  "h-14 w-full rounded-ctl border border-rule bg-surface px-4 text-24 text-ink placeholder:text-ink-3 hover:bg-surface-2 aria-invalid:border-flag-red";

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
      const lobby = await api.createLobby(decision, n);
      rememberName(lobby.code, n);
      router.push(`/host/${lobby.code}`);
    } catch (err) {
      setBusy(null);
      setCreateErr(err instanceof ApiError && err.status === 0 ? COPY.error.connectionLost : COPY.home.createFailed);
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
      setJoinErr(err instanceof ApiError && err.status === 404 ? COPY.home.codeNotFound(c) : COPY.error.connectionLost);
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-[1440px] grid-cols-1 gap-12 px-4 py-8 md:grid-cols-12 md:px-12 md:py-12">
      <section className="flex flex-col gap-8 md:col-span-7">
        <div className="flex flex-col gap-4">
          <h1 className="text-56 font-extrabold uppercase stretch-125 tracking-hero leading-hero md:text-96">{COPY.home.title}</h1>
          <p className="max-w-[40ch] text-24 text-ink-2">{COPY.home.subtitle}</p>
        </div>

        <form onSubmit={create} className="flex flex-col gap-6" noValidate>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2">
              <Label>{COPY.home.decisionLabel}</Label>
            </legend>
            <div role="radiogroup" className="flex flex-col gap-0.5">
              {index.map((d) => {
                const on = d.id === decision;
                return (
                  <label
                    key={d.id}
                    className={`flex h-14 cursor-pointer items-center gap-4 px-4 text-20 transition-colors duration-[120ms] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink ${
                      on ? "bg-ink text-bg" : "bg-surface hover:bg-surface-2"
                    }`}
                  >
                    <input
                      type="radio"
                      name="decision"
                      value={d.id}
                      checked={on}
                      onChange={() => setDecision(d.id)}
                      className="sr-only"
                    />
                    <span className="nums w-16 font-bold uppercase stretch-75">{d.race.match(/\d{4}/)?.[0]}</span>
                    <span className="font-semibold">{d.title}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-col gap-2">
            <label htmlFor="host-name">
              <Label>{COPY.home.nameLabel}</Label>
            </label>
            <input
              id="host-name"
              className={inputCls}
              value={name}
              maxLength={24}
              autoComplete="nickname"
              placeholder={COPY.home.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!createErr || undefined}
              aria-describedby={createErr ? "create-err" : undefined}
            />
            {createErr && (
              <p id="create-err" className="text-20 text-flag-red">
                {createErr}
              </p>
            )}
          </div>
          <Button type="submit" className="h-14 self-start text-20" busy={busy === "create"} busyLabel={COPY.home.creating} disabled={!decision}>
            {COPY.home.create}
          </Button>
        </form>
      </section>

      <section className="flex flex-col gap-8 md:col-span-5 md:border-l md:border-rule md:pl-12">
        <form onSubmit={join} className="flex flex-col gap-2" noValidate>
          <label htmlFor="room-code">
            <Label>{COPY.home.joinLabel}</Label>
          </label>
          <div className="flex gap-2">
            <input
              id="room-code"
              className={`${inputCls} nums h-[72px] text-40 font-extrabold uppercase stretch-125 tracking-code`}
              value={code}
              maxLength={4}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              onChange={(e) => setCode(e.target.value.replace(/[^a-z]/gi, "").toUpperCase())}
              aria-invalid={!!joinErr || undefined}
              aria-describedby={joinErr ? "join-err" : undefined}
            />
            <Button type="submit" className="h-[72px] text-20" busy={busy === "join"}>
              {COPY.home.join}
            </Button>
          </div>
          {joinErr && (
            <p id="join-err" className="text-20 text-flag-red">
              {joinErr}
            </p>
          )}
        </form>
        <Link href="/leaderboard" className="self-start text-20 text-ink-2 underline underline-offset-4 hover:text-ink">
          {COPY.home.leaderboard}
        </Link>
        <p className="mt-auto text-14 text-ink-3">{COPY.home.footer}</p>
      </section>
    </main>
  );
}
