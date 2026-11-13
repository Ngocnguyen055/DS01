# Kịch bản demo DS01 bằng web

> Luồng mặc định hiện dùng tài khoản: xem [authentication.md](authentication.md). Để chạy nguyên các ca dùng `peer-a/peer-b/peer-c` bên dưới, chọn **Thử nghiệm kỹ thuật bằng Peer ID**. Với tài khoản mới, đăng ký/đăng nhập rồi thay ID trong kịch bản bằng `user_<username>`.

## Chuẩn bị

- Ba cửa sổ bằng ba browser profile hoặc ba trình duyệt khác nhau.
- Ba terminal chạy `dev:signaling`, `dev:relay`, `dev:web`.
- Nhập tên hiển thị và đăng ký lần lượt `peer-a`, `peer-b`, `peer-c`. Tạo nhóm qua nút + cạnh Nhóm; quản lý thành viên trong Thông tin hội thoại.
- Quay màn hình đồng thời giữ log signaling và relay để đối chiếu Message ID.
- Khi kiểm thử qua Internet, dùng HTTPS/WSS và ít nhất hai mạng, ví dụ Wi-Fi và 4G.

## Trình tự trình diễn

1. **Discovery và heartbeat:** xác nhận cả ba peer xuất hiện online. Đóng đột ngột tab C, chờ C chuyển offline, rồi mở lại và đăng ký cùng Peer ID.
2. **Chat DIRECT:** A chọn B, gửi một tin khi không bật ép relay. Hai phía phải hiện `DIRECT`; A chuyển sang `delivered` sau ACK. Tìm Message ID trong log relay và xác nhận không có dòng `FORWARD` tương ứng.
3. **Fallback RELAY:** bật `Ưu tiên relay khi gửi tin (trong Tình trạng kết nối)` ở A, gửi tin mới cho B. Hai phía phải hiện `RELAY`; log relay phải có `FORWARD` với đúng Message ID.
4. **Nhóm ba peer:** A nhập `peer-b,peer-c`, tạo nhóm rồi gửi tin. Kiểm tra ACK/trạng thái riêng cho B và C. Xóa C khỏi nhóm, gửi lại và xác nhận C không nhận tin mới. Thêm C lại và chờ cả ba peer cập nhật membership trước bước 5.
5. **Gửi gần đồng thời:** B và C cùng gửi vào nhóm. Ghi lại thứ tự quan sát được ở từng peer; không tuyên bố có total order toàn hệ thống.
6. **Peer tắt đột ngột:** đóng B, gửi tin cho B và chờ retry hết giới hạn rồi chuyển `failed`. Mở B lại; lịch sử cũ của B phải còn trong localStorage, còn tin lúc offline không được tự giao lại.
7. **Mất DIRECT:** xác nhận một tin đã DIRECT và delivered, sau đó đóng DataChannel/RTCPeerConnection đang mở trong khi vẫn giữ kết nối signaling/relay. Giữ checkbox ép relay tắt, gửi tin mới và kiểm tra tự chuyển sang RELAY có log chuyển tiếp. Cách thao tác cụ thể nằm ở ca E07 trong [hướng dẫn nghiệm thu](MANUAL-ACCEPTANCE.md). Checkbox ép relay ở bước 3 chỉ kiểm tra lựa chọn đường truyền.
8. **Mất relay:** giữ chế độ ép RELAY, dừng relay bằng `Ctrl+C`, gửi và chờ `failed`. Chạy relay lại và gửi một tin mới để chứng minh phục hồi.
9. **Khởi động lại peer:** tải lại A hoặc đóng/mở trình duyệt cùng profile, đăng ký lại `peer-a`, chọn hội thoại và xác nhận lịch sử cục bộ được khôi phục.

## Bằng chứng cần thu

| Yêu cầu | Bằng chứng |
| --- | --- |
| Ba Peer ID và discovery | Ảnh ba giao diện cùng danh sách online + log `REGISTER` |
| DIRECT không qua relay | Message ID ở hai peer và log relay không có `FORWARD` cho ID đó |
| RELAY có chuyển tiếp | Message ID ở hai peer và dòng `[relay] FORWARD` |
| ACK/retry/dedup | Trạng thái `delivered`/`failed` và log retry |
| Nhóm ba peer | Thành viên, group ID/version và trạng thái theo từng người nhận |
| Offline/restart | Ảnh trước/sau cùng localStorage và trạng thái presence |
| Hai mạng thật | Tên mạng, thời gian, commit và video/log công khai |

Chỉ điền kết quả đã quan sát. Checkbox ép relay mô phỏng DIRECT thất bại, không thay thế bằng chứng NAT trên hai mạng thật.
