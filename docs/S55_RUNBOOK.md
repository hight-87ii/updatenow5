# S-55 — Sao lưu hằng ngày và diễn tập khôi phục

> `[CẦN CHỐT]` nơi lưu dài hạn + mã hoá: hiện tại bản ngoài máy chủ là GitHub Artifact (retention 14 ngày) + thư mục staging `.git/s55-backups` (không commit). Muốn giữ đúng 14 bản + mã hoá at-rest thì PO chốt S3/R2/KMS trước Sprint 8. Không dùng export thủ công ở `docs/RENDER_FREE_RUNBOOK.md` thay cho job này.

## 1. Job đêm

* Workflow `.github/workflows/s55-backup.yml`: cron `0 17 * * *` (00:00 ICT) + `workflow_dispatch`.
* Cần secret `S55_STAGING_DATABASE_URL` (External PG URL, mở IP/32 tạm thời, TLS `verify-full`). Chưa có secret thì job skip có warning, không fail ầm ĩ.
* Mỗi run: `pg_dump --format=custom`, ghi `.sha256`, cập nhật `manifest.json`, prune giữ 14 bản mới nhất, upload Artifact `s55-nightly-<run>` retention 14 ngày.
* Không in connection string ra log. Dump chứa password hash/session: giữ private, không attach vào PR/chat.

## 2. Sao lưu tay (local)

```powershell
$taskSecure = Read-Host 'DATABASE_URL (không gửi trong chat)' -AsSecureString
$env:PGDATABASE = [System.Net.NetworkCredential]::new('', $taskSecure).Password
node scripts/s55-backup.mjs --keep 14
Remove-Item Env:PGDATABASE
```

## 3. Diễn tập khôi phục (bắt buộc trước khi claim Done)

1. Tạo database tạm **mới/rỗng** (local docker hoặc PG mới). PO xác nhận target, **không** restore chồng lên DB có dữ liệu.
2. Chạy drill:

```powershell
$taskSecure = Read-Host 'S55_RESTORE_URL temp DB (không gửi trong chat)' -AsSecureString
$env:S55_RESTORE_URL = [System.Net.NetworkCredential]::new('', $taskSecure).Password
node scripts/s55-restore.mjs --file .git/s55-backups/s55-<stamp>.dump --yes
Remove-Item Env:S55_RESTORE_URL
```

3. Script kiểm: `pg_restore --list` đọc được TOC, `pg_restore --exit-on-error --no-owner` thành công (không `--clean/--drop/reset`), in số dòng `users/orders/order_items/payments/seats`.
4. Boot API trỏ vào temp DB, kiểm `/health` 200, mở catalog buyer thấy dữ liệu đã restore. Ghi ngày drill + file dump + kết quả vào evidence (không copy dữ liệu thật vào repo).
5. Đóng external IP allowance sau drill.

## 4. Tiêu chí Done S-55

* [ ] Job đêm chạy xanh 3 đêm liên tiếp, Artifact ngoài máy chủ đủ 3 bản.
* [ ] Chỉ giữ ≤14 bản (manifest + prune có test `node --test scripts/s55-retention.spec.mjs`).
* [ ] 1 drill restore lên DB tạm thành công + app chạy được với dữ liệu đó.
* [ ] Quy trình này đã có tóm tắt trong `README.md` (mục S-55).
