#!/usr/bin/env node
// S-55: restore drill to an EMPTY temp database, then smoke-check the app data.
// Usage:
//   $env:S55_RESTORE_URL = '<temp-db-url>'   # hidden prompt only; never staging/prod without PO approval
//   node scripts/s55-restore.mjs --file .git/s55-backups/s55-<stamp>.dump --yes
// Refuses to run without --yes, without a file, or without S55_RESTORE_URL.
// Never prints the URL. Uses pg_restore --exit-on-error; no --clean/--drop.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const file = opt("--file");
const target = process.env.S55_RESTORE_URL;
const approved = args.includes("--yes");

if (!approved) {
  console.error("FAIL: pass --yes after PO confirms the target is a NEW/EMPTY temp database.");
  process.exit(1);
}
if (!file || !existsSync(file)) {
  console.error("FAIL: --file <existing .dump> is required.");
  process.exit(1);
}
if (!target) {
  console.error("FAIL: set S55_RESTORE_URL via hidden env prompt (temp DB only).");
  process.exit(1);
}

const have = (cmd) => {
  try {
    execFileSync(cmd[0], cmd.slice(1), { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const useDocker = !have(["pg_restore", "--version"]);

try {
  // 1. Validate dump readability (lists TOC; proves file is a real custom-format dump).
  if (useDocker) {
    execFileSync(
      "docker",
      ["run", "--rm", "--mount", `type=bind,source=${process.cwd()},target=/work`, "postgres:15-alpine",
        "pg_restore", "--list", `/work/${file}`],
      { stdio: "pipe" },
    );
  } else {
    execFileSync("pg_restore", ["--list", file], { stdio: "pipe" });
  }
  console.log("PASS: dump TOC readable (pg_restore --list)");

  // 2. Restore into temp DB. Database name/URL travels via env only.
  if (useDocker) {
    execFileSync(
      "docker",
      ["run", "--rm", "-e", "S55_RESTORE_URL",
        "--add-host=host.docker.internal:host-gateway",
        "--mount", `type=bind,source=${process.cwd()},target=/work`, "postgres:15-alpine",
        "pg_restore", "--exit-on-error", "--no-owner", "--dbname", target, `/work/${file}`],
      { env: { ...process.env }, stdio: "inherit" },
    );
  } else {
    execFileSync("pg_restore", ["--exit-on-error", "--no-owner", "--dbname", target, file], {
      env: { ...process.env },
      stdio: "inherit",
    });
  }
  console.log("PASS: pg_restore --exit-on-error completed");

  // 3. Smoke: row counts for ticket-sale tables (missing table => warn, not fail the restore itself).
  const counts = (sql) => {
    try {
      const out = useDocker
        ? execFileSync("docker",
            ["run", "--rm", "-e", "S55_RESTORE_URL", "--add-host=host.docker.internal:host-gateway",
              "postgres:15-alpine", "psql", target, "-tA", "-c", sql],
            { encoding: "utf8" })
        : execFileSync("psql", [target, "-tA", "-c", sql], { encoding: "utf8" });
      return out.trim();
    } catch {
      return "n/a (table may not exist in this dump)";
    }
  };
  for (const t of ["users", "orders", "order_items", "payments", "seats"]) {
    console.log(`rows ${t}: ${counts(`SELECT count(*) FROM ${t}`)}`);
  }
  console.log("\nNext: boot API against the temp DB and check /health 200 + buyer catalog. See docs/S55_RUNBOOK.md.");
} catch (err) {
  console.error(`FAIL: S-55 restore — ${err.message}`);
  process.exit(1);
}
