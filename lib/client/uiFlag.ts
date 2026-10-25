// Race Night UI flag. The build-time default comes from NEXT_PUBLIC_UI ("racenight" turns it on; anything else is
// classic). Each browser can override it with ?ui=racenight or ?ui=classic, kept in localStorage under outpace:ui.
// useSyncExternalStore's server snapshot is the env default, so SSR and the first client render agree; the
// override applies right after hydration.
import { useSyncExternalStore } from "react";

export type UiMode = "racenight" | "classic";

const STORAGE_KEY = "outpace:ui";
const CHANGE_EVENT = "outpace:ui-change";

const asMode = (v: string | null | undefined): UiMode | null => (v === "racenight" || v === "classic" ? v : null);

// The build-time default, with no per-browser override. Safe on the server and in non-React code.
export function uiFlagDefault(): boolean {
  return process.env.NEXT_PUBLIC_UI === "racenight";
}

function readStored(): UiMode | null {
  try {
    return asMode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function readQuery(): UiMode | null {
  try {
    return asMode(new URLSearchParams(window.location.search).get("ui"));
  } catch {
    return null;
  }
}

function snapshot(): boolean {
  const mode = readQuery() ?? readStored();
  return mode ? mode === "racenight" : uiFlagDefault();
}

function subscribe(onChange: () => void): () => void {
  // Persist a ?ui= override once we are mounted (never during render).
  const q = readQuery();
  if (q && q !== readStored()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, q);
    } catch {
      // Storage blocked (private mode): the query still wins for this page load.
    }
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

// True when the Race Night UI should render. First render (server and hydration) always equals uiFlagDefault().
export function useRaceNight(): boolean {
  return useSyncExternalStore(subscribe, snapshot, uiFlagDefault);
}

// Set or clear (null) this browser's override, e.g. from a dev toggle. Notifies every mounted useRaceNight().
export function setUiOverride(mode: UiMode | null): void {
  try {
    if (mode) window.localStorage.setItem(STORAGE_KEY, mode);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
