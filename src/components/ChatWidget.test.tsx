import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatWidget from "./ChatWidget";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("../lib/apiClient", () => ({
  apiFetch: mocks.apiFetch,
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ChatWidget suggestions", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.apiFetch.mockResolvedValue(jsonResponse({ voice_enabled: false }));
  });
  afterEach(() => cleanup());

  it("shows only public-safe indicator suggestions to citizens", () => {
    render(<ChatWidget userPhone={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Mở tra cứu số liệu" }));

    expect(
      screen.getByRole("button", { name: "Thôn Phú Hòa có bao nhiêu hộ dân?" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Thôn tôi có bao nhiêu hộ nghèo?" }),
    ).not.toBeInTheDocument();

    expect(
      screen.getByText(
        "Không nhập họ tên, số điện thoại, địa chỉ hoặc số giấy tờ cá nhân.",
      ),
    ).toBeInTheDocument();
  });

  it("shows internal workflow suggestions to authenticated staff", () => {
    render(<ChatWidget userPhone="0900000101" />);
    fireEvent.click(screen.getByRole("button", { name: "Mở tra cứu số liệu" }));

    expect(
      screen.getByRole("button", { name: "Thôn tôi có bao nhiêu hộ nghèo?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Thôn nào chưa nộp báo cáo kỳ này?" }),
    ).toBeInTheDocument();
  });

  it("hides the closed panel from keyboard users and restores focus after Escape", async () => {
    render(<ChatWidget userPhone={null} />);
    const toggle = screen.getByRole("button", { name: "Mở tra cứu số liệu" });

    expect(screen.queryByRole("dialog", { name: "Tra cứu số liệu" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole("dialog", { name: "Tra cứu số liệu" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Tra cứu số liệu" })).not.toBeInTheDocument();
      expect(toggle).toHaveFocus();
    });
  });

  it("keeps voice input hidden when the backend feature flag is disabled", async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({ voice_enabled: false }));
    render(<ChatWidget userPhone={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Mở tra cứu số liệu" }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith("/ai/capabilities"));
    expect(
      screen.queryByRole("button", { name: "Nhập câu hỏi bằng giọng nói" }),
    ).not.toBeInTheDocument();
  });

  it("shows voice input only after the backend feature flag is enabled", async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse({ voice_enabled: true }));
    render(<ChatWidget userPhone={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Mở tra cứu số liệu" }));

    expect(
      await screen.findByRole("button", { name: "Nhập câu hỏi bằng giọng nói" }),
    ).toBeInTheDocument();
  });

  it("renders the source, update time, scope and limitations returned by the API", async () => {
    mocks.apiFetch
      .mockResolvedValueOnce(jsonResponse({ voice_enabled: false }))
      .mockResolvedValueOnce(jsonResponse({
        answer: "Thôn Phú Hòa có 120 hộ dân.",
        intent: "VILLAGE_INDICATOR",
        rows_retrieved: 1,
        sources: [{
          kind: "report_data",
          title: "CT01 — Số hộ dân",
          scope: "Thôn Phú Hòa",
          period: "Tháng 7/2026",
          reference: "CT01",
        }],
        as_of: "2026-07-25T08:00:00+00:00",
        data_scope: "public_published",
        limitations: ["Chỉ phản ánh dữ liệu đã công bố."],
      }));
    render(<ChatWidget userPhone={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Mở tra cứu số liệu" }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith("/ai/capabilities"));
    fireEvent.click(
      screen.getByRole("button", { name: "Thôn Phú Hòa có bao nhiêu hộ dân?" }),
    );

    expect(await screen.findByText("CT01 — Số hộ dân")).toBeInTheDocument();
    expect(screen.getByText("Dữ liệu tổng hợp đã công bố")).toBeInTheDocument();
    expect(screen.getByText("Chỉ phản ánh dữ liệu đã công bố.")).toBeInTheDocument();
  });
});
