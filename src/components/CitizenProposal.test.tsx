import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CitizenProposal from "./CitizenProposal";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

const publishedReport = {
  village_id: "village-1",
  report_period: "Tháng 7/2026",
  workflow_status: "approved",
  publication_status: "published",
  updated_at: "2026-07-20T00:00:00Z",
  published_at: "2026-07-20T00:00:00Z",
  CT01: 120,
};

vi.mock("../lib/useVillages", () => ({ useVillages: () => ({ villages: [{ id: "village-1", name: "Thôn mẫu" }] }) }));
vi.mock("../lib/apiClient", () => ({
  apiFetch: mocks.apiFetch,
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

describe("citizen proposal workflow", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ tracking_code: "AB12CD34EF56GH78" }),
    });
  });

  it("moves through the three review steps before submission", async () => {
    const user = userEvent.setup();
    render(<CitizenProposal reports={[publishedReport]} onProposalSubmitted={() => undefined} />);

    await user.type(screen.getByLabelText(/Giá trị đề xuất/), "125");
    await user.type(screen.getByLabelText("Lý do cần đối chiếu"), "Số liệu cần cán bộ đối chiếu lại.");
    await user.click(screen.getByRole("button", { name: "Tiếp tục" }));

    const nameInput = screen.getByLabelText(/Họ và tên/);

    expect(nameInput).toHaveAttribute("type", "text");
    expect(nameInput).toHaveAttribute("placeholder", "Ví dụ: Nguyễn Văn A");
    expect(nameInput).not.toBeRequired();

    await user.type(nameInput, "Người dân mẫu");
    await user.type(screen.getByLabelText(/Số điện thoại/), "0900000000");
    await user.click(screen.getByRole("button", { name: "Tiếp tục" }));

    expect(screen.getByText("Xác nhận nội dung")).toBeInTheDocument();
    expect(screen.getByText("Thôn mẫu · Tháng 7/2026")).toBeInTheDocument();
    expect(screen.getByText("CT01 · Tổng số hộ dân")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Gửi đề nghị đối chiếu" }));
    expect(await screen.findByText("Đề nghị đối chiếu đã được ghi nhận")).toBeInTheDocument();
    const [, request] = mocks.apiFetch.mock.calls[0];
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      village_id: "village-1",
      report_period: "Tháng 7/2026",
      ct_code: "CT01",
    });
    expect(body).not.toHaveProperty("report_id");
  }, 10_000);

  it("separates public-data corrections from field reports", async () => {
    const user = userEvent.setup();
    const openFieldReport = vi.fn();
    render(<CitizenProposal reports={[]} onProposalSubmitted={() => undefined} onOpenFieldReport={openFieldReport} />);

    expect(screen.getByText("Phạm vi tiếp nhận")).toBeInTheDocument();
    expect(screen.getByText(/đường, điện, nước, rác thải/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Phản ánh hiện trường" }));
    expect(openFieldReport).toHaveBeenCalledOnce();
  });

  it("uses only the newest public report and excludes internal data", async () => {
    render(
      <CitizenProposal
        reports={[
          {
            ...publishedReport,
            report_period: "Chưa xác định",
            published_at: "2026-07-01T00:00:00Z",
            CT01: 247,
          },
          {
            ...publishedReport,
            report_period: "Tháng 8/2026",
            workflow_status: "submitted",
            publication_status: "private",
            published_at: null,
            updated_at: "2026-08-20T00:00:00Z",
            CT01: 999,
          },
          {
            ...publishedReport,
            report_period: "Bản công bố minh họa — Tháng 7/2026",
            period_id: "period-july",
            published_at: "2026-07-28T00:00:00Z",
            CT01: 318,
          },
        ]}
        onProposalSubmitted={() => undefined}
      />,
    );

    expect(await screen.findByDisplayValue("Bản công bố minh họa — Tháng 7/2026")).toBeInTheDocument();
    expect(screen.getByText("318 hộ")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Tháng 8/2026" })).not.toBeInTheDocument();
  });

  it("blocks invalid values and phone numbers before advancing", async () => {
    const user = userEvent.setup();
    render(
      <CitizenProposal
        reports={[publishedReport]}
        onProposalSubmitted={() => undefined}
      />,
    );

    await user.type(screen.getByLabelText(/Giá trị đề xuất/), "-1");
    await user.type(screen.getByLabelText("Lý do cần đối chiếu"), "Đối chiếu nguồn.");
    await user.click(screen.getByRole("button", { name: "Tiếp tục" }));
    expect(screen.getByRole("alert")).toHaveTextContent("số nguyên không âm");

    await user.clear(screen.getByLabelText(/Giá trị đề xuất/));
    await user.type(screen.getByLabelText(/Giá trị đề xuất/), "125");
    await user.click(screen.getByRole("button", { name: "Tiếp tục" }));
    await user.type(screen.getByLabelText(/Số điện thoại/), "123");
    await user.click(screen.getByRole("button", { name: "Tiếp tục" }));
    expect(screen.getByRole("alert")).toHaveTextContent("chưa đúng định dạng");
    expect(screen.queryByText("Xác nhận nội dung")).not.toBeInTheDocument();
  });
});
