import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReportPeriodChangeRequests from "./ReportPeriodChangeRequests";

const mocks = vi.hoisted(() => ({
  apiJson: vi.fn(),
  invalidateReportPeriods: vi.fn(),
}));

vi.mock("../lib/apiClient", () => ({
  apiJson: mocks.apiJson,
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

vi.mock("../lib/useReportPeriods", () => ({
  invalidateReportPeriods: mocks.invalidateReportPeriods,
}));

vi.mock("../lib/useVillages", () => ({
  useVillages: () => ({
    villages: [
      { id: "11111111-1111-4111-8111-111111111111", name: "Thôn An Sơn" },
      { id: "22222222-2222-4222-8222-222222222222", name: "Thôn Phú Hòa" },
    ],
    isLoading: false,
    error: null,
  }),
}));

const periods = [{
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Tháng 07/2026",
  due_date: "2026-08-01T10:00:00+07:00",
  village_ids: [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ],
}];

describe("ReportPeriodChangeRequests", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets an administrator request a correction but does not edit the period directly", async () => {
    mocks.apiJson.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/report-periods/change-requests") return Promise.resolve([]);
      if (path.endsWith("/change-requests") && options?.method === "POST") {
        return Promise.resolve({ id: "request-1" });
      }
      return Promise.reject(new Error(`Unexpected ${path}`));
    });
    const user = userEvent.setup();
    render(<ReportPeriodChangeRequests role="admin_xa" periods={periods} />);

    const nameInput = await screen.findByLabelText("Tên kỳ đề nghị");
    await user.clear(nameInput);
    await user.type(nameInput, "Tháng 08/2026");
    await user.type(
      screen.getByLabelText(/Lý do đề nghị/),
      "Điều chỉnh theo văn bản rà soát đã ký.",
    );
    await user.click(screen.getByRole("button", { name: "Gửi lãnh đạo phê duyệt" }));

    await waitFor(() => expect(mocks.apiJson).toHaveBeenCalledWith(
      `/report-periods/${periods[0].id}/change-requests`,
      expect.objectContaining({ method: "POST" }),
    ));
    const post = mocks.apiJson.mock.calls.find(
      ([path, options]) => path.includes(periods[0].id) && options?.method === "POST",
    );
    const body = JSON.parse(post?.[1]?.body as string);
    expect(body).toEqual({
      request_kind: "update",
      reason: "Điều chỉnh theo văn bản rà soát đã ký.",
      proposed_name: "Tháng 08/2026",
    });
    expect(screen.getByText(/chỉ thay đổi sau khi lãnh đạo xã phê duyệt/)).toBeInTheDocument();
  });

  it("shows before and after evidence and requires a leader decision reason", async () => {
    const request = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      period_id: periods[0].id,
      period_name: "Tháng 07/2026",
      request_kind: "update",
      reason: "Điều chỉnh theo văn bản rà soát đã ký.",
      before_snapshot: {
        name: "Tháng 07/2026",
        due_date: "2026-08-01T03:00:00Z",
        village_ids: periods[0].village_ids,
      },
      proposed_snapshot: {
        name: "Tháng 08/2026",
        due_date: "2026-08-31T10:00:00Z",
        village_ids: periods[0].village_ids,
      },
      requested_at: "2026-07-26T03:00:00Z",
      requester_name: "Quản trị xã",
      status: "pending",
      decision: null,
    };
    let listCount = 0;
    mocks.apiJson.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/report-periods/change-requests") {
        listCount += 1;
        return Promise.resolve(listCount === 1 ? [request] : []);
      }
      if (path.endsWith("/decision") && options?.method === "POST") {
        return Promise.resolve({ id: "decision-1", decision: "approved" });
      }
      return Promise.reject(new Error(`Unexpected ${path}`));
    });
    const user = userEvent.setup();
    render(<ReportPeriodChangeRequests role="lanh_dao" periods={periods} />);

    expect(await screen.findByText("Thông tin đang lưu")).toBeInTheDocument();
    expect(screen.getByText("Thông tin đề nghị thay đổi")).toBeInTheDocument();
    expect(screen.getByText("Tháng 08/2026")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Lý do quyết định/), "Đủ căn cứ để áp dụng.");
    await user.click(screen.getByRole("button", { name: "Phê duyệt" }));

    await waitFor(() => expect(mocks.apiJson).toHaveBeenCalledWith(
      `/report-periods/change-requests/${request.id}/decision`,
      expect.objectContaining({ method: "POST" }),
    ));
    const decisionCall = mocks.apiJson.mock.calls.find(
      ([path]) => path.endsWith("/decision"),
    );
    expect(JSON.parse(decisionCall?.[1]?.body as string)).toEqual({
      decision: "approved",
      reason: "Đủ căn cứ để áp dụng.",
    });
    expect(mocks.invalidateReportPeriods).toHaveBeenCalledOnce();
  });
});
