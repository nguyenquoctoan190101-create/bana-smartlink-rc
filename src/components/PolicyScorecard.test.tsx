import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PolicyScorecard from "./PolicyScorecard";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("../lib/apiClient", () => ({
  apiFetch: mocks.apiFetch,
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

vi.mock("../lib/useReportPeriods", () => ({
  useReportPeriods: () => ({
    periods: [
      { id: "future-empty", name: "1/2027", due_date: "2027-01-31T17:00:00Z" },
      { id: "approved-period", name: "Tháng 7/2026", due_date: "2026-07-31T17:00:00Z" },
    ],
  }),
}));

describe("PolicyScorecard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not turn a zero denominator into a real zero percent", async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        period_id: "future-empty",
        period_name: "1/2027",
        electronic_profile_rate: { numerator: 0, denominator: 0, percent: 0 },
        once_only_score: { numerator: 0, denominator: 0, percent: 0 },
        interpretation: "Không dùng vì mẫu số bằng 0",
      }),
    });

    render(<PolicyScorecard preferredPeriodId="future-empty" />);

    expect(
      screen.getByRole("heading", { name: "Chọn phạm vi theo dõi" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Kết quả và ý nghĩa theo dõi" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/chưa có báo cáo đủ điều kiện để tính tỷ lệ báo cáo điện tử/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Chưa có báo cáo để tính")).toBeInTheDocument();
    expect(screen.getByText("Chưa có trường dữ liệu để tính")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("opens on the decision-ready period supplied by the leadership workspace", async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        period_id: "approved-period",
        period_name: "Tháng 7/2026",
        electronic_profile_rate: { numerator: 10, denominator: 10, percent: 100 },
        once_only_score: { numerator: 4, denominator: 140, percent: 2.86 },
        interpretation: "Dữ liệu hợp lệ",
      }),
    });

    render(<PolicyScorecard preferredPeriodId="approved-period" />);

    await waitFor(() =>
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        "/api/policy-scorecard?period_id=approved-period",
      ),
    );
    expect(await screen.findByText(/100% báo cáo nộp điện tử/i)).toBeInTheDocument();
  });
});
