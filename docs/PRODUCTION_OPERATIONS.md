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

`POST /api/operations/ai-drafts` luôn tạo brief deterministic trước từ số lượng báo cáo, điểm chất lượng và trạng thái lỗi/nộp muộn đã được quyền xem. Khi `FEATURE_DECISION_AI=true` và có nhà cung cấp hợp lệ, hệ thống gửi duy nhất gói bằng chứng tổng hợp đã lọc sang AI để bổ sung nhận định, các phương án thay thế, đánh đổi, rủi ro, biện pháp giảm thiểu và câu hỏi phản biện.

Đầu ra AI bị khóa bằng JSON schema, mọi phương án/rủi ro phải dẫn về `evidence_id` có thật, và server từ chối nội dung có mã dẫn chứng lạ, chữ số chưa được luật xác định kiểm chứng, email hoặc số điện thoại. OpenAI dùng Responses API với `store=false`, `safety_identifier` đã băm và mô hình mặc định `gpt-5.6-sol`; cấu hình `auto` ưu tiên OpenAI rồi dùng Gemini đã có. Nếu không có khóa hoặc nhà cung cấp lỗi, brief deterministic vẫn được tạo và giao diện nêu rõ trạng thái fallback.

Không provider nào nhận giá trị chỉ tiêu, CT14, ghi chú báo cáo, tên/điện thoại người dân hoặc quyền gọi công cụ. Chuỗi nhãn trong gói bằng chứng được coi là dữ liệu không đáng tin, không phải chỉ thị. AI không được tự tạo action, cập nhật báo cáo, duyệt hay công bố.

Chỉ `admin_xa` được gọi endpoint review. Người duyệt phải nhập căn cứ ít nhất 10 ký tự; mọi nội dung AI vẫn ở trạng thái `pending_review` trước khi được chấp nhận hoặc từ chối. `confidence` tiếp tục biểu thị độ sẵn sàng của bằng chứng deterministic, không phải “độ tin cậy” tự khai của mô hình.

## Cổng người dân

Mỗi kiến nghị được database sinh `tracking_code` 16 ký tự ngẫu nhiên. `GET /auth/citizen/pending-updates/{tracking_code}` bị rate-limit và chỉ trả mã, trạng thái, CT công khai, thời điểm gửi, thông điệp chung. Nó không truy vấn/trả tên, điện thoại, địa chỉ, hộ, quan hệ, lý do hay CT14. Mã tra cứu không phải cơ chế xác thực tài khoản và không được ghi log ở dạng đầy đủ.

## Gate không thể xác nhận bằng mã nguồn

Các mục sau vẫn phải có bằng chứng độc lập trước production: rotate credential/session và xem usage log, migration/RLS trên staging mới, backup-restore drill, UAT 5 principal, accessibility browser QA, legal/privacy sign-off, SAST/SCA/secret scan CI và phê duyệt release. Xem `README.md`, `docs/RUNBOOK.md` và `scripts/production_gate.py`; các lệnh gate fail-closed, không coi dữ liệu mẫu là bằng chứng production.
