# Nguồn gốc và quyền sử dụng tài sản

Cập nhật: 26/07/2026.

## Tài sản đang phát hành

| Tài sản | Mục đích | Căn cứ sử dụng | SHA-256 |
|---|---|---|---|
| `public/images/ba-na-brand-logo.png` | Tệp gốc nhận diện Ba Na SmartLink | Nhận diện công khai của dự án; thuộc giả định đã khóa trong đề bài rằng nhận diện công khai hiện tại đã được cơ quan có thẩm quyền phê duyệt | `8b69b94efb7883b66e856569df10df7fbdacd97ab9c15bfa27225680b2eca4b6` |
| `public/images/ba-na-brand-logo-96.png` | Logo giao diện 1x | Dẫn xuất nội bộ từ logo gốc, đã loại metadata | `7cf6acc04cc12ff514179666199087010aba1760ecbe0c5b2d02457b095e760f` |
| `public/images/ba-na-brand-logo-192.png` | Logo giao diện 2x | Dẫn xuất nội bộ từ logo gốc, đã loại metadata | `940e7a9b4ccc73034899d036bd25246098caaad63961a53b0e7b3221810667f7` |
| Các nền xanh/vàng trong `src/brand-v3.css` | Hình ảnh trang công khai và đăng nhập | Đồ họa gốc tạo bằng CSS trong mã nguồn; không dùng ảnh bên thứ ba | Theo commit phát hành |

## Tài sản đã loại

Ảnh Cầu Vàng từng có trong `public/images` không có hồ sơ nguồn hoặc quyền sử
dụng đi kèm và còn chứa metadata máy ảnh. Ảnh gốc cùng các bản dẫn xuất đã
được loại khỏi mã nguồn; giao diện dùng đồ họa CSS gốc thay thế.

## Quy tắc bổ sung tài sản

1. Ảnh chụp chỉ được đưa vào khi có chủ sở hữu, nguồn, phạm vi quyền sử dụng và
   ngày phê duyệt bằng văn bản.
2. Tệp phát hành phải được tái mã hóa để loại EXIF, GPS và thumbnail ẩn.
3. Mọi dẫn xuất phải truy được về tệp gốc đã được phê duyệt.
4. Không chấp nhận ảnh chân dung không phục vụ nghiệp vụ hoặc tài sản tải từ
   Internet nhưng không có giấy phép rõ ràng.
