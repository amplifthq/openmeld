#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { publishGuardedLocalReleaseEvidence } from "./production-release-evidence.mjs";
import {
  acquireProductionScopeLease,
  releaseProductionScopeLease,
} from "./production-scope-lease.mjs";
import { runCliRelease } from "./release-cli.mjs";
import {
  isCliReleasePath,
  isServiceReleasePath,
  isSkillsReleasePath,
} from "./release-ready-paths.mjs";
import { readCurrentWorkerVersionIds } from "./release-stage-probes.mjs";
import { requireMainlineReleaseSha } from "./require-mainline-release-sha.mjs";

const DEFAULT_BASE_REF = "origin/main";
const COMPLETION_PROBE_TIMEOUT_MS = 30_000;
const LINE_SPLIT_REGEX = /\r?\n/u;
const TEST_FILE_REGEX =
  /(?:^|\/)[^/]+\.(?:integration\.)?(?:spec|test)\.[cm]?[jt]sx?$/u;
const VITEST_CONFIG_REGEX = /(?:^|\/)vitest\.[^/]+config\.[cm]?[jt]s$/u;
const RELEASE_COMMANDS = new Set(["deploy", "plan", "preflight", "verify"]);
const DIRECT_SCOPES = new Set([
  "auth",
  "cli",
  "core",
  "db",
  "gateway",
  "remote-agent",
  "web",
]);
const CLOUD_SCOPES = ["auth", "web", "gateway", "core", "remote-agent"];
const FULL_SCOPES = ["db", ...CLOUD_SCOPES];
const SCOPE_ORDER = [
  "db",
  "cli",
  "auth",
  "web",
  "gateway",
  "core",
  "remote-agent",
];
const REMOTE_AGENT_RECEIVER_FIRST_SCOPE_ORDER = [
  "db",
  "remote-agent",
  "auth",
  "core",
  "gateway",
  "web",
  "cli",
];
const CENTER_AGENT_CLI_RECEIVER_FIRST_SCOPE_ORDER = [
  "db",
  "remote-agent",
  "auth",
  "core",
  "gateway",
  "web",
  "cli",
];
const CORE_WORKER_RESPONSE_READER_FIRST_SCOPE_ORDER = [
  "db",
  "auth",
  "core",
  "remote-agent",
  "gateway",
  "web",
  "cli",
];
const INBOX_SOURCE_TARGET_RECEIVER_FIRST_SCOPE_ORDER = [
  "db",
  "auth",
  "web",
  "gateway",
  "core",
  "remote-agent",
  "cli",
];
const LOCAL_SERVICE_RUNTIME_RECEIVER_FIRST_SCOPE_ORDER = [
  "db",
  "auth",
  "web",
  "gateway",
  "core",
  "remote-agent",
  "cli",
];
const WAKE_PROGRESS_OPT_IN_RECEIVERS_FIRST_SCOPE_ORDER =
  LOCAL_SERVICE_RUNTIME_RECEIVER_FIRST_SCOPE_ORDER;
const SPACE_HISTORY_QUERY_RECEIVERS_FIRST_SCOPE_ORDER =
  LOCAL_SERVICE_RUNTIME_RECEIVER_FIRST_SCOPE_ORDER;
const CONNECT_COMPUTER_CLI_RECEIVER_FIRST_SCOPE_ORDER = [
  "db",
  "auth",
  "cli",
  "web",
  "gateway",
  "core",
  "remote-agent",
];
const REMOTE_AGENT_AND_INBOX_RECEIVERS_FIRST_SCOPE_ORDER = [
  "db",
  "remote-agent",
  "auth",
  "web",
  "gateway",
  "core",
  "cli",
];
const REMOTE_AGENT_AND_CONNECT_COMPUTER_RECEIVERS_FIRST_SCOPE_ORDER = [
  "db",
  "remote-agent",
  "auth",
  "cli",
  "web",
  "gateway",
  "core",
];
const REMOTE_AGENT_AND_WAKE_PROGRESS_OPT_IN_RECEIVERS_FIRST_SCOPE_ORDER =
  REMOTE_AGENT_AND_INBOX_RECEIVERS_FIRST_SCOPE_ORDER;
const CORE_WORKER_RESPONSE_AND_WAKE_PROGRESS_OPT_IN_RECEIVERS_FIRST_SCOPE_ORDER =
  LOCAL_SERVICE_RUNTIME_RECEIVER_FIRST_SCOPE_ORDER;
const CORE_WORKER_RESPONSE_AND_CONNECT_COMPUTER_RECEIVERS_FIRST_SCOPE_ORDER =
  CONNECT_COMPUTER_CLI_RECEIVER_FIRST_SCOPE_ORDER;
const DEPLOY_SCOPE_ORDER_BY_PROFILE = {
  "space-invitation-receivers-first": [
    "db",
    "core",
    "auth",
    "gateway",
    "web",
    "remote-agent",
    "cli",
  ],
  "center-agent-cli-receiver-first":
    CENTER_AGENT_CLI_RECEIVER_FIRST_SCOPE_ORDER,
  "connect-computer-cli-receiver-first":
    CONNECT_COMPUTER_CLI_RECEIVER_FIRST_SCOPE_ORDER,
  "core-worker-response-and-connect-computer-receivers-first":
    CORE_WORKER_RESPONSE_AND_CONNECT_COMPUTER_RECEIVERS_FIRST_SCOPE_ORDER,
  "core-worker-response-reader-first":
    CORE_WORKER_RESPONSE_READER_FIRST_SCOPE_ORDER,
  "core-worker-response-and-wake-progress-opt-in-receivers-first":
    CORE_WORKER_RESPONSE_AND_WAKE_PROGRESS_OPT_IN_RECEIVERS_FIRST_SCOPE_ORDER,
  "wake-progress-opt-in-receivers-first":
    WAKE_PROGRESS_OPT_IN_RECEIVERS_FIRST_SCOPE_ORDER,
  "space-history-query-receivers-first":
    SPACE_HISTORY_QUERY_RECEIVERS_FIRST_SCOPE_ORDER,
  "default-auth-receiver-first": SCOPE_ORDER,
  "inbox-source-target-receiver-first":
    INBOX_SOURCE_TARGET_RECEIVER_FIRST_SCOPE_ORDER,
  "local-service-runtime-receiver-first":
    LOCAL_SERVICE_RUNTIME_RECEIVER_FIRST_SCOPE_ORDER,
  "remote-agent-and-inbox-receivers-first":
    REMOTE_AGENT_AND_INBOX_RECEIVERS_FIRST_SCOPE_ORDER,
  "remote-agent-and-connect-computer-receivers-first":
    REMOTE_AGENT_AND_CONNECT_COMPUTER_RECEIVERS_FIRST_SCOPE_ORDER,
  "remote-agent-and-wake-progress-opt-in-receivers-first":
    REMOTE_AGENT_AND_WAKE_PROGRESS_OPT_IN_RECEIVERS_FIRST_SCOPE_ORDER,
  "remote-agent-receiver-first": REMOTE_AGENT_RECEIVER_FIRST_SCOPE_ORDER,
};
const INBOX_SOURCE_TARGET_SCHEMA_PATH =
  "packages/schemas/src/schemas/http/inbox.ts";
const WAKE_PROGRESS_SCHEMA_PATH =
  "packages/schemas/src/schemas/http/space-wake-progress.ts";
const SPACE_HISTORY_QUERY_SCHEMA_PATH =
  "packages/schemas/src/schemas/http/list-signals-query.ts";
const WAKE_PROGRESS_CLI_CALLER_PATH =
  "clients/openmeld-cli/src/space/wake-control-command.ts";
const WAKE_PROGRESS_CORE_PRODUCER_PATHS = new Set([
  "services/core/src/rpc/methods.ts",
  "services/core/src/space/transport/do/space.ts",
]);
const INBOX_SOURCE_TARGET_WRITER_PATHS = new Set([
  "services/core/src/remote-agent/application/native-delivery-inbox-producer.ts",
  "services/core/src/remote-agent/application/native-delivery-service.ts",
  "services/core/src/remote-agent/application/slack-inbox-source-target.ts",
  "services/core/src/runtime-transport/application/runtime-coordinator-interaction-inbox-producer.ts",
]);
const INBOX_SOURCE_TARGET_REQUIRED_SCOPES = ["web", "gateway", "core"];
const LOCAL_SERVICE_RUNTIME_TRANSPORT_SCHEMA_PATH =
  "packages/schemas/src/schemas/daemon/runtime-transport.ts";
const LOCAL_SERVICE_RUNTIME_CORE_RECEIVER_PATH_PREFIX =
  "services/core/src/runtime-transport/";
const LOCAL_SERVICE_RUNTIME_PRODUCER_PATH_PREFIX =
  "clients/openmeld-cli/src/local-service/";
const CONNECT_COMPUTER_DEVICE_AUTH_SCHEMA_PATH =
  "packages/schemas/src/schemas/http/auth-device-authorization.ts";
const CONNECT_COMPUTER_CLI_RECEIVER_PATH =
  "clients/openmeld-cli/src/openmeld.ts";
const CONNECT_COMPUTER_WEB_PRODUCER_PATH =
  "clients/web/src/lib/cli-entry-command.ts";
const REMOTE_AGENT_RECEIVER_FIRST_CONTRACT_PATHS = new Set([
  "services/remote-agent/.flue/cloudflare.ts",
  "services/remote-agent/flue-adapter/cloudflare-entrypoint.ts",
  "services/remote-agent/flue-adapter/execution-reconciliation.ts",
]);
const REMOTE_AGENT_WORKER_RESPONSE_SCHEMA_PATH =
  "packages/schemas/src/schemas/runtime/remote-agent-worker.ts";
const REMOTE_AGENT_WORKER_REQUEST_SCHEMA_PATHS = new Set([
  REMOTE_AGENT_WORKER_RESPONSE_SCHEMA_PATH,
  "packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts",
]);
const REMOTE_AGENT_WORKER_RESPONSE_PRODUCER_PATHS = new Set([
  "services/remote-agent/.flue/agents/center-agent.ts",
]);
const REMOTE_AGENT_WORKER_REQUEST_PRODUCER_PATHS = new Set([
  "services/core/src/remote-agent/application/remote-agent-conversation-continuity.ts",
  "services/core/src/remote-agent/application/remote-agent-worker-admission.ts",
  "services/core/src/remote-agent/application/slack-signal-service.ts",
]);
const REMOTE_AGENT_WORKER_REQUEST_RECEIVER_PATH =
  "services/remote-agent/.flue/agents/center-agent.ts";
const PACKAGE_SCOPE = new Map([
  ["@openmeld/auth-worker", "auth"],
  ["@openmeld/core", "core"],
  ["@openmeld/gateway", "gateway"],
  ["@openmeld/remote-agent", "remote-agent"],
  ["openmeld", "cli"],
  ["openmeld-web", "web"],
]);
const DB_MIGRATION_PATH_PREFIX = "packages/db/drizzle/";
const DB_SCHEMA_PATH_PREFIXES = [
  "packages/db/src/auth/",
  "packages/db/src/core/",
];
const DB_SCHEMA_PATHS = new Set([
  "packages/db/src/auth.ts",
  "packages/db/src/core.ts",
  "packages/db/src/schema.ts",
]);
const DEPENDENCY_RULE_PATHS = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
]);
const GLOBAL_WORKSPACE_RUNTIME_PATHS = new Set([
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
]);
const SCOPE_VERIFY_SPECS = {
  auth: {
    filter: "@openmeld/auth-worker...",
    label: "Verify Auth Worker",
    tasks: ["check", "test", "test:runtime"],
  },
  cli: {
    filter: "openmeld...",
    label: "Verify CLI and local components",
    tasks: ["check", "test", "test:integration"],
  },
  core: {
    filter: "@openmeld/core...",
    label: "Verify Core Worker",
    tasks: ["check", "test", "test:integration"],
  },
  gateway: {
    filter: "@openmeld/gateway...",
    label: "Verify Gateway Worker",
    tasks: ["check", "test"],
  },
  "remote-agent": {
    filter: "@openmeld/remote-agent...",
    label: "Verify Remote Agent Worker",
    tasks: ["check", "test"],
  },
  web: {
    filter: "openmeld-web...",
    label: "Verify Web",
    tasks: ["check", "test", "test:integration"],
  },
};

export function parseProductionReleaseArgs(argv) {
  const command = argv[0];
  if (!RELEASE_COMMANDS.has(command)) {
    throw new Error(
      "Production release command must be one of: plan, verify, preflight, deploy."
    );
  }

  const options = {
    base: process.env.OPENMELD_RELEASE_BASE ?? DEFAULT_BASE_REF,
    command,
    json: false,
    scope: "auto",
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--base") {
      index += 1;
      options.base = readRequiredArgument(argv, index, arg);
      continue;
    }
    if (arg === "--scope") {
      index += 1;
      options.scope = readRequiredArgument(argv, index, arg);
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    throw new Error(`Unknown production release option: ${arg}`);
  }
  return options;
}

export function expandRequestedReleaseScopes(scope) {
  const normalized = String(scope).trim();
  if (normalized === "auto") {
    return null;
  }
  if (normalized === "cloud") {
    return [...CLOUD_SCOPES];
  }
  if (normalized === "full") {
    return [...FULL_SCOPES];
  }

  const requested = normalized
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (requested.length === 0) {
    throw new Error("Production release scope cannot be empty.");
  }
  for (const value of requested) {
    if (!DIRECT_SCOPES.has(value)) {
      throw new Error(
        `Unknown production release scope: ${value}. Use auto, cloud, full, or a comma-separated list of ${[...DIRECT_SCOPES].join(", ")}.`
      );
    }
  }
  return sortScopes(requested);
}

export function resolveAutomaticReleaseScopes(input) {
  const scopes = new Set();
  for (const packageName of input.affectedPackages) {
    const scope = PACKAGE_SCOPE.get(packageName);
    if (scope) {
      scopes.add(scope);
    }
  }

  if (input.changedPaths.some(isDatabaseSchemaPath)) {
    scopes.add("db");
  }
  if (
    input.changedPaths.some(
      (path) =>
        isCliReleasePath(path) ||
        isServiceReleasePath(path) ||
        isSkillsReleasePath(path)
    )
  ) {
    scopes.add("cli");
  }
  if (isInboxSourceTargetReceiverFirstDiff(input.changedPaths)) {
    for (const scope of INBOX_SOURCE_TARGET_REQUIRED_SCOPES) {
      scopes.add(scope);
    }
  }
  if (isConnectComputerCliReceiverFirstDiff(input.changedPaths)) {
    scopes.add("cli");
    scopes.add("web");
  }
  if (isWakeProgressOptInContractDiff(input.changedPaths)) {
    scopes.add("gateway");
    scopes.add("core");
  }
  if (isSpaceHistoryQueryContractDiff(input.changedPaths)) {
    scopes.add("cli");
    scopes.add("gateway");
    scopes.add("core");
  }

  return sortScopes(scopes);
}

export function buildProductionVerifyStepSpecs(input) {
  const steps = buildCommonReleaseStepSpecs(input.changedPaths);

  if (input.scopes.some((scope) => scope === "auth" || scope === "gateway")) {
    steps.push({
      args: ["turbo", "run", "build", "--filter=@openmeld/core^..."],
      command: "pnpm",
      label: "Build Core service-binding dependencies",
    });
  }

  for (const scope of sortScopes(input.scopes)) {
    if (scope === "db") {
      steps.push(
        {
          args: ["db:check"],
          command: "pnpm",
          label: "Check database migration truth",
        },
        {
          args: ["--filter", "@openmeld/db", "test"],
          command: "pnpm",
          label: "Test database tooling",
        }
      );
      continue;
    }
    const spec = SCOPE_VERIFY_SPECS[scope];
    if (!spec) {
      continue;
    }
    if (
      scope === "core" &&
      !input.scopes.includes("cli") &&
      !isSpaceInvitationReceiverFirstDiff(input.changedPaths)
    ) {
      steps.push(coreCliChannelCompatibilityStep());
    }
    steps.push({
      args: [
        "turbo",
        "run",
        ...spec.tasks,
        `--filter=${spec.filter}`,
        "--concurrency=2",
      ],
      command: "pnpm",
      label: spec.label,
    });
    if (scope === "cli") {
      steps.push(cliReleaseMetadataStep());
    }
  }
  return steps;
}

export function buildProductionPreflightStepSpecs(input) {
  const steps = buildCommonReleaseStepSpecs(input.changedPaths);
  if (input.scopes.includes("gateway")) {
    steps.push(productionQueueVerificationStep("gateway"));
  }
  if (input.scopes.some((scope) => scope === "cli" || scope === "core")) {
    steps.push(productionQueueVerificationStep("core"));
  }
  if (
    input.scopes.includes("core") &&
    !input.scopes.includes("cli") &&
    !isSpaceInvitationReceiverFirstDiff(input.changedPaths)
  ) {
    steps.push(coreCliChannelCompatibilityStep());
  }
  return steps;
}

export function buildCoreCurrentCliProjectionPreflightStepSpecs(
  changedPaths = []
) {
  return [
    ...buildCommonReleaseStepSpecs(changedPaths),
    productionQueueVerificationStep("core"),
  ];
}

export function runCoreCurrentCliProjectionPreflight(input = {}) {
  const executeStep = input.runStep ?? runStep;
  for (const step of buildCoreCurrentCliProjectionPreflightStepSpecs(
    input.changedPaths
  )) {
    executeStep(step);
  }
}

function productionQueueVerificationStep(scope) {
  return {
    args: [
      "run",
      "verify:cloudflare:production-queues",
      "--",
      `services/${scope}/wrangler.jsonc`,
    ],
    command: "pnpm",
    controlArgs: [`services/${scope}/wrangler.jsonc`],
    controlCommand: "node",
    controlNodeArgs: ["--experimental-strip-types"],
    controlPath: "scripts/cloudflare/verify-production-queues.mjs",
    label: `Verify production ${scope === "core" ? "Core" : "Gateway"} Queue resources`,
  };
}

function buildCommonReleaseStepSpecs(changedPaths) {
  const steps = [
    {
      args: [
        "run",
        "verify:cloudflare:env-contract",
        "--",
        "--profile",
        "production",
      ],
      command: "pnpm",
      controlArgs: ["--profile", "production"],
      controlCommand: "node",
      controlNodeArgs: ["--experimental-strip-types"],
      controlPath: "scripts/cloudflare/verify-worker-env-contract.mjs",
      label: "Verify Cloudflare environment contracts",
    },
    {
      args: ["scripts/ci/check-retired-identifiers.sh"],
      command: "bash",
      controlArgs: [],
      controlCommand: "bash",
      controlNodeArgs: [],
      controlPath: "scripts/ci/check-retired-identifiers.sh",
      label: "Check retired identifiers",
    },
  ];

  if (changedPaths.some((path) => DEPENDENCY_RULE_PATHS.has(path))) {
    steps.push({
      args: ["sherif"],
      command: "pnpm",
      label: "Check dependency rules",
    });
  }

  return steps;
}

export function buildProductionDeployStepSpecs(scopes, input = {}) {
  const selected = new Set(scopes);
  const steps = [];
  const changedPaths = input.changedPaths ?? [];
  assertConnectComputerReleaseScopes(scopes, changedPaths);
  assertInboxSourceTargetReleaseScopes(scopes, changedPaths);
  assertLocalServiceRuntimeReleaseScopes(scopes, changedPaths);
  assertWakeProgressOptInContractReleaseScopes(scopes, changedPaths);
  assertSpaceHistoryQueryReleaseScopes(scopes, changedPaths);
  const deployOrderProfile = resolveProductionDeployOrderProfile(changedPaths);
  if (
    deployOrderProfile === "space-invitation-receivers-first" &&
    (selected.has("auth") || selected.has("cli")) &&
    !(selected.has("core") && selected.has("auth"))
  ) {
    throw new Error(
      "Space invitation release requires Core and Auth receivers before publishing its CLI caller."
    );
  }
  const orderedScopes = resolveProductionDeployScopeOrder(scopes, changedPaths);
  assertWakeProgressOptInDeployOrder(orderedScopes, changedPaths);
  assertSpaceHistoryQueryDeployOrder(orderedScopes, changedPaths);
  for (const scope of orderedScopes) {
    appendProductionDeployScopeSteps({
      deployOrderProfile,
      releaseSha: input.releaseSha,
      scope,
      selected,
      steps,
    });
  }
  if (selected.has("cli")) {
    steps.push({
      internalOperation: "publish-cli",
      label: "Verify final R2/npm/Core alignment",
    });
  }
  return steps;
}

function appendProductionDeployScopeSteps(input) {
  if (input.scope === "db") {
    input.steps.push({
      args: ["db:release:prod"],
      command: "pnpm",
      label: "Synchronize production database",
    });
    return;
  }
  if (input.scope === "cli") {
    input.steps.push({
      internalOperation: "publish-cli",
      label: "Publish CLI and deploy its Core release projection",
    });
    return;
  }
  if (input.scope === "web") {
    input.steps.push(
      packageDeployStep("openmeld-web", "Deploy Web", {
        args: ["--config", "clients/web/wrangler.jsonc", "--env", "prod"],
      }),
      publicHealthStep("https://openmeld.ai/guide.md", "Verify Web health")
    );
    return;
  }
  if (input.scope === "gateway") {
    input.steps.push(
      packageDeployStep("@openmeld/gateway", "Deploy Gateway Worker", {
        args: ["--config", "services/gateway/wrangler.jsonc", "--env", "prod"],
      }),
      publicHealthStep(
        "https://gateway.openmeld.ai/health",
        "Verify Gateway Worker health"
      )
    );
    return;
  }
  if (input.scope === "auth") {
    input.steps.push(
      packageDeployStep("@openmeld/auth-worker", "Deploy Auth Worker", {
        args: ["--config", "services/auth/wrangler.jsonc", "--env", "prod"],
      }),
      publicHealthStep(
        "https://auth.openmeld.ai/health",
        "Verify Auth Worker health"
      )
    );
    return;
  }
  if (input.scope === "core") {
    if (
      input.selected.has("cli") ||
      input.deployOrderProfile === "space-invitation-receivers-first"
    ) {
      if (!doesCliReleaseOwnCoreProjection(input.deployOrderProfile)) {
        input.steps.push(
          {
            args: [
              "scripts/release/deploy-core-current-cli-projection.mjs",
              ...(input.releaseSha ? ["--release-sha", input.releaseSha] : []),
            ],
            command: "node",
            label: "Deploy Core with the current published CLI projection",
            workerDeploymentArgs: [
              "--config",
              "services/core/wrangler.jsonc",
              "--env",
              "prod",
            ],
          },
          workerDeploymentHealthStep({
            args: ["--config", "services/core/wrangler.jsonc", "--env", "prod"],
            label: "Verify Core deployment is visible",
          })
        );
      }
      return;
    }
    input.steps.push(
      {
        args: [
          "scripts/release/deploy-core-worker.mjs",
          ...(input.releaseSha ? ["--release-sha", input.releaseSha] : []),
        ],
        command: "node",
        label: "Deploy Core Worker",
        workerDeploymentArgs: [
          "--config",
          "services/core/wrangler.jsonc",
          "--env",
          "prod",
        ],
      },
      workerDeploymentHealthStep({
        args: ["--config", "services/core/wrangler.jsonc", "--env", "prod"],
        label: "Verify Core deployment is visible",
      })
    );
    return;
  }
  if (input.scope === "remote-agent") {
    input.steps.push(
      packageDeployStep(
        "@openmeld/remote-agent",
        "Deploy Remote Agent Worker",
        {
          args: [
            "--config",
            "services/remote-agent/wrangler.jsonc",
            "--env",
            "prod",
          ],
        }
      ),
      workerDeploymentHealthStep({
        args: [
          "--config",
          "services/remote-agent/dist/openmeld_remote_agent/wrangler.prod.json",
        ],
        label: "Verify Remote Agent deployment is visible",
      })
    );
  }
}

function resolveProductionDeployScopeOrder(scopes, changedPaths) {
  const profile = resolveProductionDeployOrderProfile(changedPaths);
  const order = DEPLOY_SCOPE_ORDER_BY_PROFILE[profile];
  const selected = new Set(scopes);
  return order.filter((scope) => selected.has(scope));
}

function resolveProductionDeployOrderProfile(changedPaths) {
  const profile = resolveExistingProductionDeployOrderProfile(changedPaths);
  if (!isSpaceInvitationReceiverFirstDiff(changedPaths)) {
    return profile;
  }
  if (profile !== "default-auth-receiver-first") {
    throw new Error(
      `Space invitation receiver order must be reviewed together with ${profile}; split incompatible receiver-first releases.`
    );
  }
  return "space-invitation-receivers-first";
}

function isSpaceInvitationReceiverFirstDiff(changedPaths) {
  return [
    "packages/schemas/src/space-invitation.ts",
    "services/core/src/organizations/space-invitations.ts",
    "services/auth/src/lib/hono/space-invitation-routes.ts",
  ].every((path) => changedPaths.includes(path));
}

function resolveExistingProductionDeployOrderProfile(changedPaths) {
  const isConnectComputerReceiverFirst =
    isConnectComputerCliReceiverFirstDiff(changedPaths);
  const isInboxReceiverFirst =
    isInboxSourceTargetReceiverFirstDiff(changedPaths);
  const isRemoteAgentRequestReceiverFirst =
    isRemoteAgentWorkerRequestReceiverFirstDiff(changedPaths);
  const isRemoteAgentReceiverFirst = changedPaths.some(
    isRemoteAgentReceiverFirstContractPath
  );
  const isLocalServiceReceiverFirst =
    isLocalServiceRuntimeReceiverFirstDiff(changedPaths);
  const isCoreWorkerResponseReaderFirst =
    isCoreWorkerResponseReaderFirstDiff(changedPaths);
  const isCenterAgentCliReceiverFirst = changedPaths.some(
    isCenterAgentCliReceiverFirstContractPath
  );
  const isWakeProgressOptInReceiversFirst =
    isWakeProgressOptInContractDiff(changedPaths);
  assertComposableConnectComputerReleaseProfile({
    isCenterAgentCliReceiverFirst,
    isConnectComputerReceiverFirst,
    isInboxReceiverFirst,
    isLocalServiceReceiverFirst,
  });
  const wakeProgressOptInProfile = resolveWakeProgressOptInDeployOrderProfile({
    isCenterAgentCliReceiverFirst,
    isConnectComputerReceiverFirst,
    isCoreWorkerResponseReaderFirst,
    isRemoteAgentReceiverFirst,
    isRemoteAgentRequestReceiverFirst,
    isWakeProgressOptInReceiversFirst,
  });
  if (wakeProgressOptInProfile) {
    return wakeProgressOptInProfile;
  }
  if (
    isConnectComputerReceiverFirst &&
    (isRemoteAgentRequestReceiverFirst || isRemoteAgentReceiverFirst)
  ) {
    return "remote-agent-and-connect-computer-receivers-first";
  }
  if (isConnectComputerReceiverFirst && isCoreWorkerResponseReaderFirst) {
    return "core-worker-response-and-connect-computer-receivers-first";
  }
  if (isConnectComputerReceiverFirst) {
    return "connect-computer-cli-receiver-first";
  }
  if (isRemoteAgentRequestReceiverFirst) {
    return isInboxReceiverFirst
      ? "remote-agent-and-inbox-receivers-first"
      : "remote-agent-receiver-first";
  }
  if (isCoreWorkerResponseReaderFirst) {
    return isInboxReceiverFirst
      ? "inbox-source-target-receiver-first"
      : "core-worker-response-reader-first";
  }
  if (
    isInboxReceiverFirst &&
    (isRemoteAgentReceiverFirst || isCenterAgentCliReceiverFirst)
  ) {
    return "remote-agent-and-inbox-receivers-first";
  }
  if (isInboxReceiverFirst) {
    return "inbox-source-target-receiver-first";
  }
  if (isRemoteAgentReceiverFirst) {
    return "remote-agent-receiver-first";
  }
  if (isCenterAgentCliReceiverFirst) {
    return "center-agent-cli-receiver-first";
  }
  if (isLocalServiceReceiverFirst) {
    return "local-service-runtime-receiver-first";
  }
  return resolveDefaultDeployOrderProfile(changedPaths);
}

function resolveDefaultDeployOrderProfile(changedPaths) {
  return isSpaceHistoryQueryContractDiff(changedPaths)
    ? "space-history-query-receivers-first"
    : "default-auth-receiver-first";
}

function resolveWakeProgressOptInDeployOrderProfile(input) {
  assertComposableWakeProgressOptInReleaseProfile(input);
  if (input.isWakeProgressOptInReceiversFirst) {
    if (
      input.isRemoteAgentRequestReceiverFirst ||
      input.isRemoteAgentReceiverFirst ||
      input.isCenterAgentCliReceiverFirst
    ) {
      return "remote-agent-and-wake-progress-opt-in-receivers-first";
    }
    if (input.isCoreWorkerResponseReaderFirst) {
      return "core-worker-response-and-wake-progress-opt-in-receivers-first";
    }
    return "wake-progress-opt-in-receivers-first";
  }
  return null;
}

function assertComposableConnectComputerReleaseProfile(input) {
  if (!input.isConnectComputerReceiverFirst) {
    return;
  }
  if (input.isInboxReceiverFirst) {
    throw new Error(
      "Connect Computer and Inbox receiver-first contracts cannot ship in one release because they require Core on opposite sides of the Web deployment. Split them into independently releasable changes."
    );
  }
  if (input.isLocalServiceReceiverFirst) {
    throw new Error(
      "Connect Computer and Local Service receiver-first contracts cannot ship in one release because they require Core on opposite sides of the CLI publication. Split them into independently releasable changes."
    );
  }
  if (input.isCenterAgentCliReceiverFirst) {
    throw new Error(
      "Connect Computer and Center Agent CLI receiver-first contracts cannot ship in one release because they require the CLI on opposite sides of the Web and Core deployments. Split them into independently releasable changes."
    );
  }
}

function assertComposableWakeProgressOptInReleaseProfile(input) {
  if (!input.isWakeProgressOptInReceiversFirst) {
    return;
  }
  if (input.isConnectComputerReceiverFirst) {
    throw new Error(
      "Connect Computer and Wake Progress opt-in receiver-first contracts cannot ship in one release because they require the CLI on opposite sides of the Core deployment. Split them into independently releasable changes."
    );
  }
  if (
    (input.isRemoteAgentRequestReceiverFirst ||
      input.isRemoteAgentReceiverFirst ||
      input.isCenterAgentCliReceiverFirst) &&
    input.isCoreWorkerResponseReaderFirst
  ) {
    throw new Error(
      "Remote Agent receiver-first and worker-response contracts cannot ship with a Wake Progress opt-in contract in one release because they require Remote Agent on opposite sides of the Core deployment. Split them into independently releasable changes."
    );
  }
}

function doesCliReleaseOwnCoreProjection(profile) {
  return (
    profile === "default-auth-receiver-first" ||
    profile === "connect-computer-cli-receiver-first" ||
    profile === "core-worker-response-and-connect-computer-receivers-first" ||
    profile === "remote-agent-and-connect-computer-receivers-first"
  );
}

function isConnectComputerCliReceiverFirstDiff(changedPaths) {
  return (
    changedPaths.includes(CONNECT_COMPUTER_DEVICE_AUTH_SCHEMA_PATH) &&
    changedPaths.includes(CONNECT_COMPUTER_CLI_RECEIVER_PATH) &&
    changedPaths.includes(CONNECT_COMPUTER_WEB_PRODUCER_PATH)
  );
}

function assertConnectComputerReleaseScopes(scopes, changedPaths) {
  if (!isConnectComputerCliReceiverFirstDiff(changedPaths)) {
    return;
  }
  const selected = new Set(scopes);
  if (selected.has("cli") && selected.has("web")) {
    return;
  }
  throw new Error(
    "The Connect Computer command contract requires both the CLI and Web scopes so the CLI receiver and Core current-channel projection publish before Web emits --device-code."
  );
}

function isLocalServiceRuntimeReceiverFirstDiff(changedPaths) {
  return (
    changedPaths.includes(LOCAL_SERVICE_RUNTIME_TRANSPORT_SCHEMA_PATH) &&
    changedPaths.some((path) =>
      path.startsWith(LOCAL_SERVICE_RUNTIME_CORE_RECEIVER_PATH_PREFIX)
    ) &&
    changedPaths.some((path) =>
      path.startsWith(LOCAL_SERVICE_RUNTIME_PRODUCER_PATH_PREFIX)
    )
  );
}

function isWakeProgressOptInContractDiff(changedPaths) {
  return (
    changedPaths.includes(WAKE_PROGRESS_SCHEMA_PATH) &&
    changedPaths.includes(WAKE_PROGRESS_CLI_CALLER_PATH) &&
    changedPaths.some((path) => WAKE_PROGRESS_CORE_PRODUCER_PATHS.has(path))
  );
}

function isSpaceHistoryQueryContractDiff(changedPaths) {
  return changedPaths.includes(SPACE_HISTORY_QUERY_SCHEMA_PATH);
}

function assertSpaceHistoryQueryReleaseScopes(scopes, changedPaths) {
  if (
    !(isSpaceHistoryQueryContractDiff(changedPaths) && scopes.includes("cli"))
  ) {
    return;
  }
  const selected = new Set(scopes);
  if (selected.has("gateway") && selected.has("core")) {
    return;
  }
  throw new Error(
    "The Space history query contract requires the Gateway and Core scopes before publishing its CLI caller."
  );
}

function assertSpaceHistoryQueryDeployOrder(scopes, changedPaths) {
  if (
    !(isSpaceHistoryQueryContractDiff(changedPaths) && scopes.includes("cli"))
  ) {
    return;
  }
  const gatewayIndex = scopes.indexOf("gateway");
  const coreIndex = scopes.indexOf("core");
  const cliIndex = scopes.indexOf("cli");
  if (
    gatewayIndex < 0 ||
    coreIndex < 0 ||
    gatewayIndex > cliIndex ||
    coreIndex > cliIndex
  ) {
    throw new Error(
      "The Space history query contract must deploy Gateway and Core before CLI. Split conflicting receiver-first changes into independently releasable releases."
    );
  }
}

function assertWakeProgressOptInContractReleaseScopes(scopes, changedPaths) {
  if (!isWakeProgressOptInContractDiff(changedPaths)) {
    return;
  }
  const selected = new Set(scopes);
  if (!(selected.has("core") || selected.has("cli"))) {
    return;
  }
  if (selected.has("gateway") && selected.has("core")) {
    return;
  }
  throw new Error(
    "The Wake Progress opt-in contract requires the Gateway and Core scopes before publishing its Core producer or CLI caller."
  );
}

function assertWakeProgressOptInDeployOrder(scopes, changedPaths) {
  if (!isWakeProgressOptInContractDiff(changedPaths)) {
    return;
  }
  const gatewayIndex = scopes.indexOf("gateway");
  const coreIndex = scopes.indexOf("core");
  const cliIndex = scopes.indexOf("cli");
  if (
    gatewayIndex < 0 ||
    coreIndex < 0 ||
    gatewayIndex > coreIndex ||
    (cliIndex >= 0 && coreIndex > cliIndex)
  ) {
    throw new Error(
      "The Wake Progress opt-in contract must deploy Gateway before Core and Core before CLI. Split conflicting receiver-first changes into independently releasable releases."
    );
  }
}

function assertLocalServiceRuntimeReleaseScopes(scopes, changedPaths) {
  if (
    !(
      isLocalServiceRuntimeReceiverFirstDiff(changedPaths) &&
      scopes.includes("cli")
    ) ||
    scopes.includes("core")
  ) {
    return;
  }
  throw new Error(
    "A strict Local Service runtime release requires the Core scope before publishing CLI/Service."
  );
}

function isInboxSourceTargetReceiverFirstDiff(changedPaths) {
  return (
    changedPaths.includes(INBOX_SOURCE_TARGET_SCHEMA_PATH) &&
    changedPaths.some((path) => INBOX_SOURCE_TARGET_WRITER_PATHS.has(path))
  );
}

function assertInboxSourceTargetReleaseScopes(scopes, changedPaths) {
  if (!isInboxSourceTargetReceiverFirstDiff(changedPaths)) {
    return;
  }
  const selected = new Set(scopes);
  const missing = INBOX_SOURCE_TARGET_REQUIRED_SCOPES.filter(
    (scope) => !selected.has(scope)
  );
  if (missing.length > 0) {
    throw new Error(
      `Inbox source-target receiver-first release requires the Web, Gateway, and Core scopes before Core can write durable targets. Missing: ${missing.join(", ")}.`
    );
  }
  if (
    resolveProductionDeployOrderProfile(changedPaths) ===
      "remote-agent-and-inbox-receivers-first" &&
    !selected.has("remote-agent")
  ) {
    throw new Error(
      "Combined Remote Agent and Inbox receiver-first release requires the Remote Agent scope before Core can write either contract."
    );
  }
}

function isRemoteAgentWorkerRequestReceiverFirstDiff(changedPaths) {
  return (
    changedPaths.some((path) =>
      REMOTE_AGENT_WORKER_REQUEST_SCHEMA_PATHS.has(path)
    ) &&
    changedPaths.includes(REMOTE_AGENT_WORKER_REQUEST_RECEIVER_PATH) &&
    changedPaths.some((path) =>
      REMOTE_AGENT_WORKER_REQUEST_PRODUCER_PATHS.has(path)
    )
  );
}

export function buildProductionReleasePlan(input) {
  const changedPaths = input.changedPaths ?? resolveChangedPaths(input.base);
  const requested = expandRequestedReleaseScopes(input.scope);
  const affectedPackages = requested
    ? []
    : (input.affectedPackages ?? resolveAffectedPackages(changedPaths));
  const scopes =
    requested ??
    resolveAutomaticReleaseScopes({ affectedPackages, changedPaths });
  const sourceSha = input.sourceSha ?? readHeadSha();
  const deployOrderProfile = resolveProductionDeployOrderProfile(changedPaths);
  const deployScopeOrder = resolveProductionDeployScopeOrder(
    scopes,
    changedPaths
  );
  return {
    affectedPackages,
    base: input.base,
    changedPaths,
    coreProjectionFromCli: scopes.includes("cli"),
    deployOrderProfile,
    deployScopeOrder,
    deploySteps: buildProductionDeployStepSpecs(scopes, {
      changedPaths,
      releaseSha: sourceSha,
    }),
    preflightSteps: buildProductionPreflightStepSpecs({ changedPaths, scopes }),
    scopes,
    sourceSha,
    verifySteps: buildProductionVerifyStepSpecs({ changedPaths, scopes }),
  };
}

function resolveChangedPaths(base) {
  assertGitRef(base);
  const outputs = [
    runGit(["diff", "--name-only", `${base}...HEAD`]),
    runGit(["diff", "--name-only"]),
    runGit(["ls-files", "--others", "--exclude-standard"]),
  ];
  return [...new Set(outputs.flatMap(splitLines))].toSorted();
}

function resolveAffectedPackages(changedPaths) {
  const workspacePackages = readWorkspacePackages();
  if (
    changedPaths.some((changedPath) =>
      GLOBAL_WORKSPACE_RUNTIME_PATHS.has(changedPath)
    )
  ) {
    return workspacePackages.map((workspacePackage) => workspacePackage.name);
  }

  const changedPackageNames = new Set();
  for (const changedPath of changedPaths) {
    const workspacePackage = workspacePackages.find(
      (candidate) =>
        changedPath === candidate.relativePath ||
        changedPath.startsWith(`${candidate.relativePath}/`)
    );
    if (
      workspacePackage &&
      isWorkspaceRuntimePath(
        changedPath.slice(workspacePackage.relativePath.length + 1)
      )
    ) {
      changedPackageNames.add(workspacePackage.name);
    }
  }

  const affectedPackageNames = new Set(changedPackageNames);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const workspacePackage of workspacePackages) {
      if (affectedPackageNames.has(workspacePackage.name)) {
        continue;
      }
      if (
        workspacePackage.workspaceDependencies.some((dependencyName) =>
          affectedPackageNames.has(dependencyName)
        )
      ) {
        affectedPackageNames.add(workspacePackage.name);
        expanded = true;
      }
    }
  }
  return [...affectedPackageNames].toSorted();
}

function readWorkspacePackages() {
  const output = execFileSync(
    resolveCommandBinary("pnpm"),
    ["-r", "list", "--depth", "-1", "--json"],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 5 }
  );
  const listedPackages = JSON.parse(output);
  const repoRoot = process.cwd();
  const packageNames = new Set(
    listedPackages
      .map((listedPackage) => listedPackage.name)
      .filter((name) => typeof name === "string")
  );
  return listedPackages
    .filter(
      (listedPackage) =>
        typeof listedPackage.name === "string" &&
        typeof listedPackage.path === "string" &&
        path.resolve(listedPackage.path) !== path.resolve(repoRoot)
    )
    .map((listedPackage) => {
      const packageJson = JSON.parse(
        readFileSync(path.join(listedPackage.path, "package.json"), "utf8")
      );
      const dependencyNames = new Set([
        ...Object.keys(packageJson.dependencies ?? {}),
        ...Object.keys(packageJson.optionalDependencies ?? {}),
        ...Object.keys(packageJson.peerDependencies ?? {}),
      ]);
      return {
        name: listedPackage.name,
        relativePath: path
          .relative(repoRoot, listedPackage.path)
          .split(path.sep)
          .join("/"),
        workspaceDependencies: [...dependencyNames].filter((name) =>
          packageNames.has(name)
        ),
      };
    });
}

function assertGitRef(ref) {
  try {
    runGit(["rev-parse", "--verify", `${ref}^{commit}`]);
  } catch {
    throw new Error(
      `Production release base ref ${ref} is not available. Fetch it or pass --base <ref>.`
    );
  }
}

function assertCleanWorktree() {
  const dirty = splitLines(
    runGit(["status", "--porcelain=v1", "--untracked-files=all"])
  );
  if (dirty.length > 0) {
    throw new Error(
      [
        "Local production release requires a clean worktree.",
        ...dirty.map((path) => `- ${path}`),
      ].join("\n")
    );
  }
}

function assertSourceStillMatches(sourceSha) {
  assertCleanWorktree();
  const currentSha = readHeadSha();
  if (currentSha !== sourceSha) {
    throw new Error(
      `Production release source changed during verification: planned ${sourceSha}, current ${currentSha}. Run the plan again.`
    );
  }
}

export function resolveProductionLeaseScopes(scopes) {
  return sortScopes([...scopes, ...(scopes.includes("cli") ? ["core"] : [])]);
}

export async function executeWithProductionScopeLeases(input) {
  const acquire =
    input.adapters?.acquireProductionScopeLease ?? acquireProductionScopeLease;
  const release =
    input.adapters?.releaseProductionScopeLease ?? releaseProductionScopeLease;
  const leases = [];
  let executionResult;
  let originalError = null;
  try {
    for (const scope of resolveProductionLeaseScopes(input.scopes)) {
      leases.push(
        acquire({
          owner: input.owner,
          scope,
          sourceSha: input.sourceSha,
        })
      );
    }
    executionResult = await input.execute();
    await input.afterSuccess?.({
      scopes: resolveProductionLeaseScopes(input.scopes),
      sourceSha: input.sourceSha,
    });
  } catch (error) {
    originalError = error;
  }
  const releaseErrors = [];
  for (const lease of leases.toReversed()) {
    try {
      release({
        leaseSha: lease.leaseSha,
        scope: lease.metadata.scope,
      });
    } catch (error) {
      releaseErrors.push(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
  if (originalError || releaseErrors.length > 0) {
    throw combineReleaseErrors(originalError, releaseErrors);
  }
  return executionResult;
}

export function resolveLocalReleaseOwner(input = {}) {
  const user = String(input.user ?? process.env.USER ?? "unknown").trim();
  const hostname = String(input.hostname ?? os.hostname()).trim();
  const pid = Number(input.pid ?? process.pid);
  if (!(user && hostname && Number.isInteger(pid) && pid > 0)) {
    throw new Error(
      "Local production release owner requires a user, hostname, and positive process id."
    );
  }
  return `local:${user}@${hostname}:${String(pid)}`;
}

export function assertProductionReleaseSource(input) {
  return requireMainlineReleaseSha({
    cwd: input.cwd,
    mainRef: input.mainRef ?? "refs/remotes/origin/main",
    releaseSha: input.sourceSha,
  });
}

function runStep(step) {
  process.stdout.write(`\n[production-release] ${step.label}\n`);
  const result = spawnSync(resolveCommandBinary(step.command), step.args, {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${step.command} ${step.args.join(" ")} failed with exit code ${String(result.status)}`
    );
  }
}

export async function executeProductionDeploySteps(input) {
  const adapters = {
    publishCliRelease: input.adapters?.publishCliRelease ?? runCliRelease,
    runCommand: input.adapters?.runCommand ?? runReadOnlyCommand,
    runStep: input.adapters?.runStep ?? runStep,
  };
  const write = input.write ?? ((value) => process.stdout.write(value));
  for (const step of input.steps) {
    if (step.internalOperation === "publish-cli") {
      await adapters.publishCliRelease({
        cwd: input.cwd ?? process.cwd(),
        env: input.env ?? process.env,
        withBinary: true,
      });
      input.afterStep?.(step);
      continue;
    }
    if (step.workerDeploymentArgs) {
      const result = adapters.runCommand({
        args: [
          "exec",
          "wrangler",
          "deployments",
          "list",
          ...step.workerDeploymentArgs,
          "--json",
        ],
        command: "pnpm",
        env: input.env ?? process.env,
      });
      printCurrentWorkerVersions(step.label, result, write);
    }
    adapters.runStep(step);
    input.afterStep?.(step);
  }
}

function printCurrentWorkerVersions(label, result, write) {
  if (result.status !== 0) {
    const detail =
      String(result.stderr ?? "").trim() ||
      String(result.stdout ?? "").trim() ||
      `exit ${String(result.status)}`;
    write(
      `\n[production-release] ${label} — current production version id unavailable: ${detail}; deploy will still RUN\n`
    );
    return;
  }
  try {
    const versions = readCurrentWorkerVersionIds(JSON.parse(result.stdout));
    const detail =
      versions.length > 0
        ? versions
            .map(
              (version) =>
                `${version.versionId} (${String(version.percentage)}%)`
            )
            .join(", ")
        : "none";
    write(
      `\n[production-release] ${label} — current production version id(s): ${detail}; deploy will RUN\n`
    );
  } catch (error) {
    write(
      `\n[production-release] ${label} — current production version id unavailable: ${error instanceof Error ? error.message : String(error)}; deploy will still RUN\n`
    );
  }
}

function runReadOnlyCommand(input) {
  const result = spawnSync(resolveCommandBinary(input.command), input.args, {
    encoding: "utf8",
    env: input.env,
    maxBuffer: 1024 * 1024 * 20,
    timeout: COMPLETION_PROBE_TIMEOUT_MS,
  });
  return {
    status: result.error ? 1 : (result.status ?? 1),
    stderr: [String(result.stderr ?? "").trim(), result.error?.message]
      .filter(Boolean)
      .join("\n"),
    stdout: String(result.stdout ?? ""),
  };
}

function printPlan(plan, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  const lines = [
    "Production release plan",
    `Source: ${plan.sourceSha}`,
    `Base: ${plan.base}`,
    `Scopes: ${plan.scopes.length > 0 ? plan.scopes.join(", ") : "none"}`,
    `Deploy order: ${plan.deployOrderProfile}`,
  ];
  if (plan.coreProjectionFromCli) {
    lines.push("CLI note: the CLI release owns its required Core projection.");
  }
  lines.push("", "Changed paths:");
  lines.push(
    ...(plan.changedPaths.length > 0
      ? plan.changedPaths.map((path) => `- ${path}`)
      : ["- none"])
  );
  lines.push("", "Full confidence verification:");
  lines.push(
    ...(plan.verifySteps.length > 0
      ? plan.verifySteps.map((step) => `- ${step.label}`)
      : ["- none"])
  );
  lines.push("", "Deployment preflight:");
  lines.push(
    ...(plan.preflightSteps.length > 0
      ? plan.preflightSteps.map((step) => `- ${step.label}`)
      : ["- none"])
  );
  lines.push("", "Production actions:");
  lines.push(
    ...(plan.deploySteps.length > 0
      ? plan.deploySteps.map((step) => `- ${step.label}`)
      : ["- none"])
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function main(argv) {
  const options = parseProductionReleaseArgs(argv);
  const plan = buildProductionReleasePlan(options);
  printPlan(plan, options.json);
  if (options.command === "plan") {
    return;
  }
  if (plan.scopes.length === 0) {
    throw new Error(
      "No production deploy scope was selected. Pass --scope explicitly if this change needs a deploy."
    );
  }

  assertCleanWorktree();
  refreshCurrentMain();
  assertProductionReleaseSource({ sourceSha: plan.sourceSha });
  const preparationSteps =
    options.command === "verify" ? plan.verifySteps : plan.preflightSteps;
  for (const step of preparationSteps) {
    runStep(step);
  }
  assertSourceStillMatches(plan.sourceSha);
  if (options.command === "verify" || options.command === "preflight") {
    return;
  }
  await executeWithProductionScopeLeases({
    afterSuccess: ({ scopes, sourceSha }) =>
      publishGuardedLocalReleaseEvidence({ scopes, sourceSha }),
    execute: () =>
      executeProductionDeploySteps({
        afterStep: () => assertSourceStillMatches(plan.sourceSha),
        steps: plan.deploySteps,
      }),
    owner: resolveLocalReleaseOwner(),
    scopes: plan.scopes,
    sourceSha: plan.sourceSha,
  });
}

function refreshCurrentMain() {
  const result = spawnSync(
    resolveCommandBinary("git"),
    [
      "fetch",
      "--no-tags",
      "origin",
      "refs/heads/main:refs/remotes/origin/main",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Local production release could not refresh current main: ${result.error?.message ?? result.stderr.trim()}`
    );
  }
}

function combineReleaseErrors(originalError, releaseErrors) {
  const lines = [];
  if (originalError) {
    lines.push(
      `Production release failed: ${originalError instanceof Error ? originalError.message : String(originalError)}`
    );
  }
  for (const releaseError of releaseErrors) {
    lines.push(`Production lease release failed: ${releaseError.message}`);
  }
  return new Error(lines.join("\n"));
}

function coreCliChannelCompatibilityStep() {
  const channelSyncArgs = ["--current", "--channel-sync-check"];
  return {
    args: ["run", "verify:release-ready", "--", ...channelSyncArgs],
    command: "pnpm",
    controlArgs: channelSyncArgs,
    controlCommand: "node",
    controlPath: "scripts/release/verify-release-ready.mjs",
    label: "Verify Core CLI channel compatibility",
  };
}

function cliReleaseMetadataStep() {
  return {
    args: ["run", "verify:release-ready"],
    command: "pnpm",
    label: "Verify CLI release metadata",
  };
}

function packageDeployStep(packageName, label, input) {
  return {
    args: ["--filter", packageName, "run", "deploy"],
    command: "pnpm",
    label,
    workerDeploymentArgs: input.args,
  };
}

function publicHealthStep(url, label) {
  return {
    args: [
      "--fail",
      "--silent",
      "--show-error",
      "--retry",
      "5",
      "--retry-all-errors",
      "--retry-delay",
      "3",
      "--output",
      "/dev/null",
      url,
    ],
    command: "curl",
    label,
  };
}

function workerDeploymentHealthStep(input) {
  return {
    args: ["exec", "wrangler", "deployments", "list", ...input.args, "--json"],
    command: "pnpm",
    label: input.label,
  };
}

function isDatabaseSchemaPath(path) {
  if (path.startsWith(DB_MIGRATION_PATH_PREFIX)) {
    return path.endsWith(".sql") || path.endsWith(".json");
  }
  return (
    DB_SCHEMA_PATHS.has(path) ||
    (DB_SCHEMA_PATH_PREFIXES.some((prefix) => path.startsWith(prefix)) &&
      (path.endsWith("/schema.ts") || path.endsWith(".schema.ts")))
  );
}

function isCenterAgentTaskContractPath(path) {
  return (
    path.includes("center-agent-task") || path.includes("center_agent_task")
  );
}

function isRemoteAgentReceiverFirstContractPath(path) {
  return REMOTE_AGENT_RECEIVER_FIRST_CONTRACT_PATHS.has(path);
}

function isCoreWorkerResponseReaderFirstDiff(changedPaths) {
  return (
    changedPaths.includes(REMOTE_AGENT_WORKER_RESPONSE_SCHEMA_PATH) &&
    changedPaths.some((path) =>
      REMOTE_AGENT_WORKER_RESPONSE_PRODUCER_PATHS.has(path)
    )
  );
}

function isCenterAgentCliReceiverFirstContractPath(path) {
  return (
    isCenterAgentTaskContractPath(path) ||
    isCenterAgentContextManifestContractPath(path)
  );
}

function isCenterAgentContextManifestContractPath(path) {
  return (
    path.includes("center-agent-context-manifest") ||
    path.includes("center_agent_context_manifest")
  );
}

function isWorkspaceRuntimePath(relativePath) {
  if (!relativePath) {
    return false;
  }
  if (
    relativePath === "README.md" ||
    relativePath.endsWith(".md") ||
    relativePath.includes("/__fixtures__/") ||
    relativePath.includes("/__tests__/") ||
    relativePath.startsWith("test/") ||
    relativePath.startsWith("tests/") ||
    VITEST_CONFIG_REGEX.test(relativePath) ||
    TEST_FILE_REGEX.test(relativePath)
  ) {
    return false;
  }
  return true;
}

function sortScopes(scopes) {
  return [...new Set(scopes)].toSorted(
    (left, right) => SCOPE_ORDER.indexOf(left) - SCOPE_ORDER.indexOf(right)
  );
}

function readRequiredArgument(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function readHeadSha() {
  return runGit(["rev-parse", "HEAD"]).trim();
}

function runGit(args) {
  return execFileSync(resolveCommandBinary("git"), args, {
    encoding: "utf8",
  });
}

function splitLines(value) {
  return String(value).split(LINE_SPLIT_REGEX).filter(Boolean);
}

function resolveCommandBinary(command) {
  if (process.platform !== "win32") {
    return command;
  }
  if (command === "git") {
    return "git.exe";
  }
  if (command === "pnpm") {
    return "pnpm.cmd";
  }
  return command;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
