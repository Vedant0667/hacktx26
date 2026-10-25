// Real circuit outlines for the Race Night track maps, plus pure geometry helpers: parse the path, measure it,
// find the point at a fraction of the lap, and place cars on it from their gap to the leader.
// Outlines: bacinger/f1-circuits, MIT (GeoJSON projected to SVG; path direction = racing direction, starting on the line).
// Placement logic ported from the mockup generator (scratchpad tools/trackgen.py).

export type TrackKey = "sg-2008" | "qa-2004";

export interface TrackOutline {
  key: TrackKey;
  name: string;
  lengthM: number;
  viewBox: string; // "minX minY width height"
  start: [number, number]; // start/finish line, the first point of `d`
  d: string; // M x y L x y ... Z (absolute, straight segments only)
}

export const TRACKS: Record<TrackKey, TrackOutline> = {
  "sg-2008": {
    key: "sg-2008",
    name: "Marina Bay Street Circuit",
    lengthM: 4928,
    viewBox: "0 0 1000 683",
    start: [930.3, 271.9],
    d: "M930.3 271.9 L948.3 408.8 L950.0 426.5 L948.3 435.2 L943.4 442.9 L921.2 476.7 L917.3 482.3 L913.1 484.3 L907.7 484.9 L895.6 484.3 L839.4 481.2 L752.7 472.0 L741.8 469.1 L734.8 464.9 L729.4 459.0 L724.8 447.1 L724.2 435.3 L724.5 428.3 L722.3 424.7 L710.2 423.8 L697.7 423.5 L633.8 419.9 L453.9 410.3 L432.1 407.7 L416.9 403.6 L401.2 395.8 L337.4 339.8 L310.1 316.5 L305.5 312.8 L299.0 311.8 L290.9 313.2 L284.8 317.3 L280.8 321.2 L269.3 356.4 L263.2 382.7 L248.0 462.3 L216.5 622.6 L214.8 626.0 L212.5 628.9 L208.1 632.0 L203.0 633.2 L196.6 633.1 L193.7 631.9 L186.3 622.6 L179.0 612.2 L173.5 600.3 L167.6 594.5 L139.9 572.3 L126.1 559.6 L117.5 551.3 L112.2 543.8 L106.8 525.5 L107.6 517.0 L109.1 510.5 L112.9 502.9 L110.9 498.2 L103.9 495.8 L91.1 491.4 L80.0 484.3 L66.4 474.8 L55.9 465.5 L52.2 457.8 L50.4 446.9 L50.0 437.3 L60.6 419.1 L103.5 342.4 L158.7 243.2 L168.5 225.3 L177.7 216.8 L181.5 213.7 L194.1 211.2 L205.2 218.0 L219.3 227.8 L277.1 288.5 L282.3 291.2 L286.6 290.1 L290.6 282.6 L313.4 237.9 L343.9 186.3 L349.5 177.9 L354.9 176.0 L364.6 180.3 L370.2 183.6 L532.5 277.5 L559.1 287.7 L577.5 291.1 L806.4 304.6 L815.3 302.9 L826.8 297.5 L836.4 290.8 L842.5 279.6 L844.0 269.1 L842.2 243.9 L835.7 209.8 L815.8 154.6 L810.4 142.9 L806.8 133.1 L804.8 121.3 L804.8 106.0 L808.2 72.0 L814.0 58.7 L821.9 50.6 L828.7 50.0 L834.8 51.6 L841.5 59.4 L845.1 64.1 L848.6 69.0 L854.9 74.3 L869.4 81.4 L881.6 84.8 L896.8 83.3 L904.7 86.5 L908.6 92.1 L911.0 101.0 L917.1 176.3 L930.3 271.9 Z",
  },
  "qa-2004": {
    key: "qa-2004",
    name: "Losail International Circuit",
    lengthM: 5380,
    viewBox: "0 0 862 1000",
    start: [183.8, 594.7],
    d: "M183.8 594.7 L89.5 422.1 L52.4 355.0 L50.0 342.5 L51.6 329.5 L56.3 319.4 L63.7 312.0 L75.1 305.3 L88.1 303.3 L100.4 305.5 L194.6 362.6 L203.5 365.1 L215.4 365.5 L229.1 361.5 L240.1 351.2 L246.4 340.0 L247.9 328.6 L245.8 246.5 L247.1 235.4 L250.5 225.7 L255.0 216.5 L261.5 208.9 L395.8 60.1 L403.2 54.1 L414.6 50.9 L425.6 50.0 L436.8 52.9 L445.5 58.1 L485.4 96.2 L489.9 104.2 L491.9 115.3 L491.5 124.9 L488.8 134.3 L483.0 142.8 L395.8 238.6 L392.0 245.6 L391.7 253.2 L393.7 259.9 L398.0 264.8 L404.3 268.8 L413.0 270.0 L419.1 268.2 L427.0 264.6 L579.3 203.6 L589.3 202.6 L601.6 204.3 L611.9 209.0 L620.0 217.1 L625.0 227.4 L626.9 237.6 L626.7 246.5 L623.8 255.1 L617.6 265.0 L612.4 269.8 L600.5 279.5 L587.3 294.7 L576.3 310.0 L567.1 326.2 L559.7 345.3 L555.5 358.3 L550.9 381.1 L547.2 390.9 L540.7 399.2 L533.7 404.4 L524.3 408.6 L437.7 429.7 L430.1 434.1 L424.3 439.3 L421.0 447.8 L419.6 456.1 L421.1 468.6 L430.6 480.9 L446.7 497.2 L471.6 516.2 L497.6 531.0 L524.0 540.4 L550.5 546.0 L576.3 548.3 L604.5 545.5 L733.9 531.2 L745.8 533.7 L759.5 540.2 L770.0 548.3 L779.9 561.7 L809.9 617.5 L812.3 627.1 L812.3 635.9 L811.0 645.0 L804.8 656.7 L758.1 731.9 L752.3 737.5 L743.6 741.5 L734.6 744.2 L722.5 743.8 L573.6 713.7 L563.1 713.7 L552.5 716.9 L543.6 723.0 L537.3 730.8 L433.7 932.3 L425.4 941.9 L415.9 947.8 L402.3 950.0 L392.0 948.8 L381.9 944.6 L371.6 935.6 L183.8 594.7 Z",
  },
};

// Which outline a race or a decision is run on. Race keys (races.key) and decision ids (decision_points.id).
const BY_ID: Record<string, TrackKey> = {
  "2026-singapore": "sg-2008",
  "2025-qatar": "qa-2004",
  "2024-qatar": "qa-2004",
  "singapore-2026-vsc": "sg-2008",
  "qatar-2025-l7": "qa-2004",
};

// The outline for a race key or decision id; null when there is no outline for it (draw no map).
export function trackFor(id: string | null | undefined): TrackOutline | null {
  if (!id) return null;
  const low = id.toLowerCase();
  const k = BY_ID[id] ?? (low.includes("singapore") ? "sg-2008" : low.includes("qatar") ? "qa-2004" : null);
  return k ? TRACKS[k] : null;
}

// ---------------------------------------------------------------------------------------------------------
// Geometry

export type Pt = [number, number];

export interface TrackGeometry {
  outline: TrackOutline;
  points: Pt[]; // closed: last point equals the first
  cum: number[]; // cumulative length at each point, cum[0] = 0
  length: number; // total length in viewBox units
  vb: [number, number, number, number];
}

export interface PathPoint {
  x: number;
  y: number;
  tx: number; // unit tangent (direction of travel)
  ty: number;
}

// All absolute "x y" pairs in the path, closed (the first point is appended when the path does not end on it).
export function parsePath(d: string): Pt[] {
  const pts: Pt[] = [];
  for (const m of d.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)) pts.push([parseFloat(m[1]), parseFloat(m[2])]);
  if (pts.length > 1) {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    if (a[0] !== b[0] || a[1] !== b[1]) pts.push([a[0], a[1]]);
  }
  return pts;
}

export function cumulativeLengths(points: Pt[]): number[] {
  const cum = [0];
  for (let i = 0; i < points.length - 1; i++) {
    cum.push(cum[i] + Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]));
  }
  return cum;
}

const geoCache = new Map<string, TrackGeometry>();

export function geometry(outline: TrackOutline): TrackGeometry {
  const hit = geoCache.get(outline.key + outline.d.length);
  if (hit) return hit;
  const points = parsePath(outline.d);
  const cum = cumulativeLengths(points);
  const vb = outline.viewBox.split(/\s+/).map(Number) as [number, number, number, number];
  const g = { outline, points, cum, length: cum[cum.length - 1] ?? 0, vb };
  geoCache.set(outline.key + outline.d.length, g);
  return g;
}

// Wrap any fraction into [0, 1).
export const wrap01 = (f: number) => ((f % 1) + 1) % 1;

// The point at a fraction of the lap (0 = start/finish line, increasing in the racing direction; wraps).
export function pointAt(g: TrackGeometry, fraction: number): PathPoint {
  const { points: p, cum, length } = g;
  if (p.length < 2 || length === 0) return { x: p[0]?.[0] ?? 0, y: p[0]?.[1] ?? 0, tx: 1, ty: 0 };
  const s = wrap01(fraction) * length;
  // Binary search for the segment holding s.
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] >= s) hi = mid;
    else lo = mid;
  }
  const a = p[lo];
  const b = p[hi];
  const seg = cum[hi] - cum[lo] || 1;
  const t = (s - cum[lo]) / seg;
  return { x: a[0] + t * (b[0] - a[0]), y: a[1] + t * (b[1] - a[1]), tx: (b[0] - a[0]) / seg, ty: (b[1] - a[1]) / seg };
}

// Shortest distance from q to the track centre line (for label placement).
export function distanceToTrack(g: TrackGeometry, q: Pt): number {
  let best = Infinity;
  const p = g.points;
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, ay] = p[i];
    const dx = p[i + 1][0] - ax;
    const dy = p[i + 1][1] - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / l2));
    const d = Math.hypot(q[0] - ax - t * dx, q[1] - ay - t * dy);
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------
// Car placement

export interface GapCar {
  code: string;
  gap_to_leader_s: number | null;
}

export interface PlacedCar {
  code: string;
  fraction: number; // [0, 1) along the lap from the start/finish line
  lapped: boolean; // a lap or more down: drawn where it physically is, ahead of its position order
  lapsDown: number; // whole laps behind the leader (0 on the lead lap)
}

export interface PlaceOptions {
  lapTimeS: number; // a representative lap time (e.g. the leader's last green lap); gap / lapTimeS = fraction behind
  leaderFraction?: number; // where the leader is on the lap (default 0: on the line, which is where end-of-lap gaps are measured)
}

// Fraction behind the leader for a gap, wrapping for lapped cars.
export function gapToFraction(gapS: number, opts: PlaceOptions): number {
  const lap = opts.lapTimeS > 0 ? opts.lapTimeS : 1;
  return wrap01((opts.leaderFraction ?? 0) - gapS / lap);
}

// Places each car on the lap by its gap to the leader: fraction = leaderFraction - gap / lapTime, wrapped.
// A gap of a lap or more wraps round (the car is drawn where it physically is) and is flagged lapped.
// Cars with no gap (null) are left out, except a car in P1 / the leader, which sits at leaderFraction.
export function placeCars<T extends GapCar>(drivers: readonly T[], opts: PlaceOptions): (PlacedCar & { car: T })[] {
  const lap = opts.lapTimeS > 0 ? opts.lapTimeS : 1;
  const out: (PlacedCar & { car: T })[] = [];
  for (const car of drivers) {
    const gap = car.gap_to_leader_s;
    if (gap == null || !Number.isFinite(gap)) continue;
    const g = Math.max(0, gap);
    const lapsDown = Math.floor(g / lap + 1e-9);
    out.push({ code: car.code, fraction: gapToFraction(g, opts), lapped: lapsDown > 0, lapsDown, car });
  }
  return out;
}

// The rejoin ghost's fraction from its projected gap to the leader (e.g. rejoin.gapToLeader), same mapping as placeCars.
export function ghostAt(gapToLeaderS: number, opts: PlaceOptions): number {
  return gapToFraction(Math.max(0, gapToLeaderS), opts);
}

// The leaderFraction that puts a given car (by its gap to the leader) at `fraction` on the lap. Use it to hold the
// followed car on a readable stretch, as the mockups do (GAS at 0.22 of Marina Bay).
export function leaderFractionFor(fraction: number, gapToLeaderS: number, lapTimeS: number): number {
  const lap = lapTimeS > 0 ? lapTimeS : 1;
  return wrap01(fraction + Math.max(0, gapToLeaderS) / lap);
}

// ---------------------------------------------------------------------------------------------------------
// Map scene: dots and collision-free labels for a set of markers (pure; TrackMap renders it).

export type MapRole = "field" | "near" | "me" | "ghost" | "sc";

export interface MapMarker {
  code: string;
  fraction: number;
  role: MapRole;
  label?: string | null;
  prefer?: number; // preferred label direction in degrees (0 = right, 90 = below, 270 = above)
}

export type MapStyle = "host" | "phone";

export interface SceneOptions {
  style: MapStyle;
  k: number; // viewBox units per rendered px
  scale?: number; // extra size factor for the host style (the big replay map uses 1.15)
}

export interface SceneDot {
  code: string;
  role: MapRole;
  x: number;
  y: number;
  r: number;
}

export interface SceneLabel {
  code: string;
  role: MapRole;
  x: number; // centre
  y: number; // baseline
  fontSize: number;
  weight: 800 | 900;
  text: string;
  box: [number, number, number, number]; // x0, x1, y0, y1
}

export interface SceneStroke {
  edge: number; // outer stroke width (also the label keep-out band)
  asphalt: number;
  surface: number;
  centre: number;
  dash: [number, number];
}

export interface MapScene {
  u: (px: number) => number;
  strokes: SceneStroke;
  start: { x: number; y: number; angle: number; w: number; h: number };
  halos: { x: number; y: number; r: number }[];
  dots: SceneDot[];
  labels: SceneLabel[];
  dotStroke: Record<MapRole, number>;
}

// Rendered px per role (radius), per style. Host values are trackgen.py's; phone values match the phone mockups.
const RADIUS: Record<MapStyle, Record<MapRole, number>> = {
  host: { field: 4.5, near: 6.5, me: 8.5, ghost: 8, sc: 8 },
  phone: { field: 4, near: 5.5, me: 7, ghost: 7.5, sc: 6.5 },
};
const DOT_STROKE: Record<MapStyle, Record<MapRole, number>> = {
  host: { field: 1.5, near: 2, me: 2.6, ghost: 2, sc: 1.5 },
  phone: { field: 1, near: 1.5, me: 2.2, ghost: 2, sc: 1 },
};
const LABEL_PX: Record<MapStyle, { small: number; big: number }> = {
  host: { small: 13, big: 17 },
  phone: { small: 12, big: 12 },
};
const ORDER: Record<MapRole, number> = { field: 0, near: 2, sc: 3, ghost: 4, me: 6 };

export function buildScene(g: TrackGeometry, markers: readonly MapMarker[], opts: SceneOptions): MapScene {
  const scale = opts.style === "host" ? (opts.scale ?? 1) : 1;
  const u = (px: number) => px * opts.k * scale;
  const strokes: SceneStroke =
    opts.style === "host"
      ? { edge: u(13), asphalt: u(11), surface: u(6.5), centre: u(0.9), dash: [u(4), u(5)] }
      : { edge: u(8), asphalt: u(8), surface: u(4.5), centre: u(0.75), dash: [0, 0] };

  // Start/finish: a chequered strip across the track at fraction 0.
  const s0 = pointAt(g, 0);
  const start = { x: s0.x, y: s0.y, angle: (Math.atan2(s0.ty, s0.tx) * 180) / Math.PI, w: u(6), h: u(17) };

  const R = RADIUS[opts.style];
  const placed = markers.map((m) => ({ m, p: pointAt(g, m.fraction) }));
  const obstacles = placed.map(({ m, p }) => ({ x: p.x, y: p.y, r: u(R[m.role]) + u(2) }));
  const halos = placed.filter(({ m }) => m.role === "me").map(({ p }) => ({ x: p.x, y: p.y, r: u(opts.style === "host" ? 15 : 13) }));
  const sorted = [...placed].sort((a, b) => ORDER[a.m.role] - ORDER[b.m.role]);
  const dots: SceneDot[] = sorted.map(({ m, p }) => ({ code: m.code, role: m.role, x: p.x, y: p.y, r: u(R[m.role]) }));

  const labels: SceneLabel[] = [];
  const [vx, vy, vw, vh] = g.vb;
  const lp = LABEL_PX[opts.style];
  for (const { m, p } of sorted) {
    if (!m.label) continue;
    const big = m.role === "me";
    const r = u(R[m.role]);
    const fs = u(big ? lp.big : lp.small);
    const text = m.label;
    const tw = fs * 0.5 * text.length + fs * 0.08 * text.length; // condensed caps estimate incl. letter-spacing
    const th = fs * 0.72;
    // Rendered SVG text boxes run larger than this estimate (mixed case, ascent/descent), so keep labels
    // apart with a padded box when testing against each other.
    const padX = fs * 0.25 * text.length * 0.5 + u(6);
    const padY = fs * 0.35 + u(4);
    const gap = u(5) + (big ? (u(18) - r) * 0.35 : 0);
    let best: { pen: number; cx: number; cy: number; box: [number, number, number, number] } | null = null;
    for (let deg = 0; deg < 360; deg += 15) {
      const a = (deg * Math.PI) / 180;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const cx = p.x + dx * (r + gap + (tw / 2) * Math.abs(dx));
      const cy = p.y + dy * (r + gap + (th / 2) * Math.abs(dy));
      const bx0 = cx - tw / 2;
      const bx1 = cx + tw / 2;
      const by0 = cy - th / 2;
      const by1 = cy + th / 2;
      let pen = 0;
      const lim = strokes.edge / 2 + u(2);
      for (let i = 0; i <= 6; i++) {
        for (let j = 0; j <= 2; j++) {
          const dd = distanceToTrack(g, [bx0 + ((bx1 - bx0) * i) / 6, by0 + ((by1 - by0) * j) / 2]);
          if (dd < lim) pen += (lim - dd) * 3;
        }
      }
      for (const o of obstacles) {
        const nx = Math.max(bx0, Math.min(o.x, bx1));
        const ny = Math.max(by0, Math.min(o.y, by1));
        const dd = Math.hypot(o.x - nx, o.y - ny);
        if (dd < o.r + u(2)) pen += (o.r + u(2) - dd) * 6;
      }
      for (const l of labels) {
        const [lx0, lx1, ly0, ly1] = l.box;
        const ix = Math.max(0, Math.min(bx1 + padX, lx1) - Math.max(bx0 - padX, lx0) + u(3));
        const iy = Math.max(0, Math.min(by1 + padY, ly1) - Math.max(by0 - padY, ly0) + u(3));
        if (ix > 0 && iy > 0) pen += u(400) + ix * iy * 8; // labels must never touch each other
      }
      if (bx0 < vx + u(2) || by0 < vy + u(2) || bx1 > vx + vw - u(2) || by1 > vy + vh - u(2)) pen += 1e5;
      if (m.prefer != null) pen += (1 - Math.cos(a - (m.prefer * Math.PI) / 180)) * u(6);
      if (deg % 90) pen += u(0.4);
      if (!best || pen < best.pen) best = { pen, cx, cy, box: [bx0, bx1, by0, by1] };
    }
    if (best) {
      labels.push({ code: m.code, role: m.role, x: best.cx, y: best.cy + fs * 0.36, fontSize: fs, weight: big ? 900 : 800, text, box: best.box });
    }
  }
  const ds = DOT_STROKE[opts.style];
  const dotStroke = { field: u(ds.field), near: u(ds.near), me: u(ds.me), ghost: u(ds.ghost), sc: u(ds.sc) };
  return { u, strokes, start, halos, dots, labels, dotStroke };
}
