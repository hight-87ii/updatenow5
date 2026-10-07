#!/usr/bin/env node
// S-01 offline deploy-readiness gates. No network, no deploy, no secrets.
// Fails loudly when the repo is not ready for the owner-gated staging steps
// described in docs/S01_STAGING_GATES.md. Run: node scripts/verify-s01-gates.mjs
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const check = (label, fn) => {
  try {
    fn();
    console.log(`PASS: ${label}`);
  } catch (err) {
    failures.push(label);
    console.error(`FAIL: ${label} — ${err.message}`);
  }
};
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// AC1a: pipeline ordering — staging-gate blocked by build/lint/test.
check("ci: staging-gate needs build+lint+test", () => {
  const ci = read(".github/workflows/ci.yml");
  must(ci.includes("staging-gate:"), "staging-gate job missing");
  const gate = ci.slice(ci.indexOf("staging-gate:"));
  for (const job of ["build", "lint", "test"])
    must(gate.includes(job), `staging-gate must need ${job}`);
});

// AC1b: Render profile deployable shape, auto-deploy never "always on commit".
check("render.yaml: free shape + off|checksPass only", () => {
  const yaml = read("render.yaml");
  must(yaml.includes("plan: free"), "every resource must stay plan: free");
  must(yaml.includes("region: singapore"), "region must stay singapore");
  must(yaml.includes("healthCheckPath: /health"), "API healthCheckPath missing");
  must(yaml.includes("healthCheckPath: /api/health"), "web healthCheckPath missing");
  must(!/autoDeployTrigger:\s*["']?commit["']?/.test(yaml), "autoDeployTrigger=commit uploads on every commit; only off|checksPass allowed");
  must(/autoDeployTrigger:\s*["']?(off|checksPass)["']?/.test(yaml), "autoDeployTrigger must be off (current phase) or checksPass (after owner approval)");
  for (const banned of ["preDeployCommand", "disk:", "previews:", "schedule:", "registryCredential"])
    must(!yaml.includes(banned), `paid/unapproved key present: ${banned}`);
});

// AC1c/AC4: health contract + rollback policy presence.
check("health contract: api /health with 503 path + web proxy", () => {
  const api = read("apps/api/src/app.controller.ts");
  must(api.includes("@Get('health')"), "API GET /health missing");
  must(api.includes("ServiceUnavailableException"), "API /health must 503 when deps down");
  const proxy = read("apps/web/src/app/api/[...path]/route.ts");
  must(proxy.includes("proxyApi"), "web /api/* proxy missing (needed for /api/health)");
});

// AC2: failing tests cannot reach the gate — unit proof via needs + test cmd.
check("repo: test scripts exist for gate to block on", () => {
  const root = JSON.parse(read("package.json"));
  must(root.scripts?.test, "root pnpm test missing");
  const ci = read(".github/workflows/ci.yml");
  must(ci.includes("pnpm test") && ci.includes("test:e2e"), "CI must run unit + e2e before gate");
});

// AC3: one-command local boot wiring.
check("compose: infra required + app profile optional", () => {
  const compose = read("docker-compose.yml");
  must(compose.includes("postgres:"), "postgres service missing");
  must(compose.includes("redis:"), "redis service missing");
  must(compose.includes("pg_isready"), "postgres healthcheck missing");
  must(compose.includes("redis-cli"), "redis healthcheck missing");
  must(compose.includes("127.0.0.1:5432:5432"), "postgres must bind 127.0.0.1:5432");
  must(compose.includes("127.0.0.1:6379:6379"), "redis must bind 127.0.0.1:6379");
  must(compose.includes("profiles:"), "api/web must offer compose profile 'app' for one-command boot");
  must(compose.includes("app"), "compose profile 'app' missing");
  must(compose.includes("SERVICE_ROLE"), "app-profile services must set SERVICE_ROLE");
  must(/127\.0\.0\.1:3001:3001/.test(compose), "api profile must map 127.0.0.1:3001");
  must(/127\.0\.0.1:3000:3000/.test(compose), "web profile must map 127.0.0.1:3000");
});

// Ràng buộc S-01: no secrets in repo.
check("secrets: none committed, none in NEXT_PUBLIC_*", () => {
  const example = read(".env.example");
  must(!/NEXT_PUBLIC_.*(SECRET|PASSWORD|TOKEN|KEY)/i.test(example), "secret in NEXT_PUBLIC_*");
  must(!example.includes("dpg-") && !example.includes(".render.com"), "staging URL/secret leaked into example");
  for (const line of example.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const [k, v = ""] = t.split("=");
    // PAYMENT/MOMO/ACCOUNTANT là cấu hình cổng dev/test do S-18/S-19 quản lý
    // (mock bị cấm ở production bằng guard khởi động); gate S-01 chỉ soi
    // credential hạ tầng + URL staging thật.
    if (/^(PAYMENT_|MOMO_|ACCOUNTANT_)/.test(k)) continue;
    if (/PASSWORD|SECRET|ACCESS_KEY|SECRET_KEY/i.test(k))
      must(/<.*>/.test(v) || /mock|dev|example/i.test(v), `${k} looks like a real value; use <PLACEHOLDER> or dev-only`);
  }
  let tracked = "";
  try {
    tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
  } catch { /* git unavailable in some runners; skip tracked check */ }
  if (tracked) must(!tracked.split("\n").some((f) => f.trim() === ".env"), ".env is tracked; must stay git-ignored");
  const ignore = read(".gitignore");
  must(ignore.split("\n").some((l) => l.trim() === ".env"), ".gitignore must list .env");
  const docker = read("Dockerfile");
  must(!/COPY.*\.env/i.test(docker), "Dockerfile must not COPY .env");
  must(/USER node/.test(docker), "runtime images must drop to USER node");
});

// Dockerfile targets needed for both local profile and Render.
check("dockerfile: api/web/migration/render targets", () => {
  const docker = read("Dockerfile");
  for (const stage of ["AS api", "AS web", "AS migration", "AS render"])
    must(docker.includes(stage), `Docker stage missing: ${stage}`);
});

if (failures.length) {
  console.error(`\nS-01 gates: ${failures.length} FAILING — see docs/S01_STAGING_GATES.md`);
  process.exit(1);
}
console.log("\nS-01 gates: all PASS (offline; not staging evidence)");
