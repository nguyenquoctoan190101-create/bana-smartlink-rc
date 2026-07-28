import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecordLookup from "./RecordLookup";

const mocks = vi.hoisted(() => ({ apiJson: vi.fn() }));

vi.mock("../lib/apiClient", () => ({
  apiJson: mocks.apiJson,
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

describe("RecordLookup", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("explains the two supported opaque code formats without exposing PII", () => {
    render(<RecordLookup />);

    expect(screen.getByRole("heading", { name: "Tra cứu hồ sơ" })).toBeInTheDocument();
    expect(screen.getAllByText(/16 ký tự/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/32 ký tự/).length).toBeGreaterThan(0);
    expect(screen.getByText("A1B2C3D4E5F6G7H8")).toBeInTheDocument();
    expect(
      screen.getByText("A1B2C3D4E5F6G7H8J9K0L1M2N3P4Q5R6"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Mã ví dụ — không dùng để tra cứu"),
    ).toHaveLength(2);
    expect(
      screen.getByPlaceholderText("Nhập mã thật đã được cấp (16 hoặc 32 ký tự)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/không tạo danh sách lịch sử tra cứu/),
    ).toBeInTheDocument();
    expect(screen.getByText("Cách hiểu kết quả")).toBeInTheDocument();
    expect(screen.getByText(/không hiển thị thông tin cá nhân/)).toBeInTheDocument();
  });

  it("rejects an invalid code locally instead of calling the API", async () => {
    const user = userEvent.setup();
    render(<RecordLookup />);

    await user.type(screen.getByLabelText("Mã tra cứu thật đã được cấp"), "SAI-MA");
    await user.click(screen.getByRole("button", { name: "Tra cứu" }));

    expect(screen.getByRole("alert")).toHaveTextContent("phải gồm 16 ký tự");
    expect(mocks.apiJson).not.toHaveBeenCalled();
  });

  it("stops a displayed example code before any lookup request", async () => {
    const user = userEvent.setup();
    render(<RecordLookup />);

    await user.type(
      screen.getByLabelText("Mã tra cứu thật đã được cấp"),
      "A1B2C3D4E5F6G7H8",
    );
    await user.click(screen.getByRole("button", { name: "Tra cứu" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Đây là mã ví dụ để minh họa định dạng",
    );
    expect(mocks.apiJson).not.toHaveBeenCalled();
  });

  it("shows localized status and category returned by the shared tracker", async () => {
    mocks.apiJson.mockResolvedValue({
      status: "received",
      case: { category: "road" },
    });
    const user = userEvent.setup();
    render(<RecordLookup />);

    await user.type(screen.getByLabelText("Mã tra cứu thật đã được cấp"), "A".repeat(32));
    await user.click(screen.getByRole("button", { name: "Tra cứu" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Đã tiếp nhận");
    expect(screen.getByRole("status")).toHaveTextContent("Đường giao thông");
    expect(mocks.apiJson).toHaveBeenCalledWith(
      `/api/cases/track/${"A".repeat(32)}`,
      { cache: "no-store" },
    );
  });
});
