/**
 * Digits as speech recognition writes them (SPEC "Quote and token lifecycle", 3a): "482913",
 * "4 8 2 9 1 3.", "four eight two nine one three", "oh oh seven", "double four". The step-up code
 * reaches confirm_transfer however the user said it, so reading it is the server's job, not the
 * model's. Pure: no I/O.
 */

const WORD_DIGITS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  for: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  ate: "8",
  nine: "9",
};

/** "double four" is "44", as many Indian English speakers say codes and phone numbers. */
const REPEAT: Record<string, number> = { double: 2, triple: 3 };

/** Every digit heard in `text`, in order: numerals kept, digit words mapped, other words dropped. */
export function spokenDigits(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let out = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? "";
    const times = REPEAT[w];
    const next = words[i + 1] ?? "";
    const nextDigit = /^\d$/.test(next) ? next : WORD_DIGITS[next];
    if (times && nextDigit) {
      out += nextDigit.repeat(times);
      i++;
    } else if (/^\d+$/.test(w)) out += w;
    else out += WORD_DIGITS[w] ?? "";
  }
  return out;
}

/** The code in `text` when exactly `digits` digits are heard; otherwise undefined. */
export function readCode(text: string, digits = 6): string | undefined {
  const d = spokenDigits(text);
  return d.length === digits ? d : undefined;
}
