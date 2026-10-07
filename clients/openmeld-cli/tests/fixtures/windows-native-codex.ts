// biome-ignore-all lint/suspicious/noMisplacedAssertion: Compiled native acceptance; assertion failures must fail the job.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { probeCodexAppServerAccount } from "../../../../runtime/adapters/codex/src/transport/codex-app-server-transport";
import { discoverCodexThreads } from "../../src/agent-activity/session-inventory-provider-adapters";
import { createDefaultRuntimeAgentControllerSettings } from "../../src/config/runtime-config";
import { resolveAgentControllerInterfaceSnapshot } from "../../src/local-service/inventory/agent-controller-interface";

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

// This entry is a GUI-subsystem binary, like the shipped Service. Piped stdio
// alone must not mask the regression by giving the parent a console.
const witness = process.argv[3];
assert.ok(witness);
const control = spawnSync(witness, ["--console-check"], {
  encoding: "utf8",
  windowsHide: false,
});
assert.ifError(control.error);
assert.equal(control.status, 0);
assert.equal(
  control.stdout.trim(),
  "console",
  "The positive control must allocate a console"
);
const launchContract = { kind: "executable" as const, commandPath: witness };
const snapshot = await resolveAgentControllerInterfaceSnapshot({
  agentControllerRef: "builtin:codex",
  state: {
    agentId: "codex",
    contextIdMappingSpec:
      createDefaultRuntimeAgentControllerSettings("codex").contextIdMappingSpec,
    detected: true,
    displayName: "Codex",
    enabled: true,
    installChoices: [],
    lifecycleStatus: "active",
    launchContract,
    launchStatus: "ready",
    launchStatusDetail: null,
    registered: true,
    registration: null,
    runtimeSupported: true,
    selectable: true,
    selectableReason: null,
    targetKind: "builtin",
    transportModes: [],
  },
});
assert.equal(snapshot.auth.status, "unauthenticated", JSON.stringify(snapshot));
assert.equal(snapshot.version, "0.153.4");
assert.deepEqual(
  await discoverCodexThreads({
    bindings: [],
    launchContract,
    nowMs: Date.now(),
    rootDir: process.env.OPENMELD_HOME,
  }),
  []
);
console.log(
  JSON.stringify({
    stage: "windows_background_controller_probes",
    status: "passed",
  })
);
