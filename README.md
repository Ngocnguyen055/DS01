# Mạch — DS01 P2P Chat

Repository độc lập cho bài tập Hệ thống phân tán DS01. Hệ thống gồm web peer, signaling server và application relay. Peer luôn thử WebRTC DataChannel trước; khi DIRECT không mở hoặc mất ACK, peer tự chuyển sang relay Socket.IO.

Giao diện responsive có tên hiển thị, hội thoại online/offline, nhóm có tên, trạng thái từng receiver, retry cùng Message ID, chặn peer, xuất lịch sử/log và sáng/tối. Nâng cao: gửi file theo chunk có SHA-256, pool tối đa bốn relay với failover, cấu hình STUN/TURN và kiểm tra tải đồng thời.

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

- Node.js `^20.19.0 || >=22.12.0`; dùng Node 22.12+ để chạy cả browser QA.
- npm.
- Chrome, Edge hoặc Firefox có WebRTC.

## Cài đặt

```powershell
git clone https://github.com/Ngocnguyen055/DS01.git
cd DS01
node scripts/init-env.mjs
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

Mở `http://localhost:5173` bằng ba browser profile riêng. Chọn **Tạo tài khoản**, tạo `alice`, `bob`, `carol` với tên hiển thị và mật khẩu tối thiểu 10 ký tự. Sau đó đăng nhập: ứng dụng tự đăng ký peer, kết nối và đưa vào chat. Peer ID lần lượt là `user_alice`, `user_bob`, `user_carol`.

F5 trong cùng tab tự khôi phục phiên. Nút **Đăng xuất** thu hồi phiên và đóng kết nối. Mỗi tài khoản có tối đa một peer online. Tài khoản lưu tại signaling, lịch sử vẫn lưu cục bộ trên thiết bị.

Hướng dẫn, thiết kế, giới hạn và 12 ca kiểm thử: [docs/authentication.md](docs/authentication.md).

Các kịch bản bên dưới dùng ID demo `peer-a/peer-b/peer-c`: chọn **Thử nghiệm kỹ thuật bằng Peer ID** ở cuối biểu mẫu để chạy chúng hoặc mở lịch sử demo cũ. Với tài khoản, thay các ID đó bằng Peer ID thực tế `user_...`. Log và checkbox relay nằm trong **Tình trạng kết nối**; quản lý nhóm trong **Thông tin hội thoại**.

## Demo nhanh

1. Xác nhận A, B, C xuất hiện trong danh sách online.
2. A chọn B và gửi tin khi chưa bật ép relay. Tin phải hiện `DIRECT`, `delivered`; relay không có `FORWARD` cho Message ID đó.
3. Mở Tình trạng kết nối, bật `Ưu tiên relay khi gửi tin`, gửi tin mới và đối chiếu `RELAY SEND` với `[relay] FORWARD` cùng Message ID.
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
npm.cmd run test:browser
```

Bộ test kiểm tra protocol, ba peer, Peer ID trùng, heartbeat/discovery, group version conflict, relay routing, sender giả, body quá kích thước, ACK, retry, chống trùng và fallback bằng DataChannel mô phỏng không mở.

Vitest kiểm tra protocol/integration/hồi quy. `test:browser` dùng ba browser context, WebRTC thật, file/IndexedDB, phá DIRECT, restart signaling và failover relay trên các process local riêng. Ảnh/kết quả nằm trong `docs/evidence/`. Cần Chromium đã cài (có thể đặt `CHROME_PATH`); script chỉ dùng profile/dịch vụ tạm. Internet/NAT vẫn cần chạy trên hai mạng hoặc mạng mô phỏng cô lập theo đề và lưu bằng chứng riêng.

## Đo relay

Khởi động signaling và relay rồi chạy:

```powershell
npm.cmd run benchmark:relay
```

Script gửi 100 envelope RELAY tuần tự và in `p50`, `p95`, `max`. Ghi rõ máy, mạng, ngày giờ và commit khi dùng kết quả trong báo cáo.

Đo tải nhiều peer: `npm.cmd run load:relay -- --peers 20 --messages 10 --concurrency 8`. Phép đo headless này không đo ACK ứng dụng hoặc WebRTC; xem [advanced-features.md](docs/advanced-features.md).

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

- STUN mặc định là `stun:stun.l.google.com:19302`. TURN tùy chọn qua `VITE_ICE_SERVERS`; có mẫu coturn, chưa xác minh một TURN public. ICE relay candidate được ghi `TURN`, không gọi là DIRECT.
- Relay Socket.IO là relay tầng ứng dụng, không phải TURN.
- Không có hàng đợi hoặc giao tin offline.
- CLI signaling lưu hash danh tính và nhóm trong atomic snapshot `.data/signaling.json`; chỉ một signaling writer cho mỗi file, chưa có replication/failover signaling.
- Có failover tối đa bốn application relay nếu cả hai peer nối cùng pool. Không replication trạng thái/offline queue giữa relay.
- Sequence/session được khôi phục, kết hợp logical time và merge thứ tự theo sender; không total order toàn hệ thống.
- Giữ 1000 dòng lịch sử và 10000 khóa dedup mỗi peer. File tối đa 512 KiB, lưu IndexedDB; chưa resume file qua restart và chưa gửi file nhóm.
- Chưa có E2EE. TLS/WebRTC transport encryption không đồng nghĩa mã hóa đầu cuối qua application relay.
- Adapter nhóm dự án và block tài khoản được giữ để mở rộng, nhưng cần Mobile API bên ngoài khi dùng Peer ID tài khoản Mongo 24 ký tự hex.

## Tài liệu

- [Hướng dẫn tự nghiệm thu từng yêu cầu DS01](docs/MANUAL-ACCEPTANCE.md)
- [Bảng điền kết quả kiểm thử](docs/manual-results.csv)
- [Tính năng nâng cao và cách chạy lại](docs/advanced-features.md)
- [Trạng thái khắc phục và nghiệm thu](docs/implementation-status.md)
- [Báo cáo kỹ thuật dự thảo](docs/report.pdf)
- [Kiến trúc](docs/architecture.md)
- [Giao thức](docs/protocol.md)
- [Kế hoạch kiểm thử](docs/test-plan.md)
- [Kịch bản demo](docs/demo-script.md)
- [Dàn ý báo cáo](docs/report-outline.md)
