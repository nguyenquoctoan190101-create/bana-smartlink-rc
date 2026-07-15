# Checklist xử lý credential đã lộ

Các khóa từng xuất hiện trong ZIP phải được coi là đã bị xâm phạm. Việc xóa
chuỗi khỏi mã nguồn không làm cho khóa cũ an toàn trở lại.

## Hành động của chủ sở hữu dịch vụ

1. Đóng băng triển khai và lưu bản sao artifact làm bằng chứng, hạn chế quyền
   truy cập vào bản sao đó.
2. Rotate mật khẩu PostgreSQL, Supabase service-role/JWT signing key, Gemini
   API key và mọi khóa Zalo từng tạo.
3. Vô hiệu hóa session cũ; xóa hoặc reset toàn bộ tài khoản demo.
4. Kiểm tra DB/Auth/API/usage logs từ thời điểm artifact đầu tiên được chia sẻ;
   lưu lại actor, IP, thời gian và hành động bất thường.
5. Xác minh không có dữ liệu thật trong DB/DB local/artifact; nếu có, kích hoạt
   quy trình thông báo sự cố của đơn vị.
6. Purge artifact chứa khóa khỏi kho lưu trữ và lịch sử Git theo quy trình có
   phê duyệt; không xóa bản bằng chứng duy nhất trước khi điều tra hoàn tất.
7. Cấp credential mới cho một staging mới, chỉ chứa dữ liệu tổng hợp.

## Kiểm soát phòng ngừa

- `.env.example` chỉ chứa placeholder.
- Ứng dụng fail startup khi thiếu biến bắt buộc ở staging/production.
- CI quét secret trong source và cả archive lồng nhau.
- Script release dùng allowlist và từ chối `.env`, DB local, build cũ, cache,
  credential demo và archive lồng.
- Không ghi token, connection string, payload PII hoặc response Supabase nguyên
  bản vào log.

## Điều kiện đóng sự cố

- Tất cả khóa cũ đã revoke và khóa mới chưa từng nằm trong source/artifact.
- Tài khoản demo đã bị xóa hoặc reset và session cũ không còn hợp lệ.
- Log review có kết luận bằng văn bản.
- Secret scan release trả về 0 finding thật.

