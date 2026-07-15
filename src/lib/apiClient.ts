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
