import { Suspense } from "react";
import { PlayScreen } from "@/components/play/PlayScreen";

export default function Page({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense fallback={null}>
      {params.then(({ code }) => (
        <PlayScreen code={code.toUpperCase()} />
      ))}
    </Suspense>
  );
}
