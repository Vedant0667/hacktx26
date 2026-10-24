"use client";
// Round 7: the end screen's data. Polls GET /reveal?part=results from the reveal until grading is done, then stops.
import { useEffect, useState } from "react";
import type { LobbyPhase } from "@/lib/types";
import { ApiError, api, type ResultsResponse } from "./api";

export function useResults(code: string, phase: LobbyPhase | undefined): { results: ResultsResponse | null; failed: boolean } {
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const open = phase === "reveal" || phase === "done";
  const finished = !!results && !results.grading;
  useEffect(() => {
    if (!open || finished) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const load = () =>
      api
        .results(code)
        .then((r) => {
          if (!alive) return;
          setResults(r);
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
  return { results: results && !results.grading ? results : null, failed };
}
