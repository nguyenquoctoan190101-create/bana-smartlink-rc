import { describe, expect, it } from "vitest";
import { INDICATOR_CODES, IndicatorValues } from "../types";
import { validateReportIndicators } from "./reportValidation";

function values(overrides: Partial<IndicatorValues> = {}): IndicatorValues {
  return {
    CT01: 100,
    CT02: 350,
    CT03: 10,
    CT04: 5,
    CT05: 4,
    CT06: 6,
    CT07: 70,
    CT08: 2,
    CT09: 80,
    CT10: 200,
    CT11: 330,
    CT12: 6,
    CT13: 20,
    CT14: 1,
    ...overrides,
  };
}

describe("validateReportIndicators", () => {
  it("reports only the 14 missing fields for a blank form", () => {
    const blank = Object.fromEntries(INDICATOR_CODES.map((code) => [code, null])) as IndicatorValues;
    const result = validateReportIndicators(blank);

    expect(result.errors).toHaveLength(14);
    expect(result.errors.map((error) => error.field)).toEqual([...INDICATOR_CODES]);
    expect(result.errors.every((error) => error.message.includes("bắt buộc"))).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("does not compare a value with a missing reference field", () => {
    const result = validateReportIndicators(values({ CT01: null, CT03: 101, CT04: 20, CT09: 101, CT14: 2 }));

    expect(result.errors).toEqual([
      expect.objectContaining({ field: "CT01", message: expect.stringContaining("bắt buộc") }),
    ]);
  });

  it("accepts a complete report that satisfies all deterministic relations", () => {
    expect(validateReportIndicators(values())).toEqual({ errors: [], warnings: [] });
  });

  it("returns every relationship violation once", () => {
    const result = validateReportIndicators(values({
      CT01: 10,
      CT02: 30,
      CT03: 11,
      CT04: 1,
      CT07: 31,
      CT08: 32,
      CT09: 11,
      CT10: 31,
      CT11: 31,
      CT14: 11,
    }));

    expect(result.errors.map((error) => error.field)).toEqual([
      "CT03", "CT04", "CT07", "CT08", "CT09", "CT10", "CT11", "CT14",
    ]);
  });

  it("only calculates ratios when numerator and denominator are present", () => {
    const missingNumerators = validateReportIndicators(values({ CT02: null, CT07: null }));
    expect(missingNumerators.warnings).toEqual([]);

    const outlier = validateReportIndicators(values({ CT02: 500, CT07: 250, CT10: 200, CT11: 330 }));
    expect(outlier.warnings.map((warning) => warning.field)).toEqual(["CT02", "CT07"]);
  });
});
