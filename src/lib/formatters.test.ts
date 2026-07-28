import { describe, expect, it } from "vitest";
import { formatViNumber, formatViPercent } from "./formatters";

describe("Vietnamese number presentation", () => {
  it("uses dots for thousands and commas for decimals", () => {
    expect(formatViNumber(1176)).toBe("1.176");
    expect(formatViNumber(3.77, 2)).toBe("3,77");
    expect(formatViPercent(95, 1)).toBe("95,0%");
  });
});
