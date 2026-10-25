import { Suspense } from "react";
import { notFound } from "next/navigation";
import { EndPreview } from "./EndPreview";

type SP = Promise<Record<string, string | string[] | undefined>>;

async function View({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return <EndPreview v={typeof sp.v === "string" ? sp.v : "race"} />;
}

// Development-only preview of the Race Night host end views: ?v=scoring|scoring-moments|race|race12|moment
export default function Page({ searchParams }: { searchParams: SP }) {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <View searchParams={searchParams} />
    </Suspense>
  );
}
