// Strings for the test-deployment password gate (kept apart from lib/copy.ts so the gate ships independently).
export const GATE_COPY = {
  title: "Test build",
  body: "Enter the test password to open this build.",
  label: "Password",
  wrong: "Wrong password. Try again.",
  limited: "Too many tries from this network. Wait 10 minutes, then try again.",
  misconfigured: "This build is locked because its password is not set. Tell the team.",
  submit: "Open",
} as const;
