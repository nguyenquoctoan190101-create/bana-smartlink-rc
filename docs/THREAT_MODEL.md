# Threat model rút gọn

## Tài sản cần bảo vệ

- CT14, thông tin người lập báo cáo và đề xuất công dân.
- Quyền admin, JWT/session, service-role và credential DB/Gemini.
- Tính toàn vẹn của 14 chỉ tiêu, kỳ báo cáo, workflow duyệt và audit log.
- Quota/chi phí Gemini và tính sẵn sàng của upload/OCR/chatbot.

## Mối đe dọa chính và kiểm soát

| Đe dọa | Kiểm soát bắt buộc |
|---|---|
| Credential trong source/archive | Rotate, allowlist packaging, recursive secret scan |
| Report poisoning/IDOR | Auth ở mọi mutation, village scope, UUID + idempotency |
| Bypass RLS qua service-role | User JWT/RLS cho nghiệp vụ, service-role tối thiểu |
| CT14/PII lộ công khai | Public projection 5 CT, publication gate, no-store |
| XSS/path traversal/formula injection | Escape, containment check, CSP, XLSX sanitization |
| Lost update/mất queue offline | Transaction, version, ACK từng item, giữ reject |
| Upload bomb/AI quota abuse | Magic-byte, size/decompression/pixel limits, rate limit |
| OCR gửi PII | Crop/redaction có preview, fail-closed, human confirmation |
| Prompt injection/hallucination | Scoped retrieval, provenance, từ chối khi thiếu dữ liệu |
| Tài khoản khóa vẫn hoạt động | DB profile check ở backend và RLS |

## Rủi ro còn phụ thuộc bên ngoài

- Rotate credential và review access logs cần quyền trên dịch vụ của chủ sở hữu.
- RLS phải được chạy trên PostgreSQL/Supabase thật; test mô phỏng không đủ.
- Nội dung privacy/legal phải được đầu mối pháp lý của đơn vị phê duyệt.
- Phân bổ dữ liệu Đông Sơn cần xác nhận chính thức từ xã.

