// Every UI selector the e2e harness uses, in one place. A descriptor is
//   { css, text, notIn, dom }
// css: querySelectorAll selector (default "*"); text: regex source matched (case-insensitive) against the
// element's innerText; notIn: css of an ancestor the element must NOT be inside; dom: click through the DOM
// (for visually hidden inputs). "{driver}" in css is replaced by the driver code.
// Race Night overrides go in OVERRIDES.racenight; keys not overridden fall back to the classic descriptor.

const BASE = {
  // Phone: join form
  name: { css: "#nick, input[autocomplete=nickname], input[name=nickname]" },
  consent: { css: "input[type=checkbox]", dom: true },
  driver: { css: 'input[type=radio][value="{driver}"]', dom: true },
  join: { css: "form button[type=submit]" },
  // Host: lobby
  start: { css: "button", text: "^\\s*start race\\b" },
  // Phone: call pad
  stay: { css: "button", text: "^\\s*stay out\\b" },
  box: { css: "button", text: "^\\s*box\\b" },
  // The mic button (aria-pressed = recording). The Simple/Advanced toggle is aria-pressed too, hence the text.
  record: { css: "button[aria-pressed]", text: "^\\s*(tap to|transcrib|opening)", notIn: "[role=group]" },
  send: { css: "button[type=submit]", text: "^\\s*send\\b" },
  // End summary: the page must NOT show this while the server is still grading
  scoringText: "Scoring the calls",
};

const OVERRIDES = {
  classic: {},
  // The Race Night mic shows "Radio in" / "Stop" (accessible name stays "Tap to say why").
  racenight: { record: { css: "button[aria-pressed]", text: "^\\s*(radio in|tap to|stop|transcrib|opening)", notIn: "[role=group]" } },
};

export function selectorsFor(ui) {
  return { ...BASE, ...(OVERRIDES[ui] ?? {}) };
}
