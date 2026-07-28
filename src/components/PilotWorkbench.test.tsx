import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PilotWorkbench from "./PilotWorkbench";

const mocks = vi.hoisted(() => ({ apiJson: vi.fn() }));

vi.mock("../lib/apiClient", () => ({
  apiJson: mocks.apiJson,
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

vi.mock("./PilotObservatory", () => ({
  default: () => null,
}));

describe("PilotWorkbench", () => {
  beforeEach(() => {
    mocks.apiJson.mockImplementation((path: string) => {
      if (path === "/api/pilots/status") {
        return Promise.resolve({ iot_enabled: true, tourism_enabled: true });
      }
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    cleanup();
    mocks.apiJson.mockReset();
  });

  it("labels experimental controls and blocks an invalid device name", async () => {
    const user = userEvent.setup();
    render(<PilotWorkbench role="admin_xa" />);

    await screen.findByRole("heading", { name: "Thiết bị cảm biến" });
    expect(screen.getByLabelText("Tên thiết bị")).toBeInTheDocument();
    expect(screen.getByLabelText("Loại thiết bị")).toBeInTheDocument();
    expect(screen.getByLabelText("Đơn vị đo")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Tên thiết bị"), "A");
    await user.click(screen.getByRole("button", { name: "Tạo thiết bị" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tên thiết bị phải có từ 2 đến 160 ký tự.",
    );
    expect(
      mocks.apiJson.mock.calls.some(
        ([path, options]) =>
          path === "/api/pilots/sensors/devices"
          && options?.method === "POST",
      ),
    ).toBe(false);
  });

  it("shows a safe error when device creation is rejected", async () => {
    mocks.apiJson.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/api/pilots/status") {
        return Promise.resolve({ iot_enabled: true, tourism_enabled: false });
      }
      if (
        path === "/api/pilots/sensors/devices"
        && options?.method === "POST"
      ) {
        return Promise.reject(new Error("backend details"));
      }
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    render(<PilotWorkbench role="admin_xa" />);

    await screen.findByRole("heading", { name: "Thiết bị cảm biến" });
    await user.type(screen.getByLabelText("Tên thiết bị"), "Cảm biến mưa");
    await user.click(screen.getByRole("button", { name: "Tạo thiết bị" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Không thể tạo thiết bị thử nghiệm. Vui lòng thử lại.",
    );
  });

  it("keeps the leadership pilot workspace strictly read-only", async () => {
    mocks.apiJson.mockImplementation((path: string) => {
      if (path === "/api/pilots/status") {
        return Promise.resolve({ iot_enabled: true, tourism_enabled: true });
      }
      if (path === "/api/pilots/sensors/devices") {
        return Promise.resolve([
          {
            id: "device-1",
            name: "Cảm biến mưa",
            device_type: "rain_gauge",
            unit: "mm",
          },
        ]);
      }
      if (path === "/api/pilots/tourism/places/internal") {
        return Promise.resolve([
          {
            id: "place-1",
            name: "Điểm tham quan mẫu",
            category: "nature",
            summary: "Nội dung nội bộ đã kiểm chứng.",
            status: "draft",
          },
        ]);
      }
      return Promise.resolve([]);
    });

    render(<PilotWorkbench role="lanh_dao" />);

    expect(await screen.findByText("Cảm biến mưa")).toBeInTheDocument();
    expect(screen.getByText("Điểm tham quan mẫu")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tên thiết bị")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tên điểm đến")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Duyệt công bố" }),
    ).not.toBeInTheDocument();
    expect(
      mocks.apiJson.mock.calls.some(([, options]) => options?.method),
    ).toBe(false);
  });
});
