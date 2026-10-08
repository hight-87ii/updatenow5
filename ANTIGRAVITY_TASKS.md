# Hướng dẫn triển khai: Module Thanh toán & Đơn hàng

Tài liệu này dành cho agent trong Antigravity IDE. Dự án là web quản lý sự kiện có sơ đồ ghế. Các phần đã có: đăng nhập, đăng ký, sơ đồ ghế, chọn ghế (giữ chỗ). Cần làm thêm 5 story thuộc Epic **Thanh toán và đơn hàng** (S-17 → S-21).

**Quy tắc quan trọng nhất: mỗi story làm trên MỘT branch riêng, làm xong một story thì dừng lại và báo cáo, không tự động chuyển sang story tiếp theo.**

---

## 0. Cách dùng

Người dùng sẽ ra lệnh theo mẫu: *"Làm story S-17 theo file ANTIGRAVITY_TASKS.md"*. Khi đó agent:

1. Đọc **Phần 1 (Quy tắc chung)** và đúng **một** mục story được yêu cầu.
2. Thực hiện **Bước 0 (khám phá codebase)** trước khi viết bất kỳ dòng code nào.
3. Tạo branch đúng tên, code, viết test, commit, rồi báo cáo theo mẫu ở Phần 7.

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
| Thanh toán (Payment) | `INITIATED`, `SUCCEEDED`, `FAILED`, `AMOUNT_MISMATCH`, `LATE` (tiền về sau khi đơn hết hạn) |

Một đơn được coi là **hết hạn** khi `status = PENDING` và `now > expiresAt`, kể cả khi job dọn dẹp chưa chạy. Tạo một hàm dùng chung (ví dụ `isOrderExpired(order, now)`) ở S-17 và các story sau tái sử dụng.

### 1.5. Test

Mỗi story phải kèm test tự động cho **từng** tiêu chí chấp nhận (AC) trong mục của nó. Chạy toàn bộ test hiện có để chắc chắn không làm hỏng chức năng cũ (đăng nhập, sơ đồ ghế, chọn ghế).

### 1.6. Thứ tự và phụ thuộc

```
S-17 → S-18 → S-19 → S-20 → S-21
```

| Story | Phụ thuộc | Ghi chú |
|---|---|---|
| S-17 | Chọn ghế/giữ chỗ đã có | Nền tảng cho trang đơn |
| S-18 | S-17 | Tạo interface cổng thanh toán (`PaymentGateway`, tương ứng mã T-40 trong tài liệu yêu cầu) |
| S-19 | S-18 | Cài đặt cổng giả lập theo interface của S-18 |
| S-20 | S-18, S-19 | Làm webhook idempotent |
| S-21 | S-18, S-19 | Xác thực chữ ký webhook |

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
- Nếu đơn vẫn `PENDING` khi user vừa quay về, polling trạng thái đơn (ví dụ 2 giây/lần, tối đa khoảng 30 giây) vì webhook có thể đến chậm. Hiển thị: đã trả / đang xác nhận / thất bại, có nút quay lại đơn hoặc thử lại.

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

## 7. Mẫu báo cáo sau mỗi story

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
