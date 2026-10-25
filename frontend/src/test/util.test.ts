import { describe, expect, it } from "vitest";
import { fmtSecs, pct, practiceLink, wordCount } from "../lib/util";

describe("util", () => {
  it("counts words like the writing task does", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("  Dear  Ms. Tremblay,\n I am writing  ")).toBe(6);
  });
  it("formats timers", () => {
    expect(fmtSecs(90)).toBe("1:30");
    expect(fmtSecs(5)).toBe("0:05");
    expect(fmtSecs(-3)).toBe("0:00");
  });
  it("formats percentages and missing values", () => {
    expect(pct(0.909)).toBe("91%");
    expect(pct(null)).toBe("—");
  });
  it("builds practice links with module context", () => {
    expect(practiceLink("writing", 4, 9)).toBe("/writing?q=4&session=9");
    expect(practiceLink("reading")).toBe("/reading");
  });
});
