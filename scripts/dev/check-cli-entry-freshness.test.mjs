import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CHECKER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "check-cli-entry-freshness.mjs"
);

test("check-cli-entry-freshness passes when dist is newer than source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openmeld-cli-freshness-"));
  try {
    const entryPath = join(dir, "dist", "openmeld-dev.js");
    const sourcePath = join(dir, "src", "index.ts");
    await mkdir(dirname(entryPath), { recursive: true });
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(entryPath, "console.log('dist')\n");
    await writeFile(sourcePath, "console.log('source')\n");

    const now = Date.now();
    await utimes(sourcePath, new Date(now - 2000), new Date(now - 2000));
    await utimes(entryPath, new Date(now), new Date(now));

    await execFileAsync(process.execPath, [
      CHECKER_PATH,
      entryPath,
      "pnpm --filter openmeld build",
      dirname(sourcePath),
    ]);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("check-cli-entry-freshness fails when source is newer than dist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openmeld-cli-freshness-"));
  try {
    const entryPath = join(dir, "dist", "openmeld-dev.js");
    const sourcePath = join(dir, "src", "index.ts");
    await mkdir(dirname(entryPath), { recursive: true });
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(entryPath, "console.log('dist')\n");
    await writeFile(sourcePath, "console.log('source')\n");

    const now = Date.now();
    await utimes(entryPath, new Date(now - 2000), new Date(now - 2000));
    await utimes(sourcePath, new Date(now), new Date(now));

    await assert.rejects(
      () =>
        execFileAsync(process.execPath, [
          CHECKER_PATH,
          entryPath,
          "pnpm --filter openmeld build",
          dirname(sourcePath),
        ]),
      (error) => {
        const stderr = String(error.stderr);
        assert.ok(stderr.includes("openmeld-dev build is stale"));
        assert.ok(stderr.includes("pnpm --filter openmeld build"));
        assert.ok(stderr.includes("index.ts"));
        return true;
      }
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
