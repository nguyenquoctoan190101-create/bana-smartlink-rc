import {
  fireEvent,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReportForm from "./ReportForm";

const mocks = vi.hoisted(() => ({
  getLocalDraftForScope: vi.fn(),
  queueReportForSync: vi.fn(),
  saveDraftForScope: vi.fn(),
  syncQueuedReports: vi.fn(),
  authScope: {
    userName: "Cán bộ thôn",
    userPhone: "0900000000",
    userVillageId: "village-1" as string | null,
    userVillageIds: ["village-1"] as string[],
    userRole: "can_bo_thon" as
      | "can_bo_thon"
      | "to_cnscd"
      | "admin_xa"
      | "lanh_dao"
      | "dan",
  },
}));

vi.mock("../lib/AuthContext", () => ({
  useAuth: () => mocks.authScope,
}));

vi.mock("../lib/useVillages", () => ({
  useVillages: () => ({
    villages: [
      { id: "village-1", name: "Thôn An Sơn" },
      { id: "village-2", name: "Thôn Hòa Nhơn" },
      { id: "village-3", name: "Thôn Hòa Ninh" },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../lib/useReportPeriods", () => ({
  useReportPeriods: () => ({
    periods: [
      {
        id: "period-1",
        name: "Tháng 7/2026",
        due_date: "2026-07-31T17:00:00+07:00",
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../lib/db", () => ({
  getLocalDraftForScope: mocks.getLocalDraftForScope,
  queueReportForSync: mocks.queueReportForSync,
  saveDraftForScope: mocks.saveDraftForScope,
}));

vi.mock("../lib/reportSync", () => ({
  syncQueuedReports: mocks.syncQueuedReports,
}));

vi.mock("./UploadReport", () => ({
  default: () => <div>Nhập dữ liệu từ tệp báo cáo</div>,
}));

afterEach(cleanup);

describe("ReportForm accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLocalDraftForScope.mockResolvedValue(null);
    mocks.queueReportForSync.mockResolvedValue(undefined);
    mocks.syncQueuedReports.mockResolvedValue({ accepted: [], rejected: [] });
    Object.assign(mocks.authScope, {
      userName: "Cán bộ thôn",
      userPhone: "0900000000",
      userVillageId: "village-1",
      userVillageIds: ["village-1"],
      userRole: "can_bo_thon",
    });
  });

  it("exposes the task form and all fourteen indicators without blocking axe violations", async () => {
    const { container } = render(
      <ReportForm onSaved={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: /báo cáo/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("spinbutton")).toHaveLength(14);
    expect(
      screen.getByRole("heading", { name: "Tóm tắt tác vụ báo cáo" }),
    ).toBeInTheDocument();
    expect(screen.getByText("0/14 chỉ tiêu")).toBeInTheDocument();

    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      result.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
  });

  it("shows the durable server receipt after an acknowledged submission", async () => {
    mocks.syncQueuedReports.mockImplementation(async () => {
      const queued = mocks.queueReportForSync.mock.calls.at(-1)?.[0];
      return {
        accepted: [{
          client_id: queued.id,
          report_id: "00000000-0000-4000-8000-000000000041",
          version: 3,
          workflow_status: "submitted",
          timeliness_status: "on_time",
          publication_status: "private",
          server_received_at: "2026-07-29T02:15:00Z",
          next_step: "await_commune_review",
          replayed: false,
        }],
        rejected: [],
      };
    });
    render(<ReportForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    const values = [
      100, 350, 10, 20, 5, 10, 50, 5, 80, 150, 140, 3, 50, 0,
    ];
    screen.getAllByRole("spinbutton").forEach((input, index) => {
      fireEvent.change(input, { target: { value: String(values[index]) } });
    });

    const reviewButton = screen
      .getAllByRole("button", { name: /Kiểm tra trước khi gửi/ })
      .find((button) => !(button as HTMLButtonElement).disabled);
    expect(reviewButton).toBeDefined();
    await waitFor(() => expect(reviewButton!).toBeEnabled());
    fireEvent.click(reviewButton!);
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /tôi xác nhận/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Nộp báo cáo" }));

    const receiptHeading = await screen.findByRole("heading", {
      name: "Biên nhận máy chủ",
    });
    const receipt = receiptHeading.parentElement;
    expect(receipt).not.toBeNull();
    expect(within(receipt!).getByText("3")).toBeInTheDocument();
    expect(
      within(receipt!).getByText("Chờ quản trị xã rà soát"),
    ).toBeInTheDocument();
    expect(within(receipt!).getByText(/29\/7\/2026/)).toBeInTheDocument();
  });

  it("offers CNSCĐ only explicitly assigned villages and records assistance", async () => {
    Object.assign(mocks.authScope, {
      userName: "Thành viên Tổ CNSCĐ",
      userVillageId: null,
      userVillageIds: ["village-1", "village-3"],
      userRole: "to_cnscd",
    });

    render(<ReportForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    const villageSelect = await screen.findByLabelText("Thôn báo cáo:");
    expect(within(villageSelect).getByRole("option", { name: "Thôn An Sơn" })).toBeInTheDocument();
    expect(within(villageSelect).getByRole("option", { name: "Thôn Hòa Ninh" })).toBeInTheDocument();
    expect(
      within(villageSelect).queryByRole("option", { name: "Thôn Hòa Nhơn" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Chỉ có thể lập báo cáo cho 2 thôn được quản trị xã phân công."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: "Ghi nhận hỗ trợ nhập liệu",
      }),
    ).toBeInTheDocument();
  });
});
