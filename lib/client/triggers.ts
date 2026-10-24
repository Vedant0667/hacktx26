// Why a race freeze happened, in plain words. The engine writes each trigger's `info` as a terse line with
// model terms ("medium 23 laps (+1 this lap) vs expected 24 (prior)"); this pulls the numbers out and
// rewrites them with COPY.triggerInfo. Anything it cannot read is dropped rather than shown raw.
// Safety car and VSC return null: the chip and the yellow strip already say it.
import { COPY } from "@/lib/copy";

export function triggerText(type: string, info: string, me: string): string | null {
  let m: RegExpMatchArray | null;
  switch (type) {
    case "SC":
    case "VSC":
      return null;
    case "RIVAL_STOP":
      // "pitted lap 23: NOR +1.2s, HAM -0.8s (pit loss 21.0s, measured)"
      if ((m = info.match(/^pitted lap (\d+): ([^(]+)/))) {
        const codes = m[2].split(",").map((x) => x.trim().split(/\s+/)[0]).filter(Boolean);
        return codes.length ? COPY.triggerInfo.rival(codes, Number(m[1])) : null;
      }
      return null;
    case "UNDERCUT":
      // "1.2s behind NOR (tyres 20 vs our 12 laps) < 2-lap fresh gain 2.0s (0.95s/lap, ...)"
      if ((m = info.match(/^([\d.]+)s behind (\w+) \(tyres (\d+) vs our (\d+) laps\) < 2-lap fresh gain ([\d.]+)s/)))
        return COPY.triggerInfo.undercut(m[1], m[2], Number(m[3]), me, Number(m[4]), m[5]);
      return null;
    case "FAST_DEG":
      // "last 3 laps +0.85s vs stint base laps ..."
      if ((m = info.match(/^last 3 laps \+([\d.]+)s/))) return COPY.triggerInfo.deg(Number(m[1]).toFixed(1));
      return null;
    case "TYRE_WINDOW":
      // "medium 23 laps (+1 this lap) vs expected 24 (prior)"
      if ((m = info.match(/^(\w+) (\d+) laps .*expected (\d+)/))) return COPY.triggerInfo.window(me, m[1], Number(m[2]), Number(m[3]));
      return null;
    case "RAIN":
      // "rainfall 0->1 on lap 12"
      if ((m = info.match(/^rainfall ([\d.]+)->([\d.]+) on lap (\d+)/))) return COPY.triggerInfo.rain(Number(m[2]) > Number(m[1]), Number(m[3]));
      return null;
    default:
      return null;
  }
}
