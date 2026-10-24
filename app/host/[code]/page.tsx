import { Suspense } from "react";
import { HostScreen } from "@/components/host/HostScreen";

export default function Page({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense fallback={null}>
      {params.then(({ code }) => (
        <HostScreen code={code.toUpperCase()} />
      ))}
    </Suspense>
  );
}
