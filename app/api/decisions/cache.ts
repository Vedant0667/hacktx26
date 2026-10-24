// Blind race data changes only when the seed runs. private: a shared cache must never hand gated data to a
// visitor without the gate cookie.
export const BLIND_CACHE = "private, max-age=300";
