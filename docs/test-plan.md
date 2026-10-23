# Kế hoạch kiểm thử DS01

## Ma trận bắt buộc

| ID | Loại | Thao tác | Kết quả mong đợi | Trạng thái hiện tại |
|---|---|---|---|---|
| F1 | Chức năng | Đăng ký A/B/C | Ba Peer ID online và duy nhất | Tự động đạt; cần ảnh demo |
| F2 | Chức năng | A lookup B | Trả đúng online/connection | Tự động đạt |
| F3 | Chức năng | A gửi B bằng DIRECT | B nhận, ACK; relay không FORWARD cùng ID | Cần WebRTC thật |
| F4 | Chức năng | Ép DIRECT lỗi | Tự chuyển RELAY, có FORWARD và ACK | Tự động bằng mock; cần UI demo |
| F5 | Chức năng | A tạo nhóm A/B/C và gửi | B/C nhận; ACK riêng | Tự động đạt; cần ảnh demo |
| F6 | Chức năng | Thêm/xóa C | Membership nhất quán; C không nhận tin mới sau khi xóa | Tự động đạt |
| F7 | Chức năng | Tải lại peer | Lịch sử localStorage được khôi phục | Cần browser thật |
| F8 | Chức năng | Peer offline | Báo offline/failed, không hứa giao lại | Tự động một phần; cần demo |
| C1 | Đồng thời | Hai peer sửa nhóm với cùng version | Một thành công, một stale/rejected | Tự động đạt |
| C2 | Đồng thời | B và C gửi nhóm gần đồng thời | Không mất/trùng; thứ tự hợp lý từng sender | Cần demo |
| E1 | Lỗi/phục hồi | Tắt C đột ngột rồi mở lại | Presence đổi; lịch sử cũ còn; tin mới gửi được | Cần demo |
| E2 | Lỗi/phục hồi | Tắt relay khi DIRECT cũng mất | Tin failed; relay mở lại nhận tin mới | Cần demo |
| S1 | Bảo mật | Giả `senderId` khác token | Relay REJECT, không FORWARD | Tự động đạt |
| S2 | Dữ liệu sai | Body >4000, ID/schema sai | Bị từ chối | Tự động đạt |
| P1 | Hiệu năng | 100 relay envelope tuần tự | In count, p50, p95, max và môi trường | Có kết quả localhost cũ; nên chạy lại |

## Lệnh tự động

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build:web
```

Test tự động sử dụng Socket.IO server thật trên cổng động. Test fallback dùng RTC giả lập cố tình không mở DataChannel, vì môi trường unit test không chứng minh NAT/WebRTC thực tế.

## Thiết bị và mạng

### Mức 1: một máy

- Ba browser profile.
- Signaling, relay và web chạy local.
- Dùng để chứng minh discovery, WebRTC localhost, RELAY ép, nhóm và log.

### Mức 2: hai mạng

- Signaling/relay/web qua HTTPS/WSS công khai.
- Một peer Wi-Fi, một peer 4G hoặc Wi-Fi khác.
- Dùng để chứng minh NAT, DIRECT timeout tự nhiên hoặc RELAY qua Internet.

Nút ép RELAY là bằng chứng logic lựa chọn đường truyền, không phải bằng chứng NAT thật.

## Bằng chứng cần lưu

- Commit hash và ngày giờ.
- Phiên bản Node, browser, OS.
- Video ba peer discovery/group.
- Ảnh Message ID, DIRECT và trạng thái ACK.
- Log relay không có `FORWARD` cho ID DIRECT.
- Log `RELAY SEND`/`FORWARD` cùng ID.
- Video peer tắt/khởi động lại và lịch sử khôi phục.
- Video relay dừng/phục hồi.
- Output benchmark thật.

Chỉ ghi `passed` cho tình huống đã chạy. Tình huống chưa có thiết bị hoặc URL công khai ghi `not run`.
