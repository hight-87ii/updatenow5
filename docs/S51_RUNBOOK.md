# S-51 — Đối soát giao dịch hệ thống với sao kê cổng thanh toán

Tier Later, 5 SP. Lát cắt này cho kế toán nạp CSV sao kê theo kỳ và ghép với giao dịch thanh toán đã ghi nhận trong hệ thống.

## Phạm vi hiện tại

* API: `POST /payments/reconciliation`, yêu cầu role `ACCOUNTANT`.
* UI: `/account/reconciliation`, chọn cổng, kỳ đối soát, tệp CSV.
* CSV cần header `transactionId,amount`; `amount` là số nguyên VND.
* Kết quả gồm 4 nhóm:
  * `matched`: có ở hệ thống và sao kê, số tiền khớp.
  * `systemOnly`: có ở hệ thống mà không có ở sao kê cổng.
  * `statementOnly`: có ở sao kê cổng mà không có ở hệ thống.
  * `amountMismatches`: cùng mã giao dịch nhưng lệch số tiền.

## Ghi chú về `payment_events`

AC gốc nói ghép với `payment_events`, nhưng schema hiện tại chưa có bảng này; dữ liệu giao dịch bền vững đang nằm ở bảng `payments` (`gateway`, `transactionId`, `amount`, `status`, `updatedAt`). Vì vậy S-51 ghép với `payments` có `status=SUCCEEDED`, `transactionId != null`, cùng `gateway` và nằm trong kỳ `[from, to)`.

Khi sau này thêm bảng `payment_events`, giữ nguyên contract API/UI và đổi nguồn đọc từ `payments` sang event ledger có review migration riêng.

## Kiểm thử

```powershell
pnpm --filter api test -- reconciliation
pnpm --filter api run typecheck
pnpm --filter web run typecheck
```

CSV mẫu:

```csv
transactionId,amount
tx-001,100000
tx-002,250000
```

Không upload sao kê thật vào GitHub/PR/chat; sao kê có thể chứa dữ liệu giao dịch nhạy cảm.
