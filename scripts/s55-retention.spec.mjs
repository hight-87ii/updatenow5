// S-55 retention unit tests (pure logic, no DB/docker). Run: node --test scripts/s55-retention.spec.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Mirrors the prune rule in scripts/s55-backup.mjs: keep newest KEEP by lexicographic timestamp order.
export function pruneList(dumps, keep = 14) {
  const sorted = [...dumps].sort();
  if (sorted.length <= keep) return { kept: sorted, pruned: [] };
  return { kept: sorted.slice(sorted.length - keep), pruned: sorted.slice(0, sorted.length - keep) };
}

export function isBackupName(f) {
  return /^s55-.*\.dump$/.test(f);
}

describe("S-55 retention", () => {
  it("keeps the 14 newest, prunes the rest", () => {
    const dumps = Array.from({ length: 16 }, (_, i) => `s55-202610${String(i).padStart(2, "0")}.dump`);
    const { kept, pruned } = pruneList(dumps, 14);
    assert.equal(kept.length, 14);
    assert.equal(pruned.length, 2);
    assert.ok(!kept.includes(dumps[0]) && kept.includes(dumps[15]));
  });

  it("keeps everything when under the limit", () => {
    const { kept, pruned } = pruneList(["s55-a.dump", "s55-b.dump"], 14);
    assert.deepEqual(kept, ["s55-a.dump", "s55-b.dump"]);
    assert.deepEqual(pruned, []);
  });

  it("accepts only s55-*.dump names", () => {
    assert.equal(isBackupName("s55-20261008.dump"), true);
    assert.equal(isBackupName("staging-approved-run.dump"), false);
    assert.equal(isBackupName("s55-20261008.sql"), false);
  });

  it("backup script refuses to log connection strings (static guard)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["scripts/s55-backup.mjs", "scripts/s55-restore.mjs"]) {
      const src = readFileSync(f, "utf8");
      assert.ok(!src.includes("console.log(dbUrl") && !src.includes("console.log(target"),
        `${f} must never print the DB URL`);
    }
  });
});
