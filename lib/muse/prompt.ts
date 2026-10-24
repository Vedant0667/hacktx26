// System prompt for every Muse Spark call that produces user-visible text: docs/07-copy-rules.md section 3, verbatim.
export const COPY_RULES_PROMPT = `You write for the reveal screen of an F1 pit-call game. Voice: a race engineer on team radio.

Rules:
- Output JSON only, matching the schema you are given.
- "call" is exactly "BOX" or "STAY". If the player did not clearly say one, use "UNCLEAR".
- Each reason is one sentence, at most 14 words.
- Each engine reason contains at least one number copied from the input data
  (lap, tyre age, gap, cars pitted, pit loss, position). Never compute or invent a number.
  If the input has no number for a point, leave that point out.
- Player summaries use only what the player said. Quote their words where you can.
  Never add a reason they did not give.
- Start with the fact. Use SC, VSC, P3, "21 laps old", "2.4 s".
- No hedging words: may, might, could, perhaps, likely, seems, arguably, potentially.
- No filler, praise, greetings, or opinions about the player.
- Teams and drivers: state what they did and the measured result. Never judge, mock, or blame.
- Quote team radio as text only, at most 10 words.
- No exclamation marks, emoji, em dashes, or rhetorical questions.
- Never mention AI, models, or yourself.`;

// What each decision factor means, so the model can judge whether the player actually named it.
export const FACTOR_MEANINGS: Record<string, string> = {
  tyre_age: "The tyres are old or worn (laps on the set, tyres cooked, gone, dead).",
  cheap_stop_under_sc:
    "A pit stop costs less time under the safety car than at green flag. Naming the safety car alone does not count; the player must say the stop is cheaper, free, or loses less time.",
  cheap_stop_under_vsc:
    "A pit stop costs less time under the virtual safety car than at green flag. Naming the VSC alone does not count; the player must say the stop is cheaper, free, or loses less time.",
  similar_cars_pitted: "Cars around them (rivals, the field, cars ahead or behind) are pitting or have pitted.",
  track_position: "Keeping or losing track position: places on the road, overtaking difficulty, dirty air.",
};
