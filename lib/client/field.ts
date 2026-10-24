// The decision-moment colour field: the player's team colour from the frames, with black or white ink
// picked by WCAG contrast. A flat colour field only (docs/06 track rules: no livery art, no logos).
import type { LapFrame } from "@/lib/types";

// Neutral grey when the frames carry no team colour: never a brand red.
export const FIELD_FALLBACK = "#D9D9D6";
const INK = "#0E0E0E";
const WHITE = "#FFFFFF";

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const normal = (c: string | null | undefined) => {
  if (!c) return null;
  const h = c.trim().replace("#", "");
  return /^[0-9a-f]{6}$/i.test(h) || /^[0-9a-f]{3}$/i.test(h) ? `#${h.toUpperCase()}` : null;
};

// Pure black or white always reaches at least 4.58:1 against any colour. The near-black ink (#0E0E0E) can fall
// just short on a few mid tones, so those fields get pure black instead.
export function fieldColours(teamColour: string | null | undefined): { field: string; ink: string; ratio: number } {
  const field = normal(teamColour) ?? FIELD_FALLBACK;
  const cb = contrast(field, INK);
  const cw = contrast(field, WHITE);
  if (cw > cb) return { field, ink: WHITE, ratio: cw };
  if (cb >= 4.5) return { field, ink: INK, ratio: cb };
  return { field, ink: "#000000", ratio: contrast(field, "#000000") };
}

// The player's team colour from the latest frame that has it.
export function teamColourOf(frames: LapFrame[] | null | undefined, number: number): string | null {
  if (!frames) return null;
  for (let i = frames.length - 1; i >= 0; i--) {
    const c = frames[i].drivers.find((d) => d.number === number)?.team_colour;
    if (c) return c;
  }
  return null;
}

// Inline style that sets the field tokens used by bg-field / text-on-field.
export function fieldStyle(teamColour: string | null | undefined): React.CSSProperties {
  const { field, ink } = fieldColours(teamColour);
  // Set the theme tokens themselves: a var() inside --color-field resolves at :root, so overriding --field
  // on a child alone would never reach bg-field / text-on-field.
  return {
    ["--field" as string]: field,
    ["--on-field" as string]: ink,
    ["--color-field" as string]: field,
    ["--color-on-field" as string]: ink,
  } as React.CSSProperties;
}

export const isDarkField = (teamColour: string | null | undefined) => fieldColours(teamColour).ink === WHITE;
