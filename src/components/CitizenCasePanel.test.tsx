import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CitizenCasePanel from "./CitizenCasePanel";

const mocks = vi.hoisted(() => ({ apiJson: vi.fn() }));

vi.mock("../lib/apiClient", () => ({
  apiJson: mocks.apiJson,
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

describe("CitizenCasePanel", () => {
  beforeEach(() => {
    mocks.apiJson.mockReset();
  });

  afterEach(() => cleanup());

  it("selects the first village when the public catalogue finishes loading", async () => {
    const { rerender } = render(
      <CitizenCasePanel villages={[]} onBack={vi.fn()} />,
    );

    rerender(
      <CitizenCasePanel
        villages={[{ id: "village-1", name: "Thôn An Sơn" }]}
        onBack={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Thôn" })).toHaveValue(
        "village-1",
      ),
    );
  });

  it("validates and normalizes optional contact information before submission", async () => {
    mocks.apiJson.mockResolvedValue({
      tracking_code: "A".repeat(32),
      case: { id: "case-1", status: "received" },
      message: "Đã tiếp nhận",
    });
    render(
      <CitizenCasePanel
        villages={[{ id: "village-1", name: "Thôn An Sơn" }]}
        onBack={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Mô tả sự cố/), {
      target: { value: "Đèn đường không sáng." },
    });
    fireEvent.change(screen.getByLabelText(/Số điện thoại/), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Gửi phản ánh" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Số điện thoại chưa đúng định dạng",
    );
    expect(mocks.apiJson).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Số điện thoại/), {
      target: { value: "0901 234 567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi phản ánh" }));

    await waitFor(() => expect(mocks.apiJson).toHaveBeenCalledOnce());
    expect(JSON.parse(mocks.apiJson.mock.calls[0][1].body)).toMatchObject({
      description: "Đèn đường không sáng.",
      submitter_phone: "0901234567",
      consent_version: "1.0-2026-07-26",
    });
  });
});
