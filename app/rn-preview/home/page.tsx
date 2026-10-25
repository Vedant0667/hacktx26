// Development-only preview of the Race Night home (H01) on real race data. Same loader as app/page.tsx.
import { notFound } from "next/navigation";
import { RNHomeScreen } from "@/components/rn/home/RNHomeScreen";
import { getIndex } from "@/lib/data";

export default async function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  const index = (await getIndex()) ?? [];
  return <RNHomeScreen index={index} />;
}
