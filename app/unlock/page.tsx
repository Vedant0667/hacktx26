import { safeNext } from "@/lib/gate";
import { GATE_COPY } from "@/lib/copy-gate";

// Test-deployment gate. Posts to /api/unlock, which sets the cookie and sends the visitor back to `next`.
export default async function UnlockPage({ searchParams }: PageProps<"/unlock">) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : "/");
  const failed = params.error === "1";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
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
        {failed && <p className="text-16 text-flag-red" role="alert">{GATE_COPY.wrong}</p>}
        <button type="submit" className="bg-flag-yellow px-4 py-3 text-20 font-bold text-bg">
          {GATE_COPY.submit}
        </button>
      </form>
    </main>
  );
}
