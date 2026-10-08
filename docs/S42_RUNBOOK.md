# S-42 — Giới hạn số vé mỗi tài khoản trong một suất

## AC

Ban tổ chức đặt giới hạn theo suất (`PATCH /showtimes/:id/ticket-limit`,
`{maxTicketsPerUser: 1..2000 | null}`); `null` = không giới hạn (mặc định cho
suất cũ). Khi giữ ghế, `đang giữ + đã mua + xin thêm > giới hạn` thì `403
{code: TICKET_LIMIT}` và không chạm tới routine giữ ghế.

## Cách đếm (không đếm trùng)

* **Đang giữ** = `seat_holds` còn hiệu lực của tài khoản ở mọi phiên
  (đơn PENDING giữ nguyên dòng hold nên đã nằm trong số này).
* **Đã mua** = `order_items` của đơn `PAID`/`NEEDS_REVIEW` (hold đã xoá sau webhook).
* Đơn `EXPIRED`/`CANCELLED` không tính.
* Hai số đếm gộp trong **một** query; giới hạn theo suất cache trong memory
  mỗi API instance 10 giây (`S42_LIMIT_CACHE_TTL_MS`) để hot path giữ ghế
  không thêm connection lên pool (giữ nguyên gate đồng thời/NFR T-31 và đo
  overhead S-43). Lookup lạnh của burst đồng thời được singleflight thành
  đúng 1 query; lookup lỗi thì fail-open (bỏ qua kiểm tra, thử lại ở claim
  sau). Đổi giới hạn có hiệu lực trong tối đa 10 giây/instance.

## Giới hạn đã biết (S-42b khi lên Next)

* Chặn ở tầng service trước routine: chặn được gom ghế tuần tự (đúng pattern
  scalping), nhưng hai claim cùng mili-giây có thể cùng lọt — chống bán trùng
  ghế (S-13, ở tầng DB) không ảnh hưởng. Muốn chặn tuyệt đối thì đưa kiểm tra
  vào `claim_hold_v3`.
* `[CẦN CHỐT]` giới hạn theo tài khoản hay số điện thoại đã xác minh; hiện theo
  tài khoản. Giá trị mặc định khi ban tổ chức chưa đặt: không giới hạn.

## Kiểm thử

```powershell
pnpm --filter api test -- holds      # parse + chặn/vượt ngưỡng + tương thích cũ
pnpm --filter api test -- showtimes  # endpoint đặt giới hạn + phân quyền
```

Kịch bản tay: organizer đặt giới hạn 2 ở trang quản lý suất → buyer giữ 2 ghế
OK → giữ ghế thứ 3 báo `Mỗi tài khoản chỉ được giữ/mua tối đa 2 vé`.
