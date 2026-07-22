import { describe, expect, it } from "vitest";
import { prepareReportForSync, sanitizeReportForOffline } from "./db";
import { INDICATOR_CODES, type IndicatorValues, type ReportData } from "../types";

describe("offline privacy boundary", () => {
  it("does not persist the reporter's name or phone number", () => {
    const values = Object.fromEntries(
      INDICATOR_CODES.map((code) => [code, 1]),
    ) as IndicatorValues;
    const report: ReportData = {
      ...values,
      id: "5f011f32-f645-4ca2-9234-e21914632ddf",
      village_id: "298f286f-d63d-4959-aa14-71afe97ec73b",
      report_period: "Quý III/2026",
      reporter_name: "Nguyễn Văn A",
      reporter_phone: "0900000000",
      workflow_status: "draft",
      timeliness_status: "not_submitted",
      publication_status: "private",
      updated_at: "2026-07-13T00:00:00Z",
    };

    const safe = sanitizeReportForOffline(report);

    expect(safe.reporter_name).toBe("");
    expect(safe.reporter_phone).toBe("");
    expect(safe.CT14).toBe(1);
    expect(report.reporter_name).toBe("Nguyễn Văn A");
  });

  it("keeps a queued submission in a non-authoritative pending state", () => {
    const values = Object.fromEntries(
      INDICATOR_CODES.map((code) => [code, 1]),
    ) as IndicatorValues;
    const report: ReportData = {
      ...values,
      id: "5f011f32-f645-4ca2-9234-e21914632ddf",
      village_id: "298f286f-d63d-4959-aa14-71afe97ec73b",
      report_period: "Quý III/2026",
      reporter_name: "Nguyễn Văn A",
      reporter_phone: "0900000000",
      workflow_status: "submitted",
      timeliness_status: "on_time",
      publication_status: "private",
      status: "Submitted",
      updated_at: "2026-07-13T00:00:00Z",
    };

    const queued = prepareReportForSync(report);

    expect(queued.pending_sync).toBe(true);
    expect(queued.workflow_status).toBe("draft");
    expect(queued.timeliness_status).toBe("not_submitted");
    expect(queued.status).toBe("Draft");
    expect(report.workflow_status).toBe("submitted");
  });
});
