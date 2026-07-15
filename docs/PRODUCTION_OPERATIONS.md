# Gói vận hành production: chất lượng dữ liệu, điều hành và đổi mới

## Phạm vi đã có trong mã nguồn

`20260714_0003_production_operations.sql` bổ sung bốn miền dữ liệu có RLS:

- `action_items`: cảnh báo hoặc việc thủ công có owner, hạn, trạng thái, kết quả và nguồn.
- `digital_maturity_assessments`: scorecard quý theo sáu trụ cột `strategy`, `process`, `data`, `people`, `security`, `governance`; từng điểm là 1–5 và phải kèm evidence/kế hoạch.
- `innovation_initiatives`: vấn đề, giả thuyết giá trị, owner, effort, rủi ro dữ liệu, KPI trước/sau và quyết định portfolio.
- `ai_action_drafts`: bản nháp điều hành có citations, confidence, model provider và trạng thái `pending_review`/`accepted`/`rejected`.

Mọi bản ghi mang `commune_id`; bản ghi theo thôn/kỳ có `village_id`/`period_id`. `admin_xa` tạo và duyệt; `lanh_dao` chỉ đọc nội bộ; cán bộ chỉ xem việc thuộc owner hoặc thôn được RLS cho phép. Không có policy `anon` cho các bảng này.

## Trung tâm chất lượng dữ liệu

API `GET /api/operations/quality?period_id={uuid}` tính trực tiếp từ báo cáo, giá trị và validation flag mà JWT gọi được RLS cho phép. Kết quả luôn giữ `null` là thiếu dữ liệu, không ép thành `0`; bao gồm:

- completeness trên CT01–CT14,
- validity từ các lỗi chặn có trạng thái chưa resolve,
- timeliness do server xác định,
- outlier/unresolved count,
- lineage gồm `report_source`, `report_version`, `rule_version`.

Điểm tổng hợp chỉ là chỉ dấu điều hành, không thay thế validator deterministic hay quyết định nghiệp vụ.

## AI có kiểm soát

`POST /api/operations/ai-drafts` hiện tạo brief deterministic từ số lượng báo cáo, điểm chất lượng và trạng thái lỗi/nộp muộn đã được quyền xem. Nó không gửi PII, giá trị CT14 hoặc bất kỳ chỉ tiêu nào vào nội dung/citation; không tự tạo action, cập nhật báo cáo, duyệt hay công bố.

Chỉ `admin_xa` được gọi endpoint review. Một tích hợp LLM sau này phải giữ đúng contract này: input đã redaction, citations có cấu trúc, confidence, rate/cost limit, red-team prompt injection và human review trước mọi hành động.

## Cổng người dân

Mỗi kiến nghị được database sinh `tracking_code` 16 ký tự ngẫu nhiên. `GET /auth/citizen/pending-updates/{tracking_code}` bị rate-limit và chỉ trả mã, trạng thái, CT công khai, thời điểm gửi, thông điệp chung. Nó không truy vấn/trả tên, điện thoại, địa chỉ, hộ, quan hệ, lý do hay CT14. Mã tra cứu không phải cơ chế xác thực tài khoản và không được ghi log ở dạng đầy đủ.

## Gate không thể xác nhận bằng mã nguồn

Các mục sau vẫn phải có bằng chứng độc lập trước production: rotate credential/session và xem usage log, migration/RLS trên staging mới, backup-restore drill, UAT 5 principal, accessibility browser QA, legal/privacy sign-off, SAST/SCA/secret scan CI và phê duyệt release. Xem `README.md`, `docs/RUNBOOK.md` và `scripts/production_gate.py`; các lệnh gate fail-closed, không coi dữ liệu mẫu là bằng chứng production.
