# Giao thức DS01

## Đăng ký và presence

1. Client kết nối signaling và gửi `peer:register` với `peerId`, `identityProof`.
2. Signaling từ chối ID sai định dạng, secret ngắn hoặc Peer ID đang online.
3. Signaling trả token relay, danh sách peer và nhóm hiện tại.
4. Client gửi `peer:heartbeat` mỗi 10 giây.
5. Peer quá 30 giây không có heartbeat bị timeout và presence được phát lại.

Peer web demo dùng ID 3–32 ký tự gồm chữ, số, `_`, `-`. Secret ngẫu nhiên lưu trong localStorage, còn signaling chỉ giữ hash trong RAM.

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
| `type` | `text`, `attachment` hoặc `ack` |
| `timestamp` | Unix milliseconds tại sender |
| `mode` | `DIRECT` hoặc `RELAY` |
| `attempt` | Lần thử hiện tại |
| `sequence` | Thứ tự theo sender và cuộc trò chuyện |

Text tối đa 4000 ký tự. Relay giới hạn gói Socket.IO 8192 byte.

## ACK, retry và chống trùng

Receiver lưu tin rồi tạo envelope `type: ack` với `ackFor` bằng Message ID gốc. ACK Socket.IO server chỉ cho biết relay đã nhận request; ACK ứng dụng mới đưa trạng thái sender sang `delivered`.

Sender chờ ACK 2 giây. Nếu không có ACK, lần thử tiếp theo dùng RELAY. Có tối đa 3 attempt. Sau lần cuối, trạng thái là `failed`.

Receiver kiểm tra cặp `(messageId, senderId)`. Tin trùng không được lưu lại nhưng vẫn ACK để sender dừng retry.

## Chat nhóm

Nhóm web được tạo bằng:

```text
group:create { members }
group:change { groupId, memberId, action, version }
```

Owner thêm thành viên; owner hoặc chính thành viên có thể xóa. `version` ngăn hai bản cập nhật cũ cùng ghi đè.

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
