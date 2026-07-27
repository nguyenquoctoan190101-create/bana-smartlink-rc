import { describe, expect, it } from "vitest";
import type { ReportPeriod } from "../types";
import {
  getDraftSavedMessage,
  resolveRequestedReportPeriod,
  shouldReturnAfterSubmission,
} from "./ReportForm";

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

describe("getDraftSavedMessage", () => {
  it("states the device-only scope and that the report has not been submitted", () => {
    const message = getDraftSavedMessage("Thôn An Sơn", "Tháng 7/2026");

    expect(message).toContain("cục bộ trên thiết bị này");
    expect(message).toContain("chưa được gửi lên xã");
    expect(message).toContain("Thôn An Sơn");
    expect(message).toContain("Tháng 7/2026");
  });
});

describe("shouldReturnAfterSubmission", () => {
  it("returns after a server ACK or a safe offline queue", () => {
    expect(shouldReturnAfterSubmission(true, true)).toBe(true);
    expect(shouldReturnAfterSubmission(false, false)).toBe(true);
  });

  it("keeps the form open when an online submission is rejected or unacknowledged", () => {
    expect(shouldReturnAfterSubmission(true, false)).toBe(false);
  });
});
