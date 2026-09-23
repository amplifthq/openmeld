// biome-ignore-all lint/suspicious/noMisplacedAssertion: Standalone compiled acceptance executable; failed assertions must exit nonzero.

// @ts-expect-error This native acceptance entry is compiled and executed by Bun.
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { invokeClaudeAgentSdkTransport } from "../../../../runtime/adapters/claude-code/src/transport/claude-agent-sdk-transport";
import { readOpenCodeSessionRows } from "../../src/agent-activity/opencode-storage";

// Separate compiled component acceptance, complementary to the actual shipped
// Service/Host artifact test. This entry is never included in product commands.
assert.equal(process.platform, "win32");
assert.ok(process.versions.bun);
assert.ok(process.env.OPENMELD_HOME);
const fixture = process.argv[2];
assert.ok(fixture);
const dbPath = join(process.cwd(), "opencode.db");
const database = new Database(dbPath, { create: true });
database.exec(
  "CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER, time_archived INTEGER)"
);
database
  .query("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)")
  .run("fixture-session", process.cwd(), "SQLite 中文", 1, 2, null);
database.close();
const hash = async () =>
  createHash("sha256")
    .update(await readFile(dbPath))
    .digest("hex");
const before = await hash();
assert.deepEqual(await readOpenCodeSessionRows(dbPath, "fixture-session"), [
  {
    id: "fixture-session",
    directory: process.cwd(),
    title: "SQLite 中文",
    time_created: 1,
    time_updated: 2,
    time_archived: null,
  },
]);
assert.deepEqual(await readOpenCodeSessionRows(dbPath, "' OR 1=1 --"), []);
assert.equal(await hash(), before);
console.log(JSON.stringify({ stage: "sqlite_readonly", status: "passed" }));

const result = await invokeClaudeAgentSdkTransport({
  launchContract: { kind: "executable", commandPath: fixture },
  claudeTimeoutMs: 30_000,
  claudeWorkdir: process.cwd(),
  prompt: "fixture request: 中文 & spaces",
  sessionId: null,
  env: process.env,
});
assert.equal(result.output, "fixture response: 中文 & spaces");
assert.equal(result.sessionId, "e09a1234-11d2-4efd-9d80-72cc8fb1ea08");
console.log(
  JSON.stringify({
    stage: "claude_sdk_native_protocol",
    status: "passed",
    inference: false,
  })
);
