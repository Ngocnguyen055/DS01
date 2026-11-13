# Tính năng nâng cao

## 1. Gửi file thật qua các đường truyền

- Chat cá nhân → nút `+` cạnh ô soạn tin → chọn file 1 byte–512 KiB.
- Chia thành chunk 2304 byte, base64 tối đa 3072 ký tự/chunk, vẫn giữ giới hạn envelope 8192 byte.
- Mỗi chunk có Message ID và ACK/retry riêng, được gửi DIRECT, TURN hoặc application RELAY như tin nhắn.
- Metadata gồm transferId/index/total/name/mime/size/SHA-256. Kiểm tra số chunk, kích thước, nội dung chunk trùng và hash toàn file.
- Chỉ lưu IndexedDB sau khi xác minh; notification attachment sau cùng chỉ ACK nếu byte file đã có. Không ACK thành công giả khi file thiếu sau reload hoặc có hash sai.
- Trên UI có tiến trình và nút tải về. File được tải như dữ liệu, không tự thực thi HTML/SVG.

Thử: gửi file qua DIRECT, đóng DIRECT rồi gửi file khác qua RELAY; tải cả hai và so SHA-256. `tests/recovery-advanced.test.ts` truyền/so toàn bộ 512 KiB; `npm run test:browser` kiểm tra file 32 KiB trong browser/IndexedDB thật. Sau reload vẫn tải được file đã hoàn thành.

Giới hạn: chưa gửi file nhóm, chưa resume transfer đang dở sau restart, chưa E2EE. Assembly tối đa 4 transfer, bỏ bản dở sau 2 phút; transfer integrity lỗi không được chấp nhận lại ngay với cùng ID. Người dùng có thể chọn file gửi lại thành transfer mới.

## 2. Nhiều application relay và failover

Terminal relay chính: `npm run start:relay` (4002).

Terminal relay dự phòng, cùng secret và signaling:

```powershell
$env:RELAY_PORT='4003'
npm.cmd run start:relay
```

Trong `.env` trước khi chạy Vite/build:

```env
VITE_RELAY_URL=http://localhost:4002
VITE_RELAY_URLS=http://localhost:4003
```

Mọi peer phải dùng cùng pool. Tối đa 4 URL khác nhau; không trỏ hai alias tới cùng một relay instance. Client giữ kết nối outbound tới pool và thử relay còn kết nối khi gửi; cùng Message ID được giữ khi cần truyền lại. Cả hai bên phải cùng kết nối được ít nhất một relay còn sống.

Thử: bật ưu tiên relay, gửi thành công, dừng relay chính, đợi bảng kết nối còn 1 relay rồi gửi tin/file mới. Receiver vẫn ACK, chỉ có một bản tin; log relay dự phòng phải có đúng ID. Có test integration và browser cho ca này.

Đây là failover đường truyền, không phải consensus hoặc replication state. Signaling vẫn là điểm lỗi đơn. Không có hàng đợi offline hoặc tự di chuyển dữ liệu giữa relay.

## 3. ICE/STUN/TURN và cách gọi đúng đường truyền

Client nhận `VITE_ICE_SERVERS` dạng JSON tại build time. Ví dụ khi đã có coturn của nhóm:

```env
VITE_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":["turn:turn.example.org:3478?transport=udp","turn:turn.example.org:3478?transport=tcp"],"username":"ds01-lab","credential":"REPLACE_WITH_LAB_PASSWORD"}]
```

TURN credentials trong cấu hình này được gửi tới browser, không phải secret chỉ dành cho server. Dùng credential lab có quota/thời hạn phù hợp; PEER_SECRET và JWT_SECRET không bao giờ đặt vào VITE_*.

| UI / envelope | Ý nghĩa |
|---|---|
| DIRECT | DataChannel với ICE candidate pair không có relay candidate |
| TURN | DataChannel có selected relay candidate, đi qua TURN |
| RELAY | Chat envelope qua application relay Socket.IO |

Client kiểm tra getStats trước khi báo DataChannel ready; nếu không xác định được selected route thì fallback thay vì tuyên bố DIRECT. TURN kết nối được không đồng nghĩa đã chứng minh DIRECT P2P không qua server.

`deploy/turnserver.conf.example` là cấu hình lab, không chứa credential thật. Copy ra ngoài repo, điền realm/user/password/public IP, chạy coturn trên server nhóm kiểm soát; mở 3478 TCP/UDP và dải relay 49160–49200 UDP theo cấu hình. Mẫu chưa bật TURNS; muốn TURNS phải cấu hình chứng chỉ và cổng TLS riêng. Các tùy chọn được đối chiếu với [mẫu cấu hình chính thức coturn](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf).

**Chưa chạy một coturn public thật trong môi trường này.** Hãy ghi NOT RUN cho nghiệm thu TURN/WAN tới khi có endpoint và log thực tế.

## 4. Lưu bền và phục hồi

CLI signaling ghi atomic snapshot hash danh tính và nhóm. Server restart không giải phóng quyền sở hữu Peer ID cho secret khác và không xóa nhóm. Dữ liệu hỏng làm startup báo lỗi thay vì âm thầm reset registry.

Mỗi file chỉ có một signaling writer; không dùng cùng file làm giao tiếp giữa nhiều process. Trong Docker dùng named volume riêng signaling. Backup file, giữ secret và giới hạn quyền truy cập; không commit `.data/`.

Client khôi phục sequence/session từ lịch sử; interrupted pending/sent thành failed. Retry text giữ Message ID. Group owner rời nhóm chuyển cho ID nhỏ nhất còn lại; nhóm hết người archived.

## 5. Tải đồng thời

```powershell
npm.cmd run load:relay -- --peers 20 --messages 10 --concurrency 8 --signal http://localhost:4001 --relay http://localhost:4002
```

Script đăng ký nhiều headless peer, giữ heartbeat và gửi đồng thời theo vòng. Kết quả có requested/delivered/failed/duplicate, success rate, throughput, p50/p95/max và ước tính payload bytes.

Giới hạn lab: 3–100 peer, 1–100 tin/peer, 1–50 worker. Đây là simulated peers trong một process tạo tải, không phải một máy cho mỗi peer. Latency kết thúc khi recipient Socket.IO nhận envelope; không đo app ACK, browser storage, WebRTC hay WAN. Payload bytes không gồm toàn bộ overhead TCP/TLS/Socket.IO.

`npm run test:browser` cũng chạy phép đo 20 peer, 200 tin, 8 worker trên relay dự phòng local và ghi `docs/evidence/load-relay.json`. Giữ source fingerprint/commit, môi trường và phạm vi đo khi đưa số vào báo cáo; không gọi số localhost là Internet latency.

## 6. Giao diện và tiện ích

Mạch có danh sách hội thoại gồm cả peer offline, tên hiển thị, tên nhóm, search, bubble nhóm gộp fan-out nhưng giữ trạng thái riêng từng receiver ở Chi tiết, retry, chặn peer, tải file, xuất lịch sử/log, dark mode và mobile layout.

Ưu tiên relay nằm trong Tình trạng kết nối, ghi rõ đó là chọn route, không mô phỏng NAT. Không hiển thị delivered như đã đọc, không gọi transport encryption là E2EE. History export không chứa identity proof/token.
