import { describe, expect, it } from "vitest";
import { readCode, spokenDigits } from "../src/core/spoken.js";

describe("reading a code the way speech recognition writes it", () => {
  it("takes digits, words, separators and trailing punctuation", () => {
    for (const said of [
      "482913",
      "4 8 2 9 1 3",
      "4 8 2 9 1 3.",
      "48 29 13",
      "4-8-2-9-1-3",
      "four eight two nine one three",
      "Four, eight, two, nine, one, three.",
      "the code is four eight two nine one three",
      "4 eight 2 nine 1 three",
    ]) {
      expect(readCode(said), said).toBe("482913");
    }
  });

  it("knows zero said as oh, and double or triple a digit", () => {
    expect(readCode("oh oh seven four four one")).toBe("007441");
    expect(readCode("double four eight two nine one")).toBe("448291");
    expect(readCode("triple one two two seven")).toBe("111227");
    expect(readCode("double 4 8 2 9 1")).toBe("448291");
  });

  it("gives nothing unless exactly six digits come out", () => {
    for (const said of ["", "banana", "12345", "1234567", "four eight two", "yes please"]) {
      expect(readCode(said), said).toBeUndefined();
    }
  });

  it("spokenDigits keeps every digit it hears, in order", () => {
    expect(spokenDigits("send five hundred")).toBe("5");
    expect(spokenDigits("one two, three")).toBe("123");
  });
});
