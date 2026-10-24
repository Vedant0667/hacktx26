import { LeaderboardScreen } from "@/components/LeaderboardScreen";
import { getIndex } from "@/lib/data";

async function loadIndex() {
  "use cache";
  return (await getIndex()) ?? [];
}

export default async function Page() {
  const index = await loadIndex();
  return <LeaderboardScreen index={index} />;
}
