import { HomeSwitch } from "@/components/rn/home/HomeSwitch";
import { getIndex } from "@/lib/data";

async function loadIndex() {
  "use cache";
  return (await getIndex()) ?? [];
}

export default async function Page() {
  const index = await loadIndex();
  return <HomeSwitch index={index} />;
}
