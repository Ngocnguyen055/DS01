# DS01 P2P Chat

Repository độc lập cho bài tập Hệ thống phân tán DS01. Hệ thống gồm web peer, signaling server và application relay. Peer luôn thử WebRTC DataChannel trước; khi DIRECT không mở hoặc mất ACK, peer tự chuyển sang relay Socket.IO.

## Thành phần

```text
src/
├── web-peer/       Giao diện peer, log và localStorage
├── shared/         Protocol, PeerClient, WebRTC, ACK/retry/dedup
├── signaling/      Registration, discovery, heartbeat, SDP/ICE, nhóm
└── relay/          Xác thực, ánh xạ Peer ID và chuyển tiếp RELAY
```

- Signaling chạy độc lập ở cổng `4001` và chỉ xử lý control plane.
- Relay chạy độc lập ở cổng `4002` và chỉ chuyển chat envelope khi mode là `RELAY`.
- Web peer chạy ở cổng Vite mặc định `5173`.
- Lịch sử web lưu trong localStorage của từng Peer ID.
- Demo với ID `peer-a`, `peer-b`, `peer-c` không cần MongoDB hoặc Mobile API.

## Yêu cầu

- Node.js 20 trở lên.
- npm.
- Chrome, Edge hoặc Firefox có WebRTC.

## Cài đặt

```powershell
git clone https://github.com/Ngocnguyen055/DS01.git
cd DS01
Copy-Item .env.example .env
npm.cmd install
```

Không commit `.env`. Khi chạy local, các giá trị mặc định trong `.env.example` đã trỏ tới localhost.

## Chạy local

Mở ba terminal tại thư mục repository.

Terminal 1:

```powershell
npm.cmd run dev:signaling
```

Terminal 2:

```powershell
npm.cmd run dev:relay
```

Terminal 3:

```powershell
npm.cmd run dev:web
```

Mở `http://localhost:5173` bằng ba browser profile riêng và đăng ký:

- `peer-a`
- `peer-b`
- `peer-c`

Dùng profile riêng giúp Peer ID, secret và localStorage không bị thay đổi khi tải lại trang.

## Demo nhanh

1. Xác nhận A, B, C xuất hiện trong danh sách online.
2. A chọn B và gửi tin khi chưa bật ép relay. Tin phải hiện `DIRECT`, `delivered`; relay không có `FORWARD` cho Message ID đó.
3. Bật `Mô phỏng DIRECT thất bại (ép RELAY)`, gửi tin mới và đối chiếu `RELAY SEND` với `[relay] FORWARD` cùng Message ID.
4. A nhập `peer-b,peer-c`, tạo nhóm và gửi. Kiểm tra ACK riêng cho B và C.
5. Xóa C khỏi nhóm, gửi lại và xác nhận C không nhận tin mới.
6. Đóng C, theo dõi offline; mở lại cùng Peer ID và xác nhận lịch sử localStorage còn nguyên.
7. Dừng relay khi đang ép RELAY; tin mới phải `failed`. Chạy relay lại rồi gửi tin mới.

Kịch bản đầy đủ và danh sách bằng chứng nằm trong [docs/demo-script.md](docs/demo-script.md) và [docs/test-plan.md](docs/test-plan.md).

## Kiểm tra tự động

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build:web
```

Bộ test kiểm tra protocol, ba peer, Peer ID trùng, heartbeat/discovery, group version conflict, relay routing, sender giả, body quá kích thước, ACK, retry, chống trùng và fallback bằng DataChannel mô phỏng không mở.

Test tự động không chứng minh WebRTC DIRECT thật hoặc RELAY qua hai mạng Internet. Hai trường hợp này phải quay màn hình và lưu log thực tế.

## Đo relay

Khởi động signaling và relay rồi chạy:

```powershell
npm.cmd run benchmark:relay
```

Script gửi 100 envelope RELAY tuần tự và in `p50`, `p95`, `max`. Ghi rõ máy, mạng, ngày giờ và commit khi dùng kết quả trong báo cáo.

## Triển khai Internet

1. Chạy signaling và relay thành hai process riêng.
2. Dùng HTTPS/WSS reverse proxy theo [deploy/Caddyfile.example](deploy/Caddyfile.example).
3. Điền URL công khai vào `.env` trước khi build web:

```env
VITE_SIGNAL_URL=https://signal.example.org
VITE_RELAY_URL=https://relay.example.org
PUBLIC_SIGNAL_URL=https://signal.example.org
PUBLIC_RELAY_URL=https://relay.example.org
```

4. Chạy `npm.cmd run build:web` và phục vụ `src/web-peer/dist`.
5. Dùng ít nhất hai mạng, ví dụ Wi-Fi và 4G, để kiểm tra NAT và fallback thực tế.

## Giới hạn đã xác định

- Không triển khai TURN. STUN mặc định là `stun:stun.l.google.com:19302`.
- Relay Socket.IO là relay tầng ứng dụng, không phải TURN.
- Không có hàng đợi hoặc giao tin offline.
- Nhóm demo web nằm trong RAM của signaling và phải tạo lại sau khi signaling restart.
- Không có failover giữa nhiều signaling/relay instance.
- Sequence giữ thứ tự theo sender/cuộc trò chuyện; không có total order toàn hệ thống.
- Adapter nhóm dự án và block tài khoản được giữ để mở rộng, nhưng cần Mobile API bên ngoài khi dùng Peer ID tài khoản Mongo 24 ký tự hex.

## Tài liệu

- [Kiến trúc](docs/architecture.md)
- [Giao thức](docs/protocol.md)
- [Kế hoạch kiểm thử](docs/test-plan.md)
- [Kịch bản demo](docs/demo-script.md)
- [Dàn ý báo cáo](docs/report-outline.md)
