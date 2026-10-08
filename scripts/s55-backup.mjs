#!/usr/bin/env node
// S-55: nightly PostgreSQL backup. No secrets in logs/repo.
// Usage:
//   $env:PGDATABASE = $env:DATABASE_URL   # never paste URL in chat/CLI history
//   node scripts/s55-backup.mjs [--dir .git/s55-backups] [--keep 14]
// Exit 0 + manifest.json on success. Prunes to the newest --keep dumps.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DIR = opt("--dir", ".git/s55-backups");
const KEEP = Math.max(1, parseInt(opt("--keep", "14"), 10) || 14);

const dbUrl = process.env.PGDATABASE || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("FAIL: set PGDATABASE (or DATABASE_URL) via hidden env prompt. Refusing to run without a target.");
  process.exit(1);
}

mkdirSync(DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "-").slice(0, 15) + "Z";
const file = `s55-${stamp}.dump`;
const absFile = join(DIR, file);

const have = (cmd) => {
  try {
    execFileSync(cmd[0], cmd.slice(1), { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

try {
  if (have(["pg_dump", "--version"])) {
    execFileSync("pg_dump", ["--format=custom", `--file=${absFile}`], {
      env: { ...process.env, PGDATABASE: dbUrl },
      stdio: "inherit",
    });
  } else if (have(["docker", "--version"])) {
    // Container reaches host-published postgres via host gateway; URL stays in env only.
    execFileSync(
      "docker",
      [
        "run", "--rm",
        "-e", "PGDATABASE",
        "--add-host=host.docker.internal:host-gateway",
        "--mount", `type=bind,source=${process.cwd()}/${DIR},target=/backup`,
        "postgres:15-alpine",
        "pg_dump", "--format=custom", `--file=/backup/${file}`,
      ],
      { env: { ...process.env, PGDATABASE: dbUrl }, stdio: "inherit" },
    );
  } else {
    throw new Error("neither pg_dump nor docker is available");
  }

  const buf = readFileSync(absFile);
  if (buf.length === 0) throw new Error("dump is empty");
  const sha256 = createHash("sha256").update(buf).digest("hex");
  writeFileSync(`${absFile}.sha256`, `${sha256}  ${file}\n`);

  // Manifest + prune to newest KEEP (lexicographic timestamp order).
  const dumps = readdirSync(DIR).filter((f) => /^s55-.*\.dump$/.test(f)).sort();
  const pruned = dumps.length > KEEP ? dumps.slice(0, dumps.length - KEEP) : [];
  for (const old of pruned) {
    rmSync(join(DIR, old), { force: true });
    rmSync(join(DIR, `${old}.sha256`), { force: true });
  }
  const kept = readdirSync(DIR).filter((f) => /^s55-.*\.dump$/.test(f)).sort();
  const manifest = kept.map((f) => ({ file: f, sha256File: `${f}.sha256` }));
  writeFileSync(join(DIR, "manifest.json"), `${JSON.stringify({ keep: KEEP, backups: manifest }, null, 2)}\n`);

  console.log(`S-55 backup OK: ${file} (${buf.length} bytes, sha256 ${sha256.slice(0, 12)}…), kept ${kept.length}/${KEEP}.`);
  if (pruned.length) console.log(`Pruned ${pruned.length} oldest: ${pruned.join(", ")}`);
} catch (err) {
  console.error(`FAIL: S-55 backup — ${err.message}`);
  rmSync(absFile, { force: true });
  process.exit(1);
}
