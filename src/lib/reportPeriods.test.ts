import { describe, expect, it } from "vitest";
import {
  decorateReportPeriod,
  normalizeReportPeriodName,
  reportPeriodNameIssue,
} from "./reportPeriods";

describe("report period names", () => {
  it("normalizes harmless whitespace", () => {
    expect(normalizeReportPeriodName("  Bản   công bố  tháng 7  ")).toBe("Bản công bố tháng 7");
  });

  it.each(["0/2026", "13/2026", "Tháng 00/2026", "tháng 19 / 2026"])(
    "rejects impossible calendar month %s",
    (name) => {
      expect(reportPeriodNameIssue(name)).toBe("Tháng của kỳ báo cáo phải từ 1 đến 12.");
    },
  );

  it.each(["1/2027", "12/2026", "Tháng 07/2026", "Bản công bố minh họa — Tháng 7/2026"])(
    "accepts valid or descriptive name %s",
    (name) => {
      expect(reportPeriodNameIssue(name)).toBeNull();
    },
  );

  it("labels an invalid legacy row without changing its stored name", () => {
    const decorated = decorateReportPeriod({
      id: "legacy-period",
      name: "0/2026",
      due_date: "2026-07-31T17:00:00Z",
    });

    expect(decorated.name).toBe("0/2026");
    expect(decorated.display_name).toBe("Kỳ cần rà soát: 0/2026");
    expect(decorated.requires_review).toBe(true);
  });
});
