# Phương án demo dự phòng Ba Na SmartLink

Tài liệu này bổ sung cho [kịch bản demo chính](DEMO_AND_HANDOVER_SCRIPT.md).
Mục tiêu là tiếp tục trình bày trung thực khi mạng, Render, Supabase, OCR hoặc
tài khoản gặp sự cố; phương án dự phòng không được trình bày như bằng chứng
production hay UAT.

## Chuẩn bị trước buổi demo

1. Ghi full commit SHA, tag, URL và thời gian kiểm tra gần nhất.
2. Chỉ dùng tài khoản và dữ liệu tổng hợp dành cho demo; không lưu mật khẩu
   trong slide, script, trình duyệt hoặc video.
3. Chuẩn bị bản trình chiếu/video đã duyệt của đúng commit, kèm phụ đề và
   transcript. Ảnh phải che email, token, mã tra cứu, thông tin cá nhân và thanh
   địa chỉ nhạy cảm.
4. Lưu checksum của slide/video/ảnh trong kho bằng chứng có phân quyền. Không
   đưa archive cũ hoặc dữ liệu thật vào release ZIP.
5. Kiểm tra `/health/live`, `/health/ready` và full SHA theo
   [runbook](RUNBOOK.md) trước khi mở phòng.
6. Có một người trình bày, một người vận hành và một người ghi nhận thời
   điểm/sự cố; thống nhất tín hiệu chuyển sang phương án dự phòng.

## Cây quyết định nhanh

```text
Ứng dụng hoạt động và đúng SHA?
  Có -> demo trực tiếp theo kịch bản chính.
  Không -> health/readiness có phục hồi an toàn trong thời gian chờ đã công bố?
            Có -> giải thích cold start, xác minh lại SHA rồi tiếp tục.
            Không -> dừng demo trực tiếp, dùng video/ảnh của đúng commit.

Đăng nhập hoặc dịch vụ AI lỗi nhưng cổng công khai còn hoạt động?
  Có -> demo phần công khai, sau đó dùng video/ảnh cho phần nội bộ/AI.
  Không -> dùng toàn bộ phương án ghi sẵn và ghi rõ sự cố.
```

## Tình huống và cách xử lý

### 1. Mất mạng tại địa điểm

- Xác nhận đây là lỗi kết nối của thiết bị, không liên tục tải lại hoặc chuyển
  sang hotspot cá nhân chứa credential không kiểm soát.
- Trình bày video/ảnh đã duyệt và sơ đồ trong
  [ARCHITECTURE.md](ARCHITECTURE.md).
- Nếu demo hàng đợi ngoại tuyến, chỉ dùng dữ liệu tổng hợp đã chuẩn bị; nói rõ
  đồng bộ thực tế sẽ được kiểm tra lại khi mạng phục hồi.
- Ghi “demo ghi sẵn do mất mạng”; không đánh dấu smoke/UAT production là đạt.

### 2. Render cold start hoặc health chưa sẵn sàng

- Mở `/health/live` và `/health/ready`; chờ theo ngân sách thời gian đã thống
  nhất, không coi liveness là readiness.
- Khi dịch vụ sẵn sàng, chạy kiểm tra full SHA trước khi đăng nhập.
- Nếu quá thời gian chờ, chuyển sang video/ảnh. Người vận hành lưu thời điểm và
  trạng thái để điều tra sau buổi demo.

### 3. Tài khoản lỗi, bị khóa hoặc sai phạm vi

- Không dùng tài khoản của người khác và không reset mật khẩu trước khán giả.
- Tiếp tục phần công khai; dùng video/ảnh cho role bị lỗi.
- Nếu tài khoản thấy sai thôn/xã hoặc quyền rộng hơn dự kiến, dừng toàn bộ phần
  nội bộ, đăng xuất và kích hoạt [quy trình sự cố](SECURITY_INCIDENT_RESPONSE.md).

### 4. Supabase/database chưa sẵn sàng

- Không chạy migration, seed hoặc restore phá hủy trong buổi trình bày.
- Chuyển sang bản ghi sẵn; giữ nguyên database để người vận hành thu thập log.
- Sau demo, xử lý theo [RUNBOOK.md](RUNBOOK.md); bằng chứng cũ không thay thế
  restore/RLS test của release hiện hành.

### 5. OCR ảnh/PDF bị khóa hoặc Gemini không sẵn sàng

- Đây là trạng thái dự kiến của staging/production; tiếp tục bằng nhập thủ công
  hoặc Excel.
- Không gửi ảnh nguyên trang có thông tin cá nhân sang công cụ khác.
- Dùng video/ảnh để giải thích preview, confidence, vùng nguồn và bước cán bộ
  xác nhận; không tuyên bố độ chính xác khi chưa có
  [benchmark](AI_BENCHMARK_PROTOCOL.md).

### 6. Trình duyệt, máy chiếu hoặc responsive lỗi

- Chuyển sang profile/trình duyệt sạch đã kiểm tra; không tắt kiểm soát bảo mật.
- Nếu vẫn lỗi, dùng ảnh 1440px và 390px của đúng commit, có thời gian và browser
  trong metadata bằng chứng nhưng không chứa thông tin cá nhân.
- Ghi lỗi để browser QA lại; ảnh dự phòng không thay thế accessibility UAT.

### 7. Production không khớp commit

- Dừng demo production. Không dựa vào thời gian deploy, tên release hoặc short
  SHA.
- Dùng môi trường đã xác minh hoặc video/ảnh của commit dự kiến; nói rõ
  production chưa cập nhật.
- Chỉ tiếp tục smoke sau khi
  [`production_sha_smoke.py`](../scripts/production_sha_smoke.py) đạt.

### 8. Nguy cơ lộ secret hoặc thông tin cá nhân

- Dừng chia sẻ màn hình ngay, không chụp thêm và không cố che bằng thao tác tạm
  trên màn hình đang phát.
- Cô lập artifact/phiên, báo đầu mối sự cố và ghi thời điểm/phạm vi.
- Không tiếp tục demo nội bộ cho đến khi người phụ trách xác nhận an toàn.

## Gói dự phòng tối thiểu

| Hiện vật | Điều kiện |
|---|---|
| Video demo ≤5 phút | Đúng commit, dữ liệu tổng hợp, không secret/thông tin cá nhân, có phụ đề |
| Slide/PDF demo | Có full SHA và nhãn “bản ghi minh họa”; link căn cứ kỹ thuật |
| Ảnh desktop/mobile | 1440px và 390px, đã rà soát quyền riêng tư |
| Transcript | Mô tả đúng trạng thái RC và các gate còn chờ |
| Hash manifest | SHA-256 từng hiện vật, ngày tạo, người kiểm tra |
| Bản in kịch bản | Luồng chính, cây quyết định và thông tin liên hệ sự cố |

Sau buổi demo, ghi phương án đã dùng, thời lượng gián đoạn, chức năng chưa thể
chứng minh và owner xử lý vào [mẫu nghiệm thu](ACCEPTANCE_TEMPLATE.md). Không
chuyển một mục từ “Chờ” sang “Đạt” chỉ vì video dự phòng chạy thành công.
