import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTailRuntimeEvidenceInvocation,
  buildWranglerTailArgs,
  parseTailRuntimeEvidenceArgs,
  resolveTailSearch,
} from "./tail-runtime-evidence.mjs";

const INVALID_FORMAT_RE = /Invalid --format/;
const UNKNOWN_OPTION_RE = /Unknown option/;
const UNKNOWN_WORKER_RE = /Unknown worker/;

test("builds the default gateway wrangler tail command from a client message selector", () => {
  const parsed = parseTailRuntimeEvidenceArgs(["--client-message", "cm_123"]);
  const invocation = buildTailRuntimeEvidenceInvocation(parsed);

  assert.deepEqual(
    {
      args: invocation.args,
      command: invocation.command,
      worker: invocation.worker,
      workerDir: invocation.workerDir,
      workerPathSuffix: invocation.workerPath.slice(-"services/gateway".length),
    },
    {
      args: ["tail", "--env", "prod", "--format", "json", "--search", "cm_123"],
      command: "pnpm",
      worker: "gateway",
      workerDir: "services/gateway",
      workerPathSuffix: "services/gateway",
    }
  );
});

test("supports the shared OpenMeld and Cloudflare runtime evidence selectors", () => {
  const selectors = [
    ["--space", "space_123", "space_123"],
    ["--source-signal", "sig_123", "sig_123"],
    ["--target-profile", "ap_123", "ap_123"],
    ["--dispatch", "dispatch_123", "dispatch_123"],
    ["--latest-attempt", "attempt_123", "attempt_123"],
    ["--claim-lease", "lease_123", "lease_123"],
    ["--binding", "binding_123", "binding_123"],
    ["--openmeld-service-runtime-id", "runtime_123", "runtime_123"],
    ["--agent-controller", "builtin:codex", "builtin:codex"],
    ["--result-ref", "result_123", "result_123"],
    ["--published-signal", "sig_reply_123", "sig_reply_123"],
    ["--reply-signal", "sig_reply_123", "sig_reply_123"],
    ["--request", "req_123", "req_123"],
    ["--trace", "trace_123", "trace_123"],
    ["--cf-ray", "cf_ray_123", "cf_ray_123"],
  ];

  for (const [flag, value, expectedSearch] of selectors) {
    assert.equal(
      resolveTailSearch(parseTailRuntimeEvidenceArgs([flag, value])),
      expectedSearch
    );
  }
});

test("lets raw search override selector flags", () => {
  const parsed = parseTailRuntimeEvidenceArgs([
    "--search",
    "core.openmeld.dispatch.queue_message_started",
    "--dispatch",
    "dispatch_123",
  ]);

  assert.equal(
    resolveTailSearch(parsed),
    "core.openmeld.dispatch.queue_message_started"
  );
});

test("builds tail args with explicit worker, env, format, and status", () => {
  const parsed = parseTailRuntimeEvidenceArgs([
    "--worker",
    "core",
    "--env",
    "prod",
    "--format",
    "pretty",
    "--status",
    "error",
    "--dispatch",
    "dispatch_123",
  ]);

  assert.deepEqual(buildWranglerTailArgs(parsed), [
    "tail",
    "--env",
    "prod",
    "--format",
    "pretty",
    "--search",
    "dispatch_123",
    "--status",
    "error",
  ]);
});

test("rejects invalid workers and invalid formats", () => {
  assert.throws(
    () =>
      buildTailRuntimeEvidenceInvocation(
        parseTailRuntimeEvidenceArgs(["--worker", "unknown"])
      ),
    UNKNOWN_WORKER_RE
  );
  assert.throws(
    () =>
      buildWranglerTailArgs(parseTailRuntimeEvidenceArgs(["--format", "xml"])),
    INVALID_FORMAT_RE
  );
  assert.throws(
    () => parseTailRuntimeEvidenceArgs(["--diagnostic-report", "diag_123"]),
    UNKNOWN_OPTION_RE
  );
});
