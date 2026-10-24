// Simple / Advanced data mode: a per-device, per-lobby setting (phone and host keep separate keys),
// plus the pre-reveal figures Advanced shows. Nothing here reads decision.engine or ground_truth.correct.
import { useCallback, useSyncExternalStore } from "react";
import { COPY } from "@/lib/copy";
import type { DecisionPoint, LapFrame } from "@/lib/types";

export type DataMode = "simple" | "advanced";
export type ModeRole = "play" | "host";

const EVENT = "datamode";
const key = (code: string, role: ModeRole) => `lobby:${code.toUpperCase()}:mode:${role}`;

function read(k: string): DataMode {
  try {
    return localStorage.getItem(k) === "advanced" ? "advanced" : "simple";
  } catch {
    return "simple";
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useDataMode(code: string, role: ModeRole): [DataMode, (m: DataMode) => void] {
  const k = key(code, role);
  const mode = useSyncExternalStore(subscribe, () => read(k), () => "simple" as DataMode);
  const set = useCallback(
    (m: DataMode) => {
      try {
        localStorage.setItem(k, m);
      } catch {}
      window.dispatchEvent(new Event(EVENT));
    },
    [k],
  );
  return [mode, set];
}

// public/data/<id>/ground_truth.json, the parts the UI reads. Only pit_loss is shown before the reveal.
export interface GroundTruthFile {
  pit_loss?: { normal_s: number; n_stops: number; from: string };
  seconds?: {
    start_lap_end: number;
    end_lap: number;
    pairs: unknown[];
    mean_delta_s_player_call_vs_other: number;
    swing_s: number;
  };
  positions_reference?: {
    end_lap: number;
    cohort_rule?: string;
    field?: PlacesSplit;
    cohort?: PlacesSplit;
  };
}
export interface PlacesSplit {
  box_mean_gain: number;
  stay_mean_gain: number;
  n_box: number;
  n_stay: number;
}

// Share of a green-flag stop that a stop costs under each neutralisation.
export const PIT_FACTOR = { SC: 0.5, VSC: 0.75 } as const;

export function pitLoss(gt: GroundTruthFile | null, trigger: "SC" | "VSC"): { normal: number; under: number } | null {
  const normal = gt?.pit_loss?.normal_s;
  if (normal == null) return null;
  return { normal, under: Math.round(normal * PIT_FACTOR[trigger] * 10) / 10 };
}

// Advanced freeze figures from the call-moment frame (pass callMomentFrames output).
export function advancedFigures(d: DecisionPoint, seen: LapFrame[], totalLaps: number, gt: GroundTruthFile | null) {
  const f = seen.find((x) => x.lap === d.lap) ?? seen[seen.length - 1];
  const me = f?.drivers.find((x) => x.number === d.player_role.number);
  if (!f || !me) return null;
  const ages = f.drivers.map((x) => x.tyre_age).filter((a): a is number => a != null).sort((a, b) => a - b);
  const median = ages.length ? (ages.length % 2 ? ages[(ages.length - 1) / 2] : Math.round((ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2)) : null;
  const loss = pitLoss(gt, d.trigger);
  let within: number | null = null;
  if (loss && me.gap_to_leader_s != null) {
    within = f.drivers.filter(
      (x) => x.position > me.position && x.gap_to_leader_s != null && x.gap_to_leader_s - me.gap_to_leader_s! < loss.under,
    ).length;
  }
  return { loss, lapsLeft: Math.max(0, totalLaps - d.lap), median, within, compound: me.compound };
}

// Interval to the car ahead, for the Advanced tower column.
export function intervals(drivers: { number: number; position: number; gap_to_leader_s: number | null }[]): Map<number, number | null> {
  const sorted = [...drivers].sort((a, b) => a.position - b.position);
  const m = new Map<number, number | null>();
  sorted.forEach((x, i) => {
    const ahead = sorted[i - 1];
    m.set(x.number, !ahead || x.gap_to_leader_s == null || ahead.gap_to_leader_s == null ? null : x.gap_to_leader_s - ahead.gap_to_leader_s);
  });
  return m;
}

// Advanced freeze figures. Pit loss comes from ground_truth.json pit_loss.normal_s times the SC/VSC factor.
export function advRows(trigger: "SC" | "VSC", a: NonNullable<ReturnType<typeof advancedFigures>>) {
  const rows: { label: string; value: string; wide?: boolean }[] = [];
  if (a.loss) rows.push({ label: COPY.mode.pitLossLabel(trigger), value: COPY.mode.pitLoss(a.loss.under, a.loss.normal), wide: true });
  rows.push({ label: COPY.mode.lapsLeft, value: String(a.lapsLeft) });
  if (a.median != null) rows.push({ label: COPY.mode.medianAge, value: COPY.mode.laps(a.median) });
  if (a.within != null) rows.push({ label: COPY.mode.within, value: String(a.within), wide: true });
  return rows;
}
