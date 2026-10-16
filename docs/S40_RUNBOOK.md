# S-40 — Phòng chờ khi vượt ngưỡng (full: S-40a + S-40b + S-40c)

> Tier Later, ước lượng thô 8 SP. Đã làm đủ 3 lát trong một branch theo yêu cầu.
> `[CẦN CHỐT]` trước khi lên Next/merge: ngưỡng `S40_ACTIVE_LIMIT` (mặc định 200),
> thời gian giữ lượt `S40_TURN_TTL_SEC` (mặc định 300s), và hàng đợi đặt ở Redis
> hay tầng trước ứng dụng (WAF/edge).

## Đã làm

* **S-40a:** vào hàng chờ + xem vị trí + tới lượt vào chọn ghế.
  API `POST/GET/DELETE /showtimes/:id/waiting`, guard `WAITING_ROOM 429` trên `POST /holds`,
  trang `/shows/:id/waiting` poll mỗi 2 giây, tới lượt tự chuyển vào `/seats`.
* **S-40b:** hết lượt mất chỗ + thao tác gia hạn. `POST /holds` thành công gọi
  `WaitingService.touch` gia hạn lượt thêm một TTL; lượt quá hạn không thao tác bị
  prune và phải join lại từ cuối (không resume). Mỗi lần prune ghi log
  `waiting_turn_expired` và tăng counter `ticket_waiting_turns_expired_total`.
  Test 2000 lượt join FIFO kèm vị trí đúng trong `waiting.service.spec.ts`.
* **S-40c:** chống lách hàng chờ. Guard `WAITING_ROOM 429` áp cho cả
  `POST /showtimes/:id/orders` (tạo đơn từ ghế giữ), không chỉ `POST /holds`;
  các `GET` tra cứu (seats/catalog) giữ mở để không chặn xem công khai.
  Cùng tab/phiên dùng chung một ticket (rejoin giữ score cũ — test), phiên khác
  là ticket riêng. Mỗi lần chặn ghi log `waiting_gate_blocked` (showtime, userId,
  position, activeCount, queueTotal — không email/token) và tăng counter
  `ticket_waiting_gate_blocked_total` cho S-41 đối chiếu.

## Thiết kế

* Hàng chờ FIFO trên Redis sorted set `s40:q:{showtime}` (score = giờ vào),
  lượt đang chọn `s40:active:{showtime}` (score = giờ hết lượt).
* Không worker nền: prune lượt hết hạn + nâng hàng chờ ngay trong mỗi `join/status/guard`,
  nên đúng cả trên Render Free (không cron/worker).
* Dưới ngưỡng: mọi request qua thẳng, flow giữ ghế cũ không đổi (fail-open khi Redis lỗi để
  Valkey restart không chặn bán vé — rủi ro anti-abuse đã ghi, chờ S-41).
* Quá ngưỡng: `POST /holds` và `POST /showtimes/:id/orders` trả
  `429 {code: WAITING_ROOM, position}`, web chuyển vào phòng chờ.

## Kiểm thử

```powershell
pnpm --filter api test -- waiting        # FIFO, vị trí, hết lượt, fail-open
pnpm --filter web typecheck              # contract + trang waiting
```

Kịch bản tay: đặt `S40_ACTIVE_LIMIT=2`, 3 buyer vào `/shows/<id>/waiting` —
2 người đầu vào thẳng `/seats`, người thứ 3 thấy `Vị trí thứ 1`, hết lượt 300s thì được vào.
