import { notFound } from "next/navigation";
import { CallPreview } from "./CallPreview";

// Development-only preview of every Race Night call pad state (?s=<state>&mode=advanced).
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CallPreview />;
}
