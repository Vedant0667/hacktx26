"use client";
// Dev-only preview of the Race Night phone end. ?s=win|mid|moment|nocall & v=summary|calls|everyone
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { RNPhoneSummary } from "@/components/rn/phone-end/PhoneEnd";
import { FIXTURE, FIXTURE_MOMENT } from "@/components/rn/phone-end/fixtures";

function Inner() {
  const q = useSearchParams();
  const s = q.get("s") ?? "win";
  const v = (q.get("v") ?? "summary") as "summary" | "calls" | "everyone";
  const summary = s === "moment" ? FIXTURE_MOMENT : FIXTURE;
  const me = s === "mid" ? "Priya" : s === "moment" ? "Alexandria Longname" : s === "nocall" ? "Nobody" : "Vedant";
  return <RNPhoneSummary key={`${s}${v}`} summary={summary} me={me} initialView={v} />;
}

export default function Preview() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
