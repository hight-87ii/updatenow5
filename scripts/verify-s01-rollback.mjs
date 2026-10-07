#!/usr/bin/env node
// S-01 AC4 local rollback drill (no staging, no registry).
// Proves the failure-isolation pattern the staging runbook requires:
// a bad candidate image fails its own startup/health while the currently
// healthy service keeps serving /health 200 on 127.0.0.1:3001.
// Needs Docker + a healthy API (compose --profile app or pnpm dev).
// Run: node scripts/verify-s01-rollback.mjs
import { execFileSync, execSync } from "node:child_process";

const sh = (cmd, opts = {}) => execFileSync("sh", ["-c", cmd], { encoding: "utf8", ...opts });
const have = (cmd) => {
  try { execSync(cmd, { stdio: "ignore" }); return true; } catch { return false; }
};
const fetchHealth = async () => {
  const r = await fetch("http://127.0.0.1:3001/health", { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`old service health ${r.status}`);
  const body = await r.json().catch(() => ({}));
  if (body.status !== "ok") throw new Error(`old service body ${JSON.stringify(body)}`);
};

if (!have("docker --version")) {
  console.log("SKIP: docker unavailable; AC4 drill needs Docker. Old-version-keeps-serving not proven on this machine.");
  process.exit(0);
}
let oldHealthy = false;
try { await fetchHealth(); oldHealthy = true; }
catch { console.log("SKIP: no healthy API on 127.0.0.1:3001. Start `docker compose --profile app up -d --wait` or pnpm dev first."); process.exit(0); }

console.log("PASS: old service healthy before candidate (precondition for AC4)");
const badTag = "s01-bad-candidate:local";
const badName = "s01-bad-candidate-run";
try {
  sh(`docker build --target render -t ${badTag} .`, { timeout: 600000 });
  // SERVICE_ROLE=bogus makes deploy/render-start.mjs throw, so the candidate
  // exits while the old service keeps serving. The render stage ships entrypoint.
  sh(`docker rm -f ${badName} >/dev/null 2>&1 || true`);
  let badFailed = false;
  try {
    sh(`docker run -d --name ${badName} -e SERVICE_ROLE=bogus -e PORT=3999 -p 127.0.0.1:3999:3999 ${badTag}`);
    await new Promise((r) => setTimeout(r, 4000));
    const state = sh(`docker inspect -f '{{.State.Status}}:{{.State.ExitCode}}' ${badName}`).trim();
    console.log(`candidate container state: ${state}`);
    badFailed = !state.startsWith("running");
    if (!badFailed) {
      // Still running: prove it never becomes healthy, then stop it.
      let healthy = false;
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const res = await fetch("http://127.0.0.1:3999/health", { signal: AbortSignal.timeout(3000) });
          if (res.ok) { healthy = true; break; }
        } catch { /* expected */ }
      }
      badFailed = !healthy;
    }
  } finally {
    sh(`docker rm -f ${badName} >/dev/null 2>&1 || true`);
  }
  if (!badFailed) throw new Error("bad candidate unexpectedly became healthy; drill invalid");
  console.log("PASS: bad candidate isolated (never healthy, no traffic switch)");
  await fetchHealth();
  console.log("PASS: old service still 200 during/after candidate failure — AC4 pattern holds locally");
} catch (err) {
  console.error(`FAIL: AC4 drill — ${err.message}`);
  try { sh(`docker rm -f ${badName} >/dev/null 2>&1 || true`); } catch { /* noop */ }
  process.exit(1);
}
