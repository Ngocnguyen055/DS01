# Hướng dẫn tự nghiệm thu toàn bộ DS01

> Luồng mặc định hiện dùng tài khoản: xem [authentication.md](authentication.md). Để chạy nguyên các ca dùng `peer-a/peer-b/peer-c` bên dưới, chọn **Thử nghiệm kỹ thuật bằng Peer ID**. Với tài khoản mới, đăng ký/đăng nhập rồi thay ID trong kịch bản bằng `user_<username>`.

Tài liệu này áp dụng cho mã hiện tại trong repo. Đi lần lượt từ local đến Internet; mỗi ca ghi `PASS`, `FAIL`, `NOT RUN` hoặc `BLOCKED`. **Kết quả mong đợi là tiêu chí cần đạt, không phải cam kết phiên bản hiện tại đã đạt.**

Các mục đối chiếu PDF: yêu cầu chung 4.1–4.5; DS01 5.1–5.10; kiểm thử mục 9; sản phẩm nộp và demo mục 10–13. Các tính năng 5.11 là nâng cao.


### Giao diện sau cải thiện

- Nhập **Tên hiển thị + Peer ID**, bấm **Vào không gian chat** để đăng ký.
- Tạo nhóm: nút **+** cạnh mục Nhóm → tên nhóm và danh sách Peer ID. Thêm/xóa/rời nhóm trong **Thông tin hội thoại**.
- Checkbox ưu tiên relay và log nằm trong **Tình trạng kết nối** ở cuối sidebar.
- UI dịch delivered thành **Đã nhận**, failed thành **Chưa gửi được**, sent thành **Đang chờ nhận**; JSON/protocol giữ tiếng Anh.
- CLI signaling lưu `.data/signaling.json`. Không xóa file/volume trong phép thử restart.
- Xem [advanced-features.md](advanced-features.md) và [implementation-status.md](implementation-status.md) cho các tính năng và bằng chứng sau sửa.

## 0. Chuẩn bị và cách ghi kết quả

### Môi trường local

- Windows, PowerShell; Node đáp ứng engine của Vite hiện tại: `^20.19.0 || >=22.12.0`.
- Ba browser profile độc lập: A=`peer-a`, B=`peer-b`, C=`peer-c`.
- Có thể dùng Chrome, Edge và một profile Chrome khác. **Ba cửa sổ cùng profile hoặc nhiều cửa sổ ẩn danh cùng phiên không bảo đảm storage độc lập.**
- Bốn terminal: signaling, relay, web, và lệnh kiểm tra.
- Dùng thống nhất `http://localhost:5173`; đổi sang `127.0.0.1` là đổi origin, storage cũng đổi.

Trong terminal kiểm tra:

```powershell
cd F:\Downloads\DS01
node --version
npm.cmd --version
if (!(Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
npm.cmd ci
New-Item -ItemType Directory -Force docs/evidence/manual-run01
Copy-Item docs/manual-results.csv docs/evidence/manual-run01/results.csv
git rev-parse HEAD | Out-File -Encoding utf8 docs/evidence/manual-run01/commit.txt
Get-Date -Format o | Out-File -Encoding utf8 docs/evidence/manual-run01/time.txt
node --version | Out-File -Encoding utf8 docs/evidence/manual-run01/node.txt
```

Lần kiểm tra tiếp theo đổi `manual-run01` thành `manual-run02` để giữ bằng chứng cũ. Ghi thêm OS, browser/version, máy A/B/C và tên mạng trong `environment.txt`. Không lưu hoặc chụp token/secret.

Kiểm tra `.env` local: signal/relay lần lượt 4001/4002; `VITE_SIGNAL_URL=http://localhost:4001`, `VITE_RELAY_URL=http://localhost:4002`, `SIGNAL_INTERNAL_URL=http://127.0.0.1:4001`. Hai server dùng cùng `PEER_SECRET`. Không ghi đè `.env` đã dùng nếu chưa lưu lại cấu hình cần thiết.

### Chạy ba dịch vụ

Terminal 1:

```powershell
cd F:\Downloads\DS01
npm.cmd run start:signaling 2>&1 | Tee-Object -FilePath docs/evidence/manual-run01/signaling.txt
```

Terminal 2:

```powershell
cd F:\Downloads\DS01
npm.cmd run start:relay 2>&1 | Tee-Object -FilePath docs/evidence/manual-run01/relay.txt
```

Terminal 3:

```powershell
cd F:\Downloads\DS01
npm.cmd run dev:web
```

Dùng lệnh `start:*` để khi process chết bạn nhìn thấy rõ; watcher có thể tự chạy lại và che mất lỗi. Khi chạy lại một server trong cùng buổi, thêm `-Append` vào Tee-Object để không mất log trước đó.

Terminal 4:

```powershell
Invoke-RestMethod http://localhost:4001/health
Invoke-RestMethod http://localhost:4002/health
```

Mở URL Vite in ra. Nếu Vite dùng cổng khác 5173, mọi profile dùng cùng cổng đó. Đăng ký ba ID, chờ thấy log `relay connected` trước khi gửi.

### Đọc trạng thái và lưu lỗi

- `pending`: đã tạo tin, chưa xác nhận gửi qua transport.
- `sent`: đã gửi qua transport; chưa chứng minh ứng dụng nhận đã lưu.
- `delivered`: có ACK của peer nhận; không đồng nghĩa người dùng đã đọc.
- `received`: tin đã nhận và lưu cục bộ.
- `failed`: hết các lần thử hoặc không giao được theo chính sách.

Mỗi ca giữ ảnh giao diện, nội dung thử có mã ca, Message ID và đoạn log liên quan. Ví dụ `F03-A-to-B-01`. Ghi lỗi theo mẫu cuối file.

Script `scripts/manual-probe.mjs` tạo các peer thử `qa-*` riêng để kiểm tra protocol. Nó không sửa mã app, không tự khởi động dịch vụ, không in token/secret. `--signal`/`--relay` chỉ endpoint cần kiểm tra; không truyền flag thì lấy PUBLIC_* trong `.env`, rồi mới đến localhost. Trong các lệnh local dưới đây dùng flag rõ ràng để tránh nhầm môi trường.

```powershell
node scripts/manual-probe.mjs --help
```

**Không đánh dấu toàn bộ ca PASS chỉ vì script báo PASS: các bước cần quan sát UI/log phải làm thêm.**

## 1. A01–A02: kiểm tra nền và kiến trúc

**A01 — Mã cài được, kiểm tra và build được.**

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build:web
```

Đạt: cả bốn lệnh exit code 0. Bộ Vitest đã bổ sung regression; đọc số lượng và tên test trong kết quả mới. Một lệnh lỗi thì ghi output, không bỏ qua vì UI vẫn mở được. Đây là kiểm tra nền, chưa thay thế demo browser/WAN.

**A02 — Thành phần độc lập, có network và log.**

Giữ ba terminal đang chạy. Đạt: signaling 4001, relay 4002 và web chạy riêng; dừng relay không làm process signaling/web tự thoát. Các peer có ID riêng và giao tiếp qua network.

Trong DevTools → Network, quan sát kết nối Socket.IO tới hai port. Khi chat DIRECT vẫn có thể có heartbeat/control traffic tới server; tiêu chí là **chat envelope của Message ID đó không đi qua relay**. Kiểm tra log có service/node, timestamp, event và kết quả. Log hiện có ISO timestamp; đối chiếu đúng process và Message ID.

## 2. F01–F04: đăng ký, discovery và chat cá nhân

**F01 — Đăng ký ba peer.**

1. Đăng ký A, rồi B, rồi C, mỗi người một profile.
2. Kiểm tra mỗi người thấy hai người còn lại.
3. Kiểm tra terminal signaling có REGISTER tương ứng.
4. Tìm nơi nhập và hiển thị display name. Web hiện có tên hiển thị; dùng tên khác Peer ID và kiểm tra peer còn lại thấy đúng tên.

Đạt: ba ID duy nhất, online cập nhật, metadata đăng ký/discovery đáp ứng đề. Riêng display name có thể FAIL trong khi discovery PASS; ghi rõ từng phần.

**F02 — Lookup, ID trùng và quyền discovery.**

```powershell
node scripts/manual-probe.mjs discovery --signal http://localhost:4001 --relay http://localhost:4002
```

Script kiểm tra ba ID, lookup online/offline, hai kết nối cùng ID/cùng secret, cùng ID/khác secret, và client chưa đăng ký. Đạt: các check PASS; không làm mất phiên A/B/C đang dùng. Script `qa-*` xuất hiện rồi biến mất là bình thường.

**F03 — DIRECT thật, hai chiều.**

1. Bỏ checkbox ép RELAY ở A và B.
2. A chọn B, gửi `F03-A-to-B-01`.
3. B chọn A, gửi `F03-B-to-A-01`.
4. Lưu Message ID của từng tin.

Đạt: hai bên nhận đúng nội dung; phía gửi `delivered`, phía nhận `received`, tin hiển thị DIRECT. Log peer có `DIRECT open` và `DIRECT SEND <id>`; **relay không có FORWARD cùng ID**. Để đọc log:

```powershell
Select-String -Path docs/evidence/manual-run01/relay.txt -SimpleMatch 'DAN-MESSAGE-ID-VAO-DAY'
```

Không có kết quả tìm kiếm chỉ là một phần bằng chứng: cần đủ cửa sổ thời gian, tin nhận được ở B và log DIRECT ở A. Nếu gửi được nhưng hiện RELAY, F03 chưa đạt; ghi rõ DIRECT thất bại rồi fallback.

**F04 — RELAY có chủ đích.**

1. Bật checkbox ép RELAY ở A.
2. A gửi `F04-relay-01` cho B; B trả lời một tin khi B cũng ép RELAY.
3. Đối chiếu Message ID và nội dung ở hai bên.

Đạt: RELAY, delivered/received, có `RELAY SEND` và `[relay] FORWARD` cùng ID. Trên Network → WebSocket của port 4002 có envelope text/ACK. Ca này chứng minh đường relay, chưa chứng minh NAT hoặc tự động fallback.

## 3. F05–F10: nhóm, routing, offline và lịch sử

**F05 — Nhóm ba peer.**

1. A nhập `peer-b,peer-c` ở ô thành viên → Tạo nhóm.
2. Chọn đúng nhóm vừa tạo ở A/B/C; đối chiếu cùng Group ID và membership.
3. A gửi `F05-group-A-01`, B gửi `F05-group-B-01`, C gửi `F05-group-C-01`.

Đạt: mỗi tin tới đủ hai thành viên còn lại; có trạng thái giao riêng từng người nhận. **Storage giữ hai dòng cho hai receiver; UI gộp một bubble và hiện ACK từng receiver ở Chi tiết.** Ở mỗi receiver, cùng tin chỉ có một bản nhận.

**F06 — Xóa rồi thêm lại thành viên.**

1. A chọn nhóm → nhập `peer-c` → Xóa.
2. Đợi A/B cập nhật membership, nhóm biến khỏi danh sách nhóm của C.
3. A gửi `F06-after-remove-01`: B nhận, C không nhận.
4. A nhập `peer-c` → Thêm; chờ membership đồng bộ.
5. A gửi `F06-after-add-01`: B/C đều nhận.

Đạt: thao tác nhất quán, không còn giao tin mới cho người đã bị xóa. Không bắt buộc xóa lịch sử cũ của C hoặc giao bù tin trong lúc C không thuộc nhóm.

**F07 — Quyền sửa nhóm và owner rời nhóm.**

Tạo nhóm mới A/B/C. B thử thêm một ID khác: phải bị từ chối vì không phải owner. B thử xóa C: phải bị từ chối. B tự xóa B: được nếu chính sách cho phép; sau đó A thêm B lại.

Trên một nhóm thử riêng, A tự xóa A, rồi owner mới thử thêm người. Chính sách hiện tại chuyển owner cho Peer ID nhỏ nhất còn lại; nhóm rỗng archived. Phải hiển thị owner mới và thêm người được, không còn bị kẹt như bản trước sửa.

**F08 — Thành viên nhóm offline, ACK riêng.**

1. Tạo nhóm A/B/C mới, để B online, đóng tab C.
2. A gửi `F08-one-offline-01`.
3. Đợi kết thúc các lần thử; mở C lại cùng profile/ID.

Đạt theo chính sách hiện tại: B delivered; C failed; không biến cả nhóm thành delivered giả. C vẫn thuộc nhóm khi trở lại, nhận được tin gửi mới. Không yêu cầu nhận lại tin offline vì dự án không có server queue.

**F09 — Lịch sử và restart browser.**

1. A/B trao đổi 2–3 tin cá nhân, A/B/C trao đổi vài tin nhóm.
2. Chụp nội dung/status/ID; reload A rồi đăng ký lại cùng profile/ID.
3. Chọn lại hội thoại và nhóm khi signaling vẫn đang chạy.
4. Kiểm tra không mất/trùng tin, không trộn chat nhóm vào chat cá nhân.

Đạt: lịch sử cũ còn, peer nhận/gửi tin mới bình thường; membership nhóm được lấy lại. Không đổi hostname/cổng/profile trong ca này. Sau đó để B offline, reload A và thử mở lịch sử với B: chọn B trong danh sách hội thoại đã lưu; phải mở được lịch sử dù B offline.

**F10 — Routing, tách dữ liệu và cấu trúc envelope.**

A chỉ gửi B; C không được nhận tin cá nhân đó. C gửi A, rồi A/B tiếp tục trò chuyện; kiểm tra các hội thoại không lẫn nhau.

DevTools → Application → Local Storage, tìm `ds01-history-v1-peer-a` hoặc đọc tại Console của A:

```javascript
console.table(JSON.parse(localStorage.getItem('ds01-history-v1-peer-a') || '[]').map(r => ({
  id: r.message.messageId,
  sender: r.message.senderId,
  receiver: r.message.receiverId,
  group: r.message.groupId,
  session: r.message.sessionId,
  sequence: r.message.sequence,
  mode: r.message.mode,
  status: r.status
})));
```

Đạt: UUID/ID hợp lệ, sender/receiver/group/session/type/timestamp/body/mode có đúng ý nghĩa. ACK có type=ack và ackFor trỏ Message ID gốc; ACK thường không lưu trong lịch sử, xem Network khi ép RELAY. Không yêu cầu mọi event control phải mang cùng schema với chat envelope.

## 4. C01–C02 và O01: đồng thời và ordering

**C01 — Hai thao tác sửa membership cùng version.**

```powershell
node scripts/manual-probe.mjs conflict --signal http://localhost:4001 --relay http://localhost:4002
```

Đạt: đúng một thao tác được chấp nhận, version tăng một lần và mọi peer nhận cùng danh sách cuối. Một thao tác bị stale/rejected trong ca này là đúng, không phải lỗi. Chụp output và GROUP_CHANGE; chạy lại vài lần để tránh phụ thuộc thứ tự đến cố định.

**C02 — Hai người gửi gần đồng thời.**

1. Nhóm mới A/B/C. B chuẩn bị `C02-B-01`, C chuẩn bị `C02-C-01`.
2. Hai người đếm 3–2–1 rồi gửi cùng lúc; nếu một người thử thì đặt hai cửa sổ cạnh nhau.
3. Lặp 10 vòng, tăng số thứ tự của từng sender.
4. Thử cả ép RELAY, DIRECT khi chạy được, và đường hỗn hợp.

Đạt: ở A đủ 20 tin nhận với ID riêng, không mất/trùng; thứ tự từng sender hợp lý. B/C có trạng thái theo từng receiver. Không bắt buộc mọi peer có total order giống nhau giữa tin B và tin C nếu mô hình nhất quán đã nêu rõ.

Nếu chỉ click hai nút chậm, khả năng chồng lấn ít: ghi độ hạn chế của phép thử, không tuyên bố đã stress test. Đồng thời bắt đầu chat mới A→B và B→A giúp kiểm tra tránh offer xung đột.

**O01 — Tái hiện lỗi cùng timestamp một cách chắc chắn.**

Chạy trên trang Vite local, DevTools → Console. Đây là fixture storage riêng `qa-order-only`, không đụng lịch sử A/B/C:

```javascript
var { WebStore: QAStore } = await import('/store.ts');
var qaStore = new QAStore('qa-order-only');
localStorage.removeItem('ds01-history-v1-qa-order-only');
var qaTime = Date.now();
var qaSession = crypto.randomUUID();
for (var [qaId, qaSeq] of [
  ['ffffffff-ffff-4fff-bfff-ffffffffffff', 1],
  ['00000000-0000-4000-8000-000000000001', 2]
]) {
  await qaStore.put({ status: 'received', message: {
    messageId: qaId, sessionId: qaSession,
    senderId: 'peer-b', receiverId: 'qa-order-only',
    type: 'text', timestamp: qaTime, body: 'O01-sequence-' + qaSeq,
    mode: 'RELAY', attempt: 1, sequence: qaSeq
  }});
}
console.table((await qaStore.list()).map(r => ({ sequence: r.message.sequence, body: r.message.body })));
```

Đạt: có quy tắc giữ thứ tự 1 rồi 2 của cùng sender/session, không phụ thuộc UUID ngẫu nhiên. Bản trước sửa ra 2 rồi 1; bản hiện tại phải ra 1 rồi 2. Đây là kiểm tra thuật toán lưu/đọc, chưa thay thế thử tin đến đảo thứ tự qua mạng. Dọn fixture:

```javascript
localStorage.removeItem('ds01-history-v1-qa-order-only');
```

Sau khi sửa, thử thêm timestamp lùi, tin sequence 2 đến trước 1, và restart sender rồi gửi tiếp. Phải định nghĩa phạm vi session/sequence trước khi chọn comparator; không chỉ sort sequence toàn bộ lịch sử từ nhiều sender.

## 5. E01–E07: lỗi, retry và phục hồi

**E01 — Peer tắt đột ngột rồi trở lại.**

1. Khi A đang chọn B, đóng hẳn tab B, không bấm Ngắt.
2. Đo thời gian B biến khỏi danh sách A/C. Đóng tab có thể được phát hiện ngay qua disconnect, không cần đợi hết heartbeat.
3. A gửi `E01-to-offline-B` trên hội thoại còn chọn; tin phải failed sau số lần thử hữu hạn.
4. Mở lại B cùng profile, đăng ký lại, kiểm tra lịch sử và gửi tin mới hai chiều.

Đạt: offline cập nhật, không hứa delivered giả, phục hồi gửi tin mới; tin offline không giao bù theo chính sách hiện tại.

**E02 — Lease hết hạn khi socket vẫn còn sống.**

```powershell
node scripts/manual-probe.mjs lease --signal http://localhost:4001 --relay http://localhost:4002
```

Peer `qa-silent-*` giữ Socket.IO nhưng không gửi heartbeat app. Đạt: signaling ghi TIMEOUT, peer bị xóa khoảng 30–35 giây sau heartbeat cuối (có thể lệch do lịch chạy/môi trường), UI cập nhật. Script chờ tối đa 40 giây và có observer gửi heartbeat riêng. Không ghi thời gian đóng tab của E01 là thời gian lease nếu server đã nhận disconnect trước đó.

**E03 — Không có ACK, retry đúng giới hạn.**

Terminal kiểm tra:

```powershell
node scripts/manual-probe.mjs blackhole --signal http://localhost:4001 --relay http://localhost:4002
```

1. Sau READY, A chọn `qa-noack`, bật ép RELAY, gửi `E03-no-ACK-01`.
2. Theo dõi terminal script, relay và UI A trong 10–15 giây.

Đạt: cùng Message ID, attempt 1/2/3, sau đó failed; không retry vô hạn. Theo cấu hình hiện tại timeout ACK 2 giây, tổng thường khoảng 6 giây khi relay ổn định; không dùng con số này làm SLA cứng. Relay FORWARD thành công **không đủ** để đánh dấu delivered nếu recipient không gửi ACK app. Script giữ recipient 60 giây rồi tự ngắt; Ctrl+C nếu muốn kết thúc sớm.

**E04 — Ngắt lúc đang chờ ACK rồi khởi động lại peer.**

1. Chạy `blackhole` như E03 nếu nó đã hết 60 giây.
2. A gửi `E04-close-pending-01` cho qa-noack, vừa thấy sent thì bấm Ngắt trước khi hết retry.
3. Đợi >10 giây, đăng ký lại A và xem storage theo F10, tìm đúng body/ID.

Đạt: thao tác gửi bị hủy/kết thúc rõ ràng, không treo vĩnh viễn; trạng thái sau reconnect có chính sách hợp lệ như failed/interrupted hoặc retry được kiểm soát. Bản trước sửa còn sent mãi; bản hiện tại phải kết thúc và cho phép retry hợp lệ. Không gọi đây là delivered khi chưa có ACK.

**E05 — Relay dừng rồi khởi động lại.**

1. A/B online, ép RELAY ở A; gửi một tin thành công làm mốc.
2. Ctrl+C **chỉ terminal relay**; A gửi `E05-relay-down-01`.
3. Tin phải failed, server còn lại và UI không chết; ghi thời gian và lỗi.
4. Chạy lại relay, append log; đợi peer có `relay connected`.
5. Gửi `E05-after-restart-01`: phải delivered. Tin đã failed không tự hứa giao lại.
6. Khi đã có DIRECT A/B thật, dừng relay một lần nữa và thử tin DIRECT. Nếu DataChannel còn mở, chat cá nhân DIRECT nên tiếp tục hoạt động.

**E06 — Signaling dừng rồi khởi động lại.**

1. Ghi nhóm và số tin trước thử, giữ relay chạy.
2. Ctrl+C signaling; xem UI, log và thử chat trên DIRECT đã mở.
3. Phân biệt: chat cá nhân trên đường đã mở có thể tiếp tục; chat nhóm hiện cần signaling cấp quyền mỗi lần nên có thể thất bại.
4. Khởi động lại signaling, quan sát reconnect/đăng ký và thử chat mới.

Đạt: không hiển thị trạng thái gây hiểu nhầm, không treo, có phục hồi hoặc hướng dẫn đăng ký lại rõ. Nhóm và hash danh tính hiện lưu bền ở CLI signaling; phải còn sau restart với cùng state path/volume. Lịch sử cục bộ vẫn phải còn. Nếu UI vẫn Online dù signaling mất, ghi lỗi đồng bộ trạng thái.

**E07 — Phá DIRECT đã mở, tự chuyển RELAY.**

Để thao tác chính xác mà không sửa app, tại A **trước khi đăng ký** mở Console và dán đoạn sau. Nếu A đã đăng ký, bấm Ngắt trước; cài xong đăng ký lại:

```javascript
if (!window.qaOriginalRTC) {
  window.qaOriginalRTC = window.RTCPeerConnection;
  window.qaRTC = [];
  window.RTCPeerConnection = class extends window.qaOriginalRTC {
    constructor(...args) {
      super(...args);
      window.qaRTC.push(this);
    }
  };
}
```

1. Bỏ ép RELAY ở A/B, chỉ dùng A↔B trong ca này.
2. Gửi `E07-before-break`: bắt buộc DIRECT + delivered trước khi tiếp tục.
3. Console A:

```javascript
console.table(window.qaRTC.map(pc => ({ state: pc.connectionState, signaling: pc.signalingState })));
window.qaRTC.forEach(pc => pc.close());
```

4. **Giữ checkbox ép RELAY tắt**, gửi `E07-after-break`.

Đạt: không cần bấm chọn RELAY; tin mới tự đi RELAY, được ACK, có FORWARD đúng ID, log có mất/kết thúc DIRECT hoặc retry/fallback. A/B vẫn nối được signaling/relay trong lúc DataChannel đã bị đóng. Nếu qaRTC rỗng thì bạn chưa cài trước lúc PeerClient lấy RTC constructor: làm lại từ đầu; không đánh dấu ca đạt.

Đây là phá kết nối WebRTC thật trong lab, không phải bằng chứng NAT. Reload trang để bỏ hook sau khi thử. Kiểm tra thêm trường hợp đường DIRECT đang chờ ACK bị mất, rồi relay giao lại cùng ID mà phía nhận không lưu trùng.

## 6. S01–S06 và D01: dữ liệu sai, quyền và dedup

**S01 — Kiểm tra schema, spoof, token, quyền nhóm.**

```powershell
node scripts/manual-probe.mjs validation --signal http://localhost:4001 --relay http://localhost:4002
```

Đạt: sender giả, UUID/Peer ID sai, body quá dài/rỗng, ACK thiếu ackFor, DIRECT gửi vào relay, outsider gửi nhóm, token sai, secret ngắn và lookup sai đều bị từ chối; tin đúng vẫn tới đúng người, server không chết. Lưu output và REJECT logs. Những check này là nhiều ca dữ liệu sai khác nhau, ghi thành các dòng con trong kết quả nếu cần.

**S02 — Input UI và giới hạn ký tự/byte.**

Thử Peer ID `a`, `../bad`, ID có dấu cách; tin toàn khoảng trắng; nội dung chứa `<script>alert(1)</script>`, tiếng Việt và emoji. Chuỗi giống HTML phải được hiển thị như text, không thực thi.

DevTools Console có thể dùng `copy('x'.repeat(4001))` rồi dán vào ô tin để thử dài quá 4000. Đạt: báo lỗi rõ, không có tin quá giới hạn tới receiver, ứng dụng còn dùng được. Body 4000 ASCII có thể vừa giới hạn wire, nhưng 4000 ký tự Unicode có thể vượt 8192 byte; ghi rõ hai giới hạn thay vì coi mọi chuỗi <=4000 đều chắc chắn được chấp nhận.

**S03 — Quyền sở hữu ID trước/sau signaling restart.**

Dùng một lần với registry chưa có `qa-identity-check`; hai secret cố định trong script chỉ dành cho lab.

```powershell
node scripts/manual-probe.mjs identity-owner --signal http://localhost:4001 --relay http://localhost:4002
node scripts/manual-probe.mjs identity-other --signal http://localhost:4001 --relay http://localhost:4002
```

Đạt trước restart: owner được chấp nhận, other bị từ chối. Sau đó Ctrl+C signaling, chạy lại rồi **chỉ** chạy:

```powershell
node scripts/manual-probe.mjs identity-other --signal http://localhost:4001 --relay http://localhost:4002
```

Đạt bảo vệ danh tính bền: other tiếp tục bị từ chối. Bản trước sửa nhận token do registry ở RAM; bản hiện tại phải tiếp tục từ chối secret khác. Nếu trước đó chưa chạy identity-owner, kết quả không có giá trị vì chưa thiết lập chủ sở hữu. Sau khi sửa persistence, không xóa registry rồi tuyên bố đã thử restart thành công.

**S04–S05 — Callback sai kiểu làm chết server: chạy cuối, trên local lab.**

Các ca này cố tình gửi một gói sai có thể tái hiện lỗi dịch vụ thoát nếu có hồi quy; lưu bằng chứng trước và không chạy lên server có người khác đang dùng. Script chặn endpoint ngoài localhost. Không bật watcher tự restart trong ca này.

```powershell
node scripts/manual-probe.mjs crash-signal --signal http://localhost:4001 --relay http://localhost:4002
```

Đạt: signaling còn sống, `/health` trả được, đăng ký mới vẫn hoạt động. Nếu terminal server báo `TypeError: reply is not a function`/thoát, ghi FAIL rồi khởi động lại signaling.

```powershell
node scripts/manual-probe.mjs crash-relay --signal http://localhost:4001 --relay http://localhost:4002
```

Đạt tương tự cho relay; nếu chết, chạy lại relay. Sau khi sửa, bổ sung thao tác gửi tin hợp lệ để chứng minh server còn xử lý công việc, không chỉ healthcheck.

**S06 — Secret và cấu hình.**

```powershell
git ls-files .env
git check-ignore .env
```

Đạt: lệnh đầu không liệt kê `.env`; lệnh sau xác nhận bị ignore. Tự rà soát file được track, lịch sử commit, ảnh chụp và log: không có secret thật/token/password. Không in `.env` ra log nộp bài. Hai lệnh trên không tự chứng minh toàn bộ lịch sử sạch secret.

**D01 — Trùng Message ID nhưng receiver chỉ lưu một bản.**

Để B thật đăng ký `peer-b` trên UI rồi chạy:

```powershell
node scripts/manual-probe.mjs duplicate --to peer-b --signal http://localhost:4001 --relay http://localhost:4002
```

Script gửi hai envelope cùng Message ID và in ID/body. Ở B, qa-sender ngắt sau phép thử nên có thể biến khỏi danh sách online. Đếm trực tiếp bằng Console B:

```javascript
JSON.parse(localStorage.getItem('ds01-history-v1-peer-b') || '[]')
  .filter(r => r.message.messageId === 'DAN-MESSAGE-ID-SCRIPT-IN-RA').length
```

Đạt: đúng **1** dòng lưu; sender thử nhận ACK cho cả lần đầu và lần trùng. Relay có thể FORWARD hai lần: dedup thuộc receiver nên điều đó không tự là lỗi. Dự án giữ tối đa 1000 dòng lịch sử; không suy rộng thành dedup vĩnh viễn hoặc exactly-once.

## 7. W01–W03: Internet, NAT và đường hỗn hợp

### Điều kiện bắt đầu

- Máy chủ có địa chỉ public hoặc domain/tunnel truy cập được từ cả hai mạng; signaling và relay chạy riêng.
- Web dùng HTTPS; signaling/relay được truy cập qua HTTPS/WSS tương ứng. Với máy ở xa, `localhost` trỏ vào chính máy người dùng, không trỏ về máy chủ.
- Theo `deploy/README.md`, dùng mẫu Caddy và thay domain thật. Không cần Docker nếu triển khai server/process riêng đã đủ.
- Trên máy build, điền VITE_SIGNAL_URL/VITE_RELAY_URL public rồi **build lại web**. Vite nhúng URL lúc build; chỉ đổi `.env` sau build không cập nhật bundle cũ.
- `SIGNAL_INTERNAL_URL` là đường relay gọi signaling từ phía server; nếu chạy ở hai máy thì 127.0.0.1 không còn trỏ tới máy kia.
- Dùng secret ngẫu nhiên thật ở server, không dùng giá trị mẫu; không đưa secret server vào biến VITE_*.
- Trên A/B mở hai URL `/health` public. Đạt health không đồng nghĩa WebSocket/WSS đã hoạt động: phải đăng ký và thấy relay connected.

**W01 — Ba peer và chat qua nhiều mạng.**

1. A dùng Wi-Fi, B dùng 4G/hotspot hoặc đường Internet khác; C là peer thứ ba có profile riêng.
2. Đăng ký/discover; gửi cá nhân hai chiều, nhóm ba người, thử gửi gần đồng thời.
3. Chạy không ép RELAY để quan sát DIRECT có thành công không; lưu trạng thái, Message ID, log.
4. Bật ép RELAY và gửi lại trên cùng hai mạng để chứng minh relay public chuyển được payload và ACK.

Đạt: kết nối outbound hoạt động qua các mạng, tin đúng nơi, trạng thái đúng. NAT không nhất thiết khiến DIRECT thất bại: ICE/STUN có thể vượt NAT thành công. Ghi đúng kết quả quan sát.

**W02 — DIRECT bị hạn chế thật, fallback qua relay.**

Cần một mạng/firewall lab nơi WebRTC DIRECT không lập được trong khi HTTPS/WSS vẫn hoạt động. Có thể dùng một máy Windows B với Edge chuyên dùng để test, tạm chặn UDP của **Edge** trong Windows Firewall. Thao tác sau cần PowerShell chạy Administrator; nó ảnh hưởng UDP của mọi cửa sổ Edge trên máy B cho tới khi gỡ rule. Chỉ áp dụng nếu đang dùng lab của mình.

```powershell
$qaEdge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (!(Test-Path -LiteralPath $qaEdge)) { throw 'Tim lai duong dan Edge tren may nay truoc' }
New-NetFirewallRule -DisplayName 'DS01-Lab-Block-Edge-UDP' -Direction Outbound -Program $qaEdge -Protocol UDP -Action Block -Profile Any
```

1. A và B vẫn ở hai mạng khác nhau; gỡ checkbox ép RELAY cả hai.
2. Reload/đăng ký lại B để dùng kết nối mới; thử tin A→B và B→A.
3. Giữ đầy đủ log ICE/DIRECT timeout hoặc failed, sau đó RELAY SEND/FORWARD/ACK.
4. Sau thử, gỡ đúng rule vừa tạo:

```powershell
Remove-NetFirewallRule -DisplayName 'DS01-Lab-Block-Edge-UDP'
```

Chặn UDP là cách thử hạn chế mạng, **không bảo đảm mọi môi trường đều mất DIRECT**. Nếu DIRECT vẫn thành công thì ca “không thể DIRECT” chưa được tạo ra; không ghi PASS giả. Dùng mạng/firewall lab khác hoặc VM/Docker network cô lập và chứng minh đường đi. Chỉ chọn route bằng checkbox hoặc sửa hàm trả false không đủ làm bằng chứng hạn chế mạng/NAT.

Nếu không có hai kết nối Internet thật, ngoại lệ 5.10 cho phép VM/Docker network riêng. Khi đó phải lưu topology/rule mạng, chứng minh peer không DIRECT được nhưng chat qua relay độc lập được; vẫn đối chiếu yêu cầu triển khai public của 5.2/5.9/5.10 với cách được giảng viên chấp nhận. Chạy mọi thứ localhost cùng mạng không tự thành ngoại lệ này.

**W03 — Nhóm có đường hỗn hợp và phục hồi qua WAN.**

Trong nhóm A/B/C, tạo điều kiện A↔B DIRECT được, A↔C bị hạn chế phải RELAY; giữ checkbox tắt. A gửi một tin nhóm.

Đạt: hai envelope cùng Message ID/group/sequence nhưng mode theo từng receiver; B/C mỗi người lưu một bản, ACK độc lập. Sau đó ngắt một peer và relay trong hai ca riêng, khôi phục rồi gửi tin mới; ghi kết quả như E01/E05. Tính năng nhóm bắt buộc hỗ trợ khác mạng; đường hỗn hợp là ca kiểm tra thêm cho thiết kế hiện tại.

## 8. P01: phép đo hiệu năng

Giữ signaling/relay chạy, terminal kiểm tra:

```powershell
npm.cmd run benchmark:relay 2>&1 | Tee-Object -FilePath docs/evidence/manual-run01/benchmark.txt
```

PUBLIC_SIGNAL_URL/PUBLIC_RELAY_URL trong `.env` quyết định endpoint benchmark. Ghi rõ local hay Internet. Nếu muốn đo local dù `.env` đang public, đặt hai biến PUBLIC_* đúng localhost trong terminal chạy benchmark.

Đạt: hoàn tất 100 tin, in count=100, p50/p95/max, môi trường/ngày giờ/commit; giải thích kết quả và giới hạn. Không có ngưỡng latency bắt buộc trong đề, không đặt ngưỡng tùy ý rồi nói thầy yêu cầu.

Script hiện đo 100 tin tuần tự tới recipient Socket.IO; không đo app ACK, WebRTC, throughput nhiều peer hay tải đồng thời. Lặp 3 lần nếu cần quan sát độ dao động, giữ cả các lần lỗi. Muốn đánh giá scalability phải thiết kế workload nhiều peer/tin đồng thời riêng, tính success rate/throughput/bandwidth thay vì gọi phép đo hiện tại là load test.

## 9. Q01: kiểm tra hồ sơ, báo cáo và khả năng bảo vệ

| Nội dung | Cách tự kiểm tra |
|---|---|
| Đăng ký nhóm/đề tài, ≤3 người | Thông tin thật đã nộp đúng theo yêu cầu thầy |
| README và redeploy | Một người làm theo từ máy sạch có thể chạy; phiên bản Node/cấu hình chính xác |
| Báo cáo | Có docs/report.pdf, không chỉ dàn ý; yêu cầu và kết quả tương ứng từng ca |
| Phân công | Có tên/MSSV/đầu việc/link commit hoặc PR thật của từng người |
| Đóng góp Git | git shortlog -sne HEAD; git log --all; mỗi người chứng minh phần mình làm |
| Tag/release cuối | git tag --list; version package.json chưa thay thế tag/release |
| Repo private | Thầy truy cập được nếu yêu cầu; không cần công khai secret |
| Slides | Chuẩn bị nếu dùng; đề ghi “if available” |
| Demo 12 tình huống | Dùng bảng đối chiếu bên dưới, có ít nhất 1 lỗi live và concurrency |
| Phân tích | Giải thích naming/discovery, control/data plane, ICE/STUN/TURN, mapping relay, consistency, delivery semantics, SPOF, latency/bandwidth, relay down và mở rộng nhiều relay |
| Phạm vi và giới hạn | Nói rõ snapshot một writer, không offline queue/E2EE/signaling replication; TURN và WAN cần bằng chứng riêng |
| Nguồn tham khảo/AI | Trích nguồn thư viện/thuật toán phù hợp, mọi thành viên hiểu và chịu trách nhiệm sản phẩm |

### Ánh xạ đủ 12 demo bắt buộc của 5.10

| Demo trong đề | Ca ở tài liệu này |
|---|---|
| 1. Signaling/relay public | W01, điều kiện WAN |
| 2. ≥3 peer | F01 |
| 3. Register/discover | F01–F02 |
| 4. DIRECT thật | F03 |
| 5. Log không qua relay | F03 |
| 6. Khác mạng/NAT qua relay | W01–W02 |
| 7. Log chứng minh đường đi | F04, W01–W02 |
| 8. Nhóm ba peer trao đổi | F05 |
| 9. Gửi gần đồng thời | C02 |
| 10. Peer dừng đột ngột | E01 |
| 11. DIRECT bị phá → RELAY | E07 |
| 12. Peer restart/restore | F09, E01, E04 |

Mục 9 yêu cầu ≥8 functional, ≥2 concurrency/conflict, ≥2 fault/recovery, ≥2 security/invalid-data và ≥1 performance. Các ca F01–F10, C01–C02, E01/E05, S01–S05, P01 cung cấp cấu trúc để đối chiếu; chỉ tính những ca đã thực hiện và có kết quả/bằng chứng hợp lệ. Nếu một ca thất bại, ghi FAIL và sửa, không đổi tên ca để đủ số.

## 10. Ghi lỗi và vòng kiểm tra sau sửa

```text
Bug ID: DS01-...
Test ID: E04
Commit và thời gian:
Thiết bị / profile / mạng:
Điều kiện trước thử:
Các bước tái hiện:
Kết quả mong đợi:
Kết quả thực tế:
Message ID / Group ID / version:
Log / ảnh / video:
Mức ảnh hưởng:
Thành viên xử lý:
Commit sửa:
Kết quả chạy lại:
```

Sau mỗi sửa: chạy lại đúng ca từng lỗi, kiểm tra thêm luồng thành công liên quan, rồi typecheck/lint/test/build khi thay mã ứng dụng. Nếu đổi protocol/delivery, chạy lại DIRECT, RELAY, group và restart. Tránh vừa sửa nhiều nơi vừa thử mà không biết lỗi được giải quyết bởi thay đổi nào.

Thứ tự thực hành: **A → F → C/O → E → S/D → W → P → Q**. Các ca dừng server và callback sai kiểu để cuối buổi local; restart và tạo nhóm mới trước khi quay demo chính thức. Ngừng thử một ca khi điều kiện bắt đầu chưa đạt, ghi BLOCKED kèm lý do, rồi tiếp tục các ca độc lập khác.
