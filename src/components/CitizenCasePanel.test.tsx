import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    const user = userEvent.setup();
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

    await user.type(
      screen.getByLabelText(/Mô tả sự cố/),
      "Đèn đường không sáng.",
    );
    await user.type(screen.getByLabelText(/Số điện thoại/), "123");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Gửi phản ánh" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Số điện thoại chưa đúng định dạng",
    );
    expect(mocks.apiJson).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/Số điện thoại/));
    await user.type(screen.getByLabelText(/Số điện thoại/), "0901 234 567");
    await user.click(screen.getByRole("button", { name: "Gửi phản ánh" }));

    await waitFor(() => expect(mocks.apiJson).toHaveBeenCalledOnce());
    expect(JSON.parse(mocks.apiJson.mock.calls[0][1].body)).toMatchObject({
      description: "Đèn đường không sáng.",
      submitter_phone: "0901234567",
      consent_version: "1.0-2026-07-26",
    });
  });
});
