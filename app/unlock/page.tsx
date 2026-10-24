import { Suspense } from "react";
import { gateMisconfigured, safeNext } from "@/lib/gate";
import { GATE_COPY } from "@/lib/copy-gate";

// Test-deployment gate. Posts to /api/unlock, which sets the cookie and sends the visitor back to `next`.
// searchParams is request data, so it is read inside a Suspense boundary (cacheComponents prerenders the shell).
export default function UnlockPage({ searchParams }: PageProps<"/unlock">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col justify-end px-5 pb-[max(32px,env(safe-area-inset-bottom))] pt-10 md:justify-center md:px-14">
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
      <div className="flex w-full max-w-md flex-col gap-4 border-t-2 border-ink pt-4">
        <h1 className="display text-3xl md:text-4xl">{GATE_COPY.title}</h1>
        <p className="text-base font-bold" role="alert">
          {GATE_COPY.misconfigured}
        </p>
      </div>
    );
  }
  const next = safeNext(typeof params.next === "string" ? params.next : "/");
  const error = params.error === "1" ? GATE_COPY.wrong : params.error === "2" ? GATE_COPY.limited : null;

  return (
    <form method="post" action="/api/unlock" className="flex w-full max-w-md flex-col gap-6 border-t-2 border-ink pt-4">
      <div className="flex flex-col gap-2">
        <h1 className="display text-3xl md:text-4xl">{GATE_COPY.title}</h1>
        <p className="text-base text-ink-2">{GATE_COPY.body}</p>
      </div>
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1">
        <span className="meta text-ink-2">{GATE_COPY.label}</span>
        <input
          type="password"
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          aria-invalid={!!error || undefined}
          className="h-14 w-full border-0 border-b-2 border-ink bg-transparent px-0 text-xl font-bold text-ink outline-none focus:border-b-[3px] aria-invalid:border-b-[4px]"
        />
      </label>
      {error && (
        <p className="flex items-start gap-2 text-sm font-bold" role="alert">
          <span aria-hidden className="nums mt-px inline-grid size-5 shrink-0 place-items-center bg-ink text-xs text-white">
            !
          </span>
          {error}
        </p>
      )}
      <button type="submit" className="on-dark h-16 w-full bg-ink px-6 text-lg font-bold tracking-tight text-white transition-colors duration-150 hover:bg-[#262626] active:bg-[#333]">
        {GATE_COPY.submit}
      </button>
    </form>
  );
}
