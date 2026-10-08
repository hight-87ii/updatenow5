# Hướng dẫn triển khai: Module Thanh toán & Đơn hàng

Tài liệu này dành cho agent trong Antigravity IDE. Dự án là web quản lý sự kiện có sơ đồ ghế. Các phần đã có: đăng nhập, đăng ký, sơ đồ ghế, chọn ghế (giữ chỗ). Cần làm thêm 8 story thuộc Epic **Thanh toán và đơn hàng** (S-17 → S-24).

**Quy tắc quan trọng nhất: mỗi story làm trên MỘT branch riêng, làm xong một story thì dừng lại và báo cáo, không tự động chuyển sang story tiếp theo.**

---

## 0. Cách dùng

Người dùng sẽ ra lệnh theo mẫu: *"Làm story S-17 theo file ANTIGRAVITY_TASKS.md"*. Khi đó agent:

1. Đọc **Phần 1 (Quy tắc chung)** và đúng **một** mục story được yêu cầu.
2. Thực hiện **Bước 0 (khám phá codebase)** trước khi viết bất kỳ dòng code nào.
3. Tạo branch đúng tên, code, viết test, commit, rồi báo cáo theo mẫu ở Phần 10.

## 1. Quy tắc chung (áp dụng cho mọi story)

### 1.1. Bước 0: Khám phá codebase (bắt buộc)

Không được giả định công nghệ. Trước khi code, hãy đọc dự án và xác định:

- Ngôn ngữ, framework backend và frontend, ORM/DB (SQL hay NoSQL), cách đặt cấu trúc thư mục, cách đặt tên file/biến.
- Cơ chế xác thực hiện có (middleware, session/JWT, cách lấy user hiện tại).
- Model/bảng hiện có cho: sự kiện, suất (showtime/session), ghế, hạng ghế (tier) và giá, giữ chỗ (hold) và thời hạn giữ, đơn hàng (order), vé (ticket).
- Cách quản lý cấu hình (`.env`, config module), cách test (framework test, thư mục test), cách logging.
- Nhánh mặc định của repo (`main` hoặc `develop`).

Nếu thông tin nào **không tìm thấy hoặc không chắc chắn**, hãy hỏi người dùng thay vì tự đoán. Tuân theo đúng convention đang có, không đưa thêm thư viện lớn khi chưa cần.

### 1.2. Quy tắc Git

- Mỗi story một branch, tên branch ghi sẵn ở từng mục (định dạng `ID-title` viết thường, không dấu, nối bằng dấu gạch ngang).
- Luôn tạo branch từ nhánh mặc định đã cập nhật (`git checkout <nhanh-mac-dinh> && git pull`), trừ khi mục story ghi rõ phụ thuộc vào story trước chưa merge.
- Commit nhỏ, rõ nghĩa, dạng `S-17: <mô tả ngắn>` (ví dụ `S-17: thêm API xem chi tiết đơn`).
- Không đưa thay đổi của story khác vào branch hiện tại. Không sửa lung tung code ngoài phạm vi.
- Không commit file `.env` thật, secret, khoá API. Chỉ cập nhật `.env.example`.
- Không tự `push --force` hay merge vào nhánh chính. Chỉ push branch của story hiện tại khi người dùng đồng ý.

### 1.3. Quy tắc code và bảo mật

- **Mọi số tiền do server tính** từ giá hạng ghế trong DB. Tuyệt đối không tin số tiền, giá, trạng thái nào do client gửi lên.
- Các thao tác nhiều bước thay đổi dữ liệu phải nằm trong **một transaction**.
- Mọi API đơn hàng yêu cầu đăng nhập và kiểm tra quyền sở hữu (chỉ chủ đơn).
- Không lưu số thẻ. Chỉ lưu mã giao dịch từ cổng thanh toán.
- Không in secret, chữ ký hay toàn bộ body webhook vào log.
- Khoá, URL cổng, secret đọc từ biến môi trường. Thêm vào `.env.example` kèm chú thích.
- Mã nghiệp vụ không được có nhánh `if (gateway === 'mock')`. Chỉ nơi khởi tạo/chọn cổng (factory hoặc DI) mới biết loại cổng.
- Tiền tệ hiển thị theo VND, định dạng theo locale `vi-VN`. Lưu số tiền dạng số nguyên (đơn vị đồng), không dùng số thực.

### 1.4. Từ vựng trạng thái (dùng chung, map sang tên đang có nếu đã tồn tại)

| Đối tượng | Trạng thái |
|---|---|
| Đơn (Order) | `PENDING` (chờ thanh toán), `PAID` (đã trả), `EXPIRED` (hết hạn/huỷ), `NEEDS_REVIEW` (cần kiểm tra) |
| Ghế (Seat) | `AVAILABLE`, `HELD` (đang giữ), `SOLD` (đã bán) |
| Thanh toán (Payment) | `INITIATED`, `SUCCEEDED`, `FAILED`, `AMOUNT_MISMATCH`, `LATE` (tiền về nhưng không dùng được: sau khi đơn hết hạn, hoặc khi đơn đã được thanh toán bằng giao dịch khác) |

Một đơn được coi là **hết hạn** khi `status = PENDING` và `now > expiresAt`, kể cả khi job dọn dẹp chưa chạy. Tạo một hàm dùng chung (ví dụ `isOrderExpired(order, now)`) ở S-17 và các story sau tái sử dụng.

### 1.5. Test

Mỗi story phải kèm test tự động cho **từng** tiêu chí chấp nhận (AC) trong mục của nó. Chạy toàn bộ test hiện có để chắc chắn không làm hỏng chức năng cũ (đăng nhập, sơ đồ ghế, chọn ghế).

### 1.6. Thứ tự và phụ thuộc

```
S-17 → S-18 → S-19 → S-20 → S-21 → S-22 → S-23 → S-24
```

| Story | Phụ thuộc | Ghi chú |
|---|---|---|
| S-17 | Chọn ghế/giữ chỗ đã có | Nền tảng cho trang đơn |
| S-18 | S-17 | Tạo interface cổng thanh toán (`PaymentGateway`, tương ứng mã T-40 trong tài liệu yêu cầu) |
| S-19 | S-18 | Cài đặt cổng giả lập theo interface của S-18 |
| S-20 | S-18, S-19 | Làm webhook idempotent |
| S-21 | S-18, S-19 | Xác thực chữ ký webhook |
| S-22 | S-17, S-18, S-19, S-20 | Hoàn thiện trang kết quả thanh toán; thêm API trạng thái và trường `latestPayment` |
| S-23 | S-17, S-18, S-20 | Job nhả ghế đơn quá hạn; chỉnh nhánh "thanh toán trễ" của S-20 qua `expireOrder`. Chưa có S-23 (hoặc cơ chế nhả ghế tương đương) thì ghế của đơn bỏ dở không được trả lại |
| S-24 | S-18, S-22, S-23 | Thanh toán lại trên cùng đơn, nhật ký đơn |

Nên merge từng PR theo thứ tự rồi mới tạo branch kế tiếp từ nhánh mặc định. Nếu story trước chưa merge, tạo branch mới **từ branch của story trước** và ghi rõ trong PR.

**Lưu ý:** webhook ở S-18 chưa được bảo vệ đầy đủ cho đến khi xong S-20 và S-21. Không deploy riêng S-18 lên môi trường thật.

---

## 2. S-17: Xem lại chi tiết đơn trước khi thanh toán

- **Branch:** `S-17-xem-lai-chi-tiet-don-truoc-khi-thanh-toan`
- **Phụ thuộc:** chức năng chọn ghế/giữ chỗ đã có.

### Mục tiêu
Người mua vé thấy rõ từng ghế, hạng, đơn giá và tổng tiền trước khi trả, để không trả nhầm ghế mình không muốn.

### Việc cần làm

**Kiểm tra trước:** xem đã có model Order/OrderItem và chức năng "tạo đơn từ ghế đang giữ" chưa. Nếu chưa, tạo tối thiểu để story này chạy được (xem mục Dữ liệu) và ghi rõ trong báo cáo cuối là đã tự bổ sung phần này.

**Dữ liệu (nếu chưa có)**
- `Order`: id, userId (chủ đơn), eventId, showtimeId (suất), status (`PENDING` khi mới tạo), totalAmount, expiresAt, createdAt.
- `OrderItem`: id, orderId, seatId, tierName (hạng), unitPrice (chụp lại giá lúc tạo đơn).
- `expiresAt` nên khớp thời hạn giữ ghế hiện có. Nếu hệ thống đã có thời hạn giữ chỗ, dùng lại giá trị đó.

**Tạo đơn (nếu phải bổ sung)**
- Endpoint tạo đơn từ các ghế **đang được giữ bởi chính user đó**. Từ chối nếu ghế không còn giữ hoặc không thuộc user.
- Nếu body có trường tổng tiền hoặc đơn giá, **bỏ qua hoàn toàn**. Tổng = tổng đơn giá các ghế, tính từ giá hạng ghế trong DB.

**API xem chi tiết đơn**
- `GET` chi tiết đơn theo id (theo đúng convention route của dự án, ví dụ `/api/orders/:id`).
- Yêu cầu đăng nhập. Nếu đơn không thuộc user hiện tại thì trả 403 hoặc 404 (theo convention hiện có; ưu tiên 404 để không lộ sự tồn tại của đơn).
- Dữ liệu trả về: tên sự kiện, suất, danh sách ghế (nhãn ghế, khu/hàng/số, hạng, đơn giá), tổng tiền, trạng thái, `expiresAt`, số giây còn lại tính theo giờ server, cờ `isExpired`.
- Tổng tiền trả về luôn được **tính lại ở server** từ giá hạng ghế, không lấy từ trường đã lưu nếu hai giá trị khác nhau (ghi log cảnh báo nếu lệch).

**Giao diện trang đơn** (route ví dụ `/orders/:id`)
- Hiển thị: tên sự kiện, suất, bảng từng ghế kèm hạng và đơn giá, tổng tiền, đồng hồ đếm ngược thời gian còn lại để thanh toán.
- Đồng hồ đếm ngược dựa trên `expiresAt` và giờ server (không dựa vào đồng hồ máy khách). Về 0 thì chuyển ngay sang trạng thái hết hạn mà không cần tải lại trang.
- Nút "Thanh toán": hiển thị khi đơn `PENDING` và còn hạn. Ở story này chỉ cần dựng nút và truyền sẵn handler (S-18 sẽ nối). Đơn hết hạn thì thấy thông báo "Đơn đã hết hạn" và **ẩn** nút thanh toán.
- Có trạng thái loading, lỗi, và trang không tìm thấy/không có quyền.

### Tiêu chí chấp nhận (cần test)
- [ ] Đơn vừa tạo: mở trang đơn thấy tên sự kiện, suất, từng ghế kèm hạng và đơn giá, tổng tiền, thời gian còn lại.
- [ ] Gửi yêu cầu tạo đơn có trường tổng tiền bị sửa: server bỏ qua, tổng vẫn đúng theo giá hạng ghế.
- [ ] Đơn quá hạn thanh toán: trang hiển thị đã hết hạn, nút thanh toán bị ẩn.
- [ ] User khác xem đơn không phải của mình: bị từ chối. Người chưa đăng nhập: bị từ chối.

### Ngoài phạm vi
Thanh toán thật, cổng thanh toán, webhook (các story sau).

---

## 3. S-18: Thanh toán đơn hàng qua cổng sandbox

- **Branch:** `S-18-thanh-toan-don-hang-qua-cong-sandbox`
- **Phụ thuộc:** S-17.

### Mục tiêu
Người mua bấm thanh toán, được chuyển sang cổng thanh toán, trả tiền xong thì đơn chuyển sang đã trả và ghế chuyển sang đã bán.

### Việc cần làm

**Cổng sandbox của dự án là MoMo (đã chốt, không cần hỏi lại).** Tra tài liệu chính thức của MoMo (developers.momo.vn) để triển khai đúng định dạng yêu cầu thanh toán và IPN (webhook). Nếu chưa có thông tin tài khoản sandbox (partnerCode, accessKey, secretKey) thì vẫn làm toàn bộ phần interface và nghiệp vụ ở dưới, đọc các giá trị này từ biến môi trường, và dùng cổng giả lập ở S-19 để chạy được đầu-cuối.

**1. Interface cổng thanh toán** (đây là phần tương ứng T-40; S-19 phụ thuộc vào nó)
Tạo `PaymentGateway` (interface/abstract class/protocol tuỳ ngôn ngữ) ở một module riêng, gồm tối thiểu:
- `createPayment({ orderId, amount, currency, returnUrl })` → trả `{ redirectUrl, gatewayRef }`.
- `verifyWebhook(rawBody, headers)` → trả đúng/sai về chữ ký (S-21 hoàn thiện).
- `parseWebhook(rawBody)` → trả sự kiện chuẩn hoá nội bộ: `{ transactionId, orderId, amount, status: 'SUCCESS' | 'FAILED' }`.

Mã nghiệp vụ (service đơn hàng/thanh toán) chỉ làm việc với interface này. Một nơi duy nhất (factory hoặc DI) chọn cài đặt cụ thể theo biến môi trường `PAYMENT_GATEWAY` (`momo` hoặc `mock`). Tạo adapter `MomoGateway` implement interface này. Cấu hình qua `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY`, `MOMO_ENDPOINT`, thêm tất cả vào `.env.example`. Lưu ý MoMo: mỗi lần tạo yêu cầu thanh toán phải dùng `orderId`/`requestId` phía MoMo duy nhất (kiểm tra tài liệu MoMo), nên khi user thử lại sau thanh toán thất bại không được dùng lại mã cũ. Adapter chịu trách nhiệm ánh xạ giữa mã phía MoMo và mã đơn nội bộ (ví dụ lưu trong bản ghi `Payment` hoặc `extraData`) để `parseWebhook` luôn trả về `orderId` nội bộ.

**2. Khởi tạo thanh toán**
- Endpoint kiểu `POST /api/orders/:id/pay`: yêu cầu đăng nhập, đúng chủ đơn.
- Chỉ cho phép khi đơn `PENDING` và chưa hết hạn, nếu không trả lỗi rõ ràng (409 hoặc 400 theo convention).
- Số tiền gửi sang cổng **tính lại từ DB** (giá hạng ghế), không lấy từ request.
- Gọi `createPayment`, lưu bản ghi `Payment` (`INITIATED`, kèm `gatewayRef`/mã giao dịch, orderId, amount), trả `redirectUrl` cho frontend.
- Frontend nối nút "Thanh toán" ở trang đơn (từ S-17): gọi API rồi chuyển hướng tới `redirectUrl`. Chặn bấm đúp khi đang xử lý.

**3. Nhận kết quả (webhook)**
Endpoint webhook (ví dụ `POST /api/payments/webhook`) theo pipeline: **xác thực chữ ký → phân tích → xử lý**. Xử lý một sự kiện `SUCCESS`:
- Tìm đơn theo `orderId`. So khớp `amount` của cổng với tổng đơn do server tính.
- Nếu khớp: trong **một transaction duy nhất**, (a) đơn → `PAID`, (b) các ghế của đơn → `SOLD`, (c) xoá giữ chỗ (hold) của các ghế đó, (d) cập nhật `Payment` → `SUCCEEDED` kèm mã giao dịch cổng. Một trong bốn bước lỗi thì rollback tất cả.
- Nếu **số tiền khác tổng đơn**: không ghi nhận thanh toán, không đổi đơn sang `PAID`. Đánh dấu đơn `NEEDS_REVIEW`, `Payment` → `AMOUNT_MISMATCH`, và **báo cho kế toán** qua một `AccountantNotifier` (hoặc tên tương đương). Mặc định ghi log mức cảnh báo/lỗi; nếu dự án đã có dịch vụ email thì gửi email tới địa chỉ cấu hình trong biến môi trường (ví dụ `ACCOUNTANT_EMAIL`). Đơn `NEEDS_REVIEW` phải được loại khỏi job tự động nhả ghế khi hết hạn, vì khách đã bị trừ tiền.
- Sự kiện `FAILED`: `Payment` → `FAILED`, đơn vẫn `PENDING` để user có thể thử lại cho tới khi hết hạn.
- Webhook phải xử lý được kể cả khi người dùng đã tắt trình duyệt sau khi trả tiền ở cổng (không phụ thuộc việc user quay lại).

**4. Trang kết quả thanh toán**
- Route ví dụ `/payment/result?orderId=...`. **Không tin tham số trên URL** để quyết định thành công, luôn đọc trạng thái đơn từ API.
- Nếu đơn vẫn `PENDING` khi user vừa quay về, polling trạng thái đơn (2 giây/lần, tối đa 60 giây) vì webhook có thể đến chậm. Hiển thị: đã trả / đang xác nhận / thất bại, có nút quay lại đơn hoặc thử lại. Phần này được hoàn thiện và chuẩn hoá ở S-22 (nếu có chỗ khác nhau thì S-22 là bản chuẩn).

### Tiêu chí chấp nhận (cần test)
- [ ] Đơn `PENDING` còn hạn, bấm thanh toán: nhận `redirectUrl` đến trang cổng với đúng số tiền và mã đơn.
- [ ] Đơn hết hạn hoặc không phải của user: không khởi tạo được thanh toán.
- [ ] Webhook thành công, số tiền khớp: đơn `PAID`, ghế `SOLD`, giữ chỗ bị xoá, cả ba trong một transaction (test rollback khi một bước lỗi).
- [ ] Webhook đến khi user không quay lại: đơn vẫn chuyển `PAID`.
- [ ] Webhook với số tiền khác tổng đơn: không ghi nhận, đơn `NEEDS_REVIEW`, có thông báo kế toán.
- [ ] Không có chỗ nào lưu số thẻ; DB chỉ có mã giao dịch từ cổng.

### Ngoài phạm vi
Cổng giả lập (S-19), chống xử lý trùng/đồng thời (S-20), hoàn thiện kiểm chữ ký và mã 401/404 (S-21). Tuy vậy, cấu trúc code ở S-18 phải sẵn sàng để các story đó cắm vào mà không phải viết lại.

---

## 4. S-19: Cổng thanh toán giả lập để chạy khi chưa có sandbox

- **Branch:** `S-19-cong-thanh-toan-gia-lap-de-chay-khi-chua-co-sandbox`
- **Phụ thuộc:** S-18 (interface `PaymentGateway`).

### Mục tiêu
Thành viên phát triển chạy trọn luồng thanh toán đầu-cuối ngay cả khi chưa có tài khoản sandbox, bằng một cổng giả lập chọn qua cấu hình.

### Việc cần làm

**1. Cài đặt `MockPaymentGateway`**
- Implement đúng interface `PaymentGateway` của S-18 (cùng interface, không có nhánh `if` trong mã nghiệp vụ).
- Được chọn khi `PAYMENT_GATEWAY=mock` (qua cùng factory/DI ở S-18).
- `createPayment` trả `redirectUrl` về **trang nội bộ** của ứng dụng (ví dụ `/mock-gateway/pay?orderId=...&amount=...&txnRef=...`).

**2. Trang cổng giả lập**
- Hiển thị mã đơn, số tiền, và hai nút: **"Thanh toán thành công"** và **"Thanh toán thất bại"**.
- Trang và các route phụ của mock **chỉ được đăng ký khi cổng giả lập đang bật**.

**3. Hành vi khi bấm nút**
- Server của mock gửi một **webhook giả** bằng một HTTP request thật tới endpoint webhook của hệ thống (để đi qua đúng đường xử lý như cổng thật), nội dung theo định dạng IPN của MoMo (chi tiết ở ý ngay dưới) để `parseWebhook` đọc được và chuẩn hoá về sự kiện nội bộ: `transId` → `transactionId` (duy nhất cho mỗi lần thanh toán), `resultCode` → `status` là `SUCCESS` hoặc `FAILED`.
- Webhook giả phải **mô phỏng đúng IPN của MoMo** để sau này chuyển sang MoMo thật không phải sửa lại:
  - Gửi `POST` JSON (`Content-Type: application/json`) tới endpoint webhook, gồm các trường như IPN của MoMo: `partnerCode`, `orderId`, `requestId`, `amount`, `orderInfo`, `orderType`, `transId`, `resultCode`, `message`, `payType`, `responseTime`, `extraData`, `signature`. `transId` phải duy nhất cho mỗi lần thanh toán. `resultCode = 0` là thành công (khi bấm "Thanh toán thành công"), khác 0 là thất bại (khi bấm "Thanh toán thất bại").
  - **Chữ ký nằm trong trường `signature` của body, không đi trong header.** Chữ ký là HMAC-SHA256 (dạng hex) của chuỗi ghép các trường `key=value` theo thứ tự chữ cái, nối bằng `&`. Phải đối chiếu tài liệu MoMo hiện hành (developers.momo.vn) để lấy đúng danh sách trường và thứ tự, không tự đoán.
  - Viết **một hàm dùng chung** dựng chuỗi ký và tính chữ ký (ví dụ `buildMomoSignature(fields, accessKey, secretKey)`). `MockPaymentGateway` (khi ký) và `MomoGateway.verifyWebhook` (khi kiểm) cùng gọi hàm này để hai bên không bị lệch.
  - Cổng giả lập dùng khoá dev `PAYMENT_WEBHOOK_SECRET` và một accessKey dev cố định, nên không cần tài khoản MoMo. `MomoGateway` dùng `MOMO_ACCESS_KEY` và `MOMO_SECRET_KEY`.
- Sau khi gửi webhook, redirect người dùng về trang kết quả thanh toán (`returnUrl`), kết quả giống cổng thật: bấm thành công thì đơn thành `PAID`, bấm thất bại thì đơn vẫn `PENDING` và thanh toán `FAILED`.

**4. Chặn chạy ở production**
- Khi khởi động, nếu môi trường là production (theo biến đang dùng của dự án, ví dụ `NODE_ENV=production`/`APP_ENV=production`) mà `PAYMENT_GATEWAY=mock` thì ứng dụng **từ chối khởi động**: in lỗi rõ ràng và thoát với mã lỗi khác 0.
- Thêm `PAYMENT_GATEWAY`, `PAYMENT_WEBHOOK_SECRET` vào `.env.example`, ghi chú "mock chỉ dùng cho dev/test".
- Cập nhật README (hoặc tài liệu dev có sẵn) vài dòng hướng dẫn chạy luồng thanh toán bằng cổng giả lập.

### Tiêu chí chấp nhận (cần test)
- [ ] Đặt cổng giả lập, bấm thanh toán: tới trang nội bộ có hai nút thành công/thất bại.
- [ ] Bấm thành công: webhook có chữ ký hợp lệ được gửi vào hệ thống, đơn → `PAID` như cổng thật.
- [ ] Bấm thất bại: đơn vẫn `PENDING`, thanh toán `FAILED`.
- [ ] Production + cổng giả lập: ứng dụng không khởi động được (test hàm kiểm tra cấu hình khi khởi động).
- [ ] Trong mã nghiệp vụ không có chuỗi `mock` hoặc `if` rẽ theo loại cổng (chỉ ở factory).

### Ngoài phạm vi
Cổng thật; xử lý trùng/đồng thời (S-20); sửa logic kiểm chữ ký (S-21).

---

## 5. S-20: Webhook gửi lại nhiều lần chỉ ghi nhận một

- **Branch:** `S-20-webhook-thanh-toan-gui-lai-nhieu-lan-chi-ghi-nhan-mot`
- **Phụ thuộc:** S-18, S-19.

### Mục tiêu
Một lần thanh toán chỉ được ghi nhận đúng một lần để sổ sách không nhân đôi doanh thu và khách không nhận hai bộ vé. Xử lý một webhook nhiều lần cho kết quả giống hệt xử lý một lần.

### Việc cần làm

**1. Chống trùng ở tầng dữ liệu (không chỉ ở tầng ứng dụng)**
- Thêm **ràng buộc unique** trên mã giao dịch của cổng (kết hợp provider nếu cần) trong bảng `Payment`. Tạo migration/index tương ứng.
- Chuyển đổi trạng thái đơn bằng thao tác **nguyên tử có điều kiện**, ví dụ `UPDATE orders SET status='PAID' WHERE id=? AND status='PENDING'` rồi kiểm tra số dòng bị ảnh hưởng (với MongoDB: `findOneAndUpdate` có điều kiện trạng thái, và chỉ dùng transaction khi cụm hỗ trợ). Tuyệt đối không dùng kiểu "đọc rồi mới kiểm tra rồi ghi" không có khoá.
- Cân nhắc khoá theo mã giao dịch (advisory lock hoặc `SELECT ... FOR UPDATE` trên đơn/payment) để chặn xử lý song song.

**2. Hành vi khi nhận webhook**
- Webhook trùng (mã giao dịch đã được xử lý): **không thực hiện lại bất kỳ tác dụng phụ nào**, trả mã thành công đúng như tài liệu của cổng quy định (thường là 200; với MoMo hãy tra tài liệu IPN vì có thể là 204) để cổng ngừng gửi lại. Ở các ý còn lại của mục này, "200" được hiểu là mã thành công đó.
- Hai bản sao đến **đồng thời**: đúng một bản được xử lý, bản còn lại bị bỏ qua. Bắt lỗi vi phạm unique/serialization và xem đó là "bản trùng" → 200. **Không được trả 500**.
- Vé: nếu dự án đã có model Ticket thì sinh vé trong cùng transaction, với ràng buộc unique (ví dụ `orderId + seatId`) để chỉ có đúng một bộ vé. Nếu dự án **chưa có** chức năng sinh vé, không tự tạo mới; chỉ cần đảm bảo thao tác "ghế → SOLD" chỉ xảy ra một lần và nêu rõ điều này trong báo cáo cuối.

**3. Webhook đến cho đơn đã hết hạn/huỷ**
- Nếu đơn đã `EXPIRED` (hoặc `PENDING` mà quá `expiresAt`, dùng hàm `isOrderExpired` đã có) khi webhook thành công tới: **không** đổi đơn sang `PAID`, **không** đụng vào ghế (ghế có thể đã được nhả cho người khác).
- Ghi `Payment` ở trạng thái `LATE`, đánh dấu đơn `NEEDS_REVIEW` (hoặc cờ tương đương) kèm lý do "thanh toán sau khi hết hạn, cần hoàn tiền", và báo kế toán qua `AccountantNotifier` đã có ở S-18. Trả 200.

**4. Webhook đến trước khi user quay lại**
- Đảm bảo trang kết quả (S-18) khi user quay về thấy ngay đơn `PAID`. Viết test cho luồng này (webhook xử lý xong rồi mới gọi API đơn).

### Tiêu chí chấp nhận (cần test)
- [ ] Gửi lại cùng một webhook 5 lần (tuần tự): đúng 1 bản ghi `Payment`, đơn đổi trạng thái đúng 1 lần, vé chỉ sinh 1 bộ (nếu có), cả 5 lần đều trả 2xx.
- [ ] Hai bản sao của cùng webhook gửi đồng thời (ví dụ `Promise.all`/threads): đúng một bản được xử lý, bản kia bị bỏ qua, không có lỗi 500. Chạy lặp nhiều lần để loại trừ may rủi.
- [ ] Webhook thành công cho đơn đã hết hạn: đơn **không** thành `PAID`, đánh dấu cần kiểm tra để hoàn tiền, kế toán được báo.
- [ ] Webhook tới trước khi user quay lại trang kết quả: user thấy đơn đã trả.

### Ngoài phạm vi
Kiểm chữ ký (S-21).

---

## 6. S-21: Webhook có chữ ký sai bị từ chối

- **Branch:** `S-21-webhook-co-chu-ky-sai-bi-tu-choi`
- **Phụ thuộc:** S-18, S-19.

### Mục tiêu
Hệ thống chỉ tin webhook do đúng cổng gửi, để không ai tự gửi webhook giả nhằm lấy vé miễn phí.

### Việc cần làm

**1. Thứ tự xử lý bắt buộc trên endpoint webhook**
1. Lấy **raw body** nguyên bản (cấu hình middleware giữ raw body cho riêng route này; không để body parser JSON chạy trước làm mất byte gốc).
2. **Kiểm chữ ký** bằng `PaymentGateway.verifyWebhook(rawBody, headers)`.
3. Chỉ khi chữ ký hợp lệ mới `parseWebhook` và đọc nội dung.
4. Tìm đơn theo mã đơn. Không tồn tại → 404.
5. Mới đến phần xử lý nghiệp vụ (so khớp số tiền, idempotency… của S-18/S-20).

**2. Chữ ký sai hoặc thiếu**
- Trả **401** với nội dung chung chung (không tiết lộ lý do chi tiết).
- **Không đọc/phân tích nội dung**, **không** thay đổi đơn, ghế hay thanh toán.
- Ghi log mức cảnh báo kèm **địa chỉ nguồn** (IP). Nếu app đứng sau proxy/load balancer, chỉ dùng `X-Forwarded-For` khi đã cấu hình "trust proxy", ngược lại dùng địa chỉ kết nối trực tiếp. Log **không** chứa body, chữ ký hay secret.
- Thiếu trường `signature` trong body (hoặc body không phải JSON hợp lệ) cũng xử lý như chữ ký sai (trả 401).

**3. Chữ ký đúng nhưng mã đơn không tồn tại**
- Trả **404** và ghi log (mức cảnh báo, kèm IP và mã đơn đã nhận, không kèm dữ liệu nhạy cảm).

**4. Cài đặt kiểm chữ ký**
- Dùng HMAC theo thuật toán của cổng đã chọn. Với MoMo (và cổng giả lập mô phỏng MoMo ở S-19): chữ ký nằm trong trường `signature` của body JSON và được tính theo chuỗi trường mà tài liệu MoMo quy định, không phải HMAC trên toàn bộ raw body. Vì vậy `verifyWebhook` chỉ được đọc đúng các trường cần để dựng chuỗi ký, kiểm chữ ký xong mới `parseWebhook` và xử lý nghiệp vụ. Hàm dựng chữ ký dùng chung với S-19. **So sánh bằng hàm hằng thời gian** (ví dụ `timingSafeEqual`/`hmac.compare_digest`) để tránh tấn công thời gian. Phản hồi IPN phải đúng định dạng/mã HTTP mà tài liệu MoMo yêu cầu.
- Khoá ký đọc từ biến môi trường: `MOMO_SECRET_KEY` (cùng `MOMO_ACCESS_KEY`) khi `PAYMENT_GATEWAY=momo`, hoặc `PAYMENT_WEBHOOK_SECRET` khi `PAYMENT_GATEWAY=mock`. Nếu thiếu khi ứng dụng khởi động với cổng đang bật, ứng dụng từ chối khởi động với thông báo rõ ràng. Không bao giờ hard-code khoá.
- Cổng giả lập (S-19) phải ký bằng đúng cơ chế này. Rà lại để luồng giả lập vẫn chạy trọn vẹn.

### Tiêu chí chấp nhận (cần test)
- [ ] Webhook chữ ký không khớp: trả 401, đơn/ghế/payment không đổi, có log kèm IP, nội dung không bị parse (test bằng body không phải JSON hợp lệ + chữ ký sai vẫn ra 401 chứ không phải 400).
- [ ] Webhook thiếu trường `signature`: trả 401.
- [ ] Webhook đúng chữ ký, mã đơn không tồn tại: trả 404 và có log.
- [ ] Webhook đúng chữ ký, đơn tồn tại: đi tiếp vào xử lý bình thường (S-18/S-20 vẫn pass).
- [ ] Log không chứa secret hay chữ ký.

### Ngoài phạm vi
Giới hạn tần suất (rate limit), allow-list IP của cổng (có thể đề xuất trong báo cáo nhưng không tự làm).

---

## 7. S-22: Trang kết quả thanh toán chờ xác nhận từ máy chủ, không tự kết luận

- **Branch:** `S-22-trang-ket-qua-thanh-toan-cho-xac-nhan-tu-may-chu-khong-tu-ket-luan`
- **Phụ thuộc:** S-17, S-18, S-19, S-20 (cần luồng webhook và cổng giả lập đã chạy được).

### Mục tiêu
Trang kết quả luôn nói đúng trạng thái thật của đơn theo máy chủ, để người mua không thấy "thành công" rồi sau đó nhận email huỷ. Story này hoàn thiện trang kết quả đã dựng sơ bộ ở S-18 (mục "4. Trang kết quả thanh toán"); chỗ nào khác nhau thì **S-22 là bản chuẩn**.

### Việc cần làm

**1. API trạng thái nhẹ để hỏi lại (backend)**
- Thêm `GET` trạng thái đơn (ví dụ `/api/orders/:id/status`) với cùng quy tắc đăng nhập và kiểm quyền chủ đơn như API chi tiết đơn ở S-17.
- Trả về tối thiểu: `status` của đơn, `expiresAt`, `serverTime`, và `latestPayment` (gồm `status` theo mục 1.4 và `attemptNo` của lần thanh toán gần nhất, hoặc `null` nếu chưa có lần nào).
- Chỉ đọc, **không có tác dụng phụ** (không đổi trạng thái đơn, không gọi cổng thanh toán). Gắn `Cache-Control: no-store`.
- Thêm cùng trường `latestPayment` vào API chi tiết đơn của S-17 để S-24 dùng lại. Chỉ thêm trường, không đổi trường cũ.

**2. Mã đơn lấy từ đâu**
- Khi dựng `returnUrl` (S-18/S-19), hệ thống tự đặt **mã đơn nội bộ** vào URL, khuyến nghị dạng path (ví dụ `/payment/result/:orderId`). Trang kết quả chỉ dùng mã này để biết cần hỏi máy chủ về đơn nào.
- Lý do: MoMo có thể gắn thêm tham số của riêng nó vào URL quay về, trong đó có `orderId` phía MoMo (khác mã đơn nội bộ, xem ghi chú ở S-18), nên không được dùng nhầm. Nếu S-18 đã dựng route dạng `?orderId=...` thì chuyển sang dạng trên.

**3. Các trạng thái hiển thị (frontend)**

| Máy chủ báo | Trang hiển thị |
|---|---|
| Chưa có phản hồi đầu tiên | "Đang xác nhận thanh toán…" (trung tính, **không** hiện thành công hay thất bại) |
| Đơn `PAID` | "Đã thanh toán" kèm liên kết tới vé của đơn. Nếu dự án chưa có trang vé thì liên kết tới trang chi tiết đơn (S-17) và nêu rõ trong báo cáo cuối |
| Đơn `PENDING`, `latestPayment` là `INITIATED` | "Đang xác nhận thanh toán" và tự hỏi lại máy chủ mỗi **2 giây** |
| Đơn `PENDING`, `latestPayment` là `FAILED` | "Thanh toán không thành công" kèm liên kết về trang đơn để thanh toán lại (nút và logic thử lại do S-24 làm) |
| Đơn `EXPIRED` | "Đơn đã hết hạn" |
| Đơn `NEEDS_REVIEW` | "Đơn đang được kiểm tra" kèm hướng dẫn liên hệ hỗ trợ. Không nói là đã trả hay thất bại |

Quy tắc hỏi lại (polling):
- Mỗi lần chờ phản hồi xong mới hẹn lần kế (ví dụ chuỗi `setTimeout`), **không để các yêu cầu chồng nhau**. Dừng ngay khi gặp trạng thái cuối (`PAID`, `FAILED`, `EXPIRED`, `NEEDS_REVIEW`) hoặc khi rời trang (huỷ timer khi component bị gỡ).
- Tổng thời gian chờ tối đa **60 giây** tính từ lúc trang mở, đo bằng đồng hồ thực chứ không đếm số lần hỏi. Con số này thay cho "30 giây" ghi trước đó ở S-18.
- Hết 60 giây mà vẫn `PENDING` với `INITIATED`: **không kết luận thất bại**. Hiện "Chưa nhận được xác nhận từ cổng thanh toán", hướng dẫn kiểm tra lại trong **lịch sử đơn** của mình sau ít phút, kèm mã đơn để liên hệ hỗ trợ nếu đã bị trừ tiền, và nút "Kiểm tra lại" để hỏi thêm một đợt. Nếu dự án chưa có trang lịch sử đơn thì liên kết tới trang chi tiết đơn (S-17), **không tự xây trang mới** trong story này và ghi rõ trong báo cáo cuối.
- Lỗi mạng khi hỏi lại: thử tiếp ở lần kế, không chuyển sang thất bại. Nếu lỗi kéo dài hết 60 giây thì rơi vào nhánh "hết thời gian chờ" ở trên.

**4. Không tin tham số trên URL**
- Trang kết quả **không đọc** các tham số do cổng gắn thêm (ví dụ `resultCode`, `message`, `signature`, `transId`…) để quyết định trạng thái hay nội dung hiển thị. Trạng thái chỉ đến từ API ở mục 1.
- Nếu mã đơn trong URL bị sửa sang đơn của người khác: API từ chối theo S-17, trang hiển thị lỗi chung "không tìm thấy đơn", không lộ thông tin.

**5. Cập nhật cổng giả lập (S-19) để test được các tình huống trên**
- Khi redirect về `returnUrl`, `MockPaymentGateway` cũng gắn thêm các tham số kiểu MoMo (`resultCode`, `orderId` phía MoMo, `transId`, `message`…) để tái hiện tình huống tham số bị sửa.
- Thêm biến dev `MOCK_WEBHOOK_DELAY_MS` (mặc định `0`; số dương = trì hoãn gửi webhook; `-1` = không bao giờ gửi). Khi có độ trễ, người dùng được redirect về ngay còn webhook được gửi sau độ trễ đó. Biến này chỉ có tác dụng khi `PAYMENT_GATEWAY=mock`; thêm vào `.env.example`.

### Tiêu chí chấp nhận (cần test)
- [ ] Quay về trước khi webhook tới (đặt độ trễ webhook): trang hiện "đang xác nhận thanh toán" và tự hỏi lại máy chủ mỗi 2 giây (dùng fake timers để kiểm tra đúng khoảng cách và không có yêu cầu chồng nhau).
- [ ] Webhook thành công tới sau đó: lần hỏi kế tiếp chuyển sang "đã thanh toán" kèm liên kết tới vé và việc hỏi lại dừng.
- [ ] Sau 60 giây vẫn chưa có xác nhận (webhook không bao giờ tới): hiện hướng dẫn kiểm tra lại trong lịch sử đơn, **không** hiện thất bại, ngừng hỏi lại tự động.
- [ ] Tham số trên đường dẫn quay về bị sửa thành "thành công" (ví dụ `resultCode=0`) trong khi máy chủ vẫn báo `PENDING`: trang vẫn hiện "đang xác nhận". Ngược lại, tham số báo lỗi mà máy chủ báo `PAID`: trang hiện "đã thanh toán".
- [ ] Trước phản hồi đầu tiên của máy chủ, trang không hiện "thành công" hay "thất bại".
- [ ] API trạng thái chỉ cho chủ đơn, không có tác dụng phụ, có `Cache-Control: no-store`.
- [ ] Mã nguồn trang kết quả không đọc các tham số do cổng gắn vào URL để quyết định trạng thái (có test hoặc kiểm tra tĩnh).

### Ngoài phạm vi
Nút và logic thanh toán lại (S-24), huỷ đơn quá hạn và nhả ghế (S-23), xây trang lịch sử đơn hoặc trang vé mới.

---

## 8. S-23: Đơn hàng quá hạn thanh toán thì nhả ghế

- **Branch:** `S-23-don-hang-qua-han-thanh-toan-thi-nha-ghe`
- **Phụ thuộc:** S-17, S-18, S-20.

### Mục tiêu
Ghế của đơn bị bỏ dở được trả lại để người đến sau mua được, và không bao giờ làm mất ghế của đơn đã trả tiền.

### Việc cần làm

**Kiểm tra riêng cho story này:** xem chức năng chọn ghế hiện có đã tự nhả ghế khi hết thời hạn giữ chưa (TTL ở Redis, trường `heldUntil`, job dọn dẹp…). Nếu có, không viết trùng: job mới phải **phối hợp** với cơ chế đó và vẫn chuyển đúng đơn sang `EXPIRED`. Ghế có thể đã được nhả trước, nên bước nhả ghế của job phải chạy được mà không lỗi khi không còn gì để nhả. `expiresAt` của đơn và thời hạn giữ chỗ phải là cùng một giá trị (xem S-17).

**1. Hàm dùng chung `expireOrder(orderId)`**
Một hàm duy nhất, dùng cho cả job và luồng webhook trả trễ (mục 3), thực hiện trong **một transaction**:
1. Chuyển đơn `PENDING` → `EXPIRED` bằng cập nhật nguyên tử có điều kiện: `WHERE id=? AND status='PENDING' AND expiresAt <= <thời điểm hiện tại>`. Dùng **thời gian của DB** (ví dụ `NOW()`) hoặc một nguồn thời gian duy nhất cho mọi so sánh hạn, không trộn đồng hồ của nhiều máy.
2. Nếu không dòng nào bị ảnh hưởng (đơn đã đổi trạng thái hoặc chưa tới hạn): dừng, không làm gì thêm, trả kết quả `skipped`.
3. Nếu thành công: ghế thuộc đơn này `HELD` → `AVAILABLE` (chỉ những ghế đang được giữ **bởi chính đơn/user này**; không đụng ghế `SOLD`, không đụng ghế đã được người khác giữ lại) và xoá bản ghi giữ chỗ tương ứng.
4. Lỗi ở bất kỳ bước nào thì rollback toàn bộ, không để đơn `EXPIRED` mà ghế còn bị giữ hoặc ngược lại.

Ghi log ứng dụng (mã đơn, số ghế đã nhả). Nếu sơ đồ ghế đang có cập nhật thời gian thực (websocket/SSE) thì phát sự kiện ghế trống qua cơ chế đó; nếu không có thì không cần làm thêm.

**2. Job định kỳ**
- Dùng cơ chế lập lịch đã có của dự án (cron, scheduler…); nếu chưa có, dùng thư viện lập lịch phổ biến của stack hiện tại. Chu kỳ cấu hình qua `ORDER_EXPIRY_JOB_INTERVAL_SECONDS` (mặc định 60), thêm vào `.env.example`.
- Mỗi lần chạy: lấy tối đa N đơn (ví dụ 100, cấu hình được) có `status = PENDING` và `expiresAt` đã qua, gọi `expireOrder` cho **từng đơn trong transaction riêng** (một đơn lỗi không chặn các đơn còn lại). Đơn còn lại sẽ được xử lý ở lần chạy sau.
- Chỉ chọn đơn `PENDING`. Đơn `PAID`, `EXPIRED` và `NEEDS_REVIEW` (ví dụ lệch tiền ở S-18, ghế được giữ để kế toán xử lý) **không bị job đụng tới**.
- Chạy lặp lại được và an toàn khi có nhiều instance cùng chạy nhờ điều kiện trạng thái trong `expireOrder`, không cần khoá phân tán.
- Cuối mỗi lần chạy ghi log: số đơn đã hết hạn, số bị bỏ qua, số lỗi (không log dữ liệu nhạy cảm). Lỗi của job phải được bắt và log, không làm sập ứng dụng.

**3. Điều chỉnh code S-18/S-20 để không có "trạng thái lửng" khi webhook và job va chạm**
Webhook thành công và job có thể cùng nhắm tới một đơn đúng lúc hết hạn. Chỉ một bên được thắng:
- **Webhook chuyển đơn sang `PAID`** (S-18/S-20): bổ sung điều kiện hạn vào cập nhật nguyên tử: `WHERE id=? AND status='PENDING' AND expiresAt > <thời điểm hiện tại>` (cùng nguồn thời gian với `expireOrder`). Hai điều kiện loại trừ nhau theo `expiresAt` và cùng đòi `status='PENDING'`, nên tối đa một cập nhật thành công.
- Nếu cập nhật `PAID` không ảnh hưởng dòng nào, đọc lại đơn: đã `PAID` thì là bản trùng (xử lý như S-20); `EXPIRED`, hoặc `PENDING` nhưng đã quá hạn, thì đi vào **đường thanh toán trễ**.
- **Đường thanh toán trễ** (cập nhật phần "đơn đã hết hạn" của S-20): nếu đơn còn `PENDING` mà đã quá hạn (job chưa chạy tới), gọi `expireOrder` trước để nhả ghế. Sau đó giữ nguyên hành vi của S-20: `Payment` → `LATE`, đơn → `NEEDS_REVIEW` kèm lý do "thanh toán sau khi hết hạn, cần hoàn tiền", báo kế toán, trả mã thành công. Nếu job đã thắng trước (đơn đã `EXPIRED`, ghế đã nhả) thì chỉ làm phần đánh dấu. Hai đường cho cùng một trạng thái cuối.
- Đơn `NEEDS_REVIEW` do thanh toán trễ có ghế **đã được nhả**, khác với `NEEDS_REVIEW` do lệch tiền ở S-18 (ghế vẫn giữ). Phân biệt bằng trạng thái `Payment` của đơn (`LATE` hay `AMOUNT_MISMATCH`).
- Chỉ có hai trạng thái cuối hợp lệ: (a) đơn `PAID`, ghế `SOLD`, không còn giữ chỗ; (b) đơn bị đánh dấu cần hoàn tiền (`NEEDS_REVIEW` cùng `Payment` `LATE`), ghế đã nhả, không còn giữ chỗ gắn với đơn này.

**4. Giao diện**
Không cần giao diện mới. Trang đơn (S-17) đã hiển thị đơn hết hạn và trang kết quả (S-22) đã có trạng thái `EXPIRED`.

### Tiêu chí chấp nhận (cần test)
- [ ] Đơn `PENDING` quá hạn, job chạy: đơn → `EXPIRED`, ghế → `AVAILABLE`, giữ chỗ bị xoá, trong cùng một transaction (test rollback: giả lập lỗi ở bước nhả ghế thì đơn vẫn `PENDING`).
- [ ] Đơn `PENDING` chưa tới hạn: job không đụng tới.
- [ ] Đơn đã `PAID`, job chạy nhiều lần: đơn và ghế (`SOLD`) giữ nguyên.
- [ ] Job chạy liên tiếp 3 lần trên cùng dữ liệu: kết quả sau lần 2 và 3 giống lần 1, không lỗi.
- [ ] Đơn `NEEDS_REVIEW` do lệch tiền: job không đổi trạng thái và không nhả ghế.
- [ ] Ghế đã được user khác giữ lại sau khi đơn cũ hết hạn: chạy lại `expireOrder` không nhả nhầm ghế đó.
- [ ] Webhook thành công và job cùng tác động một đơn đúng lúc hết hạn (test đồng thời, lặp nhiều lần, cả hai thứ tự webhook trước và job trước): luôn kết thúc ở đúng một trong hai trạng thái cuối ở mục 3. Không có trạng thái lửng (ví dụ đơn `PAID` mà ghế `AVAILABLE`, đơn `EXPIRED` mà ghế `SOLD`, hoặc đơn không còn `PENDING` mà ghế vẫn `HELD` của đơn đó), không lỗi 500.
- [ ] Webhook thành công tới khi đơn `PENDING` nhưng đã quá hạn và job chưa chạy: ghế được nhả, đơn `NEEDS_REVIEW`, `Payment` `LATE`, kế toán được báo.

### Ngoài phạm vi
Hoàn tiền tự động (chỉ đánh dấu và báo kế toán), thông báo nhắc sắp hết hạn, xử lý thất bại thanh toán (S-24).

---

## 9. S-24: Thanh toán thất bại thì đơn vẫn chờ và ghế còn giữ tới hết hạn

- **Branch:** `S-24-thanh-toan-that-bai-thi-don-van-cho-va-ghe-con-giu-toi-het-han`
- **Phụ thuộc:** S-18, S-22 (trường `latestPayment`), S-23 (xử lý đơn hết hạn).

### Mục tiêu
Người mua nhập sai hoặc huỷ một lần vẫn thanh toán lại được trên cùng một đơn, không mất ghế trước hạn.

Phía server đã có hành vi cơ bản từ S-18 (`Payment` → `FAILED`, đơn vẫn `PENDING`). Story này **rà lại và hoàn thiện**: không gia hạn/rút ngắn hạn, nút thanh toán lại, dùng lại cùng mã đơn, từ chối khi quá hạn và ghi nhật ký đơn.

### Việc cần làm

**1. Khi cổng báo thất bại (rà lại luồng webhook của S-18)**
- Webhook `FAILED`: `Payment` → `FAILED`; đơn **vẫn `PENDING`**; ghế **vẫn `HELD`**; giữ chỗ không bị xoá; **`expiresAt` không đổi** (không gia hạn, không rút ngắn). Nhánh `FAILED` không được gọi `expireOrder` hay nhả ghế; việc nhả ghế chỉ do S-23 làm khi hết hạn.
- Webhook `FAILED` gửi trùng: xử lý idempotent như S-20 (cùng mã giao dịch thì bỏ qua).
- Kết quả `FAILED` tới cho đơn đã quá hạn/`EXPIRED`, hoặc cho đơn đã `PAID` (do một lần thử khác thành công trước): chỉ ghi `Payment` `FAILED` cho lần thử đó, không đổi đơn hay ghế.

**2. Nút thanh toán lại (frontend, mở rộng trang đơn của S-17)**
- Dùng `latestPayment` từ API chi tiết đơn (S-22). Khi đơn `PENDING`, còn hạn và `latestPayment.status` là `FAILED`: hiện thông báo "Thanh toán lần trước không thành công, ghế của bạn vẫn được giữ" cùng đồng hồ đếm ngược đã có, và nút **"Thanh toán lại"** (thay cho nhãn "Thanh toán").
- Đơn chưa từng thử thanh toán: nhãn vẫn là "Thanh toán". Đơn hết hạn: ẩn nút (đã có ở S-17).
- Khi `latestPayment.status` là `INITIATED` (có giao dịch đang chờ kết quả): vẫn cho bấm nhưng hiện cảnh báo "Bạn có một giao dịch đang chờ xác nhận, thanh toán lại có thể bị trừ tiền hai lần".
- Giữ chặn bấm đúp đã có ở S-18.

**3. Thanh toán lại ở backend (dùng lại API của S-18)**
- **Không tạo API hay đơn mới.** Dùng lại `POST /api/orders/:id/pay` của S-18 với **cùng mã đơn nội bộ**. Mỗi lần gọi tạo thêm một bản ghi `Payment` mới (`INITIATED`) với `attemptNo` tăng dần (1, 2, 3…) và ràng buộc unique `(orderId, attemptNo)`. Khoá dòng đơn (hoặc thử lại khi vi phạm unique) để hai yêu cầu đồng thời không tạo hai lần thử trùng số.
- Phía MoMo dùng `orderId`/`requestId` **mới cho mỗi lần thử** (xem ghi chú ở S-18) và ánh xạ về cùng một mã đơn nội bộ. "Cùng mã đơn" trong yêu cầu nghĩa là mã đơn nội bộ.
- Vẫn kiểm tra như S-18: đúng chủ đơn, đơn `PENDING`, chưa hết hạn, số tiền tính lại từ DB.
- Đơn đã hết hạn (kể cả `PENDING` nhưng quá `expiresAt` mà job chưa chạy), hoặc đang `EXPIRED`/`PAID`/`NEEDS_REVIEW`: **từ chối** với mã lỗi ổn định theo convention của dự án (ví dụ `ORDER_EXPIRED` khi hết hạn), **không** tạo `Payment` mới, **không** gọi cổng. Yêu cầu bị từ chối này không tự huỷ đơn hay nhả ghế, việc đó để job S-23 xử lý như thường. Frontend hiện "Đơn đã hết hạn".

**4. Nhật ký đơn (`OrderLog`)**
- Tạo bảng/collection `OrderLog` nếu dự án chưa có bảng nhật ký phù hợp: `id`, `orderId`, `type`, `attemptNo` (có thể trống), `detail` (JSON nhỏ, **không** chứa secret, chữ ký hay dữ liệu thẻ), `createdAt`. Đánh index theo `orderId`.
- Ghi các sự kiện: `PAYMENT_ATTEMPT` mỗi lần khởi tạo thanh toán (kèm `attemptNo`; từ lần 2 trở đi chính là "thử lại" và `detail` ghi mã/lý do thất bại ngắn của lần trước nếu có), `PAYMENT_FAILED` khi nhận kết quả thất bại, `RETRY_REJECTED_EXPIRED` khi từ chối thử lại vì hết hạn.
- Ghi nhật ký **trong cùng transaction** với việc tạo `Payment` để hai bên không lệch nhau.
- Số lần thử lại = số lần `PAYMENT_ATTEMPT` trừ 1. Thêm trường `paymentAttempts` vào API chi tiết đơn. Không cần giao diện xem nhật ký.

**5. Trường hợp biên: hai lần thử cùng thành công**
Vì được thử lại, user có thể trả thành công ở hai lần thử (mở hai tab, hoặc lần thử cũ vẫn còn hiệu lực ở cổng). Khi webhook thành công thứ hai (mã giao dịch **khác**) tới cho đơn đã `PAID`: không ghi nhận lần hai, không đổi đơn hay ghế. Ghi `Payment` ở trạng thái `LATE` kèm lý do "trả trùng, cần hoàn tiền", báo kế toán qua `AccountantNotifier` (S-18), trả mã thành công. Trường hợp cùng mã giao dịch gửi lại vẫn do S-20 xử lý như bản trùng.

### Tiêu chí chấp nhận (cần test)
- [ ] Cổng trả thất bại: đơn vẫn `PENDING`, ghế vẫn `HELD`, `expiresAt` không đổi, trang đơn hiện nút "Thanh toán lại".
- [ ] Bấm thanh toán lại: dùng cùng mã đơn nội bộ, không có `Order` mới (đếm số `Order` trước và sau), có `Payment` mới với `attemptNo` = 2, phía cổng nhận mã giao dịch mới.
- [ ] Hết hạn rồi bấm thanh toán lại: bị từ chối, không có `Payment` mới, không gọi cổng. Sau đó job S-23 chạy thì đơn → `EXPIRED` và ghế được nhả như thường.
- [ ] Sau 3 lần thử: có đúng 3 bản ghi `PAYMENT_ATTEMPT` với `attemptNo` 1, 2, 3 trong nhật ký đơn, và nhật ký không chứa secret hay chữ ký.
- [ ] Job S-23 chạy khi đơn còn hạn và vừa thất bại: không đụng tới đơn và ghế.
- [ ] Hai yêu cầu thanh toán lại đồng thời: không tạo hai lần thử trùng `attemptNo`.
- [ ] Webhook `FAILED` gửi trùng, hoặc `FAILED` tới cho đơn đã `PAID` hoặc đã hết hạn: không đổi trạng thái đơn và ghế.
- [ ] Hai lần thử cùng thành công (mã giao dịch khác nhau): chỉ lần đầu được ghi nhận, lần hai `LATE` kèm báo kế toán, đơn vẫn `PAID`.

### Ngoài phạm vi
Giới hạn số lần thử lại, giao diện xem nhật ký đơn, hoàn tiền tự động.

---

## 10. Mẫu báo cáo sau mỗi story

Khi xong một story, agent trả lời theo mẫu:

```
Story: S-xx  | Branch: <tên branch>
Đã làm: <tóm tắt vài dòng>
File thay đổi chính: <danh sách>
Test: <đã viết gì, kết quả chạy toàn bộ test>
Giả định đã dùng / chỗ tự bổ sung: <nếu có, ví dụ tự tạo Order model>
Cần người dùng quyết định: <nếu có>
Đề xuất bước tiếp theo: <story kế tiếp theo thứ tự ở mục 1.6>
```

Sau đó **dừng lại** chờ người dùng xác nhận trước khi push, tạo PR hoặc sang story khác.
