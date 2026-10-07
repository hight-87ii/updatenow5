# S-01 — staging gates trên nhánh `uds01` (repo-ready, chưa phải staging Done)

Ngày: 07/10/2026. Nhánh: `uds01`. Phạm vi đúng S-01 trong
[antigravity-prompts-sprint1.md](../antigravity-prompts-sprint1.md) §3, không mở rộng
nghiệp vụ, không đổi kiến trúc, không claim staging Done.

> Lưu ý nguồn sự thật: `AGENTS.md` dẫn `../docs/product.md`,
> `../docs/architecture.md`, `../docs/decision-log.md` ngoài Git root — các file này
> **không tồn tại** trong repository hiện tại nên không đối chiếu được ở lượt này
> ([CẦN CHỐT]: chủ repo xác nhận vị trí nguồn sự thật).

## 1. Đối chiếu 4 AC (trung thực)

| AC S-01 | Repo-ready trên `uds01` | Còn chờ ngoài repo ([CẦN CHỐT]) |
|---|---|---|
| 1. Merge → build/test/deploy auto + homepage 200 | CI có `build → lint → test → staging-gate` (`.github/workflows/ci.yml`); gate offline kiểm render.yaml, secret hygiene, compose, health contract. `render.yaml` giữ `autoDeployTrigger: off`; validator chấp nhận thêm `checksPass` đúng chuẩn Render "After CI Checks Pass" khi được duyệt. | Chủ repo: Blueprint sync lần đầu, 4 resource Free, bật `checksPass`, công bố URL staging + `/health` + `/api/health` thật, đo merge→health <10p. Chưa có URL nên AC1 **chưa Done**. |
| 2. Test fail chặn deploy | `staging-gate` khai `needs: [build, lint, test]` nên test đỏ thì gate không bao giờ chạy; PR proof lint đỏ đã có ở `docs/SPRINT1_LOCAL_EVIDENCE.md:10,40`. | Chủ repo đặt 4 required checks (`build-and-typecheck`, `lint`, `test`, **`S-01 / staging-gate`**) + demo PR lỗi bị `mergeable_state: blocked`. Lệnh mẫu ở mục 3. Chưa có bằng chứng protection nên AC2 **mới nửa**. |
| 3. Thành viên mới theo README chạy PG/Redis/API/web local | `pnpm setup:local` (1 lệnh install+generate+migrate) + `docker compose --profile app up -d --wait` boot đủ 4 service (profile `app`, mặc định vẫn chỉ PG/Redis nên flow TECH-01 cũ không đổi). `GET /health` 200 khi PG+Redis healthy, 503 khi lệ thuộc lỗi. | Không còn việc ngoài repo. Phần này **đạt local**. |
| 4. Deploy lỗi thì bản cũ vẫn chạy | `node scripts/verify-s01-rollback.mjs`: dựng candidate lỗi (`SERVICE_ROLE=bogus` trên stage `render`), chứng minh candidate không bao giờ healthy/no traffic-switch, service cũ vẫn `/health` 200. Rollback Render (Events → 1 trong 2 revision trước) + migration bù vẫn theo `docs/RENDER_FREE_RUNBOOK.md` §6. | Drill revision lỗi thật + Rollback trên Dashboard + SHA cũ healthy. Chưa deploy nên AC4 **chưa Done staging**. |

Kết luận giữ nguyên như đánh giá đầu vào: **S-01 PARTIALLY DONE local, staging fail**;
T-03 vẫn BLOCKED cho tới khi T-02 Done + có host/quyền staging.

## 2. File đổi trên `uds01` (repo-side, không deploy)

- `.github/workflows/ci.yml`: thêm job `S-01 / staging-gate` (`needs` 3 job T-02).
- `scripts/verify-s01-gates.mjs` (mới): 7 gate offline cho AC1/AC2/AC3 + ràng buộc secret.
- `scripts/verify-s01-rollback.mjs` (mới): drill AC4 local, SKIP rõ ràng khi thiếu Docker/API.
- `scripts/verify-render-profile.py`: cho phép `off|checksPass`, vẫn từ chối `commit`.
- `docker-compose.yml`: thêm service `api`/`web` dưới `profiles: [app]`, healthcheck qua `node fetch`,
  bind `127.0.0.1:3001/3000`, `depends_on` healthy; mặc định không đổi.
- `package.json`: thêm `setup:local`, `verify:s01`, `verify:rollback`.
- `docs/S01_STAGING_GATES.md` (file này) + `README.md` quickstart.

## 3. Việc chủ repo làm (không thuộc nhánh này)

```powershell
# 1) Required checks — chạy bằng tài khoản admin của repo/org:
gh api repos/TTCS-T926-K19C5-N2/thudemo/branches/main/protection `
  -f required_status_checks[strict]=true `
  -f required_status_checks[checks][][context]='T-02 / build-and-typecheck' `
  -f required_status_checks[checks][][context]='T-02 / lint' `
  -f required_status_checks[checks][][context]='T-02 / test' `
  -f required_status_checks[checks][][context]='S-01 / staging-gate'
# 2) Mở PR cố ý lỗi lint, xác nhận GitHub báo mergeable_state: blocked, rồi đóng PR không merge.
# 3) Render Dashboard (sau phê duyệt PO): tạo 4 resource Free Singapore theo runbook,
#    Blueprint sync đúng SHA đã review, bật Auto-Deploy = After CI Checks Pass
#    (sửa render.yaml autoDeployTrigger off -> checksPass trong PR riêng có review),
#    ghi URL staging + /health + /api/health thật.
# 4) AC4 staging: ghi SHA healthy, deploy 1 revision lỗi build/start/health đã cô lập,
#    xác minh SHA cũ vẫn healthy, Rollback về revision trước, rồi deploy revision hợp lệ.
```

## 4. Chạy kiểm local (đã/đang chạy ở lượt này)

```powershell
pnpm setup:local
node scripts/verify-s01-gates.mjs
python3 scripts/verify-render-profile.py
docker compose config --quiet
docker compose --profile app config --quiet
node scripts/verify-s01-rollback.mjs   # cần Docker + API healthy; SKIP nếu thiếu
```
