"use client";
// Race Night UI kit: the shared, presentation-only primitives every Race Night screen is built from. No business
// logic: callers pass display values. Styles live in kit.css, all scoped under the .rn root that RNRoot renders.
import "./kit.css";
import type { ButtonHTMLAttributes, CSSProperties, ElementType, ReactNode } from "react";
import { COPY } from "@/lib/copy";
import { fieldColours } from "@/lib/client/field";
import { CALL_WINDOW_S, compoundLetter } from "@/lib/client/race";
import { Brand, clockText } from "@/components/ui";

// Strings the kit needs that lib/copy.ts does not have yet (move to COPY.rn at integration).
export const RN_KIT_COPY = {
  tyreAge: (age: number) => `${age}L`,
  lightsLabel: (lit: number) => `Countdown lights, ${lit} of 5 lit`,
  secondsLeft: (s: number) => `${s} seconds left`,
  you: "YOU",
} as const;

export const RN_NEUTRAL = { field: "#E9EBEE", ink: "#07080A", shadow: "#3A3F48" } as const;
export const RN_TYRE_RING: Record<string, string> = { S: "#E10600", M: "#FFD43B", H: "#F2F3F5", I: "#22C55E", W: "#2B7FFF" };

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ------------------------------------------------------------------------------------------------
// Team colour tokens

// The CSS variables for a team colour: --team, --on-team (black or white ink by WCAG contrast, via
// lib/client/field.ts) and --rn-shadow (the hard shadow under primary buttons). Neutral (no team yet, or
// neutral: true) is the light grey slab with near-black ink and a grey shadow.
export function teamVars(team: string | null | undefined, neutral = false): CSSProperties {
  if (neutral || !team) {
    return { ["--team" as string]: RN_NEUTRAL.field, ["--on-team" as string]: RN_NEUTRAL.ink, ["--rn-shadow" as string]: RN_NEUTRAL.shadow } as CSSProperties;
  }
  const { field, ink } = fieldColours(team);
  return {
    ["--team" as string]: field,
    ["--on-team" as string]: ink === "#FFFFFF" ? "#FFFFFF" : "#07080A",
    ["--rn-shadow" as string]: field,
  } as CSSProperties;
}

// ------------------------------------------------------------------------------------------------
// RNRoot: the dark ground, Race Night fonts and the .rn scope. Every Race Night screen renders inside one.

export function RNRoot({
  team,
  neutral = false,
  as: Tag = "div",
  className,
  style,
  children,
  ...rest
}: {
  team?: string | null;
  neutral?: boolean;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Record<`aria-${string}` | `data-${string}`, string | undefined>) {
  return (
    <Tag className={cx("rn", className)} style={{ ...teamVars(team, neutral), ...style }} {...rest}>
      {children}
    </Tag>
  );
}

// ------------------------------------------------------------------------------------------------
// Slab: the big skewX(-14deg) colour field. Decorative; position it with style (left/top/width/height).

export function Slab({ tone = "team", style, className }: { tone?: "team" | "neutral"; style?: CSSProperties; className?: string }) {
  return <div aria-hidden className={cx("rn-slab", className)} data-tone={tone} style={style} />;
}

// ------------------------------------------------------------------------------------------------
// SkewButton

export type SkewVariant = "primary" | "secondary" | "dark" | "choice";
export type SkewSize = "phone-sm" | "phone" | "host-sm" | "host" | "host-xl";

function TickMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" aria-hidden>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

export function SkewButton({
  variant = "primary",
  size = "phone",
  selected,
  tick,
  sub,
  icon,
  shadow,
  full = false,
  align,
  children,
  className,
  type = "button",
  ...rest
}: {
  variant?: SkewVariant;
  size?: SkewSize;
  selected?: boolean; // choice only: sets aria-pressed
  tick?: boolean; // choice: show the skewed tick box (default true for choice)
  sub?: ReactNode; // small text on the right (e.g. "Keep P10 on 10-lap softs")
  icon?: ReactNode; // before the label (e.g. a mic glyph)
  shadow?: "team" | "dark" | "none"; // default: team on phone primary/dark, dark on host primary/dark, none otherwise
  full?: boolean; // width: 100%
  align?: "center" | "start";
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const isChoice = variant === "choice";
  const host = size.startsWith("host");
  const sh = shadow ?? (variant === "primary" || variant === "dark" ? (host ? "dark" : "team") : "none");
  const showTick = isChoice && tick !== false;
  const al = align ?? (isChoice || sub != null ? "start" : "center");
  return (
    <button
      {...rest}
      type={type}
      className={cx("rn-btn", className)}
      data-variant={variant}
      data-size={size}
      data-shadow={sh}
      data-full={full || undefined}
      data-align={al}
      aria-pressed={isChoice ? !!selected : rest["aria-pressed"]}
    >
      <span className="rn-cs" style={host ? undefined : al === "start" ? { width: "100%", gap: 14 } : undefined}>
        {showTick && <span className="rn-tick">{selected ? <TickMark /> : null}</span>}
        {icon}
        <span className="rn-bt">{children}</span>
        {sub != null && <span className="rn-sub">{sub}</span>}
      </span>
    </button>
  );
}

// ------------------------------------------------------------------------------------------------
// SkewChip: player chips ("Vedant CALLED"), the stakes badge ("88 PTS AT STAKE"), call chips.

export function SkewChip({
  tone = "solid",
  size = "host",
  children,
  className,
  style,
}: {
  tone?: "solid" | "dashed" | "team" | "panel" | "outline" | "yellow";
  size?: "host" | "phone";
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={cx("rn-chip", className)} data-tone={tone} data-size={size} style={style}>
      <span className="rn-cs">{children}</span>
    </span>
  );
}

// ------------------------------------------------------------------------------------------------
// Label: the one small-caps label style (13 px, 800, 0.14em, uppercase, muted).

export function Label({
  as: Tag = "span",
  tone = "muted",
  className,
  style,
  children,
  id,
}: {
  as?: ElementType;
  tone?: "muted" | "ink" | "white" | "yellow" | "green"; // ink = on the team/neutral slab
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  id?: string;
}) {
  return (
    <Tag id={id} className={cx("rn-lbl", className)} data-tone={tone === "muted" ? undefined : tone} style={style}>
      {children}
    </Tag>
  );
}

// ------------------------------------------------------------------------------------------------
// Num: a value with a smaller, lighter unit, tabular figures, condensed.

export function Num({
  value,
  unit,
  size,
  weight = 800,
  className,
  style,
  condensed = true,
}: {
  value: ReactNode;
  unit?: ReactNode;
  size?: number; // px
  weight?: 600 | 700 | 800 | 900;
  className?: string;
  style?: CSSProperties;
  condensed?: boolean;
}) {
  return (
    <span className={cx(condensed && "rn-d", "rn-num", className)} style={{ fontWeight: weight, fontSize: size, lineHeight: 1, ...style }}>
      {value}
      {unit != null && <span className="rn-u">{unit}</span>}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------
// StartLights: five lights from the seconds left (all lit at the start of the window, the last one goes out at 0).

export type LightsSize = "host" | "host-md" | "host-sm" | "phone";
const LIGHT_PX: Record<LightsSize, { d: number; gap: number }> = {
  host: { d: 40, gap: 12 },
  "host-md": { d: 32, gap: 12 },
  "host-sm": { d: 26, gap: 10 },
  phone: { d: 12, gap: 5 },
};

export function litCount(left: number, total: number = CALL_WINDOW_S): number {
  if (left <= 0 || total <= 0) return 0;
  return Math.max(0, Math.min(5, Math.ceil(left / (total / 5))));
}

export function StartLights({ left, total = CALL_WINDOW_S, size = "host", className }: { left: number; total?: number; size?: LightsSize; className?: string }) {
  const lit = litCount(left, total);
  const { d, gap } = LIGHT_PX[size];
  return (
    <div className={cx("rn-lights", className)} data-size={size} style={{ gap }} role="img" aria-label={RN_KIT_COPY.lightsLabel(lit)}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className="rn-light" data-lit={i < lit} style={{ width: d, height: d }} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Countdown: the big clock. The last 5 s turn yellow.

export type CountdownSize = "host" | "host-md" | "host-sm" | "phone";
const COUNT_PX: Record<CountdownSize, number> = { host: 120, "host-md": 92, "host-sm": 88, phone: 36 };

export function Countdown({ left, size = "host", className, style }: { left: number; size?: CountdownSize; className?: string; style?: CSSProperties }) {
  const urgent = left > 0 && left <= 5;
  return (
    <span
      className={cx("rn-count", className)}
      data-urgent={urgent}
      role="timer"
      aria-live={urgent ? "polite" : "off"}
      aria-label={RN_KIT_COPY.secondsLeft(left)}
      style={{ fontSize: COUNT_PX[size], lineHeight: size === "phone" ? 1 : 0.82, ...style }}
    >
      {clockText(left)}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------
// Banner: SC/VSC yellow chevron banner, red flag, slim green strip, chequered strip.

export type BannerKind = "vsc" | "sc" | "green" | "chequered" | "red";

export function Banner({ kind, text, size = "host", className, style }: { kind: BannerKind; text?: ReactNode; size?: "host" | "phone"; className?: string; style?: CSSProperties }) {
  if (kind === "green") {
    return <div className={cx("rn-banner", className)} data-kind="green" data-size={size} style={style} role="status" aria-label={typeof text === "string" ? text : undefined} />;
  }
  if (kind === "chequered") {
    return (
      <div className={cx("rn-banner", className)} data-kind="chequered" data-size={size} style={style} role="status" aria-label={typeof text === "string" ? text : undefined}>
        {text ? <span aria-hidden={typeof text === "string" ? true : undefined}>{text}</span> : null}
      </div>
    );
  }
  const n = size === "host" ? 5 : 3;
  return (
    <div className={cx("rn-banner", className)} data-kind={kind} data-size={size} style={style} role="status">
      <span className="rn-chev" data-side="l" aria-hidden>
        {">".repeat(n)}
      </span>
      <span>{text}</span>
      <span className="rn-chev" data-side="r" aria-hidden>
        {"<".repeat(n)}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// TyreBadge: compound letter in a ringed dark disc, optional age ("10L").

export function TyreBadge({
  compound,
  age,
  showAge = true,
  size = "md",
  ageClassName,
  ageStyle,
}: {
  compound: string | null | undefined;
  age?: number | null;
  showAge?: boolean;
  size?: "md" | "lg";
  ageClassName?: string;
  ageStyle?: CSSProperties;
}) {
  const l = compoundLetter(compound ?? null);
  const ring = l ? RN_TYRE_RING[l] : "#8A8F98";
  const label = COPY.tyreLabel(COPY.compounds[compound?.toUpperCase() ?? ""] ?? compound ?? "", age ?? null);
  return (
    <span className="rn-ty-wrap" role="img" aria-label={label} title={label}>
      <span className="rn-ty" data-size={size} style={{ borderColor: ring }} aria-hidden>
        {l ?? "?"}
      </span>
      {showAge && age != null && (
        <span className={cx("rn-ty-age", ageClassName)} style={ageStyle} aria-hidden>
          {RN_KIT_COPY.tyreAge(age)}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------
// GapValue: a gap relative to your/the followed car, F1 signs (true minus = car ahead, plus = behind).
// delta = that car's gap to the leader minus yours (negative = ahead). Uses COPY.tele.gapToYou.

export function gapText(delta: number): string {
  return COPY.tele.gapToYou(delta);
}

export function GapValue({
  delta,
  unit = true,
  size,
  weight = 800,
  className,
  style,
}: {
  delta: number | null | undefined;
  unit?: boolean;
  size?: number;
  weight?: 600 | 700 | 800 | 900;
  className?: string;
  style?: CSSProperties;
}) {
  if (delta == null || !Number.isFinite(delta)) return <Num value={COPY.tele.none} size={size} weight={weight} className={className} style={style} />;
  return <Num value={gapText(delta)} unit={unit ? "s" : undefined} size={size} weight={weight} className={className} style={style} />;
}

// ------------------------------------------------------------------------------------------------
// TowerRow: one timing-tower row (position, team tick, code, tyre, gap, optional trend). Your row fills with the team colour.

export type TowerSize = "host" | "host-sm" | "phone";
const TOWER_PX: Record<TowerSize, { pos: number; posW: number; code: number; codeW: number; gap: number }> = {
  host: { pos: 16, posW: 24, code: 18, codeW: 44, gap: 17 },
  "host-sm": { pos: 15, posW: 22, code: 17, codeW: 40, gap: 15 },
  phone: { pos: 15, posW: 18, code: 17, codeW: 38, gap: 17 },
};

export function TowerRow({
  pos,
  code,
  teamColour,
  compound,
  age,
  gap,
  trend,
  me = false,
  bench = false,
  size = "host",
  className,
  style,
}: {
  pos: number | string | null;
  code: string;
  teamColour?: string | null; // the tick; hidden on phone rows (the mockup has none there)
  compound?: string | null;
  age?: number | null; // shown on phone rows
  gap: ReactNode; // e.g. <GapValue delta={-1.5} unit={false} /> or RN_KIT_COPY.you
  trend?: ReactNode;
  me?: boolean;
  bench?: boolean;
  size?: TowerSize;
  className?: string;
  style?: CSSProperties;
}) {
  const px = TOWER_PX[size];
  const phone = size === "phone";
  return (
    <div className={cx("rn-row", "rn-num", className)} data-size={size} data-me={me || undefined} data-bench={bench || undefined} style={style}>
      <span className="rn-d" style={{ width: px.posW, fontWeight: phone ? 700 : 800, fontSize: px.pos, color: phone && !me ? "var(--rn-muted)" : undefined }}>
        {pos ?? ""}
      </span>
      {!phone && <span className="rn-tick-bar" style={{ background: me ? "var(--on-team)" : (teamColour ?? "#5A5F68") }} />}
      <span className="rn-d" style={{ width: px.codeW, fontWeight: 900, fontSize: px.code }}>
        {code}
      </span>
      {compound !== undefined && <TyreBadge compound={compound} age={phone ? age : null} ageStyle={{ width: 28, color: me ? "var(--on-team)" : "var(--rn-muted)", fontWeight: 600 }} />}
      <span className="rn-d" style={{ marginLeft: "auto", width: phone ? 56 : undefined, textAlign: "right", fontWeight: 800, fontSize: px.gap }}>
        {gap}
      </span>
      {trend !== undefined && (
        <span style={{ width: 64, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, fontWeight: 700, fontSize: 15, color: me ? undefined : "var(--rn-muted)" }}>{trend}</span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Logo: the OutpaceF1 wordmark (components/ui Brand), in currentColor.

const LOGO_PX = { host: 26, phone: 17, "phone-sm": 14 } as const;

export function Logo({ size = "host", className, style }: { size?: keyof typeof LOGO_PX; className?: string; style?: CSSProperties }) {
  return (
    <span className={className} style={{ display: "inline-flex", ...style }}>
      <Brand height={LOGO_PX[size]} />
    </span>
  );
}

// ------------------------------------------------------------------------------------------------
// OutlineNumber: the giant outline car number. Decorative and absolutely positioned: the caller places it
// (style: right/bottom/top) where it cannot sit under text.

export function OutlineNumber({
  value,
  size = 260,
  stroke = "rgba(7,8,10,0.16)",
  strokeWidth = 2,
  style,
  className,
}: {
  value: number | string;
  size?: number;
  stroke?: string;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div aria-hidden className={cx("rn-outline-num", className)} style={{ fontSize: size, WebkitTextStroke: `${strokeWidth}px ${stroke}`, ...style }}>
      {value}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// ModeTabs: Simple / Advanced. segment = phone joined skewed tabs; underline = host panel text tabs;
// split = two skewed buttons on the dark ground (selected white); split-slab = on the team slab (selected black).

export type DataModeValue = "simple" | "advanced";

export function ModeTabs({
  mode,
  onChange,
  variant = "segment",
  label = COPY.mode.label,
  className,
  style,
}: {
  mode: DataModeValue;
  onChange?: (m: DataModeValue) => void;
  variant?: "segment" | "underline" | "split" | "split-slab";
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const items = (["simple", "advanced"] as const).map((m) => (
    <button key={m} type="button" aria-pressed={mode === m} onClick={onChange ? () => onChange(m) : undefined}>
      {variant === "underline" ? COPY.mode[m] : <span>{COPY.mode[m]}</span>}
    </button>
  ));
  if (variant === "segment") {
    return (
      <div role="group" aria-label={label} className={cx("rn-seg", className)} style={style}>
        {items}
      </div>
    );
  }
  return (
    <div role="group" aria-label={label} className={cx("rn-tabs", className)} data-variant={variant} style={style}>
      {items}
    </div>
  );
}
