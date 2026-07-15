import { describe, expect, it } from "vitest";
import { extractPublishedPeriods, formatPublicIndicatorValue } from "./PublicVillagePage";

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

describe("public period options", () => {
  it("derives unique periods only from already-published report responses", () => {
    expect(extractPublishedPeriods([
      { report_period: "Tháng 7/2026" },
      { report_period: "Tháng 7/2026" },
      { report_period: "  Quý III/2026  " },
      { report_period: null },
      null,
    ])).toEqual(["Tháng 7/2026", "Quý III/2026"]);
  });
});
