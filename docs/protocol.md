# Giao thức DS01

## Đăng ký và presence

1. Client gửi `peer:register` với `peerId`, `identityProof`, `displayName` (web bắt buộc tên; protocol chấp nhận client cũ không gửi tên).
2. Signaling từ chối ID sai định dạng, secret ngắn hoặc Peer ID đang online.
3. Signaling trả token relay, danh sách peer và nhóm hiện tại.
4. Client gửi `peer:heartbeat` mỗi 10 giây.
5. Peer quá 30 giây không có heartbeat bị timeout và presence được phát lại.

Peer ID gồm 3–32 chữ/số/`_`/`-`. Secret ngẫu nhiên lưu theo ID trong localStorage; signaling CLI lưu hash trong atomic snapshot. `presence` giữ danh sách ID để tương thích; `peer:profiles` bổ sung displayName/lastSeen, chỉ phát cho peer đã đăng ký.

## Discovery

Client đã đăng ký gọi:

```text
peer:list
peer:lookup { peerId }
```

Lookup trả trạng thái online, `lastSeen` và khả năng `webrtc-datachannel`/`socket.io`. Response không trả socket ID, token hay địa chỉ nội bộ của peer khác.

## Thiết lập DIRECT

Các event signaling:

```text
signal:send { to, kind: request|offer|answer|ice, data }
signal:receive { from, kind, data }
```

Chat body không nằm trong các event này. Sau SDP/ICE negotiation, hai peer mở DataChannel `ordered: true`. Nếu không mở trong 5 giây, client dùng RELAY.

## Chat envelope

```json
{
  "messageId": "f5515419-f620-4823-a416-560033e3e0bf",
  "sessionId": "9110ba98-e1b4-4936-9a9b-1cb2daa63dc9",
  "senderId": "peer-a",
  "receiverId": "peer-b",
  "groupId": null,
  "type": "text",
  "timestamp": 1792700000000,
  "body": "Xin chào",
  "mode": "DIRECT",
  "attempt": 1,
  "sequence": 1
}
```

| Trường | Ý nghĩa |
|---|---|
| `messageId` | UUID duy nhất, dùng ACK và deduplication |
| `sessionId` | Phiên hội thoại; nhóm dùng Group ID |
| `senderId` | Peer tạo envelope |
| `receiverId` | Một peer nhận cụ thể |
| `groupId` | UUID nhóm hoặc null/undefined cho chat 1–1 |
| `type` | `text`, `attachment`, `file-chunk` hoặc `ack` |
| `timestamp` | Unix milliseconds tại sender |
| `mode` | `DIRECT`, `TURN` hoặc `RELAY` |
| `attempt` | Lần thử hiện tại |
| `sequence` | Thứ tự theo sender và cuộc trò chuyện |
| `logicalTime` | Đồng hồ logic đơn điệu; dữ liệu cũ được chấp nhận khi thiếu |
| `fileChunk` | transferId/index/total/base64 data/file metadata + SHA-256, chỉ cho file-chunk |

Text tối đa 4000 ký tự. Relay giới hạn gói Socket.IO 8192 byte.

## ACK, retry và chống trùng

Receiver lưu tin rồi tạo envelope `type: ack` với `ackFor` bằng Message ID gốc. ACK Socket.IO server chỉ cho biết relay đã nhận request; ACK ứng dụng mới đưa trạng thái sender sang `delivered`.

Sender chờ ACK 2 giây. Nếu không có ACK, lần thử tiếp theo dùng RELAY. Có tối đa 3 attempt. Sau lần cuối, trạng thái là `failed`.

Pending ACK được đăng ký trước khi gửi để không mất ACK đến sớm, nhưng timer bắt đầu sau khi transport đã chấp nhận gói. Thời gian lookup/authorization/forwarding không bị tính nhầm thành hết ngân sách chờ receiver ACK.

Receiver kiểm tra cặp `(messageId, senderId)`, không lưu trùng nhưng vẫn ACK. Web giữ ledger 10000 khóa riêng lịch sử 1000 dòng; không exactly-once vĩnh viễn. Metadata file có SHA-256 chỉ nhận khi byte file đã có và hash khớp; transfer lỗi có tombstone ngắn để không ACK nhầm chunk cuối của lần truyền đã lỗi.

## Chat nhóm

Nhóm web được tạo bằng:

```text
group:create { members, name? }
group:change { groupId, memberId, action, version }
```

Owner thêm thành viên; owner hoặc chính thành viên có thể xóa. `version` ngăn hai bản cập nhật cũ cùng ghi đè.

Giới hạn 16 người được kiểm tra khi create và add. Owner rời nhóm chuyển quyền cho Peer ID nhỏ nhất còn lại; nhóm rỗng archived. Lưu thay đổi thành công trước khi phát update/ACK.

Chat nhóm dùng multi-unicast. A gửi nhóm A/B/C thành hai envelope A→B và A→C có cùng `messageId`, `groupId`, `sequence`; trạng thái ACK được lưu riêng theo receiver.

Thành viên offline vẫn thuộc nhóm nhưng lần gửi đến họ thất bại. Không có offline delivery.

## Relay

Relay chấp nhận `relay:send` chỉ khi:

- token hợp lệ và subject trùng sender;
- envelope qua schema;
- `mode` là `RELAY`;
- receiver đang nối relay;
- nếu là nhóm, sender và receiver đều thuộc nhóm.

Log thành công:

```text
[relay] FORWARD <message-id> peer-a -> peer-b text
```

Để chứng minh DIRECT, log peer phải có `DIRECT SEND <id>` và relay không có `FORWARD <id>`. Để chứng minh RELAY, đối chiếu `RELAY SEND <id>` với `FORWARD <id>`.

## Tài khoản local và auto-connect

Luồng mặc định tạo tài khoản/đăng nhập rồi tự đăng ký peer với signaling. Peer ID user_ + username; mật khẩu scrypt với salt riêng; phiên bearer 12 giờ lưu hash tại server và token trong sessionStorage của tab. Logout thu hồi phiên và đóng peer. Relay xác minh session qua HTTP nội bộ, không đọc registry chia sẻ. Xem [authentication.md](authentication.md) cho event auth, lưu trữ, chính sách một peer online và giới hạn. Chế độ secret demo cũ nằm trong mục thử nghiệm kỹ thuật.
