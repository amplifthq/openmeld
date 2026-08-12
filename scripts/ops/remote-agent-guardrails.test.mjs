import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  applyRemoteAgentPolicyChanges,
  buildUsageDiagnosticsDevInvocation,
  buildUsageDiagnosticsUrl,
  buildUsageDiagnosticsWorkerSource,
  buildUsageDiagnosticsWranglerConfig,
  formatPolicy,
  formatUsageDiagnostics,
  parseRemoteAgentOpsArgs,
  readRemoteAgentPolicy,
  resolveRemoteAgentServiceName,
  updateWranglerPolicyVars,
} from "./remote-agent-guardrails.mjs";

const CONFIG = `{
  "name": "openmeld-core",
  "vars": {
    "OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED": "true",
    "OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS": "",
    "CORS_ORIGINS": "http://localhost:8080"
  },
  "services": [
    {
      "binding": "OPENMELD_REMOTE_AGENT_WORKER",
      "service": "openmeld-remote-agent"
    }
  ],
  "env": {
    "prod": {
      "vars": {
        "OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED": "true",
        "OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS": "org_old",
        "CORS_ORIGINS": "https://gateway.openmeld.ai"
      },
      "services": [
        {
          "binding": "OPENMELD_REMOTE_AGENT_WORKER",
          "service": "openmeld-remote-agent-prod"
        }
      ]
    }
  }
}`;

const RUNTIME_DISABLED_RE = /"OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED": "false"/u;
const BLOCKED_ORGS_SORTED_RE =
  /"OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS": "org_new,org_old"/u;
const PROD_CORS_ORIGIN_RE =
  /"CORS_ORIGINS": "https:\/\/gateway\.openmeld\.ai"/u;
const BLOCKED_ORGS_NEW_ONLY_RE =
  /"OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS": "org_new"/u;
const SPACE_REQUIRED_RE = /--space/u;
const RUNTIME_CONVERSATION_REQUIRED_RE = /--runtime-conversation/u;
const READ_USAGE_DIAGNOSTICS_RE = /readUsageDiagnostics/u;
const REMOTE_AGENT_WORKER_BINDING_RE = /OPENMELD_REMOTE_AGENT_WORKER/u;
const USAGE_RECORD_COUNT_RE = /records: 1/u;
const USAGE_LATEST_TOTAL_TOKENS_RE = /latest total tokens: 42/u;

test("defaults to policy read on prod", () => {
  const parsed = parseRemoteAgentOpsArgs([]);
  assert.equal(parsed.action, "policy");
  assert.equal(parsed.env, "prod");
  assert.equal(parsed.remote, true);
});

test("accepts the pnpm run -- separator before the command", () => {
  const parsed = parseRemoteAgentOpsArgs(["--", "policy", "--env", "local"]);
  assert.equal(parsed.action, "policy");
  assert.equal(parsed.env, "local");
});

test("reads policy from the requested env vars", async () => {
  await withConfig(async (configPath) => {
    const policy = await readRemoteAgentPolicy({ configPath, env: "prod" });
    assert.equal(policy.runtimeEnabled, true);
    assert.deepEqual([...policy.blockedOrganizationIds], ["org_old"]);
  });
});

test("updates policy vars without touching unrelated vars", () => {
  const nextText = updateWranglerPolicyVars(CONFIG, "prod", {
    OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS: "org_new,org_old",
    OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: "false",
  });
  assert.match(nextText, RUNTIME_DISABLED_RE);
  assert.match(nextText, BLOCKED_ORGS_SORTED_RE);
  assert.match(nextText, PROD_CORS_ORIGIN_RE);
});

test("block and unblock org operations are stable and sorted", async () => {
  await withConfig(async (configPath) => {
    const blockParsed = parseRemoteAgentOpsArgs([
      "policy",
      "--config",
      configPath,
      "--block-org",
      "org_new",
    ]);
    const blockResult = await applyRemoteAgentPolicyChanges(blockParsed);
    assert.equal(blockResult.changed, true);
    assert.deepEqual(
      [...blockResult.policy.blockedOrganizationIds],
      ["org_new", "org_old"]
    );

    const unblockParsed = parseRemoteAgentOpsArgs([
      "policy",
      "--config",
      configPath,
      "--unblock-org",
      "org_old",
    ]);
    const unblockResult = await applyRemoteAgentPolicyChanges(unblockParsed);
    assert.deepEqual(
      [...unblockResult.policy.blockedOrganizationIds],
      ["org_new"]
    );

    const text = await readFile(configPath, "utf8");
    assert.match(text, BLOCKED_ORGS_NEW_ONLY_RE);
  });
});

test("dry-run policy write reports change without writing", async () => {
  await withConfig(async (configPath) => {
    const parsed = parseRemoteAgentOpsArgs([
      "policy",
      "--config",
      configPath,
      "--disable-runtime",
      "--dry-run",
    ]);
    const result = await applyRemoteAgentPolicyChanges(parsed);
    assert.equal(result.changed, true);
    assert.equal(result.dryRun, true);
    const policy = await readRemoteAgentPolicy({ configPath, env: "prod" });
    assert.equal(policy.runtimeEnabled, true);
  });
});

test("usage command requires a safe space id", () => {
  assert.throws(() => parseRemoteAgentOpsArgs(["usage"]), SPACE_REQUIRED_RE);
  assert.throws(
    () => parseRemoteAgentOpsArgs(["usage", "--space", "space';drop"]),
    SPACE_REQUIRED_RE
  );
  assert.throws(
    () => parseRemoteAgentOpsArgs(["usage", "--space", "space_123"]),
    RUNTIME_CONVERSATION_REQUIRED_RE
  );
});

test("usage diagnostics uses the remote-agent service binding target", () => {
  const config = JSON.parse(CONFIG);
  assert.equal(
    resolveRemoteAgentServiceName(config, "prod"),
    "openmeld-remote-agent-prod"
  );
  const source = buildUsageDiagnosticsWorkerSource();
  assert.match(source, READ_USAGE_DIAGNOSTICS_RE);
  assert.match(source, REMOTE_AGENT_WORKER_BINDING_RE);
  const wranglerConfig = JSON.parse(
    buildUsageDiagnosticsWranglerConfig("openmeld-remote-agent-prod")
  );
  assert.deepEqual(wranglerConfig.services, [
    {
      binding: "OPENMELD_REMOTE_AGENT_WORKER",
      service: "openmeld-remote-agent-prod",
    },
  ]);
});

test("usage dry-run formats the temporary wrangler dev command", () => {
  const invocation = buildUsageDiagnosticsDevInvocation({
    port: 8799,
    remote: true,
    wranglerConfigPath: "/tmp/wrangler.json",
  });
  assert.equal(invocation.command, "pnpm");
  assert.deepEqual(invocation.args.slice(0, 4), [
    "exec",
    "wrangler",
    "dev",
    "--config",
  ]);
  assert.ok(invocation.args.includes("--remote"));
  assert.equal(
    buildUsageDiagnosticsUrl({
      organizationId: "org_1",
      port: 8799,
      runtimeConversationId:
        "remote-agent-runtime-generation.v1|5:org_1|7:space_1|2",
      spaceId: "space_1",
    }),
    "http://127.0.0.1:8799/usage?spaceId=space_1&runtimeConversationId=remote-agent-runtime-generation.v1%7C5%3Aorg_1%7C7%3Aspace_1%7C2&organizationId=org_1"
  );
});

test("formats policy and usage diagnostics for operators", () => {
  assert.equal(
    formatPolicy({
      blockedOrganizationIds: new Set(["org_1"]),
      env: "prod",
      runtimeEnabled: false,
    }),
    [
      "Remote Agent policy (prod)",
      "  runtime: disabled",
      "  blocked organizations: org_1",
    ].join("\n")
  );

  const usage = formatUsageDiagnostics({
    dryRun: false,
    result: {
      records: [
        {
          submissionId: "sub_1",
          usage: { totalTokens: 42 },
        },
      ],
    },
    serviceName: "openmeld-remote-agent-prod",
  });
  assert.match(usage, USAGE_RECORD_COUNT_RE);
  assert.match(usage, USAGE_LATEST_TOTAL_TOKENS_RE);
});

async function withConfig(callback) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openmeld-ra-ops-"));
  const configPath = path.join(tempDir, "wrangler.jsonc");
  await writeFile(configPath, CONFIG, "utf8");
  try {
    await callback(configPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
