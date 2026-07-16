# Nhập dữ liệu 22 thôn cũ sang 10 thôn mới

## Phạm vi và nguồn quyết định

Luồng này dùng cho bộ báo cáo XLSX theo 22 thôn cũ. Bảng ánh xạ có phiên bản tại
`DU_LIEU_CHINH_THUC/village_merge_map_CHINH_THUC.json` là nguồn kỹ thuật duy nhất.
Ảnh phương án sắp xếp chỉ là tài liệu phương án; chưa thay thế quyết định hành chính.

Hai khu tái định cư số 2 và số 3 được lưu với `legacy_unit_type =
resettlement_area`; chúng không được tính là hai báo cáo trong bộ 22 thôn. Toàn bộ
báo cáo Đông Sơn bị khóa vì tệp hiện có không tách riêng phần phía Bắc Đông Sơn.

## Quy tắc không suy đoán

- Không biến ô trống hoặc giá trị không đọc được thành `0`.
- Không cộng một phần của nhóm thôn mới. Chỉ tạo báo cáo khi mọi thôn cũ cấu thành
  đều có tệp đã được chấp nhận.
- Một tệp bị từ chối phải có lý do. Tệp chưa có quyết định không thể chốt.
- Tệp có ánh xạ chờ quyết định chỉ có thể bị từ chối và giữ làm bằng chứng; không
  thể được chấp nhận để tổng hợp.
- Bằng chứng nguồn (tên tệp, SHA-256, giá trị thô, thôn nguồn và ánh xạ) bất biến
  sau khi tải lên. Quyết định kiểm duyệt cũng bất biến.
- Lineage chỉ do transaction chốt đợt nhập tạo; người dùng không có quyền chèn trực tiếp.

## Trường hợp bộ dữ liệu cuộc thi hiện tại

Bộ nguồn có 19 báo cáo trên 22 thôn. Ba báo cáo chưa có là Ninh An, Sơn Phước và
Thạch Nham Tây. Đông Sơn có tệp nhưng ánh xạ chưa thể xác nhận. Sau khi người có
quyền sửa/xác nhận mọi lỗi dữ liệu và từ chối Đông Sơn với lý do phù hợp, chỉ sáu
nhóm đủ nguồn có thể được tổng hợp:

1. Thạch Nham Đông
2. Phước Hưng
3. Phú Hòa
4. Thái Lai
5. Phước Khương
6. An Sơn

Hòa Nhơn, Sơn Phước, Thạch Nham Tây và Hòa Ninh phải ở trạng thái chưa tổng hợp.
Hệ thống hiển thị từng nguồn thiếu/bị từ chối/chờ quyết định trước khi cho chốt.

## Quy trình vận hành

1. Admin chọn kỳ báo cáo và tải tối đa 25 tệp XLSX.
2. Chạy xem trước; trùng thôn phải được xử lý trước khi tạo đợt kiểm duyệt.
3. Tạo đợt kiểm duyệt dù bộ nguồn thiếu hoặc có lỗi. Việc này chỉ lưu bằng chứng,
   chưa tạo báo cáo.
4. Với từng tệp, admin sửa giá trị theo chứng cứ, ghi lý do cho mọi chỉ tiêu thay
   đổi/cảnh báo, rồi chấp nhận; hoặc nhập lý do và từ chối.
5. Kiểm tra danh sách “Có thể tổng hợp” và “Chưa được tổng hợp”.
6. Chốt nhóm đủ nguồn. Transaction tạo report, CT01–CT14 và lineage cùng lúc.
7. Đối chiếu tổng sau nhập với audit nguồn và export. Báo cáo mới ở trạng thái
   `submitted`, chưa tự động duyệt, khóa hay công bố.

## Kiểm chứng nguồn ngoài repository

Chạy lệnh đọc-chỉ-đọc sau trên thư mục dữ liệu do đơn vị cung cấp:

```powershell
python scripts/audit_source_workbooks.py "D:\duong-dan\DỮ LIỆU MẪU - BaNa Smartlink" `
  --output source_workbook_audit.json
```

Tệp JSON kết quả không chứa tên, chức danh hoặc số điện thoại người lập biểu; chỉ
ghi hash, kích thước, thôn, CT01–CT14, mã lỗi, trạng thái ánh xạ và việc định dạng
số điện thoại có hợp lệ hay không.
