# Triển khai — DS01: P2P chat system simulating Skype

Hiện nhóm demo bằng Node.js và Cloudflare Tunnel. Thư mục này chứa cấu hình cho hướng triển khai Docker, máy chủ public và CD. Các lệnh bên dưới chạy tại **thư mục gốc dự án**, trừ bước redeploy trên máy chủ.

## 1. Chạy demo hiện tại

Sau khi cài dependency và chuẩn bị `.env` theo [README chính](../README.md#4-cài-đặt-và-chạy-local):

```powershell
npm.cmd run demo:local
```

Để các thiết bị khác mạng truy cập, cài [cloudflared](https://developers.cloudflare.com/tunnel/downloads/) rồi chạy:

```powershell
npm.cmd run demo:public
```

Gửi URL **Web** được in trong terminal cho các thiết bị. Máy vận hành phải giữ mạng và terminal hoạt động; Ctrl+C dừng phiên. Người tham gia không cần cài cloudflared. Chạy hai launcher riêng sẽ tạo hai hệ thống với tài khoản và dữ liệu riêng.

## 2. Cấu hình đã có

| File | Dùng để |
| --- | --- |
| [Dockerfile](Dockerfile) | Build image app và web |
| [compose.yml](compose.yml) | Build từ mã nguồn và chạy signaling, hai relay, web |
| [compose.images.yml](compose.images.yml) | Chạy image đã phát hành trên GHCR |
| [internet.env.example](internet.env.example) | Tham khảo biến môi trường public |
| [Caddyfile.example](Caddyfile.example) | HTTPS reverse proxy; mẫu web phục vụ file tĩnh |
| [turnserver.conf.example](turnserver.conf.example) | Cấu hình coturn cho STUN/TURN |

Docker đóng gói các dịch vụ. Địa chỉ public, domain và HTTPS vẫn cần được cấu hình trên máy chạy container.

## 3. Thử Docker Compose

Cần Docker Engine/Desktop, Compose v2 và `.env` có `JWT_SECRET`/`PEER_SECRET` ngẫu nhiên, khác nhau. Có thể dùng `.env` đã tạo bằng `npm.cmd run setup:env`.

```powershell
docker compose --env-file .env -f deploy/compose.yml up --build -d --wait
docker compose --env-file .env -f deploy/compose.yml ps
docker compose --env-file .env -f deploy/compose.yml logs -f signaling relay relay-backup
```

Mở `http://localhost:8080`. Các cổng host `4001`, `4002`, `4003` và `8080` được bind vào `127.0.0.1`, dùng cho truy cập trên máy host và reverse proxy.

Signaling, relay chính và relay dự phòng có named volume riêng. Khi cập nhật mã nguồn, chạy lại lệnh `up --build -d --wait`. `docker compose down` giữ volume; thêm `-v` sẽ xóa dữ liệu trong volume.

Docker dùng `/app/.data`; launcher Node mặc định dùng `../DS01-runtime/data/`. Khi chuyển dữ liệu vào container, dừng service cũ, sao lưu và chuyển cả registry lẫn `account-data/`. Nếu tên registry khác mặc định, bổ sung `ACCOUNT_STATE_PATH` vào `environment` của service signaling cho đúng đường dẫn trong container. Chỉ chạy một signaling writer trên một kho dữ liệu.

## 4. Hướng triển khai trên máy chủ public

Chuẩn bị máy chủ Linux chạy Docker/Compose, domain và HTTPS. Có thể thuê VPS hoặc dùng máy chủ được cấp. Hai relay trên cùng host chỉ bảo vệ khi một service lỗi; để chịu lỗi host cần tách máy chủ.

Đặt các URL public trong `.env`, dùng [internet.env.example](internet.env.example) làm mẫu:

```dotenv
VITE_SIGNAL_URL=https://signal.example.org
VITE_RELAY_URL=https://relay.example.org
VITE_RELAY_URLS=https://relay-backup.example.org
PUBLIC_RELAY_URL=https://relay.example.org
PUBLIC_RELAY_BACKUP_URL=https://relay-backup.example.org
```

Thay domain ví dụ bằng domain thật. Không dùng secret mẫu. Các biến `VITE_*` được đưa vào web khi build; đổi URL hoặc ICE cần build lại web.

Cấu hình Caddy trên host theo [Caddyfile.example](Caddyfile.example), cho phép truy cập cổng 80/443. Khi dùng web container, thay block web phục vụ file tĩnh bằng:

```caddyfile
peer.example.org {
  reverse_proxy 127.0.0.1:8080
}
```

Giữ các block signaling/relay trỏ đến `4001`/`4002`/`4003`. Domain signaling phải chuyển tiếp cả Socket.IO, `/account/*` và `/health`; tham khảo [reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy). Sau khi chạy Compose, mở domain web từ các mạng khác nhau để kiểm tra discovery, chat, file và cuộc gọi. Khi các endpoint HTTPS đã public, dùng domain máy chủ thay cho `demo:public`.

Hai relay phải dùng cùng tập URL canonical trong `RELAY_CLUSTER_URLS`. `RELAY_CLUSTER_ROUTES` ánh xạ chúng sang địa chỉ nội bộ để trao đổi replica; khi tách sang hai host, sửa routes theo địa chỉ thực tế. Mỗi relay giữ state riêng, replication đi qua HTTP có HMAC/nonce.

## 5. Hướng triển khai bằng CD

[DS01 CI](../.github/workflows/ci.yml) tự chạy khi push/PR. [DS01 manual delivery](../.github/workflows/delivery.yml) là workflow phát hành và triển khai thủ công; cần chuẩn bị máy chủ ở mục 4 trước khi bật deploy.

Cấu hình trên GitHub:

| Nơi cấu hình | Giá trị |
| --- | --- |
| Repository → Settings → Secrets and variables → Actions → Variables | `VITE_SIGNAL_URL`, `VITE_RELAY_URL`, `VITE_RELAY_URLS`; tùy chọn `VITE_ICE_SERVERS` |
| Environment `production` → Variables | `DEPLOY_PATH`, ví dụ `/opt/ds01` |
| Environment `production` → Secrets | `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` |

Máy chủ cần thư mục deploy đã tồn tại, `.env` với cấu hình thật và quyền tải image từ GHCR. Nếu image private, đăng nhập registry trên máy chủ bằng token có quyền đọc package. `DEPLOY_KNOWN_HOSTS` chứa host key đã đối chiếu của máy chủ SSH.

Mở **Actions → DS01 manual delivery → Run workflow**:

| Tùy chọn | Các bước chạy |
| --- | --- |
| `deploy=false` | Chạy CI, build và đẩy image app/web lên GHCR với tag `sha-<commit>` |
| `deploy=true` | Thực hiện các bước trên, gửi Compose/script đến máy chủ, pull image và chạy container |

Workflow dùng [deploy-remote.sh](../scripts/deploy-remote.sh), chờ health rồi mới cập nhật `current-release.env`. Nếu cập nhật lỗi và có release trước, script chạy lại image của release đó. Rollback image không khôi phục dữ liệu/schema; sao lưu state trước khi đổi schema.

Để triển khai lại một revision đã phát hành, đặt `COMMIT_SHA` là SHA đầy đủ 40 ký tự của revision đó rồi chạy trong thư mục deploy trên server:

```bash
bash deploy-remote.sh ghcr.io/ngocnguyen055/ds01 "$COMMIT_SHA"
```

Workflow không cài Caddy, tạo domain hoặc cấp máy chủ. Các phần này được chuẩn bị trước khi chạy deploy.

## 6. TURN và super-peer

Coturn chạy riêng với application relay. Thay realm, credentials và cấu hình firewall theo [turnserver.conf.example](turnserver.conf.example); cấu hình external IP nếu máy chủ ở sau NAT. Mẫu hiện tắt TLS/DTLS, nên chỉ dùng `turn:`; muốn dùng `turns:` cần cấu hình chứng chỉ và listener tương ứng.

Đặt JSON STUN/TURN trong `VITE_ICE_SERVERS`. Các biến `VITE_*` hiển thị trong trình duyệt; không đặt secret ký của máy chủ vào đó. Với TURN public, dùng credential có thời hạn và quota. Xem candidate được chọn và nhãn DIRECT/TURN/RELAY để phân biệt đường truyền; Cloudflare Tunnel không thay thế TURN.

Để ứng cử super-peer, chạy relay đồng hành HTTPS public trong cluster, đặt `SUPER_PEER_ID` hoặc `SUPER_PEER_BACKUP_ID` trùng Peer ID của tài khoản. Đăng nhập, nhập URL tại **Kết nối nâng cao** và ứng cử. Theo dõi `ELECTION_CANDIDATE`, `ELECTION_RESULT` và lease trong log. `ALLOW_LOCAL_SUPERPEERS=1` chỉ dùng cho lab local.

Chi tiết: [advanced-features.md](../docs/advanced-features.md).
