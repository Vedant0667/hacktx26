// Unit checks for the track geometry, car placement and map label layout: `npx tsx lib/tracks.check.ts`.
import assert from "node:assert/strict";
import { TRACKS, buildScene, distanceToTrack, gapToFraction, geometry, leaderFractionFor, parsePath, placeCars, pointAt, trackFor, wrap01, type MapMarker } from "./tracks";

const near = (a: number, b: number, eps = 1e-6, msg = "") => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

// Outlines and lookup
assert.equal(trackFor("2026-singapore")?.key, "sg-2008");
assert.equal(trackFor("singapore-2026-vsc")?.key, "sg-2008");
assert.equal(trackFor("2025-qatar")?.key, "qa-2004");
assert.equal(trackFor("2024-qatar")?.key, "qa-2004");
assert.equal(trackFor("qatar-2025-l7")?.key, "qa-2004");
assert.equal(trackFor("monaco-2026"), null);
assert.equal(trackFor(null), null);

for (const t of Object.values(TRACKS)) {
  const pts = parsePath(t.d);
  assert.ok(pts.length > 100, `${t.key} has its points`);
  assert.deepEqual(pts[0], pts[pts.length - 1], `${t.key} path is closed`);
  near(pts[0][0], t.start[0], 0.05, `${t.key} start x`);
  near(pts[0][1], t.start[1], 0.05, `${t.key} start y`);
  const g = geometry(t);
  for (let i = 1; i < g.cum.length; i++) assert.ok(g.cum[i] >= g.cum[i - 1], "cumulative length is monotonic");
  assert.ok(g.length > 2000, `${t.key} length ${g.length}`);
  // pointAt: 0 and 1 are the line, it wraps both ways, and every point sits on the outline.
  const p0 = pointAt(g, 0);
  near(p0.x, t.start[0], 0.05);
  near(p0.y, t.start[1], 0.05);
  const p1 = pointAt(g, 1);
  near(p1.x, p0.x, 1e-9);
  near(p1.y, p0.y, 1e-9);
  const a = pointAt(g, -0.25);
  const b = pointAt(g, 0.75);
  near(a.x, b.x, 1e-9);
  near(a.y, b.y, 1e-9);
  for (let f = 0; f < 1; f += 0.037) {
    const p = pointAt(g, f);
    assert.ok(distanceToTrack(g, [p.x, p.y]) < 1e-6, `point at ${f} is on the path`);
    near(Math.hypot(p.tx, p.ty), 1, 1e-6, "unit tangent");
  }
}

// Simple synthetic square: perimeter 400, fraction 0.25 is the second corner.
{
  const sq = { key: "sg-2008" as const, name: "sq", lengthM: 400, viewBox: "0 0 100 100", start: [0, 0] as [number, number], d: "M0 0 L100 0 L100 100 L0 100 Z" };
  const pts = parsePath(sq.d);
  assert.equal(pts.length, 5, "closing point appended");
  const g = geometry(sq);
  near(g.length, 400);
  const q = pointAt(g, 0.25);
  near(q.x, 100);
  near(q.y, 0);
  const m = pointAt(g, 0.375);
  near(m.x, 100);
  near(m.y, 50);
  near(m.tx, 0);
  near(m.ty, 1);
}

// Car placement from gaps
near(wrap01(-0.25), 0.75);
near(wrap01(1.5), 0.5);
{
  const cars = [
    { code: "LEA", gap_to_leader_s: 0 },
    { code: "QTR", gap_to_leader_s: 25 },
    { code: "LAP", gap_to_leader_s: 125 }, // 1.25 laps down
    { code: "TWO", gap_to_leader_s: 200 }, // exactly 2 laps down
    { code: "DNF", gap_to_leader_s: null },
  ];
  const placed = placeCars(cars, { lapTimeS: 100, leaderFraction: 0.1 });
  assert.deepEqual(
    placed.map((p) => p.code),
    ["LEA", "QTR", "LAP", "TWO"],
    "cars with no gap are left out",
  );
  const by = Object.fromEntries(placed.map((p) => [p.code, p]));
  near(by.LEA.fraction, 0.1);
  near(by.QTR.fraction, 0.85); // 0.1 - 0.25 wrapped
  near(by.LAP.fraction, 0.85); // wraps a whole lap: physically level with QTR
  assert.equal(by.LAP.lapped, true);
  assert.equal(by.LAP.lapsDown, 1);
  assert.equal(by.QTR.lapped, false);
  near(by.TWO.fraction, 0.1);
  assert.equal(by.TWO.lapsDown, 2);
  assert.equal(by.LEA.car, cars[0], "the source row rides along");
  // default leader on the line
  near(placeCars([{ code: "A", gap_to_leader_s: 10 }], { lapTimeS: 100 })[0].fraction, 0.9);
  near(gapToFraction(50, { lapTimeS: 100, leaderFraction: 0 }), 0.5);
  // leaderFractionFor holds a chosen car at a chosen spot
  const lf = leaderFractionFor(0.22, 47.5, 99);
  near(placeCars([{ code: "GAS", gap_to_leader_s: 47.5 }], { lapTimeS: 99, leaderFraction: lf })[0].fraction, 0.22);
}

// Map scene: the H04 freeze map (352 px wide, Marina Bay, VSC) must come out where the approved mockup put it.
{
  const g = geometry(TRACKS["sg-2008"]);
  const speed = 3111 / 99; // trackgen.py SG_SPEED, viewBox units per second
  const meS = 684.5;
  const at = (t: number) => (meS - t * speed) / g.length;
  const m = (code: string, t: number, role: MapMarker["role"], label: string | null = null, prefer?: number): MapMarker => ({ code, fraction: at(t), role, label, prefer });
  const markers: MapMarker[] = [
    m("GAS", 0, "me", "GAS", 270),
    m("HUL", -1.5, "near", "HUL", 270),
    m("BEA", 5.8, "near", "BEA", 90),
    m("ALO", -3.0, "field"),
    m("NOR", -3.9, "field"),
    m("OCO", 7.0, "field", "OCO", 270),
    m("P6", -9.5, "field"),
    m("P5", -14.0, "field"),
    m("P4", -21.0, "field"),
    m("P3", -26.5, "field"),
    m("P2", -33.0, "field"),
    m("P1", -38.5, "field"),
    m("ghost", 12.6, "ghost", "BOX: REJOIN P12", 90),
  ];
  const scene = buildScene(g, markers, { style: "host", k: 1000 / 352 });
  near(scene.strokes.edge, 36.9, 0.06, "edge stroke");
  const dot = (c: string) => scene.dots.find((d) => d.code === c)!;
  const lab = (c: string) => scene.labels.find((l) => l.code === c)!;
  // Mockup H04: GAS (488.2, 412.1) r 24.1; HUL (441.2, 408.8); BEA (670.2, 421.9); ghost (850.4, 481.8).
  // Matches the mockup to the printed 0.1.
  near(dot("GAS").x, 488.2, 0.15, "GAS x");
  near(dot("GAS").y, 412.1, 0.15, "GAS y");
  near(dot("GAS").r, 24.1, 0.06, "GAS r");
  near(dot("HUL").x, 441.2, 0.15, "HUL x");
  near(dot("BEA").x, 670.2, 0.15, "BEA x");
  near(dot("ghost").x, 850.4, 0.15, "ghost x");
  near(dot("ghost").y, 481.8, 0.15, "ghost y");
  // Labels: GAS (522.6, 483.9), HUL (451.8, 378.1), BEA (670.2, 481.2), OCO (717, 398.6), ghost (830.1, 543.2).
  for (const [c, x, y] of [
    ["GAS", 522.6, 483.9],
    ["HUL", 451.8, 378.1],
    ["BEA", 670.2, 481.2],
    ["OCO", 717, 398.6],
    ["ghost", 830.1, 543.2],
  ] as const) {
    near(lab(c).x, x, 0.15, `${c} label x`);
    near(lab(c).y, y, 0.15, `${c} label y`);
  }
  // Every label inside the viewBox, no two labels overlapping, no label over a dot.
  const [vx, vy, vw, vh] = g.vb;
  for (const l of scene.labels) {
    const [x0, x1, y0, y1] = l.box;
    assert.ok(x0 >= vx && y0 >= vy && x1 <= vx + vw && y1 <= vy + vh, `${l.code} label inside the map`);
    for (const o of scene.labels) {
      if (o === l) continue;
      const ix = Math.min(x1, o.box[1]) - Math.max(x0, o.box[0]);
      const iy = Math.min(y1, o.box[3]) - Math.max(y0, o.box[2]);
      assert.ok(ix <= 0 || iy <= 0, `${l.code} and ${o.code} labels overlap`);
    }
    for (const d of scene.dots) {
      const nx = Math.max(x0, Math.min(d.x, x1));
      const ny = Math.max(y0, Math.min(d.y, y1));
      assert.ok(Math.hypot(d.x - nx, d.y - ny) >= d.r, `${l.code} label covers ${d.code}`);
    }
  }
  // Deterministic.
  assert.deepEqual(buildScene(g, markers, { style: "host", k: 1000 / 352 }).labels, scene.labels);
  // Phone style places labels inside too.
  const phone = buildScene(g, markers, { style: "phone", k: 1000 / 212 });
  for (const l of phone.labels) assert.ok(l.box[0] >= vx && l.box[2] >= vy && l.box[1] <= vx + vw && l.box[3] <= vy + vh, `${l.code} phone label inside`);
}

// Losail with a full 20-car field from gaps: all placed, labels inside.
{
  const g = geometry(TRACKS["qa-2004"]);
  const field = Array.from({ length: 20 }, (_, i) => ({ code: `C${i + 1}`, gap_to_leader_s: i === 0 ? 0 : i * 1.3 + (i > 15 ? 90 : 0) }));
  const placed = placeCars(field, { lapTimeS: 85, leaderFraction: 0.3 });
  assert.equal(placed.length, 20);
  assert.ok(placed.filter((p) => p.lapped).length === 4, "four cars a lap down");
  const markers: MapMarker[] = placed.map((p, i) => ({ code: p.code, fraction: p.fraction, role: i === 0 ? "sc" : i === 1 ? "me" : i < 4 ? "near" : "field", label: i < 4 && i > 0 ? p.code : null }));
  const scene = buildScene(g, markers, { style: "host", k: 862 / 334 });
  assert.equal(scene.dots.length, 20);
  for (const l of scene.labels) assert.ok(l.box[0] >= 0 && l.box[2] >= 0 && l.box[1] <= 862 && l.box[3] <= 1000, `${l.code} inside Losail`);
}

console.log("tracks.check: ok");
