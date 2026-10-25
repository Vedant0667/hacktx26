// Development-only preview of the T1b host freeze views, from real blind data (lib/data.ts blind loaders).
// Query: s=simple|advanced|locked, st=GREEN|SC|VSC (override), left=<s>, n=<players>, long=1, d=<decision id>.
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getBlindDecision, getBlindFrames, getIndex } from "@/lib/data";
import type { BlindDecision } from "@/lib/client/api";
import type { LapFrame } from "@/lib/types";
import { Preview } from "./Preview";

async function Loader() {
  const index = (await getIndex()) ?? [];
  const all = await Promise.all(index.map(async (x) => ({ id: x.id, decision: await getBlindDecision(x.id), frames: await getBlindFrames(x.id) })));
  const fixtures = all.filter((x) => !!x.decision && !!x.frames) as unknown as { id: string; decision: BlindDecision; frames: LapFrame[] }[];
  return <Preview fixtures={fixtures} />;
}

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <Loader />
    </Suspense>
  );
}
