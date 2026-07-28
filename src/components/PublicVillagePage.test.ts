import { describe, expect, it } from "vitest";
import {
  ApiError,
} from "../lib/apiClient";
import {
  extractPublishedPeriods,
  formatPublicIndicatorValue,
  getDefaultPublicVillageId,
  getEvacuationAvailability,
  PUBLIC_NAVIGATION_LABELS,
  getPublicLookupFailure,
  getPublicReportTimestamp,
} from "./PublicVillagePage";
import {
  formatPublicLookupMessage,
  getPublicCaseCategoryLabel,
  getPublicLookupEndpoint,
  getPublicStatusLabel,
} from "../lib/publicLookup";

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

describe("public portal navigation", () => {
  it("keeps exactly the four citizen tasks in the public hero", () => {
    expect(PUBLIC_NAVIGATION_LABELS).toEqual([
      "Số liệu công khai",
      "Đề nghị đối chiếu số liệu",
      "Phản ánh hiện trường",
      "Tra cứu hồ sơ",
    ]);
    expect(PUBLIC_NAVIGATION_LABELS).not.toContain("Đăng nhập cán bộ");
  });
});

describe("public portal default scope", () => {
  it("starts on a village with a published report when the first catalogue village has none", () => {
    expect(getDefaultPublicVillageId(
      [{ id: "new-village", name: "Thôn mới" }, { id: "published-village", name: "Thôn đã công bố" }],
      [{ village_id: "published-village", report_period: "Tháng 7/2026" }],
    )).toBe("published-village");
  });

  it("keeps the catalogue fallback when no public report exists yet", () => {
    expect(getDefaultPublicVillageId([{ id: "first-village" }], [])).toBe("first-village");
  });
});

describe("public evacuation availability", () => {
  it("never presents a failed request as an authoritative empty list", () => {
    expect(getEvacuationAvailability(true, 0)).toBe("unavailable");
    expect(getEvacuationAvailability(false, 0)).toBe("empty");
    expect(getEvacuationAvailability(false, 2)).toBe("available");
  });
});

describe("public lookup labels", () => {
  it("translates status and category values for citizens", () => {
    expect(getPublicStatusLabel("received")).toBe("Đã tiếp nhận");
    expect(getPublicCaseCategoryLabel("road")).toBe("Đường giao thông");
    expect(formatPublicLookupMessage({ status: "received", case: { category: "road" } }))
      .toBe("● Đã tiếp nhận · Loại sự cố: Đường giao thông");
  });

  it("distinguishes invalid input and an unavailable service from not found", () => {
    expect(getPublicStatusLabel("invalid_code")).toBe("Mã chưa hợp lệ");
    expect(getPublicStatusLabel("unavailable")).toBe("Chưa thể tra cứu");
    expect(getPublicStatusLabel("not_found")).toBe("Không tìm thấy");
  });

  it("distinguishes a real missing record from a lookup service failure", () => {
    expect(getPublicLookupFailure(new ApiError("missing", 404))).toMatchObject({
      status: "not_found",
    });
    expect(getPublicLookupFailure(new TypeError("Failed to fetch"))).toMatchObject({
      status: "unavailable",
    });
  });
});
