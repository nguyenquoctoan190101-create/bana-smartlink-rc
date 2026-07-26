# Kiến trúc BaNa SmartLink

## Quyết định kiến trúc

BaNa SmartLink dùng một backend FastAPI, frontend React/Vite build tĩnh và
PostgreSQL/Supabase Auth + Row Level Security. Frontend chỉ dùng Supabase cho
xác thực; mọi dữ liệu nghiệp vụ đi qua FastAPI. Không có Express, Firebase hay
Zalo. Gemini không có quyền quyết định số liệu hợp lệ.

```text
Browser (React/Vite)
  |-- Supabase Auth: đăng nhập/refresh session cho cán bộ
  `-- FastAPI: toàn bộ dữ liệu nghiệp vụ
        |-- JWT + profile + role/village authorization
        |-- deterministic validator
        |-- nhập trực tiếp/XLSX review
        |-- OCR ngoài: khóa ở staging/production
        |-- export, audit, notifications
        `-- PostgreSQL/Supabase RLS
              `-- public projection: CT01, CT02, CT09, CT12, CT13 đã publish
```

## Ranh giới tin cậy

- Browser và mọi dữ liệu đầu vào là không tin cậy.
- JWT chỉ xác nhận danh tính; profile trong DB quyết định role, village,
  `is_active` và `force_password_reset`.
- RLS là lớp phòng thủ bắt buộc, nhưng backend vẫn kiểm quyền trước khi gọi DB.
- Service-role chỉ dành cho tác vụ quản trị tối thiểu và không xuất hiện trong
  browser, log, fixture, script đóng gói hay tài liệu.
- CT14 và PII không được đưa vào public view, cache công khai, prompt công khai
  hoặc export công khai.

## Trạng thái báo cáo

- `workflow_status`: draft -> submitted -> approved -> locked; có thể trả về
  `needs_revision` từ trạng thái submitted.
- `timeliness_status`: not_submitted, on_time, late; được tính từ deadline phía
  server, không do client gửi.
- `publication_status`: private hoặc published; chỉ admin xã thay đổi.
- Mọi mutation dùng UUID, idempotency key và version để chống submit lặp và
  lost update.

## Phân quyền

- Anonymous: chỉ public projection đã publish và form đề xuất công dân.
- `can_bo_thon`: ghi/xem báo cáo đúng thôn của mình.
- `to_cnscd`: xem/hỗ trợ các thôn được giao, không duyệt.
- `admin_xa`: quản trị kỳ/tài khoản, duyệt, khóa, publish, export.
- `lanh_dao`: chỉ đọc nội bộ và export.

## Dữ liệu địa giới

Danh mục chính thức gồm 10 thôn. Ánh xạ Đông Sơn đang chờ xã xác nhận và luôn
phải giữ cờ chất lượng dữ liệu; không được tự động coi số liệu toàn thôn là số
liệu chính thức của một vùng sau chia tách.
