// Development-only visual check for the Race Night kit (components/rn/kit.tsx) and TrackMap. Behind the password
// gate like every page (proxy.ts). Not built into production: notFound() there.
import { notFound } from "next/navigation";
import { Banner, Countdown, GapValue, Label, Logo, ModeTabs, Num, OutlineNumber, RNRoot, RN_KIT_COPY, SkewButton, SkewChip, Slab, StartLights, TowerRow, TyreBadge } from "@/components/rn/kit";
import { TrackMap } from "@/components/rn/TrackMap";
import { TRACKS, geometry, ghostAt, leaderFractionFor, placeCars } from "@/lib/tracks";

// Sample field from the mockup scenario (Singapore 2026, lap 39, VSC). Gaps to the leader in seconds.
const LAP_S = 99;
const FIELD = [
  { code: "VER", gap_to_leader_s: 0 },
  { code: "NOR", gap_to_leader_s: 5.5 },
  { code: "PIA", gap_to_leader_s: 12.5 },
  { code: "LEC", gap_to_leader_s: 18 },
  { code: "HAM", gap_to_leader_s: 24.5 },
  { code: "ANT", gap_to_leader_s: 29 },
  { code: "TSU", gap_to_leader_s: 34.5 },
  { code: "ALO", gap_to_leader_s: 35.4 },
  { code: "HUL", gap_to_leader_s: 36.9 },
  { code: "GAS", gap_to_leader_s: 38.4 },
  { code: "BEA", gap_to_leader_s: 44.2 },
  { code: "OCO", gap_to_leader_s: 45.4 },
];
const GAS_AT = 684.5 / geometry(TRACKS["sg-2008"]).length; // where the mockups hold GAS
const LF = leaderFractionFor(GAS_AT, 38.4, LAP_S);
const CARS = placeCars(FIELD, { lapTimeS: LAP_S, leaderFraction: LF });
const GHOST = { fraction: ghostAt(38.4 + 12.6, { lapTimeS: LAP_S, leaderFraction: LF }), label: "BOX: REJOIN P12" };
const ALPINE = "#2B9BD8";

function HostFreeze() {
  return (
    <RNRoot team={ALPINE} style={{ position: "relative", width: 1280, height: 720, overflow: "hidden" }} data-frame="host-1280">
      <Slab style={{ left: 700, top: -40, width: 800, height: 820 }} />
      <Banner kind="vsc" text="Virtual safety car" size="host" style={{ position: "absolute", left: 0, right: 0, top: 0 }} />
      <Logo size="host" style={{ position: "absolute", left: 56, top: 60 }} />
      <div style={{ position: "absolute", left: 56, top: 116, width: 560 }}>
        <StartLights left={17} size="host" />
        <div style={{ display: "flex", alignItems: "flex-end", gap: 28, marginTop: 12 }}>
          <Countdown left={17} size="host" />
          <span style={{ paddingBottom: 4 }}>
            <span className="rn-d rn-num" style={{ display: "block", fontWeight: 900, fontSize: 26, lineHeight: 1 }}>
              4 OF 6 CALLED
            </span>
            <span style={{ display: "block", fontSize: 15, color: "var(--rn-muted)", marginTop: 4 }}>Waiting on Ekb, Priya</span>
          </span>
        </div>
        <Label as="div" style={{ marginTop: 32 }}>
          Lap 39 / 62 · Singapore · Call 4 of 4
        </Label>
        <h1 className="rn-display" style={{ marginTop: 8, fontSize: 64 }}>
          Gasly P10.
          <br />
          Box or stay out?
        </h1>
        <SkewChip tone="solid" style={{ marginTop: 20, marginLeft: 6, height: "auto", padding: "6px 18px" }}>
          <span className="rn-d rn-num" style={{ fontWeight: 900, fontSize: 26, lineHeight: 1.1 }}>
            88
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.04em", marginLeft: 6 }}>PTS AT STAKE</span>
          </span>
        </SkewChip>
      </div>
      <div style={{ position: "absolute", left: 672, top: 94, width: 552, height: 410, padding: "20px 24px", background: "var(--rn-ground)" }}>
        <div style={{ display: "flex", gap: 16 }}>
          <TrackMap track="sg-2008" cars={CARS} followed="GAS" near={["HUL", "BEA"]} labelled={["OCO"]} ghost={GHOST} caution size="host" ariaLabel="Marina Bay map under the VSC. GAS P10; a stop now rejoins P12." />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", minWidth: 0 }}>
            <div>
              <Label as="div" tone="yellow">
                Race control
              </Label>
              <div style={{ fontWeight: 700, fontSize: 17, lineHeight: 1.3, marginTop: 6 }}>VSC deployed</div>
              <div style={{ fontSize: 15, color: "var(--rn-muted)", marginTop: 2 }}>Lap 38</div>
            </div>
            <ModeTabs mode="simple" variant="underline" />
          </div>
        </div>
        <div style={{ display: "flex", gap: 24, marginTop: 18 }}>
          <div style={{ width: 292 }}>
            <Label as="div">Gap to GAS · trend</Label>
            {[
              { pos: "P9", code: "HUL", tc: "#BB0A30", c: "SOFT", age: 9, d: -1.5 },
              { pos: "P11", code: "BEA", tc: "#B6BABD", c: "MEDIUM", age: 6, d: 5.8 },
            ].map((r) => (
              <div key={r.code} style={{ display: "flex", alignItems: "center", gap: 7, height: 36, borderBottom: "1px solid var(--rn-line)" }}>
                <span className="rn-d rn-num" style={{ width: 30, fontWeight: 800, fontSize: 17 }}>
                  {r.pos}
                </span>
                <span style={{ width: 4, height: 20, background: r.tc }} />
                <span className="rn-d" style={{ width: 38, fontWeight: 900, fontSize: 20 }}>
                  {r.code}
                </span>
                <TyreBadge compound={r.c} age={r.age} ageStyle={{ width: 24, fontSize: 15 }} />
                <GapValue delta={r.d} size={20} style={{ width: 52, textAlign: "right" }} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <SkewButton variant="secondary" size="host-xl" sub={<>Keep P10<br />on 10-lap softs</>} style={{ position: "absolute", left: 67, top: 556, width: 546 }}>
        Stay out
      </SkewButton>
      <SkewButton variant="primary" size="host-xl" sub={<>Rejoin P12, 5.6 s behind OCO<br />new tyres for 23 laps</>} style={{ position: "absolute", left: 667, top: 556, width: 546 }}>
        Box
      </SkewButton>
    </RNRoot>
  );
}

function PhoneCall() {
  return (
    <RNRoot team={ALPINE} style={{ position: "relative", width: 390, height: 844, overflow: "hidden", display: "flex", flexDirection: "column" }} data-frame="phone-390">
      <Slab style={{ left: 64, top: 96, width: 420, height: 140 }} />
      <Banner kind="vsc" text="Virtual safety car" size="phone" />
      <div style={{ position: "relative", height: 60, display: "flex", alignItems: "center", gap: 12, padding: "0 24px" }}>
        <StartLights left={17} size="phone" />
        <Countdown left={17} size="phone" />
        <ModeTabs mode="simple" variant="segment" style={{ marginLeft: "auto" }} />
      </div>
      <div style={{ position: "relative", height: 140, padding: "20px 24px 0 80px", color: "var(--on-team)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Label tone="ink">GAS P10 · Up to 88 pts</Label>
          <Logo size="phone-sm" />
        </div>
        <h1 className="rn-display" style={{ marginTop: 8, fontSize: 50, lineHeight: 0.88 }}>
          Box or
          <br />
          stay out?
        </h1>
      </div>
      <section style={{ position: "relative", padding: "18px 24px 0" }}>
        {[
          { side: "Ahead", code: "HUL", c: "SOFT", age: 9, d: -1.5 },
          { side: "Behind", code: "BEA", c: "MEDIUM", age: 6, d: 5.8 },
        ].map((r) => (
          <div key={r.code} style={{ display: "flex", alignItems: "center", gap: 10, height: 36 }}>
            <Label style={{ width: 58 }}>{r.side}</Label>
            <span className="rn-d" style={{ fontWeight: 900, fontSize: 20, width: 38 }}>
              {r.code}
            </span>
            <TyreBadge compound={r.c} age={r.age} ageStyle={{ width: 26, color: "var(--rn-muted)", fontWeight: 600 }} />
            <GapValue delta={r.d} size={22} style={{ marginLeft: "auto" }} />
          </div>
        ))}
      </section>
      <section style={{ position: "relative", margin: "14px 24px 0", display: "flex", alignItems: "center", gap: 14 }}>
        <TrackMap track="sg-2008" cars={CARS} followed="GAS" near={["HUL", "BEA", "OCO"]} ghost={{ fraction: GHOST.fraction, label: "P12" }} caution size="phone" ariaLabel="Marina Bay under the VSC." />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Label as="div">If you box</Label>
          <Num value="P12" size={40} weight={900} style={{ display: "block", marginTop: 4 }} />
          <div style={{ fontSize: 14, color: "var(--rn-soft)", marginTop: 2 }}>5.6 s behind OCO</div>
          <Label as="div" style={{ marginTop: 12 }}>
            Pit loss
          </Label>
          <Num value="17.5" unit="s" size={22} />
        </div>
      </section>
      <div style={{ position: "relative", marginTop: "auto", padding: "0 30px 24px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
        <SkewButton variant="choice" size="phone" full sub={<>Keep P10 on<br />10-lap softs</>}>
          Stay out
        </SkewButton>
        <SkewButton variant="choice" size="phone" full selected sub={<>Rejoin P12, new<br />tyres for 23 laps</>}>
          Box
        </SkewButton>
        <div style={{ height: 6 }} />
        <div style={{ display: "flex", gap: 12 }}>
          <SkewButton variant="secondary" size="phone-sm" style={{ flex: 1.15 }}>
            Radio in
          </SkewButton>
          <SkewButton variant="secondary" size="phone-sm" aria-label="Type your reason instead" style={{ width: 56, flexShrink: 0, padding: 0 }}>
            Aa
          </SkewButton>
          <SkewButton variant="primary" size="phone-sm" style={{ flex: 1 }}>
            Send
          </SkewButton>
        </div>
      </div>
    </RNRoot>
  );
}

function Sheet() {
  const tower = [
    { pos: 7, code: "NOR", tc: "#FF8000", c: "MEDIUM", gap: -3.9 },
    { pos: 8, code: "ALO", tc: "#229971", c: "HARD", gap: -3.0 },
    { pos: 9, code: "HUL", tc: "#BB0A30", c: "SOFT", gap: -1.5 },
    { pos: 10, code: "GAS", tc: ALPINE, c: "SOFT", gap: 0, me: true },
    { pos: 11, code: "BEA", tc: "#B6BABD", c: "MEDIUM", gap: 5.8 },
  ];
  return (
    <RNRoot team={ALPINE} style={{ position: "relative", width: 1920, height: 1080, overflow: "hidden", padding: 56 }} data-frame="sheet-1920">
      <Slab style={{ left: 1500, top: -40, width: 700, height: 1200 }} />
      <OutlineNumber value={10} size={360} style={{ right: 64, bottom: -60 }} />
      <Logo size="host" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 440px)", gap: 48, marginTop: 32 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Label>Banners</Label>
          <Banner kind="vsc" text="Virtual safety car" size="host" />
          <Banner kind="sc" text="Safety car" size="host" />
          <Banner kind="red" text="Red flag" size="host" />
          <Banner kind="green" text="Green flag" size="host" />
          <Banner kind="chequered" size="host" />
          <Banner kind="chequered" text="Chequered flag · Singapore" size="phone" />
          <Label>Lights and countdown</Label>
          <div style={{ display: "flex", gap: 24, alignItems: "flex-end" }}>
            <div>
              <StartLights left={40} size="host-sm" />
              <Countdown left={40} size="host-sm" style={{ display: "block", marginTop: 10 }} />
            </div>
            <div>
              <StartLights left={4} size="host-sm" />
              <Countdown left={4} size="host-sm" style={{ display: "block", marginTop: 10 }} />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Label>Timing tower (host)</Label>
          <div>
            {tower.map((r) => (
              <TowerRow key={r.code} pos={r.pos} code={r.code} teamColour={r.tc} compound={r.c} me={r.me} gap={r.me ? RN_KIT_COPY.you : <GapValue delta={r.gap} unit={false} weight={800} size={17} />} size="host" />
            ))}
          </div>
          <Label>Tyres and numbers</Label>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            {["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"].map((c, i) => (
              <TyreBadge key={c} compound={c} age={i * 3 + 2} />
            ))}
            <TyreBadge compound="SOFT" size="lg" showAge={false} />
          </div>
          <div style={{ display: "flex", gap: 24, alignItems: "baseline" }}>
            <Num value="17.5" unit="s" size={40} weight={900} />
            <GapValue delta={-1.5} size={28} />
            <GapValue delta={5.8} size={28} />
          </div>
          <Label>Chips</Label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <SkewChip tone="solid">
              <span style={{ fontWeight: 700, fontSize: 16 }}>Vedant</span>
              <span className="rn-d" style={{ fontWeight: 800, fontSize: 12, letterSpacing: "0.06em" }}>
                CALLED
              </span>
            </SkewChip>
            <SkewChip tone="dashed">
              <span style={{ fontWeight: 700, fontSize: 16 }}>Ekb</span>
              <span className="rn-d" style={{ fontWeight: 800, fontSize: 12, color: "var(--rn-muted)" }}>
                thinking…
              </span>
            </SkewChip>
            <SkewChip tone="team">GAS</SkewChip>
            <SkewChip tone="panel">L22 BOX</SkewChip>
            <SkewChip tone="outline">1 MORE</SkewChip>
            <SkewChip tone="yellow">SAFETY CAR</SkewChip>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Label>Buttons</Label>
          <SkewButton variant="dark" size="host">
            Start race
          </SkewButton>
          <div style={{ display: "flex", gap: 20 }}>
            <SkewButton variant="primary" size="host-sm">
              Play again
            </SkewButton>
            <SkewButton variant="dark" size="host-sm">
              New lobby
            </SkewButton>
          </div>
          <SkewButton variant="primary" size="phone" full>
            Box now
          </SkewButton>
          <SkewButton variant="primary" size="phone" full disabled>
            Disabled
          </SkewButton>
          <Label>Mode tabs</Label>
          <ModeTabs mode="simple" variant="segment" />
          <ModeTabs mode="advanced" variant="split" />
          <ModeTabs mode="advanced" variant="underline" />
        </div>
      </div>
      <div style={{ position: "absolute", left: 56, top: 640, display: "flex", gap: 40, alignItems: "flex-end" }}>
        <div>
          <Label as="div">Replay map (host-lg, green)</Label>
          <TrackMap track="sg-2008" cars={CARS} followed="GAS" near={["HUL", "BEA"]} size="host-lg" width={560} ariaLabel="Marina Bay replay" pulse />
        </div>
        <div>
          <Label as="div">Losail (SC marker)</Label>
          <TrackMap track="qa-2004" cars={placeCars(FIELD, { lapTimeS: 85, leaderFraction: 0.12 })} followed="VER" near={["NOR"]} safetyCar={{ fraction: 0.16 }} caution size="host-sm" width={230} ariaLabel="Losail" team="#FF8000" />
        </div>
        <div>
          <Label as="div">Thumbs</Label>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ background: "#0F1115", padding: 8 }}>
              <TrackMap track="sg-2008" size="thumb" racingLine="#D5D8DE" ariaLabel="Marina Bay" />
            </div>
            <div style={{ background: "var(--team)", padding: 8, color: "#07080A" }}>
              <TrackMap track="sg-2008" size="thumb" variant="silhouette" width={200} ariaLabel="Marina Bay outline" />
            </div>
          </div>
        </div>
      </div>
    </RNRoot>
  );
}

function NeutralPhone() {
  return (
    <RNRoot neutral style={{ position: "relative", width: 390, height: 844, overflow: "hidden", display: "flex", flexDirection: "column" }} data-frame="phone-neutral">
      <div style={{ height: 64, display: "flex", alignItems: "center", padding: "0 24px" }}>
        <Logo size="phone" />
      </div>
      <div style={{ position: "relative", height: 232 }}>
        <Slab tone="neutral" style={{ left: 64, top: 0, width: 420, height: 232 }} />
        <div style={{ position: "relative", padding: "50px 24px 0 80px", color: "var(--on-team)" }}>
          <Label tone="ink">Join room</Label>
          <div className="rn-d" style={{ fontWeight: 900, fontSize: 120, lineHeight: 0.85 }}>
            DCFH
          </div>
        </div>
      </div>
      <div style={{ padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: 12 }}>
        <SkewButton variant="choice" size="phone" full selected style={{ ["--team" as string]: ALPINE }}>
          10 GAS
        </SkewButton>
        <SkewButton variant="choice" size="phone" full>
          1 NOR
        </SkewButton>
      </div>
      <div style={{ marginTop: "auto", padding: "0 30px 24px 24px" }}>
        <SkewButton variant="primary" size="phone" full>
          Join lobby
        </SkewButton>
      </div>
    </RNRoot>
  );
}

export default function RnKitPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div style={{ background: "#222", padding: 24, display: "flex", flexDirection: "column", gap: 24, width: "max-content" }}>
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <HostFreeze />
        <PhoneCall />
        <NeutralPhone />
      </div>
      <Sheet />
    </div>
  );
}
