# Đánh giá DS01 theo COURSE PROJECT SPECIFICATION.pdf

Ngày đánh giá: **29/10/2026**, múi giờ Asia/Saigon. Commit được kiểm tra: `436a38f`.

**Đây là bản rà soát trước khi sửa, giữ làm lịch sử phát hiện lỗi.** Trạng thái mã hiện tại và bằng chứng mới xem [implementation-status.md](implementation-status.md).

## 1. Kết luận

**Dự án có nền tảng đúng và đã triển khai nhiều chức năng cốt lõi DS01, nhưng chưa thể kết luận đáp ứng toàn bộ đề hoặc sẵn sàng nộp.** Có lỗi chạy thực tế cần sửa, những yêu cầu bắt buộc chưa có bằng chứng kiểm chứng, và hồ sơ nộp còn thiếu.

Ba nhóm vấn đề quan trọng nhất:

1. **Độ ổn định/bảo mật:** callback Socket.IO sai kiểu có thể làm signaling hoặc relay thoát với exit code 1; signaling bị tác động ngay cả khi client chưa đăng ký.
2. **Đúng đắn/phục hồi:** sequence chưa được dùng để sắp thứ tự hiển thị; đóng peer khi chờ ACK để lại promise chưa hoàn tất; danh tính demo mất ràng buộc secret khi signaling khởi động lại.
3. **Hoàn thành bài nộp:** chưa có bằng chứng DIRECT thật và Internet/NAT trong repo; thiếu `docs/report.pdf`, phân công bằng tên/MSSV thật, lịch sử đóng góp của các thành viên và final tag trong bản Git cục bộ.

Không chấm phần trăm hoặc ước lượng điểm vì đề không cung cấp thang điểm, và các yêu cầu demo bắt buộc không thể suy ra chỉ từ số test chạy xanh.

## 2. Phạm vi và phương pháp

- Đọc các phần yêu cầu chung, DS01, kiểm thử, sản phẩm nộp và trình diễn trong PDF 17 trang. DS02/DS03/DS04 không dùng làm tiêu chí chức năng cho dự án này.
- Rà soát toàn bộ mã ứng dụng trong `src/`, bốn file test, scripts, cấu hình, README và tài liệu/deploy hiện có. `node_modules` là thư viện bên thứ ba, không phải mã nhóm tự triển khai.
- Chạy typecheck, lint, bộ test gốc và production build web.
- Dùng các probe tạm để xác nhận bốn lỗi trạng thái/thứ tự; dùng hai child process cục bộ để kiểm tra lỗi callback sai kiểu.
- Không sửa mã chức năng. Các probe và bundle tạm đã xóa sau khi kiểm tra; giữ báo cáo và kết quả quan sát trong `docs/evidence/review-*.json`.
- Không thực hiện triển khai công khai hoặc thay đổi dịch vụ bên ngoài.

Kết quả kiểm tra nền:

| Kiểm tra | Kết quả |
|---|---|
| `npm run typecheck` | Đạt |
| `npm run lint` | Đạt |
| `npm test` | 4 file, 13 test đạt |
| `npm run build:web` | Đạt |
| 4 probe bổ sung về lỗi logic | Xác nhận cả 4 hành vi lỗi; không phải 4 tiêu chí nghiệm thu đạt |
| Callback sai kiểu trên signaling/relay | Cả hai process thoát với exit code 1 |
| WebRTC DIRECT bằng trình duyệt thật | Chưa xác minh được |
| Relay qua Internet/NAT hoặc các miền mạng cô lập | Chưa chạy |

Môi trường: Windows, Node `v25.2.1`. Test gốc dùng Socket.IO qua TCP thật nhưng tạo các server/client trong môi trường Vitest; chúng không tự chứng minh triển khai nhiều máy hoặc WebRTC thật. `DeadRTC` trong `tests/peer.test.ts` cố tình không mở DataChannel.

Giới hạn môi trường kiểm tra: tsx CLI gặp lỗi `os.userInfo()/uv_os_get_passwd ENOMEM` trong runtime hạn chế; các probe server độc lập dùng esbuild biên dịch tạm mã nguồn không thay đổi logic. Thử Chrome gặp timeout khởi tạo trang/Runtime CDP; một lần khởi chạy shell tiếp theo báo thiếu dung lượng đĩa. Không quy các lỗi môi trường này thành lỗi ứng dụng. Không tuyên bố đã kiểm thử UI, DIRECT thật hoặc phục hồi localStorage trong browser thật.

## 3. Đối chiếu yêu cầu chung

Các trang trong bảng là số trang PDF, tính từ 1.

| Mục | Yêu cầu | Đánh giá và bằng chứng |
|---|---|---|
| 4.1, trang 2 | Tối thiểu 3 thành phần độc lập, giao tiếp mạng, ID riêng, nhiều kết nối | Kiến trúc đáp ứng: signaling, relay, web peers có lệnh chạy riêng; Socket.IO/WebRTC; test có ba Peer ID. Chưa có bằng chứng triển khai đầy đủ ba browser/máy thực tế trong repo. |
| 4.1 | Không dùng bộ nhớ/file chia sẻ thay mạng | Đúng hướng: các Map là trạng thái nội bộ từng dịch vụ; peer giao tiếp mạng. localStorage lưu lịch sử cục bộ phù hợp đề. |
| 4.1 | Log có node, timestamp, loại sự kiện, kết quả | Một phần: server có prefix signal/relay và event, nhưng các `console.log` không thêm timestamp. Web có giờ cục bộ trong log. |
| 4.2, trang 2–3 | Kiến trúc, định danh, discovery, protocol, trạng thái, timeout/ACK/retry | Có mã và tài liệu tương đối rõ. Phần xử lý out-of-order chưa thực hiện đúng tuy có trường sequence. |
| 4.3, trang 3 | Đồng thời, mô hình nhất quán, kiểm soát xung đột và test | Có version nhóm và optimistic concurrency; một test sửa nhóm đồng thời. Chưa chứng minh đầy đủ hai kịch bản concurrency theo mục 9, nhất là gửi nhóm gần đồng thời với bất biến thứ tự. |
| 4.4, trang 3–4 | Ít nhất hai tình huống lỗi và phục hồi | Có timeout, retry giới hạn, ACK, dedup, heartbeat và Socket.IO reconnection. Chưa có đủ kết quả hai vòng lỗi–phục hồi; còn lỗi hủy gửi đang chờ và trạng thái UI. |
| 4.5, trang 4 | Xác thực, phân quyền, validate, secret qua env, giới hạn kích thước, log | Có JWT relay, hash secret demo, kiểm tra sender/membership, Zod, giới hạn body/wire. Chưa đạt vững do lỗi callback và mất registry danh tính sau restart. `.env` không được Git theo dõi ở commit kiểm tra. |

## 4. Đối chiếu DS01

| Mục | Nội dung đề | Đánh giá |
|---|---|---|
| 5.1, trang 4 | Peer chủ động/kết nối nhận; hoạt động WAN/NAT qua relay hoặc tương đương | Có thiết kế phù hợp: WebRTC hai chiều + relay với kết nối outbound. WAN/NAT chưa được kiểm chứng. |
| 5.2, trang 5 | Signaling, relay Internet, ≥3 peer, lưu lịch sử, giao diện | Có đủ loại thành phần trong mã. Relay Internet chưa có kết quả kiểm tra. |
| 5.2 | DIRECT không qua relay; thất bại thì RELAY | `DirectTransport.ensure()` thử DIRECT; `MessageDelivery.send()` chuyển RELAY khi timeout hoặc thiếu ACK. Cần chạy DIRECT thật và phá kết nối đã mở. |
| 5.2 | Bootstrap không âm thầm chuyển tất cả chat | Signaling chỉ điều phối đăng ký, SDP/ICE và quyền nhóm; relay chat tách riêng. Đây là điểm đúng của kiến trúc. |
| 5.3, trang 5–6 | Peer ID duy nhất, đăng ký, display name/status/connectivity, danh sách online, heartbeat và expiry | ID, discovery, heartbeat 10 giây, lease 30 giây và quét 5 giây có mã/test. **Thiếu display name trong mô hình đăng ký/presence hiện tại**; status/capability được suy ra thay vì lưu đầy đủ metadata đăng ký. |
| 5.4, trang 6 | Tìm peer → thử DIRECT → timeout → relay → hai bên biết đường truyền | Phần chính có. Hàm lookup riêng tồn tại, nhưng UI gửi trực tiếp từ danh sách presence, không dùng `DirectChatService.open()`. Chưa có trace đủ quy trình trên WAN. |
| 5.4 | Giải thích signaling, NAT, STUN/TURN và fallback | Có trong `docs/architecture.md`. Phân biệt đúng STUN/TURN với application relay. |
| 5.5, trang 6 | Chat 1–1, ưu tiên DIRECT, fallback tự động, gửi/nhận, trạng thái, lịch sử local | Có mã và kiểm thử một phần qua relay. Cần xác minh UI/browser, DIRECT thật và sửa phục hồi trạng thái gửi. |
| 5.6, trang 6–7 | Tạo nhóm, thêm/xóa, gửi mọi thành viên, nhiều mạng, membership nhất quán, xử lý offline | Có nhóm demo, version, multi-unicast và ACK theo receiver; thành viên offline dẫn đến failed, không queue. Nhiều mạng chưa kiểm chứng. Có trường hợp owner rời nhóm làm nhóm mất quyền thêm thành viên. |
| 5.7, trang 7 | Message ID, sender, receiver/group, session, type, timestamp, content, mode, ACK | Có các trường cốt lõi và ACK riêng; trạng thái gửi lưu tại peer. |
| 5.8, trang 7–8 | ID duy nhất, ACK, timeout, retry hữu hạn, dedup, ordering, báo failed, mô tả semantics | Phần lớn có. **Ordering chưa đạt ổn định** vì chỉ sort timestamp rồi UUID; sequence không được dùng để xử lý thứ tự. |
| 5.9, trang 8 | Relay public, routing đúng, nhiều kết nối, phát hiện ngắt, validate/giới hạn, chống giả danh, log | Có routing, mapping, JWT và kiểm tra sender; test kiểm tra spoof/oversize. Chưa xác nhận public; callback sai kiểu làm server chết; registry danh tính demo không bền sau signaling restart. |
| 5.9 | Đánh giá SPOF, latency, bandwidth/scalability, relay dừng, mở rộng nhiều relay | README có nêu một số giới hạn; có benchmark localhost. Chưa có phân tích hoàn chỉnh về bandwidth/scalability và thiết kế mở rộng nhiều relay trong báo cáo chính thức. |
| 5.10, trang 8–9 | 12 tình huống demo bắt buộc | Chưa đủ bằng chứng; xem bảng bên dưới. |
| 5.11, trang 9 | Các tính năng nâng cao | Không bắt buộc hoàn thành tất cả. Không có TURN, DHT, nhiều relay, file transfer hoàn chỉnh hoặc voice/video không tự động khiến bài thiếu chức năng tối thiểu. |

## 5. Các vấn đề cần sửa

### R1 — Ưu tiên cao: dữ liệu sai làm server thoát

Vị trí: `src/signaling/groupHandlers.ts:81`, `src/signaling/webrtcHandlers.ts:25`, `src/relay/index.ts:117`.

Nhiều handler dùng `reply?.(...)` mà không kiểm tra `typeof reply === 'function'`. Optional chaining chỉ bảo vệ null/undefined; chuỗi hoặc object vẫn gây TypeError khi gọi như hàm.

Đã xác nhận trên các process riêng do người kiểm tra khởi tạo:

- Client **chưa đăng ký** gửi `group:create` với `{ members: [] }` và đối số thứ ba là chuỗi; signaling thoát, exit code 1.
- Client relay có token hợp lệ gửi `relay:send` với callback sai kiểu; relay thoát, exit code 1.

Ảnh hưởng: một client có thể ngừng dịch vụ, làm mất discovery/membership hoặc toàn bộ đường relay. Liên quan trực tiếp 4.4, 4.5, 5.9. Cần chuẩn hóa kiểm tra callback cho mọi handler, chặn exception/rejection từ input và thêm regression test chứng minh server vẫn phục vụ được request hợp lệ sau gói sai.

Bằng chứng: [review-invalid-input.json](evidence/review-invalid-input.json). Các dòng stack nhắc `.audit-run.mjs` là bundle tạm từ mã nguồn gốc, đã được xóa.

### R2 — Ưu tiên cao trước nghiệm thu: ordering chỉ có trường, chưa có cơ chế đúng

Vị trí: `src/web-peer/store.ts:75`, `src/web-peer/store.ts:91`, `src/shared/messageDelivery.ts:33`.

`list()` và `listDirect()` sort theo timestamp rồi Message ID. Chúng không dùng sequence/session để giữ thứ tự sender. Đã đưa hai tin cùng timestamp, sequence lần lượt 1 và 2, với UUID của tin 2 đứng trước tin 1: cả hai hàm trả **[2, 1]**.

Đồng hồ sender lùi cũng có thể đảo tin. Sequence hiện lưu trong Map và reset khi tạo PeerClient mới; nhóm còn dùng Group ID làm session, nên không thể chỉ đổi comparator sang sequence mà bỏ qua việc định nghĩa phiên/restart.

Cần chốt quy tắc thứ tự theo sender/conversation/session, xử lý tie và tin đến muộn, xác định sequence sau restart; test cùng timestamp, đảo thứ tự đến, chuyển DIRECT→RELAY và gửi nhóm đồng thời. Không cần total order toàn hệ thống nếu mô hình nhất quán được mô tả rõ.

### R3 — Ưu tiên cao: mất ràng buộc danh tính khi signaling restart

Vị trí: `src/signaling/index.ts:48`, `src/signaling/peerHandlers.ts:40`.

Registry `demoSecrets` chỉ ở RAM. Đã đăng ký một Peer ID với secret gốc, khởi tạo lại dịch vụ rồi đăng ký cùng ID bằng secret khác: server chấp nhận và cấp token relay.

Đây là giới hạn của cơ chế đăng ký đầu tiên giữ quyền sở hữu, ảnh hưởng yêu cầu xác thực/chống mạo danh. Cần lưu bền hash ràng buộc Peer ID với secret, hoặc dùng danh tính được cấp/xác minh bởi cơ chế bền vững khác. Không cần triển khai MongoDB/Mobile API chỉ để chạy demo DS01.

### R4 — Ưu tiên vừa: ngắt peer khi chờ ACK để lại lần gửi treo

Vị trí: `src/shared/messageDelivery.ts:89`, `src/shared/messageDelivery.ts:259`.

`close()` xóa timer và Map pending nhưng không resolve/reject promise chờ ACK. Probe với timeout 30 ms, gọi close trong lúc chờ, sau 80 ms promise vẫn pending và trạng thái lưu là sent.

Cần lưu cả reject/cancellation, kết thúc lần gửi khi đóng, và định nghĩa cách xử lý pending/sent còn tồn tại khi mở lại. Không nhất thiết tự giao tin offline; đánh dấu interrupted/failed và cho người dùng gửi lại cũng là chính sách hợp lệ nếu mô tả rõ.

### R5 — Ưu tiên vừa: trạng thái Online trên UI không theo trạng thái kết nối thật

Vị trí: `src/shared/peer.ts:142`, `src/shared/peer.ts:185`, `src/web-peer/useWebPeer.ts:60`.

Đánh giá bằng đọc mã: disconnect của signaling/relay chỉ phát log. `connected` trên UI chỉ đổi khi connect thành công/thất bại hoặc bấm Ngắt. Vì vậy UI có thể tiếp tục hiển thị Online khi signaling đã mất, danh sách peer có thể cũ. Chưa xác minh hành vi này bằng browser thật.

Cần event trạng thái kết nối và state rõ connecting/online/reconnecting/offline, phân biệt signaling với relay, báo lý do đăng ký thất bại. Đặc biệt kiểm tra đường heartbeat expiry đang gọi `socket.disconnect(true)`; không nên giả định mọi kiểu ngắt đều được Socket.IO tự nối lại.

### R6 — Ưu tiên vừa: thiếu display name và timestamp phía server

Đề 5.3 yêu cầu thông tin đăng ký gồm display name; `peer:register` hiện chỉ nhận Peer ID và identity proof, `PeerSession` chỉ có socket/lastSeen. Cần bổ sung tên hiển thị cùng giới hạn/validation và đưa vào discovery/UI.

Đề 4.1 yêu cầu timestamp trong log. Các log REGISTER, DISCONNECT, TIMEOUT, GROUP_CHANGE, FORWARD của server hiện không tự ghi timestamp. Cần bổ sung thời gian, service/node, loại sự kiện và kết quả theo format thống nhất; tránh log token/secret.

### R7 — Các trường hợp biên cần làm rõ

- `src/signaling/groupHandlers.ts:124`: owner tự xóa mình khỏi nhóm được chấp nhận; các thành viên còn lại không có quyền thêm người. Đã tái hiện. Cần chuyển owner, giải tán nhóm hoặc cấm thao tác này theo chính sách rõ ràng.
- `src/web-peer/App.tsx:40`: chọn chat 1–1 chỉ từ danh sách online. Sau khi tải lại, lịch sử với peer đang offline vẫn có trong storage nhưng thiếu danh sách hội thoại để mở xem.
- `WebStore.write()` chỉ giữ 1000 dòng; dedup dựa trên chính lịch sử đó. Cần mô tả phạm vi dedup, không tuyên bố chống replay vĩnh viễn hay exactly-once.
- README và package.json ghi Node >=20, trong khi Vite cài hiện tại yêu cầu `^20.19.0 || >=22.12.0`. Cần ghi yêu cầu runtime chính xác để người khác cài lại được.
- Adapter project/account cần API ngoài, chưa có implementation API trong repo. Chức năng demo ID `peer-a/b/c` không phụ thuộc API; không nên trình bày integration này như hệ thống đã tự chứa đầy đủ.
- Attachment hiện là metadata/tham chiếu, chưa có luồng chuyển byte file/UI upload/download trong repo. Đây là tính năng nâng cao, không tính là thiếu chat tối thiểu.

## 6. Đối chiếu 12 tình huống demo bắt buộc (5.10)

| # | Tình huống | Bằng chứng hiện có / việc còn cần |
|---|---|---|
| 1 | Signaling và relay truy cập từ Internet | Chỉ có mẫu Caddy/domain example và hướng dẫn; chưa xác nhận URL chạy thật. |
| 2 | Khởi động ≥3 peer | Test có ba PeerClient; cần demo ba peer độc lập. |
| 3 | Đăng ký và discovery | Có test; cần log/ảnh demo đầy đủ. |
| 4 | Hai peer chat DIRECT thật | Có implementation; chưa có kết quả WebRTC thật. |
| 5 | Log chứng minh DIRECT không qua relay | Chưa có cặp log sender/receiver/relay theo cùng Message ID của DIRECT thật. |
| 6 | Peer khác mạng/NAT chat qua relay | Chưa có bằng chứng Internet hoặc miền mạng mô phỏng cô lập. |
| 7 | Log chứng minh đường relay | Test có FORWARD; cần bằng chứng tương ứng tình huống mạng của #6. |
| 8 | Ba peer trong nhóm trao đổi | Có test fan-out/ACK; cần trình diễn trao đổi giữa ba peer. |
| 9 | Hai peer gửi gần đồng thời | Có kịch bản dự kiến; chưa có bằng chứng demo riêng kiểm tra mất/trùng/thứ tự. |
| 10 | Dừng đột ngột một peer, cập nhật status | Có code/disconnect tests; cần dừng thật và đo/ghi thời gian phát hiện. |
| 11 | Phá kết nối DIRECT đang hoạt động, tự fallback | Test hiện mô phỏng DataChannel chưa từng mở. Checkbox chỉ chọn RELAY, không phá một DataChannel đang mở. Cần kiểm tra đúng tình huống. |
| 12 | Restart peer, khôi phục trạng thái phù hợp | Test khôi phục WebStore với localStorage giả lập; cần reload browser thật và kiểm tra trạng thái gửi/nhóm. |

Nếu không có hai mạng thật, PDF cho phép VM/Docker network riêng nhưng vẫn phải chứng minh đường DIRECT không lập được và relay độc lập chuyển tin được. Checkbox ép relay đơn thuần không chứng minh điều đó.

## 7. Kiểm thử, hiệu năng và sản phẩm nộp

Mục 9 yêu cầu tối thiểu **8 functional + 2 concurrency/conflict + 2 fault/recovery + 2 security/invalid-data + 1 performance/scalability**. Số `it()` không tương đương số tình huống nghiệm thu: một test có thể bao phủ nhiều chức năng, nhưng phải chỉ ra thao tác, kết quả và bằng chứng tương ứng.

`docs/test-plan.md` đã liệt kê đủ loại kịch bản dự kiến, song nhiều dòng vẫn ghi cần demo/chưa chạy. Không thể dùng kế hoạch làm kết quả đã đạt. Hai vòng lỗi–phục hồi nên bao gồm peer mất mạng rồi nối lại, và relay dừng rồi khởi động lại, với bất biến trạng thái được kiểm tra trước/sau.

`docs/evidence/benchmark.txt` có đo 100 tin relay tuần tự trên localhost, p50 khoảng 0.545 ms, p95 khoảng 1.023 ms, max khoảng 123.45 ms. Đây là bằng chứng một thí nghiệm hẹp, không đo WebRTC, WAN, throughput nhiều peer hoặc ACK ứng dụng. Thiếu commit gắn với phép đo và phân tích bandwidth/scalability. Không suy rộng các số này thành độ trễ Internet.

| Sản phẩm theo mục 10–11 | Trạng thái repo kiểm tra |
|---|---|
| README, src, deploy, tests, scripts, docs, .env.example | Có |
| Hướng dẫn cài/chạy/triển khai lại | Có; cần sửa yêu cầu phiên bản Node và điền cấu hình triển khai thật khi có |
| `docs/report.pdf` | **Chưa có**; `report-outline.md` chỉ là dàn ý |
| `docs/slides.pdf` | Chưa có; PDF ghi slides “if available”, không xem là điều kiện bắt buộc tuyệt đối |
| Phân công thành viên | Chỉ có bảng gợi ý Sinh viên 1/2/3; chưa có tên/MSSV/đầu việc/bằng chứng thật |
| Lịch sử Git mỗi thành viên | Bản Git local chỉ có 1 commit của 1 tác giả; chưa chứng minh đóng góp của các thành viên còn lại |
| Final tag/release | Không có tag trong bản local; version 1.0.0 trong package.json không thay thế Git tag/release |
| Quyền truy cập của giảng viên nếu repo private | Chưa xác minh từ bản local |
| Đăng ký đề tài/nhóm và giới hạn ≤3 thành viên | Thông tin ngoài repo, chưa xác minh |
| Demo có đủ thành viên tham gia | Chưa có bằng chứng |

Mục 12 coi thiếu báo cáo, không demo, không có concurrency/failure hoặc không chứng minh đóng góp cá nhân là các trường hợp không đạt. Vì vậy đây không chỉ là phần trang trí tài liệu sau khi code xong.

## 8. Thứ tự hoàn thiện đề xuất

1. Sửa lỗi callback làm chết server; thêm test input sai và xác nhận dịch vụ còn chạy.
2. Sửa ordering, hủy/khôi phục trạng thái gửi, registry danh tính; kiểm tra các ca probe xác nhận lỗi nay phải cho kết quả đúng.
3. Bổ sung display name, timestamp log, trạng thái kết nối UI và chính sách owner rời nhóm.
4. Chạy browser thật: DIRECT, log không FORWARD, ACK, reload lịch sử; sau đó phá DataChannel thật để kiểm tra fallback.
5. Triển khai signaling/relay/web qua HTTPS/WSS và chạy khác mạng/NAT, hoặc môi trường mạng cô lập đúng ngoại lệ trong đề. Lưu log/video theo Message ID.
6. Hoàn thành ma trận kiểm thử tối thiểu, đo lại hiệu năng với commit/môi trường và ghi rõ giới hạn phép đo.
7. Viết report.pdf, điền phân công thật, chứng minh đóng góp của mỗi người, chuẩn bị demo và final tag/release.

Không cần ưu tiên thêm voice/video, DHT, nhiều relay, store-and-forward hoặc TURN trước những mục trên. Một application relay Socket.IO public, có xác thực và đã chứng minh fallback qua mạng phù hợp, là lựa chọn kiến trúc hợp lệ theo đề.
