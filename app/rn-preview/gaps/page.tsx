// Development-only preview of the Race Night gap views: phone calls-locked beat, phone scoring wait, and the
// host mute / Continue controls inside the real replay and freeze views (blind data from lib/data.ts).
// Query: v=locked|scoring|replay|freeze. locked: left=<s>, team=<hex|none>. scoring: ms=<elapsed>, failed=1.
// replay/freeze: muted=1, s=simple|advanced (freeze), q=1 (quick moment layout), d=<decision id>.
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getBlindDecision, getBlindFrames, getIndex } from "@/lib/data";
import type { BlindDecision } from "@/lib/client/api";
import type { LapFrame } from "@/lib/types";
import { GapsPreview } from "./Preview";

async function Loader() {
  const index = (await getIndex()) ?? [];
  const all = await Promise.all(index.map(async (x) => ({ id: x.id, decision: await getBlindDecision(x.id), frames: await getBlindFrames(x.id) })));
  const fixtures = all.filter((x) => !!x.decision && !!x.frames) as unknown as { id: string; decision: BlindDecision; frames: LapFrame[] }[];
  return <GapsPreview fixtures={fixtures} />;
}

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <Loader />
    </Suspense>
  );
}
