import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PhonePreview } from "./PhonePreview";

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense>
      <PhonePreview />
    </Suspense>
  );
}
