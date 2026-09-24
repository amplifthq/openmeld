// biome-ignore-all lint/suspicious/noMisplacedAssertion: Compiled native acceptance; assertion failures must fail the job.
import assert from "node:assert/strict";
import { probeCodexAppServerAccount } from "../../../../runtime/adapters/codex/src/transport/codex-app-server-transport";

assert.equal(process.platform, "win32");
assert.ok(process.versions.bun);
assert.ok(process.env.CODEX_HOME);
const executable = process.argv[2];
assert.ok(executable);
// The real controller and real production adapter perform initialize,
// account/read, and owned shutdown. No authentication or model turn is sent.
const result = await probeCodexAppServerAccount({
  launchContract: { kind: "executable", commandPath: executable },
  timeoutMs: 30_000,
});
assert.equal(result.version, "0.153.4");
assert.equal(result.authStatus, "unauthenticated");
console.log(
  JSON.stringify({
    stage: "official_codex_account_protocol",
    status: "passed",
    version: result.version,
    inference: false,
  })
);
