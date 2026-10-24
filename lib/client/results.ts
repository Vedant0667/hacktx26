"use client";
// Round 7: the end-of-game summary. Polls GET /reveal?part=results once `open` (moment: reveal or done;
// race: done) until grading is done, then stops.
import { useEffect, useState } from "react";
import { ApiError, api, type GameSummary } from "./api";

export function useSummary(code: string, open: boolean): { summary: GameSummary | null; failed: boolean } {
  const [summary, setSummary] = useState<GameSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const finished = !!summary && !summary.grading;
  useEffect(() => {
    if (!open || finished) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const load = () =>
      api
        .results(code)
        .then((r) => {
          if (!alive) return;
          setSummary(r);
          setFailed(false);
          if (r.grading) t = setTimeout(load, 1500);
        })
        .catch((e) => {
          if (!alive) return;
          setFailed(true);
          t = setTimeout(load, e instanceof ApiError && e.retryAfter ? e.retryAfter * 1000 : 2000);
        });
    load();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [code, open, finished]);
  return { summary: summary && !summary.grading ? summary : null, failed };
}
