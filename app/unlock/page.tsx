import { Suspense } from "react";
import { gateMisconfigured, safeNext } from "@/lib/gate";
import { GATE_COPY } from "@/lib/copy-gate";

// Test-deployment gate. Posts to /api/unlock, which sets the cookie and sends the visitor back to `next`.
// searchParams is request data, so it is read inside a Suspense boundary (cacheComponents prerenders the shell).
export default function UnlockPage({ searchParams }: PageProps<"/unlock">) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <Suspense fallback={null}>
        <UnlockForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function UnlockForm({ searchParams }: { searchParams: PageProps<"/unlock">["searchParams"] }) {
  const params = await searchParams;
  if (gateMisconfigured()) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-32 font-bold">{GATE_COPY.title}</h1>
        <p className="text-16 text-flag-red" role="alert">{GATE_COPY.misconfigured}</p>
      </div>
    );
  }
  const next = safeNext(typeof params.next === "string" ? params.next : "/");
  const error = params.error === "1" ? GATE_COPY.wrong : params.error === "2" ? GATE_COPY.limited : null;

  return (
    <form method="post" action="/api/unlock" className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-32 font-bold">{GATE_COPY.title}</h1>
      <p className="text-16 text-ink-2">{GATE_COPY.body}</p>
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-2 text-16 font-semibold">
        {GATE_COPY.label}
        <input
          type="password"
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          className="border border-rule bg-surface px-4 py-3 text-20 text-ink outline-none focus:border-flag-yellow"
        />
      </label>
      {error && <p className="text-16 text-flag-red" role="alert">{error}</p>}
      <button type="submit" className="bg-flag-yellow px-4 py-3 text-20 font-bold text-bg">
        {GATE_COPY.submit}
      </button>
    </form>
  );
}
