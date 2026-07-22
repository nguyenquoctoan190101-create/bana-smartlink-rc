import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));

import { ApiError, apiFetch, apiJson, toUserFacingError } from "./apiClient";

describe("apiClient", () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "test-access-token" } },
      error: null,
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  it("adds the current bearer token without persisting a second copy", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    await apiFetch("/reports");
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-access-token");
    expect(localStorage.getItem("supabase_access_token")).toBeNull();
  });

  it("uses the structured backend error and request id", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      code: "REPORT_CONFLICT",
      message: "Báo cáo đã được cập nhật ở thiết bị khác.",
      request_id: "req-123",
    }), { status: 409, headers: { "content-type": "application/json" } }));

    await expect(apiJson("/reports/id", { method: "PATCH" })).rejects.toMatchObject({
      status: 409,
      code: "REPORT_CONFLICT",
      requestId: "req-123",
    });
  });

  it("rejects an HTML SPA fallback instead of parsing it as API data", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("<!doctype html><title>SPA</title>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));
    await expect(apiJson("/reports")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("does not expose server or transport errors in the UI", () => {
    expect(toUserFacingError(new ApiError("Internal server error", 500), "Không tải được dữ liệu.")).toBe(
      "Hệ thống đang tạm thời không sẵn sàng. Vui lòng thử lại sau ít phút.",
    );
    expect(toUserFacingError(new Error("Internal server error"), "Không tải được dữ liệu.")).toBe(
      "Hệ thống đang tạm thời không sẵn sàng. Vui lòng thử lại sau ít phút.",
    );
    expect(toUserFacingError(new Error("Failed to fetch"), "Không tải được dữ liệu.")).toBe(
      "Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.",
    );
  });

  it("keeps actionable validation messages", () => {
    expect(toUserFacingError(new ApiError("Giá trị CT01 không hợp lệ.", 422), "Không hợp lệ.")).toBe(
      "Giá trị CT01 không hợp lệ.",
    );
  });
});
