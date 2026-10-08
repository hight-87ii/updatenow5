# S-58 — Nhân bản suất diễn kèm sơ đồ và bảng giá

Tier Later, 2 SP. Ban tổ chức chọn "Nhân bản" trên trang quản lý suất, nhập giờ diễn mới:
suất mới ở trạng thái nháp, cùng sơ đồ ghế và giá từng hạng, ghế đều trống.

## API

`POST /showtimes/:id/clone` (ORGANIZER, chủ suất) body `{ startTime }`:

* `startTime` phải có múi giờ (như tạo suất ở S-04) và ở tương lai, nếu không 400.
* Một transaction duy nhất: khóa dòng suất gốc, tạo suất DRAFT, copy hạng (tên + giá),
  copy ghế (mã mới, cùng hàng/số/hạng, không mang giữ chỗ/đơn/vé), đánh dấu đã có sơ đồ
  nếu suất gốc có. Trùng giờ thì cảnh báo nhưng vẫn lưu (như S-04 cho diễn song song).

## Kiểm thử

```powershell
pnpm --filter api test -- showtimes   # nhân bản + đọc sơ đồ hiện có
pnpm --filter web typecheck
```

Kịch bản tay: suất đã có sơ đồ 3 hạng + giá → Nhân bản với giờ tương lai →
mở suất mới: trạng thái nháp, đủ ghế trống, đủ giá; suất gốc không đổi.
