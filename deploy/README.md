# Triển khai thử nghiệm qua Internet

1. Cài Node.js 22.12+ (app cũng hỗ trợ 20.19+) và clone repository lên máy chủ.
2. Sao chép `.env.example` thành `.env`, đổi secret và URL.
3. Chạy `npm ci`, `npm run build:web`.
4. Chạy signaling và relay thành hai process độc lập bằng systemd, PM2 hoặc hai terminal.
5. Dùng Caddy theo `Caddyfile.example` để cấp HTTPS/WSS và phục vụ web tĩnh.
6. Mở các cổng 80/443; không cần công khai trực tiếp cổng 4001/4002 khi đã reverse proxy.

Có thể dùng một máy chủ miễn phí hoặc tunnel HTTPS cho buổi thử. Tunnel cần tạo endpoint riêng cho signaling, relay và web. Repository không tự tạo tài khoản và không khẳng định đã triển khai công khai.

TURN tùy chọn qua `VITE_ICE_SERVERS`, xem [advanced-features.md](../docs/advanced-features.md) và mẫu coturn. Chưa có bằng chứng TURN public.

## Chạy bằng Docker Compose

Tại root repo, tạo/chuẩn bị `.env` bằng `node scripts/init-env.mjs` (không in secret, giữ secret thật đã có). Sau đó:

```powershell
docker compose --env-file .env -f deploy/compose.yml up --build -d
docker compose --env-file .env -f deploy/compose.yml logs -f signaling relay relay-backup
```

Mở `http://localhost:8080`: signaling 4001, relay 4002, backup 4003. Snapshot signaling nằm trong named volume, không xóa volume khi kiểm tra restart. Lệnh `down -v` xóa registry và quyền sở hữu ID, không dùng nó làm phép thử phục hồi.

Build VITE_* với URL máy chủ mà browser truy cập được; localhost chỉ phù hợp cùng máy. Compose lab chưa tự cấu hình TLS/public DNS. Khi dùng web container phía sau Caddy host, block web có thể `reverse_proxy 127.0.0.1:8080` thay cho static root. Caddy reverse_proxy hỗ trợ WebSocket upgrade theo [tài liệu chính thức](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

Với cấu hình public, đặt NODE_ENV=production và secret ngẫu nhiên thật; server từ chối secret mẫu. Không trỏ hai signaling writer vào cùng state file. Mount/persist `.data` đúng quyền node; sao lưu registry trước khi thay đổi môi trường.

Docker chưa được chạy trong môi trường kiểm tra này; cần tự build/run và lưu log trước khi đánh dấu nghiệm thu Docker/WAN đạt.
