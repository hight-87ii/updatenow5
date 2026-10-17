# S-51 — Đối soát giao dịch với sao kê cổng thanh toán

## Phạm vi đã triển khai

Kế toán có thể nạp một file CSV theo kỳ đối soát tại `/accounting/reconciliation`.
API chỉ cho vai trò `ACCOUNTANT` truy cập và lưu lại lần chạy cùng từng dòng kết quả.

CSV tối thiểu có hai cột:

```csv
transaction_id,amount,gateway_ref
TX-001,250000,REF-001
TX-002,300000,REF-002
```

`amount` là số nguyên VND, không có dấu phân cách. File tối đa 5 MB; mã giao dịch
trùng, thiếu cột, số tiền âm/không phải số hoặc kỳ thời gian sai bị từ chối toàn bộ.

## Phân loại

* `MATCHED`: mã giao dịch có ở hai bên và số tiền bằng nhau.
* `SYSTEM_ONLY`: payment `SUCCEEDED` trong hệ thống nhưng không có trong sao kê.
* `PROVIDER_ONLY`: có trong sao kê nhưng không có payment thành công trong hệ thống.
* `AMOUNT_MISMATCH`: cùng mã nhưng số tiền khác nhau.

Đối chiếu hệ thống dùng `Payment.transactionId`, chỉ lấy payment `SUCCEEDED` trong
khoảng `periodStart` đến `periodEnd`. Bản ghi lần đối soát và các dòng kết quả được
lưu trong `reconciliation_runs` và `reconciliation_lines`.

API:

* `POST /accounting/reconciliations`
* `GET /accounting/reconciliations`
* `GET /accounting/reconciliations/:id`

Body POST gồm `provider`, `fileName`, `periodStart`, `periodEnd`, `content`.
