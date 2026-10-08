# S-40 — Phòng chờ khi vượt ngưỡng (lát cắt đầu, cần chẻ khi lên Next)

> Tier Later, ước lượng thô 8 SP. Lát cắt này triển khai khung FIFO + guard + trang vị trí.
> `[CẦN CHỐT]` trước khi lên Next: ngưỡng `S40_ACTIVE_LIMIT`, thời gian giữ lượt
> `S40_TURN_TTL_SEC`, và hàng đợi đặt ở Redis hay tầng trước ứng dụng (WAF/edge).

## Đề xuất chẻ 3 story

* **S-40a (xong ở đây):** vào hàng chờ + xem vị trí + tới lượt vào chọn ghế.
  API `POST/GET/DELETE /showtimes/:id/waiting`, guard `WAITING_ROOM 429` trên `POST /holds`,
  trang `/shows/:id/waiting` poll mỗi 2 giây, tới lượt tự chuyển vào `/seats`.
* **S-40b:** hết lượt mất chỗ + thao tác gia hạn. Hiện lượt hết hạn tự động theo score Redis;
  còn thiếu: thao tác giữ ghế gia hạn lượt, webhook/metric hết lượt, test quá tải 2000 người xem.
* **S-40c:** chống lách hàng chờ. Hiện chỉ chặn `POST /holds`; còn thiếu: chặn query seats/orders
  khi chưa có lượt, fingerprint chống nhiều tab, log lạm dụng cho S-41.

## Thiết kế

* Hàng chờ FIFO trên Redis sorted set `s40:q:{showtime}` (score = giờ vào),
  lượt đang chọn `s40:active:{showtime}` (score = giờ hết lượt).
* Không worker nền: prune lượt hết hạn + nâng hàng chờ ngay trong mỗi `join/status/guard`,
  nên đúng cả trên Render Free (không cron/worker).
* Dưới ngưỡng: mọi request qua thẳng, flow giữ ghế cũ không đổi (fail-open khi Redis lỗi để
  Valkey restart không chặn bán vé — rủi ro anti-abuse đã ghi, chờ S-41).
* Quá ngưỡng: `POST /holds` trả `429 {code: WAITING_ROOM, position}`, web chuyển vào phòng chờ.

## Kiểm thử

```powershell
pnpm --filter api test -- waiting        # FIFO, vị trí, hết lượt, fail-open
pnpm --filter web typecheck              # contract + trang waiting
```

Kịch bản tay: đặt `S40_ACTIVE_LIMIT=2`, 3 buyer vào `/shows/<id>/waiting` —
2 người đầu vào thẳng `/seats`, người thứ 3 thấy `Vị trí thứ 1`, hết lượt 300s thì được vào.
