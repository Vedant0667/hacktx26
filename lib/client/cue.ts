// Freeze cues: a synthesized two-tone on the host (no samples, no radio audio) and a phone buzz.
let ctx: AudioContext | null = null;

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function playFreezeTone() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    void ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    [880, 660].forEach((hz, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = "square";
      o.frequency.value = hz;
      const s = t0 + i * 0.22;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.12, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
      o.connect(g).connect(ctx!.destination);
      o.start(s);
      o.stop(s + 0.2);
    });
  } catch {}
}

export function buzzFreeze() {
  try {
    if (reduced()) return;
    navigator.vibrate?.([120, 80, 120]);
  } catch {}
}
