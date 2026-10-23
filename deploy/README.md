# Triển khai thử nghiệm qua Internet

1. Cài Node.js 20+ và clone repository lên máy chủ.
2. Sao chép `.env.example` thành `.env`, đổi secret và URL.
3. Chạy `npm ci`, `npm run build:web`.
4. Chạy signaling và relay thành hai process độc lập bằng systemd, PM2 hoặc hai terminal.
5. Dùng Caddy theo `Caddyfile.example` để cấp HTTPS/WSS và phục vụ web tĩnh.
6. Mở các cổng 80/443; không cần công khai trực tiếp cổng 4001/4002 khi đã reverse proxy.

Có thể dùng một máy chủ miễn phí hoặc tunnel HTTPS cho buổi thử. Tunnel cần tạo endpoint riêng cho signaling, relay và web. Repository không tự tạo tài khoản và không khẳng định đã triển khai công khai.

Không có TURN trong dự án. STUN giúp tìm candidate nhưng không đảm bảo DIRECT qua mọi NAT; khi DataChannel thất bại, application relay Socket.IO thực hiện fallback.
