# Nguồn gốc và quyền sử dụng tài sản

Cập nhật: 26/07/2026.

## Tài sản đang phát hành

| Tài sản | Mục đích | Căn cứ sử dụng | SHA-256 |
|---|---|---|---|
| `public/images/ba-na-brand-logo.png` | Tệp gốc nhận diện Ba Na SmartLink | Nhận diện công khai của dự án; thuộc giả định đã khóa trong đề bài rằng nhận diện công khai hiện tại đã được cơ quan có thẩm quyền phê duyệt | `8b69b94efb7883b66e856569df10df7fbdacd97ab9c15bfa27225680b2eca4b6` |
| `public/images/ba-na-brand-logo-96.png` | Logo giao diện 1x | Dẫn xuất nội bộ từ logo gốc, đã loại metadata | `7cf6acc04cc12ff514179666199087010aba1760ecbe0c5b2d02457b095e760f` |
| `public/images/ba-na-brand-logo-192.png` | Logo giao diện 2x | Dẫn xuất nội bộ từ logo gốc, đã loại metadata | `940e7a9b4ccc73034899d036bd25246098caaad63961a53b0e7b3221810667f7` |
| Các nền xanh/vàng trong `src/brand-v3.css` | Hình ảnh trang công khai và đăng nhập | Đồ họa gốc tạo bằng CSS trong mã nguồn; không dùng ảnh bên thứ ba | Theo commit phát hành |

## Ảnh Bà Nà do người dùng cung cấp

Ngày 26/07/2026, chủ dự án cung cấp và xác nhận có thể sử dụng bộ ảnh Pexels của
nhiếp ảnh gia **Ba Uoc Phung** để làm nổi bật trang web và báo cáo. Các trang
ảnh trên Pexels ghi rõ tác giả và trạng thái "Free to use"; giấy phép Pexels tại
thời điểm kiểm tra cho phép dùng và chỉnh sửa ảnh cho website, ứng dụng và tài
liệu in, không bắt buộc ghi nguồn. Dự án vẫn ghi nguồn để bảo đảm truy xuất.

| Tệp nguồn người dùng cung cấp | Trang nguồn | Tệp phát hành dẫn xuất | SHA-256 tệp nguồn |
|---|---|---|---|
| `pexels-ba-uoc-phung-355372-5037910.jpg` | `https://www.pexels.com/photo/5037910/` | `ba-na-hero-golden-bridge.jpg` và các bản WebP 960/1920 | `0d639262ef83ba4bd3a2c2004fa421c2a7ee08dcc16e122afcef652e9b7ae673` |
| `pexels-ba-uoc-phung-355372-36839004.jpg` | `https://www.pexels.com/photo/36839004/` | `ba-na-login-cloud-station.jpg` | `8d127a58aa7fcfb0027fa57a04e31cfb2ac298949cb9cb4287ea4acad49eb8a2` |
| `pexels-ba-uoc-phung-355372-13842631.jpg` | `https://www.pexels.com/photo/13842631/` | `ba-na-story-castle.jpg` và các bản WebP 720/1440 | `eb89897d2b1ce63cdcda9c023be85290183ed6166b0e1bc3061e9c381b26377b` |
| `pexels-ba-uoc-phung-355372-36839005.jpg` | `https://www.pexels.com/photo/36839005/` | `ba-na-story-clouds.jpg` và các bản WebP 720/1200 | `a10a123b7334a06d926e3c41d190466a8cbfe9cca12d906d309d6ede83c3a272` |
| `pexels-ba-uoc-phung-355372-36839042.jpg` | `https://www.pexels.com/photo/36839042/` | `ba-na-story-cable-cars.jpg` và các bản WebP 720/1200 | `dd2f18760cca0abf584f37bd3a9315f05bce2bf517ad7a2481c60d49c062d32f` |

Giấy phép tham chiếu: `https://www.pexels.com/license/` (kiểm tra ngày
26/07/2026). Ảnh chỉ được dùng như thành phần của sản phẩm/tài liệu có nội dung,
không phân phối hoặc bán lại dưới dạng tệp ảnh độc lập và không hàm ý tác giả
hay Pexels bảo trợ cho dự án.

Các tệp phát hành đã được đổi kích thước/tái mã hóa để loại metadata máy ảnh,
GPS và thumbnail ẩn. Hash các tệp dẫn xuất được ghi dưới đây để kiểm tra đúng
artifact:

| Tệp phát hành | SHA-256 |
|---|---|
| `ba-na-hero-golden-bridge.jpg` | `3f855bc50e3450b9cd1d55affa7d498cee817b6cf9098efa351045cea81d395c` |
| `ba-na-hero-golden-bridge-960.webp` | `e07c0f2231c94918e77bba986262f34bdede2cd7587245ff21388c8223b340c8` |
| `ba-na-hero-golden-bridge-1920.webp` | `6e0d310ac09eff5c80eb4554e28c79a77e54f22a6732407a9e460c9e7af3991e` |
| `ba-na-login-cloud-station.jpg` | `ba96f6d19422c7654732bba006c8058c15d36ff728fc966e46f61b1ca0d4e946` |
| `ba-na-story-castle.jpg` | `82939efcf4d382357fd1321808e2c1a7c25632cef5be9ac7b9b3cd9d41e0834f` |
| `ba-na-story-castle-720.webp` | `5f1396fe9f09f452cba4880bd75fd03aea8c2d0bdf7ea310e8757eb11fad886d` |
| `ba-na-story-castle-1440.webp` | `a4a3b00eb7bc346a16888376c26ce69d6c5380e4f35611a912f06407681d45d5` |
| `ba-na-story-clouds.jpg` | `628159efb8b42514536c3a67866ab4bfac14371c29e8c245442068d865038b1c` |
| `ba-na-story-clouds-720.webp` | `579c7e73c777303da3cd2a90c55508bf68aebaf24f1828d9542ec3dd2eb4f626` |
| `ba-na-story-clouds-1200.webp` | `a004a9150099f41dfde22236fce15c51667920bcbae97d60649755798b8361e8` |
| `ba-na-story-cable-cars.jpg` | `465b204d79d3a20ae8695364be798817533021ec8fc6389639a456fd4549b210` |
| `ba-na-story-cable-cars-720.webp` | `18c3d7965d820dea4b69524ea6adc8da796f3772e1f6809e6c8936299a9c69ea` |
| `ba-na-story-cable-cars-1200.webp` | `4bc447b37a34e21e75de258aa6dd8553042d8f51ab380a719a5b424dfed3eb5e` |

## Quy tắc bổ sung tài sản

1. Ảnh chụp chỉ được đưa vào khi có chủ sở hữu, nguồn, phạm vi quyền sử dụng và
   ngày phê duyệt bằng văn bản.
2. Tệp phát hành phải được tái mã hóa để loại EXIF, GPS và thumbnail ẩn.
3. Mọi dẫn xuất phải truy được về tệp gốc đã được phê duyệt.
4. Không chấp nhận ảnh chân dung không phục vụ nghiệp vụ hoặc tài sản tải từ
   Internet nhưng không có giấy phép rõ ràng.
