// Shared primitives: buttons, tyre circle, track status strip, badges, connection notice.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { COPY } from "@/lib/copy";
import { compoundLetter } from "@/lib/client/race";
import type { Badges } from "@/lib/client/race";
import type { TrackStatus } from "@/lib/types";
import type { Conn } from "@/lib/client/useLobby";

type Variant = "primary" | "secondary" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-ink text-bg hover:bg-ink-2 active:bg-ink-3 disabled:bg-surface-2 disabled:text-ink-disabled",
  secondary:
    "border border-rule text-ink hover:bg-surface-2 active:bg-surface disabled:text-ink-disabled disabled:hover:bg-transparent",
  ghost: "text-ink-2 underline underline-offset-4 hover:text-ink disabled:text-ink-disabled",
};

export function Button({
  variant = "primary",
  busy,
  busyLabel,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; busyLabel?: string }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center rounded-ctl px-6 font-semibold transition-colors duration-[120ms] disabled:cursor-not-allowed ${VARIANT[variant]} ${className}`}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

const TYRE_RING: Record<string, string> = {
  S: "border-flag-red",
  M: "border-flag-yellow",
  H: "border-ink",
  I: "border-flag-green",
  W: "border-ink-2",
};

export function Tyre({ compound, age, size = "md", inverted = false }: { compound: string | null; age: number | null; size?: "md" | "lg"; inverted?: boolean }) {
  const l = compoundLetter(compound);
  const dim = size === "lg" ? "size-8 text-16" : "size-5 text-14 leading-none";
  return (
    <span className="inline-flex items-center gap-2">
      {l ? (
        <span
          className={`inline-flex ${dim} items-center justify-center rounded-full border-2 font-bold ${inverted && l === "H" ? "border-bg" : TYRE_RING[l]}`}
          aria-label={COPY.compounds[compound?.toUpperCase() ?? ""] ?? compound ?? ""}
        >
          {l}
        </span>
      ) : (
        <span className={`inline-flex ${dim}`} aria-hidden />
      )}
      <span className="nums w-6 text-right">{age ?? ""}</span>
    </span>
  );
}

export function StatusStrip({ status, size = "host" }: { status: TrackStatus; size?: "host" | "phone" }) {
  const fill = status === "GREEN" ? "bg-flag-green text-bg" : "bg-flag-yellow text-bg";
  const h = size === "host" ? "h-16 text-40" : "h-12 text-24";
  return (
    <div
      role="status"
      className={`status-strip flex ${h} w-full items-center px-6 font-extrabold uppercase stretch-125 tracking-hero leading-hero ${fill}`}
    >
      {COPY.replay.flags[status]}
    </div>
  );
}

export function BadgeTags({ badges, size = "md", inverted = false }: { badges: Badges; size?: "md" | "sm"; inverted?: boolean }) {
  const list = [
    badges.team && COPY.badges.team.name,
    badges.winning && COPY.badges.winning.name,
    badges.engine && COPY.badges.engine.name,
  ].filter(Boolean) as string[];
  if (list.length === 0) return null;
  const cls =
    size === "md"
      ? "min-h-10 px-3 py-1 text-20 stretch-112 tracking-label"
      : "h-6 whitespace-nowrap px-2 text-14 stretch-75";
  const tag = `inline-flex items-center font-semibold uppercase leading-row ${inverted ? "bg-bg text-ink" : "bg-ink text-bg"} ${cls}`;
  // Tower rows have room for one badge: show the first plus a count of the rest.
  if (size === "sm") {
    return (
      <span className="flex gap-2" aria-label={list.join(", ")}>
        <span className={tag}>{list[0]}</span>
        {list.length > 1 && <span className={`${tag} nums`}>+{list.length - 1}</span>}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-2">
      {list.map((b) => (
        <span key={b} className={tag}>
          {b}
        </span>
      ))}
    </span>
  );
}

export function ConnNotice({ conn, code }: { conn: Conn; code: string }) {
  if (conn === "ok") return null;
  const text =
    conn === "lost"
      ? COPY.error.connectionLost
      : conn === "gave_up"
        ? COPY.error.gaveUp
        : COPY.home.codeNotFound(code);
  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-40 bg-flag-red px-4 py-2 text-center text-20 font-semibold text-bg">
      {text}
    </div>
  );
}

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`text-14 font-semibold uppercase tracking-label text-ink-3 ${className}`}>{children}</span>;
}

export function CallWord({ call, className = "" }: { call: "BOX" | "STAY" | null; className?: string }) {
  return (
    <span className={`font-extrabold uppercase stretch-125 tracking-hero leading-hero ${className}`}>
      {call ? COPY.freeze.options[call] : COPY.reveal.noCall}
    </span>
  );
}
