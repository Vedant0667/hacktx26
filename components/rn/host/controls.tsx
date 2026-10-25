"use client";
// Race Night host controls passed into the replay and freeze views by the containers (RaceHost, HostScreen):
// the mute toggle and small action buttons such as Continue. Same accessible names and aria-pressed as the
// legacy <Button>s they replace; only the look changes (kit SkewButton, compact host size).
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { COPY } from "@/lib/copy";
import { SkewButton } from "../kit";
import "./controls.css";

// tone: "dark" sits on the dark ground (outlined), "slab" sits on the team slab (solid black).
export type RNControlTone = "dark" | "slab";

export function RNControlButton({
  tone = "dark",
  icon,
  children,
  className,
  ...rest
}: { tone?: RNControlTone; icon?: ReactNode; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <SkewButton
      {...rest}
      variant={tone === "slab" ? "dark" : "secondary"}
      size="host-sm"
      shadow="none"
      icon={icon}
      className={["rnhc", className].filter(Boolean).join(" ")}
      data-tone={tone}
    >
      {children}
    </SkewButton>
  );
}

export function RNMuteButton({ muted, onToggle, tone = "dark" }: { muted: boolean; onToggle: () => void; tone?: RNControlTone }) {
  return (
    <RNControlButton tone={tone} aria-pressed={muted} onClick={onToggle} icon={<SpeakerGlyph muted={muted} />}>
      {muted ? COPY.cue.unmute : COPY.cue.mute}
    </RNControlButton>
  );
}

// Speaker with sound waves (sound on) or a cross (muted). Decorative: the label carries the meaning.
function SpeakerGlyph({ muted }: { muted: boolean }) {
  return (
    <svg className="rnhc-ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" aria-hidden>
      <path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="M16 9l5 6M21 9l-5 6" />
      ) : (
        <>
          <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
          <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
        </>
      )}
    </svg>
  );
}
