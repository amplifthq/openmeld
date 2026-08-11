import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  cleanupExpiredWranglerDebugLogs,
  resolveDefaultWranglerDebugLogDirectory,
  resolveWranglerDebugLogDirectory,
} from "./wrangler-log-retention.mjs";

test("cleans only expired wrangler debug log files", () => {
  const fixture = createFixtureDirectory();
  const nowMs = Date.UTC(2026, 4, 14, 12, 0, 0);
  const oldWranglerLog = join(fixture, "wrangler-2026-05-10_00-00-00_000.log");
  const recentWranglerLog = join(
    fixture,
    "wrangler-2026-05-13_00-00-00_000.log"
  );
  const todayWranglerLog = join(
    fixture,
    "wrangler-2026-05-14_00-00-00_000.log"
  );
  const unrelatedLog = join(fixture, "wrangler-debug.log");
  const localStateDirectory = join(fixture, "d1");

  try {
    writeFileWithMtime(oldWranglerLog, nowMs - 4 * 24 * 60 * 60 * 1000);
    writeFileWithMtime(recentWranglerLog, nowMs - 1 * 24 * 60 * 60 * 1000);
    writeFileWithMtime(todayWranglerLog, nowMs);
    writeFileWithMtime(unrelatedLog, nowMs - 10 * 24 * 60 * 60 * 1000);
    mkdirSync(localStateDirectory);

    const result = cleanupExpiredWranglerDebugLogs({
      env: {
        WRANGLER_LOG_PATH: fixture,
      },
      nowMs,
    });

    assert.equal(result.deletedCount, 1);
    assert.deepEqual(readdirSync(fixture).sort(), [
      "d1",
      "wrangler-2026-05-13_00-00-00_000.log",
      "wrangler-2026-05-14_00-00-00_000.log",
      "wrangler-debug.log",
    ]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("reports a missing wrangler log directory without creating it", () => {
  const fixture = createFixtureDirectory();
  const missingDirectory = join(fixture, "missing");

  try {
    const result = cleanupExpiredWranglerDebugLogs({
      env: {
        WRANGLER_LOG_PATH: missingDirectory,
      },
      nowMs: Date.UTC(2026, 4, 14, 12, 0, 0),
    });

    assert.deepEqual(result, {
      deletedCount: 0,
      directoryExists: false,
      failedCount: 0,
      logDirectory: missingDirectory,
      retentionDays: 3,
    });
    assert.deepEqual(readdirSync(fixture), []);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("resolves default wrangler log paths by platform", () => {
  assert.equal(
    resolveDefaultWranglerDebugLogDirectory({
      homeDir: "/Users/tester",
      platform: "darwin",
    }),
    "/Users/tester/Library/Preferences/.wrangler/logs"
  );
  assert.equal(
    resolveDefaultWranglerDebugLogDirectory({
      env: {
        XDG_CONFIG_HOME: "/config",
      },
      homeDir: "/home/tester",
      platform: "linux",
    }),
    "/config/.wrangler/logs"
  );
});

test("resolves WRANGLER_LOG_PATH file paths to their parent directory", () => {
  assert.equal(
    resolveWranglerDebugLogDirectory({
      env: {
        WRANGLER_LOG_PATH: "/tmp/wrangler.log",
      },
    }),
    "/tmp"
  );
});

function createFixtureDirectory() {
  return mkdtempSync(join(tmpdir(), "openmeld-wrangler-log-retention-"));
}

function writeFileWithMtime(filePath, mtimeMs) {
  writeFileSync(filePath, "debug log\n");
  const time = new Date(mtimeMs);
  utimesSync(filePath, time, time);
}
