import { supabase } from "./supabase";
import type { ApiErrorPayload } from "../types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export type ApiRequestInit = RequestInit & {
  auth?: "session" | "none";
};

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

const BACKEND_MESSAGE_TRANSLATIONS: Record<string, string> = {
  "unsupported file type": "Loại tệp chưa được hỗ trợ.",
  "empty file": "Tệp đang rỗng. Vui lòng chọn tệp có dữ liệu.",
  "file content does not match extension":
    "Nội dung tệp không đúng với phần mở rộng. Vui lòng xuất lại tệp đúng định dạng rồi thử lại.",
  "unsupported ocr image format": "Định dạng ảnh chưa được hỗ trợ để nhận dạng số liệu.",
  "invalid tracking code": "Mã tra cứu không đúng định dạng.",
  "invalid status filter": "Bộ lọc trạng thái không hợp lệ.",
  "invalid report period": "Kỳ báo cáo không hợp lệ.",
  "invalid email": "Địa chỉ thư điện tử không hợp lệ.",
  "unsupported report source": "Nguồn dữ liệu báo cáo chưa được hỗ trợ.",
  "user has no village assignment": "Tài khoản chưa được phân công thôn.",
  "leadership role is read-only": "Tài khoản lãnh đạo chỉ được xem dữ liệu.",
  "administrators review reports but do not enter village data":
    "Quản trị viên chỉ rà soát báo cáo, không nhập số liệu thay cho thôn.",
  "role cannot modify reports": "Vai trò hiện tại không được phép sửa báo cáo.",
  "cannot modify an unassigned village":
    "Bạn không được phép sửa dữ liệu của thôn chưa được phân công.",
  "cannot read an unassigned village":
    "Bạn không được phép xem dữ liệu của thôn chưa được phân công.",
  "report validation failed": "Báo cáo chưa đạt các quy tắc kiểm tra dữ liệu.",
};

const translateBackendMessage = (message: string): string | null =>
  BACKEND_MESSAGE_TRANSLATIONS[message.trim().toLowerCase()] || null;

const looksLikeUntranslatedBackendMessage = (message: string): boolean =>
  /\b(unable|invalid|unsupported|not found|cannot|failed|failure|field required|input should|empty file|leadership role|administrators|user has no|role cannot|does not match)\b/i.test(
    message,
  );

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
    const translated = translateBackendMessage(error.message);
    if (translated) return translated;
    if (looksLikeUntranslatedBackendMessage(error.message)) return fallback;
    return error.message || fallback;
  }
  if (error instanceof Error) {
    if (/internal server error|server error|bad gateway|service unavailable/i.test(error.message)) {
      return "Hệ thống đang tạm thời không sẵn sàng. Vui lòng thử lại sau ít phút.";
    }
    if (/failed to fetch|network error|load failed|fetch failed/i.test(error.message)) {
      return "Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.";
    }
    const translated = translateBackendMessage(error.message);
    if (translated) return translated;
    if (looksLikeUntranslatedBackendMessage(error.message)) return fallback;
    return error.message || fallback;
  }
  return fallback;
}

function toUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${cleanPath}`;
}

/** Build a direct API URL for browser-native downloads without bypassing VITE_API_BASE_URL. */
export function apiUrl(path: string): string {
  return toUrl(path);
}

export async function apiFetch(path: string, options: ApiRequestInit = {}): Promise<Response> {
  let token: string | undefined;
  if (options.auth !== "none") {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      throw new ApiError("Không thể kiểm tra phiên đăng nhập.", 401, { code: "AUTH_SESSION_ERROR" });
    }
    token = data.session?.access_token;
  }

  const requestOptions = { ...options };
  delete requestOptions.auth;
  const headers = new Headers(requestOptions.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (requestOptions.body && !(requestOptions.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");

  return fetch(toUrl(path), {
    ...requestOptions,
    headers,
    credentials: "same-origin",
  });
}

/** Upload multipart data with observable byte progress and the same auth boundary. */
export async function apiUpload(
  path: string,
  body: FormData,
  onProgress?: (percentage: number) => void,
): Promise<Response> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new ApiError("Không thể kiểm tra phiên đăng nhập.", 401, {
      code: "AUTH_SESSION_ERROR",
    });
  }

  return new Promise<Response>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", toUrl(path));
    request.responseType = "text";
    request.withCredentials = true;
    request.setRequestHeader("Accept", "application/json");
    const token = data.session?.access_token;
    if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    request.onerror = () => reject(new TypeError("Failed to fetch"));
    request.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    request.onload = () => {
      const headers = new Headers();
      request.getAllResponseHeaders()
        .trim()
        .split(/[\r\n]+/)
        .filter(Boolean)
        .forEach((line) => {
          const separator = line.indexOf(":");
          if (separator > 0) {
            headers.append(
              line.slice(0, separator).trim(),
              line.slice(separator + 1).trim(),
            );
          }
        });
      onProgress?.(100);
      resolve(new Response(request.responseText, {
        status: request.status,
        statusText: request.statusText,
        headers,
      }));
    };
    request.send(body);
  });
}

export async function apiJson<T>(path: string, options: ApiRequestInit = {}): Promise<T> {
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
