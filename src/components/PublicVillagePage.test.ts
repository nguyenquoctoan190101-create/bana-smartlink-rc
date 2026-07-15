import { describe, expect, it } from "vitest";
import { formatPublicIndicatorValue } from "./PublicVillagePage";

describe("public indicator rendering", () => {
  it("does not turn missing data or invalid numbers into zero", () => {
    expect(formatPublicIndicatorValue(null)).toBe("—");
    expect(formatPublicIndicatorValue(undefined)).toBe("—");
    expect(formatPublicIndicatorValue(Number.NaN)).toBe("—");
  });

  it("still renders a real zero as zero", () => {
    expect(formatPublicIndicatorValue(0)).toBe("0");
  });
});
