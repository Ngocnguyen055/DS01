# Trạng thái khắc phục và nghiệm thu

Các phát hiện trước sửa nằm trong `DS01-REVIEW.md`; file đó là lịch sử, không phải kết luận cho mã hiện tại. Các kết quả dưới đây gắn với working tree được kiểm thử, chưa phải release đã có đóng góp/duyệt của cả nhóm.

| Vấn đề / yêu cầu | Cách xử lý | Kiểm chứng |
|---|---|---|
| Tài khoản và phiên | Đăng ký, scrypt/salt, đăng nhập, Peer ID cố định, tự online, restore/logout và thu hồi relay token | accounts.test.ts + browser ba tài khoản; xem authentication.md |
| Callback sai làm chết server | Guard middleware và kiểm tra callback từng handler; rate budget, log REJECT | Regression test server vẫn trả health và RPC hợp lệ |
| Giả sender / người ngoài nhóm / schema sai | JWT + sender binding, membership và schema/size validation | services/protocol tests, manual-probe validation |
| Danh tính mất sau restart | Hash registry snapshot; không reset file lỗi | Restart với secret khác bị từ chối; file hỏng startup lỗi |
| Nhóm mất sau restart | Snapshot trước update/ACK | Regression + browser restart giữ membership |
| Owner rời nhóm gây kẹt | Chuyển owner có thứ tự xác định, archive nhóm rỗng; giới hạn 16 khi add | Regression owner mới thêm được thành viên |
| Thiếu display name | Registration, profiles và contact cache | Browser ba phiên hiển thị tên |
| Ordering timestamp/UUID sai | Sequence/session recovery + logical time + merge chuỗi sender | Equal-clock/reversed arrival regression |
| Ngắt khi đợi ACK gây treo | Cancel/reject, đánh dấu failed; recover interrupted rows | Regression send kết thúc, không sent mãi |
| UI báo Online sai khi mất mạng | Connection events và reconnect cho cả server-forced disconnect | Browser thấy reconnecting rồi tự online sau restart |
| Không mở lịch sử offline | Danh sách từ contact/history; giữ nhóm cũ read-only | UI/sidebar và persisted stores |
| Lưu contact đồng thời mất dữ liệu | Serialize contact writes | Regression ba contact song song không mất |
| Log thiếu thời gian | ISO timestamp + service/event | Output dịch vụ và peer log export |
| Phá DIRECT thật | Chờ selected ICE route, đóng PC rồi fallback | Browser WebRTC thật; cùng nội dung được ACK qua relay |
| File nâng cao | Chunk/ACK/retry, SHA-256, IndexedDB, tiến trình/download | 512 KiB integration; 32 KiB browser, full byte/hash |
| Relay dự phòng | Kết nối chung pool, failover transport và dedup | Dừng primary, giao tin/file qua backup |
| TURN nâng cao | ICE config + phân biệt selected relay candidate | Code/config có; TURN public chưa chạy |
| Hiệu năng | Script 20 simulated peers / 200 concurrent messages / 8 workers | Kết quả thật trong load-relay.json, phạm vi headless local |
| Giao diện | Layout mới desktop/mobile, search, dark mode, nhóm/file/log | Browser smoke, ảnh chụp desktop/mobile |

## Chạy lại

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build:web
npm.cmd run test:browser
```

- `browser-smoke.json` chỉ ghi PASS khi chạy được; lỗi runtime không được thay bằng số liệu giả.
- Browser script dùng process/port/profile tạm, không dừng server bạn đang dùng. Chrome thử nghiệm dùng `--no-sandbox` trong môi trường local hạn chế; không dùng profile này để duyệt Internet.
- Các JSON `review-*` và benchmark.txt cũ là bằng chứng bản trước; kết quả mới tách file, không sửa lại lịch sử.
- `docs/manual-results.csv` là bảng người dùng tự nghiệm thu, giữ NOT RUN cho ca chưa tự chạy; không tự điền PASS chỉ dựa trên tên tính năng.

## Những phần không thể thay bằng mã nguồn

1. Endpoint public và video/log qua hai mạng/NAT hoặc miền mạng cô lập đúng đề; localhost chưa chứng minh WAN.
2. TURN public và Docker runtime chưa được chạy trong môi trường hiện tại; Docker chưa được cài ở máy kiểm tra.
3. Tên/MSSV, phân công và lịch sử đóng góp thật của từng thành viên; không tạo commit giả thay người khác.
4. Giảng viên truy cập được repo private, đăng ký nhóm/đề tài, final tag/release do nhóm chốt và demo có cả nhóm.
5. Báo cáo PDF là bản kỹ thuật dự thảo có đánh dấu thông tin nhóm/WAN cần bổ sung. Không coi là bản nộp cuối nếu các phần này còn trống.

Không triển khai offline store-and-forward, E2EE, voice/video, DHT, election hay signaling replication. Đây là các lựa chọn nâng cao khác, không phải điều kiện phải làm hết để đạt DS01.
