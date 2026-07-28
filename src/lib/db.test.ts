import { describe, expect, it } from "vitest";
import {
  prepareReportForSync,
  reportDataFromApiRow,
  sanitizeReportForOffline,
  selectLatestDraftForScope,
} from "./db";
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

  it("selects the newest editable draft for the exact village and period", () => {
    const base = {
      CT01: 1, CT02: 1, CT03: 1, CT04: 1, CT05: 1, CT06: 1, CT07: 1,
      CT08: 1, CT09: 1, CT10: 1, CT11: 1, CT12: 1, CT13: 1, CT14: 1,
      village_id: "village-a",
      period_id: "period-a",
      report_period: "Quý III/2026",
      reporter_name: "",
      reporter_phone: "",
      workflow_status: "draft" as const,
      timeliness_status: "not_submitted" as const,
      publication_status: "private" as const,
    };
    const reports: ReportData[] = [
      { ...base, id: "old", updated_at: "2026-07-01T00:00:00Z" },
      { ...base, id: "new", CT01: 42, updated_at: "2026-07-02T00:00:00Z" },
      { ...base, id: "queued", pending_sync: true, updated_at: "2026-07-03T00:00:00Z" },
      { ...base, id: "other-period", period_id: "period-b", updated_at: "2026-07-04T00:00:00Z" },
    ];

    expect(selectLatestDraftForScope(reports, "village-a", "period-a")?.id).toBe("new");
    expect(selectLatestDraftForScope(reports, "village-a", "period-a")?.CT01).toBe(42);
    expect(selectLatestDraftForScope(reports, "village-a", "missing")).toBeNull();
  });
});

describe("report API timestamp mapping", () => {
  it("prefers the authoritative update time and preserves workflow timestamps", () => {
    const mapped = reportDataFromApiRow(
      {
        id: "report-1",
        village_id: "village-1",
        period_id: "period-1",
        workflow_status: "approved",
        timeliness_status: "on_time",
        publication_status: "private",
        submitted_at: "2026-07-10T01:00:00Z",
        approved_at: "2026-07-11T02:00:00Z",
        updated_at: "2026-07-12T03:00:00Z",
        values: { CT01: 318 },
      },
      new Map([["period-1", "Tháng 7/2026"]]),
    );

    expect(mapped.updated_at).toBe("2026-07-12T03:00:00Z");
    expect(mapped.submitted_at).toBe("2026-07-10T01:00:00Z");
    expect(mapped.approved_at).toBe("2026-07-11T02:00:00Z");
    expect(mapped.report_period).toBe("Tháng 7/2026");
    expect(mapped.CT01).toBe(318);
    expect(mapped.CT02).toBeNull();
  });

  it("keeps the published timestamp fallback for the legacy public response", () => {
    const mapped = reportDataFromApiRow(
      {
        id: "public-report",
        village_id: "village-1",
        report_period: "Tháng 7/2026",
        published_at: "2026-07-15T04:00:00Z",
        values: { CT01: 318 },
      },
      new Map(),
      true,
    );

    expect(mapped.updated_at).toBe("2026-07-15T04:00:00Z");
    expect(mapped.published_at).toBe("2026-07-15T04:00:00Z");
    expect(mapped.workflow_status).toBe("approved");
    expect(mapped.publication_status).toBe("published");
  });
});
