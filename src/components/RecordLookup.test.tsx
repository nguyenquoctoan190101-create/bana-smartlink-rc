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
    expect(screen.getByText(/16 ký tự/)).toBeInTheDocument();
    expect(screen.getByText(/32 ký tự/)).toBeInTheDocument();
    expect(screen.getByText(/không hiển thị thông tin cá nhân/)).toBeInTheDocument();
  });

  it("rejects an invalid code locally instead of calling the API", async () => {
    const user = userEvent.setup();
    render(<RecordLookup />);

    await user.type(screen.getByLabelText("Mã tra cứu"), "SAI-MA");
    await user.click(screen.getByRole("button", { name: "Tra cứu" }));

    expect(screen.getByRole("alert")).toHaveTextContent("phải gồm 16 ký tự");
    expect(mocks.apiJson).not.toHaveBeenCalled();
  });

  it("shows localized status and category returned by the shared tracker", async () => {
    mocks.apiJson.mockResolvedValue({
      status: "received",
      case: { category: "road" },
    });
    const user = userEvent.setup();
    render(<RecordLookup />);

    await user.type(screen.getByLabelText("Mã tra cứu"), "A".repeat(32));
    await user.click(screen.getByRole("button", { name: "Tra cứu" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Đã tiếp nhận");
    expect(screen.getByRole("status")).toHaveTextContent("Đường giao thông");
    expect(mocks.apiJson).toHaveBeenCalledWith(
      `/api/cases/track/${"A".repeat(32)}`,
      { cache: "no-store" },
    );
  });
});
