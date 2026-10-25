import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Preview } from "./Preview";

async function Body({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { s } = await searchParams;
  return <Preview state={s ?? "lobby"} />;
}

export default function Page({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
