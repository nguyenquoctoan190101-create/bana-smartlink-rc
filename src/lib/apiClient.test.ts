import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));

import {
  ApiError,
  apiFetch,
  apiJson,
  apiUrl,
  toUserFacingError,
} from "./apiClient";

describe("apiClient", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
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

  it("keeps public requests available when a stale staff session is broken", async () => {
    mocks.getSession.mockRejectedValue(new Error("stale refresh token"));
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify([{ id: "village-1" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(apiJson("/reports/villages", { auth: "none" })).resolves.toEqual([
      { id: "village-1" },
    ]);

    expect(mocks.getSession).not.toHaveBeenCalled();
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(init).not.toHaveProperty("auth");
  });

  it("builds direct download URLs through the configured API boundary", () => {
    expect(apiUrl("reports/public/export.csv")).toBe(
      "/reports/public/export.csv",
    );
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

  it("allows a specific not-found message for the current user task", () => {
    expect(
      toUserFacingError(
        new ApiError("Not found", 404),
        "Không thể thực hiện thao tác.",
        { notFound: "Không tìm thấy hồ sơ tương ứng." },
      ),
    ).toBe("Không tìm thấy hồ sơ tương ứng.");
  });

  it("translates actionable backend validation messages", () => {
    expect(toUserFacingError(new ApiError("Unsupported file type", 400), "Không tải được tệp.")).toBe(
      "Loại tệp chưa được hỗ trợ.",
    );
    expect(toUserFacingError(new Error("File content does not match extension"), "Không tải được tệp.")).toBe(
      "Nội dung tệp không đúng với phần mở rộng. Vui lòng xuất lại tệp đúng định dạng rồi thử lại.",
    );
    expect(toUserFacingError(new ApiError("Leadership role is read-only", 409), "Không thể lưu báo cáo.")).toBe(
      "Tài khoản lãnh đạo chỉ được xem dữ liệu.",
    );
  });

  it("does not expose unknown English backend messages", () => {
    expect(toUserFacingError(new ApiError("Unable to perform future operation", 422), "Không thể thực hiện thao tác.")).toBe(
      "Không thể thực hiện thao tác.",
    );
    expect(toUserFacingError(new Error("Field required"), "Vui lòng kiểm tra dữ liệu.")).toBe(
      "Vui lòng kiểm tra dữ liệu.",
    );
  });
});
