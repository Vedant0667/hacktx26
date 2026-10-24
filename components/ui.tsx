// Shared primitives for the Field system (docs/06-ui-rules.md): square bands, hairlines, mono labels.
// No cards, no radius, no shadows. Black is the primary action; the team colour is the decision field.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
import { COPY } from "@/lib/copy";
import { compoundLetter, type Badges } from "@/lib/client/race";
import type { TrackStatus } from "@/lib/types";
import type { Conn } from "@/lib/client/useLobby";

type Variant = "primary" | "secondary" | "quiet" | "inverse";
type Size = "lg" | "md" | "sm";

const VARIANT: Record<Variant, string> = {
  primary: "on-dark bg-ink text-white hover:bg-[#262626] active:bg-[#333] disabled:bg-soft-2 disabled:text-ink-3",
  secondary: "border-2 border-ink bg-bg text-ink hover:bg-soft active:bg-soft-2 disabled:border-soft-2 disabled:text-ink-3",
  quiet: "text-ink underline decoration-2 underline-offset-4 hover:decoration-ink-3 disabled:text-ink-3",
  inverse: "bg-white text-ink hover:bg-soft active:bg-soft-2 disabled:text-ink-3",
};
const SIZE: Record<Size, string> = {
  lg: "h-16 px-6 text-lg font-bold",
  md: "h-12 px-5 text-base font-bold",
  sm: "h-9 px-3 text-sm font-bold",
};

export function Button({
  variant = "primary",
  size = "md",
  busy,
  busyLabel,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; busy?: boolean; busyLabel?: string }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex select-none items-center justify-center gap-2 tracking-tight transition-colors duration-150 ease-out disabled:cursor-not-allowed ${variant === "quiet" ? "h-11 px-0 text-base font-bold" : SIZE[size]} ${VARIANT[variant]} ${className}`}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Field({ className = "", ...rest }, ref) {
  return (
    <input
      ref={ref}
      {...rest}
      className={`h-14 w-full border-0 border-b-2 border-ink bg-transparent px-0 text-xl font-bold tracking-tight text-ink outline-none transition-colors duration-150 placeholder:font-medium focus:border-b-[3px] aria-invalid:border-b-[4px] ${className}`}
    />
  );
});

export function FieldLabel({ htmlFor, children, className = "" }: { htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={`meta text-ink-2 ${className}`}>
      {children}
    </label>
  );
}

export function ErrorText({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className={`flex items-start gap-2 text-sm font-bold ${children ? "" : "sr-only"}`}>
      {children && <span aria-hidden className="nums mt-px inline-grid size-5 shrink-0 place-items-center bg-ink text-xs text-white">!</span>}
      {children}
    </p>
  );
}

// Flag colour only means the flag: green for green, yellow for SC and VSC.
export function FlagDot({ status, className = "size-2.5" }: { status: TrackStatus; className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 ${status === "GREEN" ? "bg-green" : "bg-sc"} ${className}`} />;
}

// Short mono status line: "SC · L7/57".
export function StatusLine({ status, children, className = "" }: { status?: TrackStatus; children: ReactNode; className?: string }) {
  return (
    <span className={`meta inline-flex items-center gap-2 ${className}`}>
      {status && <FlagDot status={status} />}
      {children}
    </span>
  );
}

// A player's three-letter code as a square tag. called: inverted; talking: blinking dot.
export function Tag({ code, state = "idle", size = "md" }: { code: string; state?: "idle" | "called" | "me" | "empty"; size?: "sm" | "md" | "lg" }) {
  const dim = { sm: "h-7 px-1.5 text-sm", md: "h-9 px-2 text-base", lg: "h-14 px-3 text-2xl" }[size];
  const look = {
    idle: "bg-soft text-ink",
    called: "bg-ink text-white",
    me: "bg-ink text-white",
    empty: "border border-dashed border-ink-3 text-ink-3",
  }[state];
  return <span className={`inline-flex shrink-0 items-center font-black tracking-tight transition-colors duration-200 ${dim} ${look}`}>{code}</span>;
}

export function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" className={className}>
      <path d="M5 2.5 9.5 7 5 11.5" />
    </svg>
  );
}

export function Check({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" className={className}>
      <path d="m3 8.5 3.2 3L13 4.5" />
    </svg>
  );
}

export function MicGlyph({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden width="18" height="22" viewBox="0 0 16 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
      <rect x="4.5" y="1" width="7" height="11" rx="3.5" />
      <path d="M1 9a7 7 0 0 0 14 0M8 16v3" />
    </svg>
  );
}

// Progressive disclosure: a full-width row with a hairline above; tap to open the detail.
export function Section({
  title,
  meta,
  children,
  open = false,
  className = "",
}: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  open?: boolean;
  className?: string;
}) {
  return (
    <details open={open} className={`border-t-2 border-ink ${className}`}>
      <summary className="flex min-h-14 items-center justify-between gap-4 py-3">
        <span className="text-lg font-black tracking-tight">{title}</span>
        <span className="flex items-center gap-2 text-sm text-ink-2">
          {meta}
          <Chevron className="chev" />
        </span>
      </summary>
      <div className="disclose pb-6">{children}</div>
    </details>
  );
}

// Standard compound colours, as data only. Hard is white with a dark outline.
const COMPOUND_DOT: Record<string, { bg: string; fg: string; ring: string }> = {
  S: { bg: "#DA291C", fg: "#FFFFFF", ring: "#DA291C" },
  M: { bg: "#FFD12E", fg: "#0E0E0E", ring: "#C9A100" },
  H: { bg: "#FFFFFF", fg: "#0E0E0E", ring: "#0E0E0E" },
  I: { bg: "#43B02A", fg: "#FFFFFF", ring: "#43B02A" },
  W: { bg: "#0067AD", fg: "#FFFFFF", ring: "#0067AD" },
};

// One tyre chip everywhere: compound letter in a coloured circle plus age in laps, on a small white backing
// so it reads on white and on any team-colour field without competing with it.
export function TyreChip({ compound, age, size = "md", bare = false }: { compound: string | null; age?: number | null; size?: "sm" | "md" | "lg"; bare?: boolean }) {
  const l = compoundLetter(compound);
  const dot = l ? COMPOUND_DOT[l] : null;
  const d = { sm: "size-4 text-[9px]", md: "size-[18px] text-[10px]", lg: "size-6 text-xs" }[size];
  const label = COPY.tyreLabel(COPY.compounds[compound?.toUpperCase() ?? ""] ?? compound ?? "", age ?? null);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 align-middle font-mono font-bold leading-none text-ink ${bare ? "" : "bg-white py-0.5 pl-0.5 pr-1.5 shadow-[inset_0_0_0_1px_rgba(14,14,14,0.18)]"}`}
      aria-label={label}
      title={label}
    >
      <span
        aria-hidden
        className={`inline-grid ${d} place-items-center rounded-full`}
        style={dot ? { background: dot.bg, color: dot.fg, boxShadow: `inset 0 0 0 1.5px ${dot.ring}` } : { boxShadow: "inset 0 0 0 1.5px #8a8a8a" }}
      >
        {l ?? "?"}
      </span>
      {age != null && <span aria-hidden className={size === "lg" ? "text-sm" : "text-[11px]"}>{age}</span>}
    </span>
  );
}

// Kept for older call sites: same chip.
export const Tyre = TyreChip;

// Black-and-yellow hatch for the strip ends, drawn as SVG (no CSS gradients in the codebase).
function Hatch({ className }: { className: string }) {
  return (
    <svg aria-hidden className={`${className} shrink-0`} preserveAspectRatio="none" viewBox="0 0 24 24">
      <rect width="24" height="24" fill="#FBD530" />
      {[-24, -12, 0, 12, 24].map((o) => (
        <path key={o} d={`M${o} 24 L${o + 24} 0 L${o + 30} 0 L${o + 6} 24 Z`} fill="#0E0E0E" />
      ))}
    </svg>
  );
}

// Persistent track-status strip for SC and VSC: flag yellow, black text, black bands and hatched ends so it
// never blurs into an orange or yellow team field. Nothing on green.
export function TrackStrip({ status, size = "phone" }: { status: TrackStatus; size?: "phone" | "host" }) {
  if (status === "GREEN") return null;
  const h = size === "host" ? "h-12 text-lg" : "h-10 text-sm";
  const end = size === "host" ? "w-16" : "w-8";
  return (
    <div role="status" className={`relative flex w-full shrink-0 items-stretch border-y-[3px] border-ink bg-[#FBD530] text-ink ${h}`}>
      <Hatch className={`${end} h-full`} />
      <span className="flex flex-1 items-center justify-center font-mono font-bold uppercase tracking-[0.08em]">{COPY.replay.flags[status]}</span>
      <Hatch className={`${end} h-full`} />
    </div>
  );
}

// Small SC / VSC chip for the lap counter. Nothing on green.
export function ScChip({ status, className = "" }: { status: TrackStatus; className?: string }) {
  if (status === "GREEN") return null;
  return <span className={`inline-flex items-center border-2 border-ink bg-[#FBD530] px-1.5 font-mono text-[0.7em] font-bold leading-[1.3] text-ink ${className}`}>{status}</span>;
}

const badgeNames = (b: Badges) =>
  [b.winning && COPY.badges.winning.name, b.team && COPY.badges.team.name, b.engine && COPY.badges.engine.name].filter(Boolean) as string[];

export function BadgeList({ badges, className = "" }: { badges: Badges; className?: string }) {
  const list = badgeNames(badges);
  if (!list.length) return null;
  return (
    <ul className={`flex flex-col ${className}`}>
      {list.map((b) => (
        <li key={b} className="flex min-h-11 items-center gap-3 border-b border-line text-base font-bold">
          <span className="inline-grid size-6 place-items-center bg-ink text-white">
            <Check />
          </span>
          {b}
        </li>
      ))}
    </ul>
  );
}

export function BadgeMark({ badges }: { badges: Badges }) {
  const list = badgeNames(badges);
  if (!list.length) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm" aria-label={list.join(", ")}>
      <Check className="shrink-0" />
      <span className="truncate">{list[0]}</span>
      {list.length > 1 && <span className="nums text-xs">+{list.length - 1}</span>}
    </span>
  );
}

export function ConnNotice({ conn, code }: { conn: Conn; code: string }) {
  if (conn === "ok") return null;
  const text = conn === "lost" ? COPY.error.connectionLost : conn === "gave_up" ? COPY.error.gaveUp : COPY.home.codeNotFound(code);
  return (
    <div role="alert" className="fade fixed inset-x-0 top-0 z-[var(--z-toast)] bg-ink px-4 pb-2.5 pt-[max(10px,env(safe-area-inset-top))] text-center text-sm font-bold text-white">
      {text}
    </div>
  );
}

// MIXED is a Muse camp whose members made different calls.
export function CallWord({ call, className = "" }: { call: "BOX" | "STAY" | "MIXED" | null; className?: string }) {
  return <span className={className}>{call === "MIXED" ? COPY.reveal.mixed : call ? COPY.freeze.options[call] : COPY.reveal.noCall}</span>;
}

// Simple / Advanced data mode: two square segments, the active one inverted.
export function ModeToggle({
  mode,
  onChange,
  size = "md",
  onField = false,
}: {
  mode: "simple" | "advanced";
  onChange: (m: "simple" | "advanced") => void;
  size?: "sm" | "md";
  onField?: boolean;
}) {
  const h = size === "sm" ? "h-8 px-2.5" : "h-10 px-3.5";
  const border = onField ? "border-on-field" : "border-ink";
  return (
    <div role="group" aria-label={COPY.mode.label} className={`inline-flex shrink-0 border-2 ${border}`}>
      {(["simple", "advanced"] as const).map((m) => {
        const on = mode === m;
        return (
          <button
            key={m}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(m)}
            className={`meta ${h} transition-colors duration-150 ${
              on ? (onField ? "bg-on-field text-field" : "bg-ink text-white") : onField ? "text-on-field" : "text-ink hover:bg-soft"
            }`}
          >
            {COPY.mode[m]}
          </button>
        );
      })}
    </div>
  );
}

// Label and value rows separated by hairlines.
export function Figures({ rows, cols = 1, size = "md" }: { rows: { label: string; value: string; wide?: boolean }[]; cols?: 1 | 2; size?: "sm" | "md" | "lg" }) {
  const text = size === "sm" ? "text-sm" : size === "lg" ? "text-lg" : "text-base";
  return (
    <dl className={`grid gap-x-8 ${cols === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
      {rows.map((r) => (
        <div key={r.label} className={`flex min-h-11 items-baseline justify-between gap-4 border-b border-current/15 py-2.5 ${text} ${r.wide && cols === 2 ? "col-span-2" : ""}`}>
          <dt className="min-w-0">{r.label}</dt>
          <dd className="nums whitespace-nowrap font-bold">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Thin bar that drains over a window. Hidden under reduced motion; the numerals stay.
export function DrainBar({ total, elapsedS, className = "bg-current" }: { total: number; elapsedS: number; className?: string }) {
  return (
    <div className="h-1 w-full overflow-hidden" aria-hidden>
      <div className={`countdown-bar h-full ${className}`} style={{ animationDuration: `${total}s`, animationDelay: `-${elapsedS}s` }} />
    </div>
  );
}

// "0:36"
export const clockText = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, "0")}`;

// The OutpaceF1 logo, drawn as a CSS mask so it takes the current text colour (ink on white, white on black,
// the on-field ink on the team colour). Never a fixed colour. The accessible name is the product name.
const BRAND = {
  wordmark: { src: "/brand/wordmark.png", ratio: 2048 / 372 },
  mark: { src: "/brand/mark.png", ratio: 1024 / 631 },
} as const;
export function Brand({ kind = "wordmark", height = 20, className = "", label = true }: { kind?: keyof typeof BRAND; height?: number; className?: string; label?: boolean }) {
  const b = BRAND[kind];
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label ? COPY.name : undefined}
      aria-hidden={label ? undefined : true}
      className={`inline-block shrink-0 bg-current align-middle ${className}`}
      style={{
        height,
        width: Math.round(height * b.ratio),
        WebkitMaskImage: `url(${b.src})`,
        maskImage: `url(${b.src})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
