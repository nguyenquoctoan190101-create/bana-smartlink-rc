# Ba Na SmartLink — Quy tắc bắt buộc cho AI agent

## QUYẾT ĐỊNH KIẾN TRÚC (đã chốt ngày 08/07/2026 — KHÔNG được tự ý đảo ngược)
CHỈ MỘT backend duy nhất: FastAPI (Python, thư mục gốc: main.py/routers/services) +
PostgreSQL thật qua Supabase (Auth + Row Level Security). Frontend là React (Vite)
build tĩnh, KHÔNG có server Node/Express riêng.

CẤM TUYỆT ĐỐI, không được tạo lại dưới bất kỳ hình thức nào:
- server.ts / bất kỳ Express server nào đứng giữa frontend và FastAPI
- "Mock Supabase client" ghi vào file JSON cục bộ (kiểu MockQueryBuilder/loadMockDB)
- Firebase / Firestore dưới mọi hình thức (đã bị gỡ vì rò rỉ PII ra ngoài kiến trúc duyệt)
- Zalo OA / ZNS / OTP qua Zalo dưới mọi hình thức (kể cả cho "dân" hay cho cán bộ)
- Gọi LLM (Gemini) để tự "phán đoán" tính hợp lệ số liệu — validate CHỈ được đi qua
  services/validator.py + config/validation_rules.json (luật xác định, có thể unit test)

Nếu bạn (agent) thấy code đang vi phạm điều trên — đó là lỗi cần sửa, không phải tính
năng cần giữ, kể cả khi nó "đang chạy được".

## Xác thực & phân quyền
Dùng Supabase Auth thật (JWT) cho admin_xa/can_bo_thon/to_cnscd/lanh_dao. "Dân" KHÔNG
có tài khoản, KHÔNG xác thực SĐT — gửi đề xuất qua form công khai, cán bộ thôn duyệt
thủ công trong bảng pending_updates (đúng thiết kế gốc, không thêm bước xác thực nào).

Mọi bảng chứa dữ liệu thôn (reports, report_values, report_validation_flags,
pending_updates) PHẢI bật Row Level Security thật trên Supabase, không được bỏ qua
bằng service-role key ở phía client hay ở bất kỳ lớp trung gian nào.

## Chatbot & AI
Chatbot chỉ trả lời dựa trên dữ liệu đã truy vấn có giới hạn theo quyền người hỏi
(dân/chưa đăng nhập KHÔNG được thấy CT14 — bạo lực gia đình — và không được thấy dữ
liệu chi tiết cấp report, chỉ số liệu tổng hợp công khai cấp thôn theo đúng
PublicVillagePage.tsx). Không nhồi toàn bộ dữ liệu 10 thôn vào 1 system prompt nếu
người hỏi không có quyền xem hết.

## Nguyên tắc code
- Frontend gọi API DUY NHẤT qua biến VITE_API_BASE_URL, KHÔNG dùng đường dẫn tương
  đối "/api/..." trỏ tới server không tồn tại.
- Không hard-code đường dẫn máy cá nhân (C:/Users/..., /home/username/...) trong test.
- Mọi secret đọc từ biến môi trường qua services/settings.py, không hard-code, không
  commit file .env thật.
- Sau khi sửa xong 1 việc, LUÔN chạy `pytest tests/ -q` và báo lại kết quả pass/fail
  thật (không tự suy đoán là đã pass).
