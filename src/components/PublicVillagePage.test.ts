import { describe, expect, it } from "vitest";
import {
  extractPublishedPeriods,
  formatPublicIndicatorValue,
  getPublicLookupEndpoint,
  getPublicReportTimestamp,
} from "./PublicVillagePage";

describe("shared public lookup", () => {
  it("routes 16-character proposal codes to the proposal tracker", () => {
    expect(getPublicLookupEndpoint(" ab12cd34ef56gh78 "))
      .toBe("/auth/citizen/pending-updates/AB12CD34EF56GH78");
  });

  it("routes 32-character field-report codes to the case tracker", () => {
    expect(getPublicLookupEndpoint("ab12cd34ef56gh789012345678901234"))
      .toBe("/api/cases/track/AB12CD34EF56GH789012345678901234");
  });

  it("rejects codes that do not match either public format", () => {
    expect(getPublicLookupEndpoint("too-short")).toBeNull();
  });
});

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

  it("uses the publication time returned by the public API", () => {
    expect(getPublicReportTimestamp({
      published_at: "2026-07-15T10:04:38Z",
      updated_at: "2026-07-14T10:04:38Z",
    })).toBe("2026-07-15T10:04:38Z");
  });

  it("falls back to updated_at for older compatible responses", () => {
    expect(getPublicReportTimestamp({ updated_at: "2026-07-14T10:04:38Z" }))
      .toBe("2026-07-14T10:04:38Z");
  });
});
