# Dàn ý báo cáo DS01

1. Bài toán, yêu cầu và phạm vi demo web.
2. Kiến trúc bốn phần: web peer, shared peer core, signaling và relay.
3. Đăng ký Peer ID, discovery, heartbeat/timeout và xử lý trùng Peer ID.
4. NAT, ICE, STUN, TURN; lý do chọn WebRTC DataChannel và relay Socket.IO.
5. Phân biệt TURN với relay tầng ứng dụng của dự án.
6. Envelope: Message ID, session, sequence, sender/receiver/group, mode, timestamp và ACK.
7. DIRECT: thiết lập SDP/ICE qua signaling, DataChannel truyền payload, bằng chứng relay không chuyển tiếp.
8. RELAY: ánh xạ Peer ID, xác thực sender, giới hạn kích thước, log chuyển tiếp và fallback.
9. Chat nhóm multi-unicast, version thành viên và ACK riêng cho từng người nhận.
10. Lưu localStorage, khôi phục peer, dedupe, retry giới hạn và trường hợp offline.
11. Kiểm thử chức năng, đồng thời, lỗi/phục hồi, dữ liệu sai/bảo mật và hiệu năng.
12. Kết quả thật kèm môi trường, thời gian, commit, ảnh/log/video.
13. Giới hạn: không TURN, không giao offline, nhóm demo lưu RAM, không total order và chưa có failover nhiều server.
14. Phân công ba thành viên, bài học và hướng mở rộng.

## Phân công gợi ý cho ba sinh viên

| Thành viên | Phần chính | Kiểm chứng chéo |
| --- | --- | --- |
| Sinh viên 1 | Protocol, PeerClient, ACK/retry/dedup | Review web peer và demo DIRECT |
| Sinh viên 2 | Signaling, discovery, heartbeat, nhóm | Review relay và tình huống lỗi |
| Sinh viên 3 | Relay, web peer, deploy, test/docs | Review protocol và benchmark |

Điền tên và MSSV thật trước khi nộp. Mỗi thành viên cần hiểu toàn bộ luồng end-to-end.
