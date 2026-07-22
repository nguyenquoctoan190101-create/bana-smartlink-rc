import { supabase } from "./supabase";
import type { ApiErrorPayload } from "../types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, payload: ApiErrorPayload = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = payload.code || (typeof payload.detail === "object" ? payload.detail?.code : undefined) || "HTTP_ERROR";
    this.requestId = payload.request_id;
    this.details = payload.details;
  }
}

/** Convert transport/backend failures into safe, actionable Vietnamese copy. */
export function toUserFacingError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status >= 500 || error.code === "INVALID_RESPONSE") {
      return "Hệ thống đang tạm thời không sẵn sàng. Vui lòng thử lại sau ít phút.";
    }
    if (error.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
    if (error.status === 403) return "Bạn không có quyền thực hiện thao tác này.";
    if (error.status === 404) return "Không tìm thấy dữ liệu yêu cầu hoặc dữ liệu đã thay đổi.";
    if (error.status === 429) return "Bạn thao tác quá nhanh. Vui lòng thử lại sau.";
    return error.message || fallback;
  }
  if (error instanceof Error) {
    if (/internal server error|server error|bad gateway|service unavailable/i.test(error.message)) {
      return "Hệ thống đang tạm thời không sẵn sàng. Vui lòng thử lại sau ít phút.";
    }
    if (/failed to fetch|network error|load failed|fetch failed/i.test(error.message)) {
      return "Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.";
    }
    return error.message || fallback;
  }
  return fallback;
}

function toUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${cleanPath}`;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new ApiError("Không thể kiểm tra phiên đăng nhập.", 401, { code: "AUTH_SESSION_ERROR" });
  }

  const headers = new Headers(options.headers);
  const token = data.session?.access_token;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");

  return fetch(toUrl(path), {
    ...options,
    headers,
    credentials: "same-origin",
  });
}

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, options);
  const contentType = response.headers.get("content-type") || "";
  let payload: unknown = null;

  if (response.status !== 204) {
    if (!contentType.includes("application/json")) {
      throw new ApiError("Máy chủ trả về dữ liệu không đúng định dạng JSON.", response.status, {
        code: "INVALID_RESPONSE",
        request_id: response.headers.get("x-request-id") || undefined,
      });
    }
    payload = await response.json();
  }

  if (!response.ok) {
    const errorPayload = (payload || {}) as ApiErrorPayload;
    const nestedMessage = typeof errorPayload.detail === "object" ? errorPayload.detail?.message : undefined;
    const message = errorPayload.message || nestedMessage || (typeof errorPayload.detail === "string" ? errorPayload.detail : undefined) || "Yêu cầu không thành công.";
    throw new ApiError(message, response.status, errorPayload);
  }

  return payload as T;
}
