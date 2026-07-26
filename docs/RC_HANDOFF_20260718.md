# Ba Na SmartLink — RC handoff 18/07/2026

> Hồ sơ lịch sử của commit/lần kiểm thử ngày 18/07/2026. Không dùng số lượng
> test, tên ZIP hoặc trạng thái trong tài liệu này để xác nhận bản hiện hành.
> Quy trình hiện hành nằm tại `docs/DELIVERY_GOVERNANCE.md`.

## Phạm vi đã hoàn tất trong mã nguồn

- Nền báo cáo CT01–CT14: trạng thái workflow/timeliness/publication tách biệt,
  validation deterministic, optimistic version và idempotency.
- Cổng công khai: chỉ projection CT01, CT02, CT09, CT12, CT13 đã publish; không
  trả CT14, PII hoặc ghi chú nội bộ.
- Phản ánh hiện trường: gửi không cần tài khoản, mã tra cứu ngẫu nhiên 128-bit,
  trạng thái công khai đã lọc, tọa độ chỉ lưu sau xác nhận và tối đa năm ảnh
  JPG/PNG/WebP trong bucket private. Video bị từ chối fail-closed cho đến khi có
  probe thời lượng phía máy chủ.
- Hộp việc, kho tri thức, Digital Champions và what-if xác định đã có API/UI nội
  bộ; what-if chỉ ghi kết quả mô phỏng, không ghi ngược báo cáo thật.
- Chatbot giữ scope theo principal; khi Gemini không sẵn sàng vẫn có câu trả lời
  deterministic từ dữ liệu đã lọc và từ chối câu hỏi ngoài phạm vi một cách rõ
  ràng.
- Pilot IoT/du lịch và voice bị tắt mặc định bằng feature flag; không được bật
  trên production nếu chưa có bằng chứng vận hành tương ứng.

## Kết quả kiểm chứng tự động

| Gate | Kết quả |
| --- | --- |
| Backend tests | `389 passed` |
| Ruff | Pass |
| Frontend typecheck | Pass |
| Frontend Vitest | `10 files, 19 tests passed` |
| Production build | Pass |
| Bundle budget | Pass (JS ≤ 500 KiB, CSS ≤ 150 KiB) |
| Release hygiene | Pass, 312 files inspected |
| Secret scan, kể cả archive | Pass, không có finding |

Gói lịch sử dùng tên `BaNaSmartLink_fixed.zip`. Bản hiện hành phải dùng
`BaNaSmartLink_release.zip`, manifest trong gói và checksum `.sha256` bên cạnh
theo `docs/DELIVERY_GOVERNANCE.md`; không tái sử dụng ZIP lịch sử.

## Không thể xác nhận bằng mã nguồn

Bản này vẫn là release candidate dùng dữ liệu tổng hợp. Trước khi nhập dữ liệu
thật, người vận hành phải bổ sung bằng chứng cho: rotate secret/session và rà
access/usage log; migration + RLS matrix trên staging Supabase mới; backup/restore
drill; UAT năm principal và browser accessibility; privacy/legal approval; danh
mục phòng ban/SLA, retention, bản quyền media/nội dung, và phê duyệt phát hành.

Không gọi hệ thống là production-ready khi các mục trên chưa được ký trong
`production_attestation.json`. Các lệnh fail-closed nằm trong README và
`docs/RUNBOOK.md`.

## Giới hạn có chủ đích của RC

- Chưa bật voice/STT, IoT, tourism, proactive chatbot, predictive maintenance,
  dự báo AI, Digital Twin hoặc WebAR toàn diện.
- Không có kênh Zalo/SMS tích hợp sẵn; in-app notification là kênh cơ bản.
- Tải media cần storage bucket private của Supabase; nếu bucket chưa được tạo
  bởi migration thì upload phải báo lỗi, không tự rơi về public storage.
