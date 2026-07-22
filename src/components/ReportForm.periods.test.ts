import { describe, expect, it } from "vitest";
import type { ReportPeriod } from "../types";
import { resolveRequestedReportPeriod } from "./ReportForm";

const periods: ReportPeriod[] = [
  { id: "period-new", name: "Tháng 8/2026", due_date: "2026-08-25T17:00:00+07:00" },
  { id: "period-old", name: "Tháng 7/2026", due_date: "2026-07-25T17:00:00+07:00" },
];

describe("resolveRequestedReportPeriod", () => {
  it("selects the requested period by stable UUID", () => {
    expect(resolveRequestedReportPeriod(periods, "period-old")?.id).toBe("period-old");
  });

  it("keeps compatibility with a unique legacy period name", () => {
    expect(resolveRequestedReportPeriod(periods, "Tháng 8/2026")?.id).toBe("period-new");
  });

  it("rejects an ambiguous legacy name instead of choosing an arbitrary period", () => {
    const duplicateNamePeriods: ReportPeriod[] = [
      ...periods,
      { id: "period-duplicate", name: periods[0].name, due_date: "2026-09-25T17:00:00+07:00" },
    ];

    expect(resolveRequestedReportPeriod(duplicateNamePeriods, periods[0].name)).toBeNull();
  });

  it("rejects an invalid deep-link instead of silently selecting the latest period", () => {
    expect(resolveRequestedReportPeriod(periods, "missing-period")).toBeNull();
  });
});
