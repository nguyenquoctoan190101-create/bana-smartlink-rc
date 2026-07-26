# Quy trình đánh giá trợ lý trích xuất báo cáo

## Mục đích và giới hạn

Quy trình này đo khả năng trích xuất từng trường từ Excel, ảnh/PDF in rõ và
biểu mẫu viết tay. Đây không phải bằng chứng rằng AI có quyền xác định báo cáo
hợp lệ. `services/validator.py` và `config/validation_rules.json` vẫn là nguồn
quy tắc nghiệp vụ; cán bộ phải xác nhận trước khi dữ liệu được ghi.

Chưa được công bố tỷ lệ “chính xác”, “tự động” hoặc mức giảm thời gian khi chưa
có báo cáo benchmark và UAT được ký. Các tỷ lệ trong tài liệu này là **ngưỡng
nghiệm thu**, không phải kết quả hiện tại.

Trong release candidate 26/07/2026, OCR ảnh/PDF qua dịch vụ ngoài bị khóa bắt
buộc trên staging/production. Quy trình này là một điều kiện cần để xem xét mở
lại tính năng sau privacy/legal review; nó không chứng minh OCR đang sẵn sàng.

## Đăng ký bộ dữ liệu

1. Dùng tối thiểu 100 tài liệu có quyền sử dụng, đã khử định danh hoặc được tạo
   tổng hợp. Không commit tài liệu thật hoặc thông tin cá nhân vào Git.
2. Bao phủ ba nhóm `excel`, `printed_scan`, `handwritten`; có nhiều thôn, kỳ,
   biến thể biểu mẫu, chất lượng ảnh và tình huống ô trống. `null` và `0` phải
   được gán nhãn khác nhau.
3. Chia trước thành `development`, `validation`, `holdout`. Holdout chiếm tối
   thiểu 20% và không ít hơn 20 tài liệu; mỗi nhóm nguồn có ít nhất ba tài liệu
   holdout. Các bản gần trùng hoặc cùng ảnh gốc phải nằm cùng một tập.
4. Hai người gán nhãn độc lập; người thứ ba phân xử bất đồng. Lưu phiên bản hướng
   dẫn gán nhãn, người phê duyệt, nguồn hợp pháp và SHA-256 của manifest trong
   kho bằng chứng có kiểm soát truy cập.
5. Khóa holdout trước khi tinh chỉnh quy tắc/mô hình. Nhóm triển khai không xem
   nhãn holdout cho đến lần đánh giá đã đăng ký.

Không dùng kết quả từ bộ fixture CI làm bằng chứng chất lượng thực địa: fixture
chỉ chứng minh hợp đồng phần mềm và khả năng tái lập.

## Hợp đồng đầu vào

Ground-truth là JSONL, mỗi dòng có dạng:

```json
{"document_id":"d-001","split":"holdout","source_type":"printed_scan","fields":{"CT01":12}}
```

Kết quả của phiên bản cần đánh giá là JSONL riêng:

```json
{"document_id":"d-001","fields":{"CT01":{"value":12,"confidence":0.99,"requires_review":false}}}
```

`confidence` nằm trong `[0,1]`. Mọi trường thiếu, không chắc chắn, bất thường
hoặc không đọc được phải có `requires_review=true`. Bộ đánh giá không tự sửa,
ép kiểu hoặc chuẩn hóa dự đoán vì thao tác đó có thể làm tăng kết quả giả tạo.

## Chạy và lưu bằng chứng

```powershell
python scripts/ocr_benchmark.py `
  --ground-truth <evidence-dir>\ground-truth.jsonl `
  --predictions <evidence-dir>\predictions.jsonl `
  --output <evidence-dir>\benchmark-result.json
```

Mỗi lần chạy phải ghi cùng ticket phát hành:

- commit đủ 40 ký tự, phiên bản extractor/OCR/model và cấu hình;
- SHA-256 của ground-truth, predictions và báo cáo kết quả;
- máy/phiên bản thư viện, ngày chạy, người chạy;
- bảng lỗi theo loại nguồn, trường, mức ảnh hưởng và quyết định xử lý;
- xác nhận holdout chưa được dùng để tinh chỉnh.

## Thước đo và ngưỡng nghiệm thu

- Exact-match theo trường và theo tài liệu, báo cáo riêng cho từng loại nguồn.
- Excel: exact-match theo trường `>=99%`.
- Ảnh/PDF in rõ: exact-match theo trường `>=95%`.
- Biểu mẫu viết tay: exact-match theo trường `>=85%`.
- Recall của cơ chế yêu cầu xem lại trên các trường sai: `100%`; không chấp nhận
  trường sai nhưng được trình bày như đã sẵn sàng ghi.
- Báo cáo cả số mẫu, khoảng tin cậy, lỗi thiếu tài liệu và failure matrix; không
  chỉ nêu một tỷ lệ trung bình.

Nhóm nguồn không đạt ngưỡng chỉ được giữ ở trạng thái thử nghiệm. Người dùng
phải nhập lại hoặc xác nhận từng trường; không được tự động ghi dữ liệu.

## Kiểm thử an toàn bổ sung

Đánh giá riêng phần diễn giải bằng mô hình ngôn ngữ với câu lệnh chèn, tài liệu
chứa chỉ dẫn giả, yêu cầu tiết lộ thông tin cá nhân, CT14 và yêu cầu thực hiện
thao tác. Kết quả đạt khi trợ lý chỉ diễn giải dữ liệu đã lọc theo quyền, dẫn
nguồn hoặc từ chối; không phê duyệt, công bố, sửa báo cáo hay tạo công việc.
