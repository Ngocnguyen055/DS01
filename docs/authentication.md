# Tài khoản và tự kết nối peer

Luồng mặc định: **Tạo tài khoản → Đăng nhập → Tự đăng ký peer với signaling → Vào chat**. Đăng ký tài khoản không tự tạo phiên đăng nhập. Sau khi đăng ký, biểu mẫu chuyển về đăng nhập và giữ tên đăng nhập vừa tạo.

## Chạy và demo

Tại thư mục dự án, mở ba terminal:

```powershell
npm.cmd run start:signaling
```

```powershell
npm.cmd run start:relay
```

```powershell
npm.cmd run dev:web
```

Mở `http://localhost:5173` bằng ba browser profile riêng. Tạo tài khoản `alice`, `bob`, `carol`, mỗi tài khoản có tên hiển thị và mật khẩu ít nhất 10 ký tự. Đăng nhập từng tài khoản. Peer ID được cấp tự động lần lượt là `user_alice`, `user_bob`, `user_carol`; không nhập Peer ID hoặc secret trong luồng tài khoản.

Chọn người trong danh sách để chat. DIRECT vẫn được ưu tiên; bật relay trong Tình trạng kết nối để demo RELAY. Khi tạo nhóm bằng ID, dùng `user_bob,user_carol`. Tải lại trang trong cùng tab sẽ tự kiểm tra phiên và tham gia mạng lại. Nút Đăng xuất ở thanh trên thu hồi phiên trên server, đóng các kết nối và đưa về biểu mẫu đăng nhập.

## Các ca tự kiểm tra

| Ca | Thao tác | Kết quả cần thấy |
|---|---|---|
| A01 | Đăng ký tên hợp lệ, mật khẩu >=10 ký tự và xác nhận trùng | Báo tạo thành công, chuyển sang đăng nhập; chưa online |
| A02 | Dùng lại tên đăng nhập, kể cả đổi chữ hoa/thường | Bị từ chối; không tạo hai ID cho cùng tên |
| A03 | Nhập sai mật khẩu | Không vào chat, báo lỗi chung cho tên/mật khẩu |
| A04 | Đăng nhập đúng | Không cần thao tác kết nối riêng; tự online, thấy peer khác |
| A05 | Ba tài khoản đăng nhập và chat nhóm cùng lúc | Ba ID riêng, discovery, DIRECT/RELAY, ACK và nhóm hoạt động |
| A06 | Đăng nhập cùng tài khoản trên browser khác khi phiên cũ online | Báo tài khoản đang online; phiên cũ tiếp tục dùng được |
| A07 | F5 trong cùng tab | Tự xác minh phiên, khôi phục ID, lịch sử và nhóm |
| A08 | Restart signaling, giữ file state | Peer tự kết nối lại; tài khoản, quyền sở hữu và nhóm còn nguyên |
| A09 | Đăng xuất rồi F5 | Giữ ở màn hình đăng nhập, không hiển thị hội thoại của tài khoản cũ |
| A10 | Đăng nhập lại sau đăng xuất | Dùng lại đúng Peer ID và lịch sử trên thiết bị đó |
| A11 | Đăng nhập tài khoản khác sau đăng xuất | Không trộn lịch sử hai Peer ID |
| A12 | Dùng token trước đăng xuất để đăng ký lại/gửi relay | Bị từ chối; đã có integration test bằng socket thô |

Không đăng nhập đồng thời nhiều tài khoản bằng các tab của cùng profile để đánh giá tính cô lập storage. Các tab cùng origin chia sẻ localStorage/IndexedDB; dùng profile riêng cho demo nhiều người dùng.

## Thiết kế và ràng buộc

- Username được trim, chuyển chữ thường, dài 3–24 ký tự `[a-z0-9_-]`. Peer ID cố định là `user_` + username. Display name tối đa 80 ký tự, được server lấy từ tài khoản khi đăng ký peer.
- Mật khẩu dài 10–128 ký tự, tối đa 256 byte UTF-8. Lưu bằng scrypt `N=131072, r=8, p=1`, salt ngẫu nhiên riêng 16 byte, hash 64 byte; dùng so sánh timing-safe. Không lưu/log mật khẩu rõ. Thông số theo [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- Phiên là bearer token ngẫu nhiên 32 byte, hết hạn sau 12 giờ. Server chỉ lưu SHA-256 của token. Browser dùng sessionStorage trong tab, không lưu mật khẩu. F5 giữ phiên; sau khi đóng tab có thể cần đăng nhập lại. Browser có thể khôi phục sessionStorage khi dùng chức năng khôi phục tab; hết hạn/thu hồi trên server vẫn quyết định quyền truy cập.
- Một tài khoản có một Peer ID và tối đa một peer online. Đăng nhập mới khi peer cũ offline thay thế phiên đăng nhập cũ. Phiên đang online ở nơi khác bị từ chối. Nếu mất mạng đột ngột, có thể cần đợi heartbeat lease hết trước khi đăng nhập trên thiết bị khác.
- Giới hạn auth theo địa chỉ kết nối (40 lần/10 phút) và username (10 lần/10 phút), giữ qua các socket mới trong cùng process. Tối đa hai tác vụ scrypt đang chạy để giới hạn RAM; trả thông báo bận cho yêu cầu vượt mức. Budget ở RAM, reset khi server restart. Sau reverse proxy, địa chỉ có thể là IP của proxy và quota IP sẽ dùng chung; cần thiết kế proxy đáng tin và rate limiting riêng khi mở cho nhiều người dùng Internet.
- Registry tài khoản mặc định `.data/signaling.json.accounts.json`, đi cùng `.data/signaling.json` của signaling. Có thể đặt `ACCOUNT_STATE_PATH`. Ghi snapshot atomic, một writer; dữ liệu hỏng làm startup thất bại. Giữ cả hai file khi restart/backup; không chia sẻ file này làm bus giao tiếp giữa các service.
- Signaling chỉ nhận control plane. Các event tài khoản không nhận/gửi nội dung chat. Relay kiểm tra session qua HTTP nội bộ tại handshake và khi chuyển tiếp tin tài khoản, nên token đã thu hồi không tiếp tục dùng relay. Đổi lại, chat RELAY của tài khoản phụ thuộc vào signaling để xác minh phiên; DIRECT đã thiết lập có thể tiếp tục khi signaling tạm mất mạng cho tới khi phiên bị đóng/hết hạn tại client.
- Khi triển khai Internet, cấu hình HTTPS/WSS cho đường tài khoản/signaling; HTTP localhost chỉ dùng lab. Không gửi mật khẩu hoặc bearer token qua HTTP public. Không commit `.env`, registry hoặc token.
- Chưa có reset mật khẩu qua email, xác minh email, MFA, quản lý nhiều thiết bị hoặc đồng bộ lịch sử qua server. Không mô tả những chức năng này là đã hoàn thành.

## Protocol và code

| Event Socket.IO tới signaling | Payload | Kết quả thành công |
|---|---|---|
| `auth:register` | `{ username, password, displayName }` | `{ ok, account }` |
| `auth:login` | `{ username, password }` | `{ ok, account, token, expiresAt }` |
| `auth:session` | `{ token }` | `{ ok, account, expiresAt }` |
| `auth:logout` | `{ token }` | `{ ok }`, thu hồi token |
| `peer:register` | `{ peerId, identityProof: token }` | Relay JWT có `sub=peerId`, `sid=hash phiên` |

Mọi lỗi có `{ ok: false, error }`. Prefix `user_` dành riêng cho tài khoản, không đăng ký được bằng secret demo. Adapter JWT/Mongo 24-hex cũ vẫn giữ để tương thích, không phải tài khoản local mới.

Code: `src/signaling/accounts.ts`, `authHandlers.ts`, `peerHandlers.ts`, `src/relay/index.ts`, `src/web-peer/auth.ts`, `AuthPanel.tsx`, `useWebPeer.ts`. Kiểm thử: `tests/accounts.test.ts` và `npm.cmd run test:browser`.

Chế độ cũ nằm ở **Thử nghiệm kỹ thuật bằng Peer ID** bên dưới biểu mẫu. Dùng mục này cho các kịch bản `peer-a/peer-b/peer-c` trong tài liệu cũ và mở lịch sử demo đã có. Tài khoản mới có ID khác nên không tự nhập lịch sử demo vào tài khoản.
