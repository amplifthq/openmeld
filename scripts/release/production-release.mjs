#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readCutoverTarget } from "../../tooling/postgresql/remote-target.mjs";
import {
  admitPostgresqlProductRelease,
  readPostgresqlCutoverPreparation,
  restoreProductCrons,
  verifyProductCrons,
} from "./database-backend-admission.mjs";
import {
  cutoverConfigArgs,
  cutoverDeploySteps,
  withPostgresqlCutoverConfig,
} from "./postgresql-cutover-config.mjs";
import { executeRecordedProductionDeploySteps } from "./production-release-receipts.mjs";
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
import { resolveRemoteAgentRequestCompatibilityBridge } from "./remote-agent-request-compatibility.mjs";
import { requireMainlineReleaseSha } from "./require-mainline-release-sha.mjs";
import {
  admitWebsiteDomainRelease,
  executeObservedDomainRelease,
  prepareWebsiteDomains,
  rollbackWebsiteDomains,
} from "./website-domain-migration.mjs";

const DEFAULT_BASE_REF = "origin/main";
const COMPLETION_PROBE_TIMEOUT_MS = 30_000;
const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
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
  "website",
]);
const CLOUD_SCOPES = [
  "auth",
  "web",
  "gateway",
  "core",
  "remote-agent",
  "website",
];
const FULL_SCOPES = ["db", ...CLOUD_SCOPES];
const SCOPE_ORDER = [
  "db",
  "cli",
  "auth",
  "web",
  "gateway",
  "core",
  "remote-agent",
  "website",
];
const REMOTE_AGENT_RECEIVER_FIRST_SCOPE_ORDER = [
  "db",
  "remote-agent",
  "auth",
  "core",
  "gateway",
  "web",
  "cli",
  "website",
];
const CENTER_AGENT_CLI_RECEIVER_FIRST_SCOPE_ORDER = [
  "db",
  "remote-agent",
  "auth",
  "core",
  "gateway",
  "web",
  "cli",
  "website",
];
const CORE_WORKER_RESPONSE_READER_FIRST_SCOPE_ORDER = [
  "db",
  "auth",
  "core",
  "gateway",
  "web",
  "remote-agent",
  "cli",
  "website",
];
const INBOX_SOURCE_TARGET_RECEIVER_FIRST_SCOPE_ORDER = [
  "db",
  "auth",
  "web",
  "gateway",
  "core",
  "remote-agent",
  "cli",
  "website",
];
const LOCAL_SERVICE_RUNTIME_RECEIVER_FIRST_SCOPE_ORDER = [
  "db",
  "auth",
  "web",
  "gateway",
  "core",
  "remote-agent",
  "cli",
  "website",
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
  "website",
];
const REMOTE_AGENT_AND_INBOX_RECEIVERS_FIRST_SCOPE_ORDER = [
  "db",
  "remote-agent",
  "auth",
  "web",
  "gateway",
  "core",
  "cli",
  "website",
];
const REMOTE_AGENT_AND_CONNECT_COMPUTER_RECEIVERS_FIRST_SCOPE_ORDER = [
  "db",
  "remote-agent",
  "auth",
  "cli",
  "web",
  "gateway",
  "core",
  "website",
];
const REMOTE_AGENT_AND_WAKE_PROGRESS_OPT_IN_RECEIVERS_FIRST_SCOPE_ORDER =
  REMOTE_AGENT_AND_INBOX_RECEIVERS_FIRST_SCOPE_ORDER;
const CORE_WORKER_RESPONSE_AND_WAKE_PROGRESS_OPT_IN_RECEIVERS_FIRST_SCOPE_ORDER =
  LOCAL_SERVICE_RUNTIME_RECEIVER_FIRST_SCOPE_ORDER;
const CORE_WORKER_RESPONSE_AND_CONNECT_COMPUTER_RECEIVERS_FIRST_SCOPE_ORDER =
  CONNECT_COMPUTER_CLI_RECEIVER_FIRST_SCOPE_ORDER;
const SPACE_MESSAGE_SEARCH_RECEIVERS_FIRST_SCOPE_ORDER = [
  "db",
  "auth",
  "cli",
  "core",
  "gateway",
  "web",
  "remote-agent",
  "website",
];
const DEPLOY_SCOPE_ORDER_BY_PROFILE = {
  "center-agent-evidence-receivers-first": SCOPE_ORDER,
  "space-message-search-receivers-first":
    SPACE_MESSAGE_SEARCH_RECEIVERS_FIRST_SCOPE_ORDER,
  "space-message-search-and-evidence-receivers-first":
    SPACE_MESSAGE_SEARCH_RECEIVERS_FIRST_SCOPE_ORDER,
  "space-task-receivers-first": CORE_WORKER_RESPONSE_READER_FIRST_SCOPE_ORDER,
  "space-caller-context-receivers-first": [
    "db",
    "auth",
    "remote-agent",
    "cli",
    "core",
    "gateway",
    "web",
  ],
  "personal-remote-tools-receivers-first": SCOPE_ORDER,
  "inbox-task-retirement-producer-first": [
    "db",
    "core",
    "auth",
    "gateway",
    "web",
    "remote-agent",
    "cli",
  ],
  "remote-agent-and-inbox-task-retirement-first": [
    "db",
    "remote-agent",
    "core",
    "auth",
    "gateway",
    "web",
    "cli",
  ],
  "device-wait-receivers-first": CORE_WORKER_RESPONSE_READER_FIRST_SCOPE_ORDER,
  "people-computers-receivers-first":
    CORE_WORKER_RESPONSE_READER_FIRST_SCOPE_ORDER,
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
const INBOX_SCHEMA_PATH = "packages/schemas/src/schemas/http/inbox.ts";

// Preferred scheduling order is not a compatibility dependency. Accumulate
// only contract directions proven by the changed producer and receiver paths.
export function resolveProductionCompatibilityDependencies(
  changedPaths,
  taskInboxRetired = false,
  context = {}
) {
  const edges = [];
  const edgeKeys = new Set();
  const addEdge = (receiver, producer) => {
    const key = `${receiver}\0${producer}`;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      edges.push([receiver, producer]);
    }
  };

  const spaceTask = isSpaceTaskReceiverFirstDiff(changedPaths);
  const callerContext = isSpaceCallerContextDiff(changedPaths);
  const spaceTaskCli = changedPaths.includes(
    "clients/openmeld-cli/src/space/dispatch-task.ts"
  );
  const invitation = isSpaceInvitationReceiverFirstDiff(changedPaths);
  const dependencyGroups = [
    {
      enabled: isRemoteAiUsageDiff(changedPaths),
      edges: [["core", "remote-agent"]],
    },
    {
      enabled: isWorkingFolderRecoveryDiff(changedPaths),
      edges: [["core", "cli"]],
    },
    {
      enabled:
        isNpmSetupArtifactDiff(changedPaths) &&
        !isReviewedWindowsPreviewOnlyNpmSetupDiff(changedPaths, context),
      edges: [["cli", "web"]],
    },
    {
      enabled: isInboxNotificationObservationDiff(changedPaths),
      edges: [
        ["core", "gateway"],
        ["gateway", "web"],
      ],
    },
    {
      enabled: isCenterAgentEvidenceDiff(changedPaths),
      edges: [["core", "remote-agent"]],
    },
    {
      enabled: isSpaceMessageSearchReceiverFirstDiff(changedPaths),
      edges: [
        ["core", "gateway"],
        ["gateway", "web"],
      ],
    },
    {
      enabled:
        spaceTask &&
        (spaceTaskCli ||
          changedPaths.includes(
            "services/gateway/src/routes/rpc-http.space-tasks.ts"
          )),
      edges: [["core", "gateway"]],
    },
    {
      enabled: spaceTask && spaceTaskCli,
      edges: [["gateway", "cli"]],
    },
    {
      enabled:
        spaceTask &&
        changedPaths.includes("services/remote-agent/agent-core/tools.ts"),
      edges: [["core", "remote-agent"]],
    },
    {
      enabled: callerContext,
      edges: [
        ["auth", "cli"],
        ["remote-agent", "cli"],
        ["cli", "core"],
      ],
    },
    {
      enabled: isPersonalRemoteToolsReceiverFirstDiff(changedPaths),
      edges: [["core", "remote-agent"]],
    },
    {
      enabled: taskInboxRetired,
      edges: [
        ["core", "gateway"],
        ["core", "web"],
      ],
    },
    {
      enabled: isDeviceWaitReceiverFirstDiff(changedPaths),
      edges: [["core", "gateway"]],
    },
    {
      enabled:
        isDeviceWaitReceiverFirstDiff(changedPaths) &&
        changedPaths.some(
          (path) =>
            path.startsWith("clients/web/") && path.includes("device-wait")
        ),
      edges: [["gateway", "web"]],
    },
    {
      enabled: isPeopleComputersReceiverFirstDiff(changedPaths),
      edges: [["core", "gateway"]],
    },
    {
      // Caller Context has a reviewed opposite order: Auth and the signed
      // Service precede the Core projection in the combined rollout.
      enabled: invitation && !callerContext,
      edges: [["core", "auth"]],
    },
    {
      enabled:
        invitation &&
        changedPaths.includes(
          "clients/openmeld-cli/src/space/invitations-command.ts"
        ),
      edges: [["auth", "cli"]],
    },
    {
      enabled:
        invitation &&
        changedPaths.some(
          (path) =>
            path.startsWith("clients/web/") && path.includes("space-invitation")
        ),
      edges: [["auth", "web"]],
    },
    {
      enabled: changedPaths.some(
        (path) =>
          path.startsWith("services/core/") &&
          isCenterAgentContextManifestContractPath(path)
      ),
      edges: [["remote-agent", "core"]],
    },
    {
      enabled: changedPaths.some(
        (path) =>
          path.startsWith("clients/openmeld-cli/") &&
          isCenterAgentCliReceiverFirstContractPath(path)
      ),
      edges: [
        ["core", "cli"],
        ["gateway", "cli"],
      ],
    },
    {
      enabled: isConnectComputerCliReceiverFirstDiff(changedPaths),
      edges: [["cli", "web"]],
    },
    {
      enabled: isCoreWorkerResponseReaderFirstDiff(changedPaths),
      edges: [
        ["core", "remote-agent"],
        ["gateway", "remote-agent"],
        ["web", "remote-agent"],
      ],
    },
    {
      enabled: isWakeProgressOptInContractDiff(changedPaths),
      edges: [
        ["gateway", "core"],
        ["core", "cli"],
      ],
    },
    {
      enabled: isSpaceHistoryQueryContractDiff(changedPaths),
      edges: [
        ["gateway", "cli"],
        ["core", "cli"],
      ],
    },
    {
      enabled:
        isInboxSourceTargetReceiverFirstDiff(changedPaths) && !taskInboxRetired,
      edges: [
        ["web", "core"],
        ["gateway", "core"],
      ],
    },
    {
      enabled: isLocalServiceRuntimeReceiverFirstDiff(changedPaths),
      edges: [["core", "cli"]],
    },
    {
      enabled:
        (isRemoteAgentWorkerRequestReceiverFirstDiff(changedPaths) ||
          changedPaths.some(isRemoteAgentReceiverFirstContractPath)) &&
        !resolveRemoteAgentRequestCompatibilityBridge({
          ...context,
          readGitFile:
            context.readGitFile ??
            ((ref, path) => runGit(["show", `${ref}:${path}`])),
        }),
      edges: [["remote-agent", "core"]],
    },
    {
      enabled: isIndependentSkillBridgeDiff(changedPaths),
      edges: [
        ["gateway", "cli"],
        ["web", "cli"],
      ],
    },
  ];
  for (const group of dependencyGroups) {
    if (!group.enabled) {
      continue;
    }
    for (const [receiver, producer] of group.edges) {
      addEdge(receiver, producer);
    }
  }
  return edges;
}

export function resolveProductionCompatibilityReceiverWitnesses(changedPaths) {
  const witnesses = isWorkingFolderRecoveryDiff(changedPaths)
    ? [
        {
          receiver: "core",
          producer: "cli",
          receiverPaths: [
            "packages/schemas/src/working-folder-recovery.ts",
            "packages/schemas/src/public-agent-failure-reason.ts",
            "services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts",
            "services/core/src/runtime-transport/application/local-agent-stream.ts",
            "services/core/src/space/transport/do/space.ts",
          ],
        },
      ]
    : [];
  if (
    !(
      isRemoteAgentWorkerRequestReceiverFirstDiff(changedPaths) ||
      changedPaths.some(isRemoteAgentReceiverFirstContractPath)
    )
  ) {
    return witnesses;
  }
  const receiverPaths = [
    ...REMOTE_AGENT_WORKER_REQUEST_SCHEMA_PATHS,
    REMOTE_AGENT_WORKER_REQUEST_RECEIVER_PATH,
    ...REMOTE_AGENT_RECEIVER_FIRST_CONTRACT_PATHS,
  ].filter((path) => changedPaths.includes(path));
  return receiverPaths.length > 0
    ? [
        ...witnesses,
        {
          producer: "core",
          receiver: "remote-agent",
          receiverPaths,
        },
      ]
    : witnesses;
}

function isWorkingFolderRecoveryDiff(paths) {
  return [
    "packages/schemas/src/working-folder-recovery.ts",
    "services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts",
    "clients/openmeld-cli/src/local-service/continuation/working-folder-recovery.ts",
  ].every((file) => paths.includes(file));
}

function isNpmSetupArtifactDiff(paths) {
  return [
    "scripts/release/npm-cli-artifact.mjs",
    "clients/openmeld-cli/package.json",
    "clients/web/src/lib/setup-bootstrap-script.ts",
  ].every((file) => paths.includes(file));
}

// The reviewed Windows internal preview changed these three files only to
// package the Windows helper and select a separate binary setup path. It did
// not change the existing npm setup contract. Keep the CLI-before-Web edge
// for every other source diff, including later edits to any of these files.
const WINDOWS_PREVIEW_NPM_SETUP_BLOBS = [
  [
    "scripts/release/npm-cli-artifact.mjs",
    "211536c3e0b3b5b792267e3aeabefd87c52df9ed",
    "073c89763c3879d8b2cafb1555ce99d856cecd05",
  ],
  [
    "clients/openmeld-cli/package.json",
    "4669f73fa890a9bfc3ae87dac028ce495978bac1",
    "de975f1e921c0237d18395936533911e67581569",
  ],
  [
    "clients/web/src/lib/setup-bootstrap-script.ts",
    "417ee09845f41184b889f41f60556dab13770d96",
    "fc2af23865f1079533542f8aea638de4b283e923",
  ],
];

function isReviewedWindowsPreviewOnlyNpmSetupDiff(paths, context) {
  if (!(context.base && context.sourceSha)) {
    return false;
  }
  if (
    !paths.includes("clients/web/src/lib/setup-bootstrap-windows-binary.ts")
  ) {
    return false;
  }
  if (!paths.includes("scripts/release/publish-windows-internal-preview.mjs")) {
    return false;
  }
  const readBlobSha =
    context.readBlobSha ??
    ((ref, file) => runGit(["rev-parse", "--verify", `${ref}:${file}`]).trim());
  try {
    return WINDOWS_PREVIEW_NPM_SETUP_BLOBS.every(
      ([file, before, after]) =>
        readBlobSha(context.base, file) === before &&
        readBlobSha(context.sourceSha, file) === after
    );
  } catch {
    return false;
  }
}

function isInboxNotificationObservationDiff(paths) {
  return [
    INBOX_SCHEMA_PATH,
    "services/core/src/inbox/application/inbox-notification-observations.ts",
  ].every((file) => paths.includes(file));
}
const RETIRED_TASK_INBOX_PRODUCER_PATH =
  "services/core/src/center-agent-tasks/application/center-agent-task-inbox-producer.ts";
const TASK_INBOX_KIND_LINE = /^[ \t]*"center_agent_task",\r?\n/mu;
const TASK_INBOX_SOURCE_KIND_LINE = /^[ \t]*"center_agent_task_event",\r?\n/mu;
const TASK_INBOX_TARGET_BLOCK =
  /^[ \t]*z\.strictObject\(\{\r?\n[ \t]*kind: z\.literal\("center_agent_task"\),\r?\n[ \t]*taskId: identifierSchema,\r?\n[ \t]*\}\),\r?\n/mu;
const WAKE_PROGRESS_SCHEMA_PATH =
  "packages/schemas/src/schemas/http/space-wake-progress.ts";
const SPACE_HISTORY_QUERY_SCHEMA_PATH =
  "packages/schemas/src/schemas/http/list-signals-query.ts";
const SPACE_TASK_SCHEMA_PATH =
  "packages/schemas/src/schemas/http/space-tasks.ts";
const SPACE_TASK_CALLER_PATHS = [
  "clients/openmeld-cli/src/space/dispatch-task.ts",
  "services/gateway/src/routes/rpc-http.space-tasks.ts",
  "services/remote-agent/agent-core/tools.ts",
];
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
const INBOX_CLOUD_SCOPES = ["web", "gateway", "core"];
const LOCAL_SERVICE_RUNTIME_TRANSPORT_SCHEMA_PATH =
  "packages/schemas/src/schemas/daemon/runtime-transport.ts";
const LOCAL_SERVICE_RUNTIME_CORE_RECEIVER_PATH_PREFIX =
  "services/core/src/runtime-transport/";
const LOCAL_SERVICE_RUNTIME_PRODUCER_PATH_PREFIXES = [
  "clients/openmeld-cli/src/local-service/",
  "runtime/adapters/",
];
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
const REMOTE_AI_USAGE_PRODUCER_CONTRACT_PATHS = new Set([
  "packages/schemas/src/schemas/ai-usage.ts",
  "services/remote-agent/agent-core/ai-usage.ts",
]);
const CENTER_AGENT_CONTEXT_MANIFEST_CONTRACT_PATHS = new Set([
  "packages/schemas/src/schemas/http/center-agent-context-manifest.ts",
  "packages/schemas/src/types/http/center-agent-context-manifest.ts",
  "services/core/src/center-agent/application/center-agent-context-manifest-service.ts",
]);
function isRemoteAiUsageDiff(changedPaths) {
  // A receiver-only edit does not introduce a new Remote producer contract.
  return changedPaths.some((path) =>
    REMOTE_AI_USAGE_PRODUCER_CONTRACT_PATHS.has(path)
  );
}

// Explain these directional signals at the same owner that classifies them.
// These are source-path observations, not deployed receiver compatibility proof.
function describeCompatibilityPathSignals(changedPaths) {
  return [
    {
      contract: "remote-ai-usage",
      dependency: ["core", "remote-agent"],
      matchedPaths: changedPaths.filter((path) =>
        REMOTE_AI_USAGE_PRODUCER_CONTRACT_PATHS.has(path)
      ),
      nonTriggerPaths: changedPaths.filter(
        (path) => path === "services/core/src/usage/ai-usage-rpc.ts"
      ),
      reason:
        "The changed shared contract or Remote producer requires Core first. A Core receiver-only edit does not establish a changed Remote producer contract.",
    },
    {
      contract: "center-agent-context-manifest",
      dependency: ["remote-agent", "core"],
      matchedPaths: changedPaths.filter(
        (path) =>
          path.startsWith("services/core/") &&
          isCenterAgentContextManifestContractPath(path)
      ),
      nonTriggerPaths: changedPaths.filter(
        (path) =>
          path ===
          "services/core/src/center-agent/center-agent-context-manifest-repository.ts"
      ),
      reason:
        "The Core context projection produces Remote context entries. Its persistence repository does not define that wire contract.",
    },
  ];
}
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
  ["openmeld-website", "website"],
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
  website: {
    filter: "openmeld-website...",
    label: "Verify Website",
    tasks: ["check", "test"],
  },
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
    if (arg === "--database-cutover" && command === "plan") {
      options.databaseCutover = true;
      continue;
    }
    if (arg === "--database-cutover-restore-crons" && command === "deploy") {
      options.databaseCutoverRestoreCrons = true;
      continue;
    }
    const valueOption = new Map([
      ["--base", "base"],
      ["--scope", "scope"],
      ["--domain-evidence", "domainEvidence"],
      ["--domain-phase", "domainPhase"],
      ["--database-cutover-snapshot", "databaseCutoverSnapshot"],
    ]).get(arg);
    if (valueOption) {
      options[valueOption] = readRequiredArgument(argv, ++index, arg);
      continue;
    }
    if (arg === "--redeploy" && command === "deploy") {
      options.redeploy = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    throw new Error(`Unknown production release option: ${arg}`);
  }
  validateDomainReleaseOptions(options);
  validateDatabaseCutoverOptions(options);
  return options;
}

function validateDatabaseCutoverOptions(options) {
  if (
    options.databaseCutoverRestoreCrons &&
    (options.scope !== "auth,core" ||
      options.databaseCutoverSnapshot ||
      options.domainEvidence ||
      options.domainPhase)
  ) {
    throw new Error(
      "Cron restoration requires deploy --scope auth,core without snapshot or domain options"
    );
  }
  if (
    options.databaseCutoverSnapshot &&
    (!["deploy", "preflight"].includes(options.command) ||
      options.domainEvidence ||
      options.domainPhase)
  ) {
    throw new Error(
      "A cutover snapshot applies only to deploy or preflight, without domain changes"
    );
  }
}

function validateDomainReleaseOptions(options) {
  if (
    (options.domainEvidence || options.domainPhase) &&
    options.command !== "deploy"
  ) {
    throw new Error("Domain options apply only to the guarded deploy command.");
  }
  if (
    options.domainPhase &&
    (!(
      ["prepare", "rollback"].includes(options.domainPhase) &&
      options.domainEvidence
    ) ||
      options.scope !== "auth,web,website")
  ) {
    throw new Error(
      "Domain operations require prepare or rollback, --scope auth,web,website and --domain-evidence <file>."
    );
  }
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

function compatibilityContractScopes(changedPaths) {
  const scopes = new Set();
  if (isSpaceImageGeometryDiff(changedPaths)) {
    for (const scope of ["web", "gateway", "cli", "core"]) {
      scopes.add(scope);
    }
  }
  if (isCenterAgentEvidenceDiff(changedPaths)) {
    scopes.add("core");
    scopes.add("remote-agent");
  }
  if (isSpaceMessageSearchReceiverFirstDiff(changedPaths)) {
    scopes.add("core");
    scopes.add("gateway");
    scopes.add("web");
  }
  return scopes;
}

export function resolveAutomaticReleaseScopes(input) {
  const scopes = compatibilityContractScopes(input.changedPaths);
  if (
    input.changedPaths.some((path) =>
      path.startsWith("release/openmeld-cli-skill/")
    )
  ) {
    scopes.add("web");
  }
  if (input.changedPaths.includes("release/vendor-models.json")) {
    scopes.add("core");
  }
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
  if (
    isInboxSourceTargetReceiverFirstDiff(input.changedPaths) ||
    isInboxNotificationObservationDiff(input.changedPaths)
  ) {
    for (const scope of INBOX_CLOUD_SCOPES) {
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
  if (isSpaceTaskReceiverFirstDiff(input.changedPaths)) {
    scopes.add("core");
    if (scopes.has("cli") || scopes.has("web")) {
      scopes.add("gateway");
    }
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
      !input.taskInboxRetired &&
      !isDeviceWaitReceiverFirstDiff(input.changedPaths) &&
      !isLocalServiceRuntimeReceiverFirstDiff(input.changedPaths) &&
      !isWorkingFolderRecoveryDiff(input.changedPaths) &&
      !isPersonalRemoteToolsReceiverFirstDiff(input.changedPaths) &&
      !isSpaceTaskReceiverFirstDiff(input.changedPaths) &&
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
  if (!EXACT_SHA_PATTERN.test(String(input.releaseSha ?? ""))) {
    throw new Error(
      "Production preflight requires the exact release SHA for receipt-based train admission."
    );
  }
  steps.unshift({
    args: [
      "scripts/release/production-stage-admission.mjs",
      "--scope",
      input.scopes.join(","),
      "--source-sha",
      input.releaseSha,
    ],
    command: "node",
    controlArgs: [
      "--scope",
      input.scopes.join(","),
      "--source-sha",
      input.releaseSha,
    ],
    controlCommand: "node",
    controlNodeArgs: [],
    controlPath: "scripts/release/production-stage-admission.mjs",
    label: "Admit receipt-based Production train stage",
  });
  steps.splice(1, 0, {
    args: [
      "scripts/release/production-train-artifact-admission.mjs",
      "--scope",
      input.scopes.join(","),
      "--source-sha",
      input.releaseSha,
    ],
    command: "node",
    controlArgs: [
      "--scope",
      input.scopes.join(","),
      "--source-sha",
      input.releaseSha,
    ],
    controlCommand: "node",
    controlNodeArgs: [],
    controlPath: "scripts/release/production-train-artifact-admission.mjs",
    label: "Verify declared Production train artifacts",
  });
  if (input.scopes.includes("web")) {
    steps.splice(2, 0, {
      args: ["run", "verify:cli-skill"],
      command: "pnpm",
      controlArgs: [],
      controlCommand: "node",
      controlNodeArgs: [],
      controlPath: "scripts/release/cli-skill-check.mjs",
      label: "Verify signed CLI Skill content",
    });
  }
  if (input.scopes.includes("gateway")) {
    steps.push(productionQueueVerificationStep("gateway"));
  }
  if (input.scopes.some((scope) => scope === "cli" || scope === "core")) {
    steps.push(productionQueueVerificationStep("core"));
  }
  if (
    input.scopes.includes("core") &&
    !input.scopes.includes("cli") &&
    !input.taskInboxRetired &&
    !isDeviceWaitReceiverFirstDiff(input.changedPaths) &&
    !isLocalServiceRuntimeReceiverFirstDiff(input.changedPaths) &&
    !isWorkingFolderRecoveryDiff(input.changedPaths) &&
    !isPersonalRemoteToolsReceiverFirstDiff(input.changedPaths) &&
    !isPeopleComputersReceiverFirstDiff(input.changedPaths) &&
    !isSpaceTaskReceiverFirstDiff(input.changedPaths) &&
    !isSpaceInvitationReceiverFirstDiff(input.changedPaths)
  ) {
    steps.push(coreCliChannelCompatibilityStep());
  }
  return steps;
}

export function buildCoreCurrentCliProjectionPreflightStepSpecs(
  changedPaths,
  releaseSha
) {
  return buildProductionPreflightStepSpecs({
    changedPaths,
    releaseSha,
    scopes: ["core"],
    taskInboxRetired: true,
  }).filter((step) => step.label !== "Verify Core CLI channel compatibility");
}

export function runCoreCurrentCliProjectionPreflight(input = {}) {
  const executeStep = input.runStep ?? runStep;
  for (const step of buildCoreCurrentCliProjectionPreflightStepSpecs(
    input.changedPaths,
    input.releaseSha
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
  const compatibilityChangedPaths =
    input.compatibilityChangedPaths ?? changedPaths;
  assertCenterAgentEvidenceReleaseScopes(scopes, changedPaths);
  assertSpaceMessageSearchReleaseScopes(scopes, changedPaths);
  assertConnectComputerReleaseScopes(scopes, changedPaths);
  assertInboxSourceTargetReleaseScopes(
    scopes,
    changedPaths,
    input.taskInboxRetired
  );
  assertLocalServiceRuntimeReleaseScopes(scopes, changedPaths);
  assertWakeProgressOptInContractReleaseScopes(scopes, changedPaths);
  assertSpaceHistoryQueryReleaseScopes(scopes, changedPaths);
  assertSpaceTaskReleaseScopes(scopes, changedPaths);
  const deployOrderProfile = resolveProductionDeployOrderProfile(
    compatibilityChangedPaths,
    input.taskInboxRetired
  );
  if (
    deployOrderProfile === "space-caller-context-receivers-first" &&
    (selected.has("core") || selected.has("cli")) &&
    !["cli", "auth", "remote-agent"].every((scope) => selected.has(scope))
  ) {
    throw new Error(
      "Caller context requires Auth and Remote receivers, then the required CLI/Service publication with its Core projection."
    );
  }
  if (
    deployOrderProfile === "space-invitation-receivers-first" &&
    (selected.has("auth") || selected.has("cli")) &&
    !(selected.has("core") && selected.has("auth"))
  ) {
    throw new Error(
      "Space invitation release requires Core and Auth receivers before publishing its CLI caller."
    );
  }
  const orderedScopes = resolveProductionDeployScopeOrder(
    scopes,
    compatibilityChangedPaths,
    input.taskInboxRetired,
    input.compatibilityContext
  );
  assertWakeProgressOptInDeployOrder(orderedScopes, changedPaths);
  assertSpaceHistoryQueryDeployOrder(orderedScopes, changedPaths);
  for (const scope of orderedScopes) {
    const start = steps.length;
    appendProductionDeployScopeSteps({
      databaseBackend: input.databaseBackend,
      databaseCutoverSnapshot: input.databaseCutoverSnapshot,
      coreReceiverFirst: isWorkingFolderRecoveryDiff(changedPaths),
      deployOrderProfile,
      releaseSha: input.releaseSha,
      scope,
      selected,
      steps,
    });
    annotateReleaseScope(steps, start, scope);
  }
  if (selected.has("cli")) {
    steps.push({
      internalOperation: "publish-cli",
      label: "Verify final R2/npm/Core alignment",
    });
    annotateReleaseScope(steps, steps.length - 1, "cli");
  }
  return steps;
}

export function buildCoreReceiverStepSpecs(releaseSha) {
  const script = "scripts/release/deploy-core-current-cli-projection.mjs";
  const source = releaseSha ? ["--release-sha", releaseSha] : [];
  return [
    {
      command: "node",
      args: [script, "--deployment-only", ...source],
      controlPath: script,
      label: "Deploy Core with the current published CLI projection",
      workerDeploymentArgs: [
        "--config",
        "services/core/wrangler.jsonc",
        "--env",
        "prod",
      ],
      releaseScope: "core",
      completesReleaseScope: false,
    },
    {
      command: "node",
      args: [script, "--verify-only", ...source],
      controlPath: script,
      label: "Verify Core receiver stable identity alignment",
      releaseScope: "core",
      completesReleaseScope: true,
    },
  ];
}

function annotateReleaseScope(steps, start, scope) {
  for (let index = start; index < steps.length; index += 1) {
    steps[index] = {
      ...steps[index],
      releaseScope: scope,
      completesReleaseScope: index === steps.length - 1,
      ...(scope === "cli"
        ? {
            receiptWorkerDeploymentArgs: [
              "--config",
              "services/core/wrangler.jsonc",
              "--env",
              "prod",
            ],
          }
        : {}),
    };
  }
}

function appendRendererDeploySteps(input) {
  const website = input.scope === "website";
  const client = website ? "website" : "web";
  input.steps.push(
    packageDeployStep(
      `openmeld-${client}`,
      website ? "Deploy Website" : "Deploy Web",
      {
        args: ["--config", `clients/${client}/wrangler.jsonc`, "--env", "prod"],
      }
    ),
    {
      args: [
        "scripts/release/production-web-health.mjs",
        "--scope",
        client,
        "--url",
        website ? "https://openmeld.ai" : "https://app.openmeld.ai",
        "--source-sha",
        input.releaseSha,
        "--artifact-receipt",
        `dev-tmp/release-artifact-check/${client}.json`,
      ],
      command: "node",
      label: website ? "Verify Website health" : "Verify Web health",
    }
  );
}

function appendDatabaseDeploySteps(input) {
  if (input.databaseBackend === "postgresql") {
    for (const command of input.databaseCutoverSnapshot
      ? ["verify"]
      : ["migrate", "grant-runtime", "verify"]) {
      input.steps.push({
        command: "node",
        args: ["tooling/postgresql/cutover.mjs", command],
        label: `PostgreSQL database: ${command}`,
      });
    }
    return;
  }
  input.steps.push({
    args: ["db:release:prod"],
    command: "pnpm",
    label: "Synchronize production database",
  });
}

function appendProductionDeployScopeSteps(input) {
  if (input.scope === "db") {
    appendDatabaseDeploySteps(input);
    return;
  }
  if (input.scope === "cli") {
    input.steps.push({
      internalOperation: "publish-cli",
      label: "Publish CLI and deploy its Core release projection",
    });
    return;
  }
  if (input.scope === "web" || input.scope === "website") {
    appendRendererDeploySteps(input);
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
      input.coreReceiverFirst ||
      input.deployOrderProfile === "inbox-task-retirement-producer-first" ||
      input.deployOrderProfile ===
        "remote-agent-and-inbox-task-retirement-first" ||
      input.deployOrderProfile === "device-wait-receivers-first" ||
      input.deployOrderProfile === "people-computers-receivers-first" ||
      input.deployOrderProfile === "personal-remote-tools-receivers-first" ||
      input.deployOrderProfile === "local-service-runtime-receiver-first" ||
      input.deployOrderProfile === "space-task-receivers-first" ||
      input.deployOrderProfile === "space-invitation-receivers-first"
    ) {
      if (
        input.coreReceiverFirst ||
        !doesCliReleaseOwnCoreProjection(input.deployOrderProfile)
      ) {
        input.steps.push(...buildCoreReceiverStepSpecs(input.releaseSha));
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

function resolveProductionDeployScopeOrder(
  scopes,
  changedPaths,
  taskInboxRetired = false,
  context = {}
) {
  const profile = resolveProductionDeployOrderProfile(
    changedPaths,
    taskInboxRetired
  );
  const order = DEPLOY_SCOPE_ORDER_BY_PROFILE[profile];
  const selected = new Set(scopes);
  if (
    profile === "personal-remote-tools-receivers-first" &&
    selected.has("remote-agent") &&
    !selected.has("core")
  ) {
    throw new Error(
      "Personal Remote Agent tools require the Core receiver before Remote Agent deployment."
    );
  }
  const preferred = order.filter((scope) => selected.has(scope));
  if (
    !(
      isWorkingFolderRecoveryDiff(changedPaths) ||
      isNpmSetupArtifactDiff(changedPaths) ||
      isRemoteAiUsageDiff(changedPaths) ||
      isInboxNotificationObservationDiff(changedPaths)
    )
  ) {
    return preferred;
  }
  // Keep the existing profile's preference for independent components. These
  // added contracts must compose with every existing receiver direction, not
  // silently override an opposite profile (for example Caller Context).
  const dependencies = resolveProductionCompatibilityDependencies(
    changedPaths,
    taskInboxRetired,
    context
  ).filter(
    ([receiver, producer]) => selected.has(receiver) && selected.has(producer)
  );
  const remaining = new Set(preferred);
  const result = [];
  while (remaining.size > 0) {
    const next = preferred.find(
      (scope) =>
        remaining.has(scope) &&
        !dependencies.some(
          ([receiver, producer]) =>
            producer === scope && remaining.has(receiver)
        )
    );
    if (!next) {
      throw new Error(
        "Incompatible release dependencies require separate receiver-first stages. Inspect the component receipts before choosing a forward release."
      );
    }
    result.push(next);
    remaining.delete(next);
  }
  return result;
}

function resolveProductionDeployOrderProfile(
  changedPaths,
  taskInboxRetired = false
) {
  const evidence = isCenterAgentEvidenceDiff(changedPaths);
  const spaceMessageSearch =
    isSpaceMessageSearchReceiverFirstDiff(changedPaths);
  if (spaceMessageSearch || evidence) {
    const otherProfile = resolveProductionDeployOrderProfile(
      changedPaths.filter(
        (file) =>
          file !== SPACE_MESSAGE_SEARCH_SCHEMA_PATH &&
          !CENTER_AGENT_EVIDENCE_SCHEMA_PATHS.has(file)
      ),
      taskInboxRetired
    );
    if (otherProfile !== "default-auth-receiver-first") {
      throw new Error(
        `Space message search/evidence receiver order conflicts with ${otherProfile}; review and split incompatible releases.`
      );
    }
    if (spaceMessageSearch) {
      return evidence
        ? "space-message-search-and-evidence-receivers-first"
        : "space-message-search-receivers-first";
    }
    return "center-agent-evidence-receivers-first";
  }
  if (isSpaceTaskReceiverFirstDiff(changedPaths)) {
    const otherProfile = resolveProductionDeployOrderProfile(
      changedPaths.filter((file) => file !== SPACE_TASK_SCHEMA_PATH),
      taskInboxRetired
    );
    if (
      ![
        "default-auth-receiver-first",
        "core-worker-response-reader-first",
        "device-wait-receivers-first",
        "people-computers-receivers-first",
      ].includes(otherProfile)
    ) {
      throw new Error(
        `Space Task receivers require Core before Gateway and consumers; conflict with ${otherProfile}. Split the release.`
      );
    }
    return "space-task-receivers-first";
  }
  if (!isSpaceCallerContextDiff(changedPaths)) {
    return resolveOtherProductionDeployOrderProfile(
      changedPaths,
      taskInboxRetired
    );
  }
  const profile = resolveOtherProductionDeployOrderProfile(
    changedPaths,
    taskInboxRetired
  );
  if (
    ![
      "default-auth-receiver-first",
      "space-invitation-receivers-first",
    ].includes(profile)
  ) {
    throw new Error(
      `Caller context requires Service before Core and conflicts with ${profile}; split the release.`
    );
  }
  return "space-caller-context-receivers-first";
}

function resolveOtherProductionDeployOrderProfile(
  changedPaths,
  taskInboxRetired
) {
  if (isPersonalRemoteToolsReceiverFirstDiff(changedPaths)) {
    // This entrypoint change exports the browser facet; it does not expand a
    // Core-to-Remote request. Remote's tool calls require the Core receiver first.
    const otherProfile = resolveProductionDeployOrderProfile(
      changedPaths.filter(
        (file) =>
          file !== "services/remote-agent/.flue/cloudflare.ts" &&
          file !==
            "services/core/src/remote-agent/application/remote-agent-tool-caller.ts"
      ),
      taskInboxRetired
    );
    if (
      ![
        "default-auth-receiver-first",
        "core-worker-response-reader-first",
        "inbox-source-target-receiver-first",
      ].includes(otherProfile)
    ) {
      throw new Error(
        `Personal Remote Agent tools require Core before Remote and conflict with ${otherProfile}; split the release.`
      );
    }
    return "personal-remote-tools-receivers-first";
  }
  if (taskInboxRetired) {
    // The exact retired contract is proven against Git below. Other contracts
    // still select their ordinary profile and must be composable with Core first.
    const profile = resolveProductionDeployOrderProfile(
      changedPaths.filter((file) => file !== INBOX_SCHEMA_PATH)
    );
    if (
      profile === "remote-agent-receiver-first" ||
      profile === "center-agent-cli-receiver-first"
    ) {
      return "remote-agent-and-inbox-task-retirement-first";
    }
    if (
      profile === "default-auth-receiver-first" ||
      profile === "core-worker-response-reader-first" ||
      profile === "space-invitation-receivers-first"
    ) {
      return "inbox-task-retirement-producer-first";
    }
    throw new Error(
      `Task Inbox retirement requires Core before its strict readers and conflicts with ${profile}; split the release.`
    );
  }
  const profile = resolveExistingProductionDeployOrderProfile(changedPaths);
  if (isDeviceWaitReceiverFirstDiff(changedPaths)) {
    assertComposableDeviceWaitReleaseProfile(changedPaths, profile);
    return "device-wait-receivers-first";
  }
  if (isPeopleComputersReceiverFirstDiff(changedPaths)) {
    if (
      profile !== "default-auth-receiver-first" &&
      profile !== "core-worker-response-reader-first"
    ) {
      throw new Error(
        `PeopleComputers receiver order conflicts with ${profile}; split the release.`
      );
    }
    if (isSpaceInvitationReceiverFirstDiff(changedPaths)) {
      throw new Error(
        "PeopleComputers and invitation receiver orders require separate releases."
      );
    }
    return "people-computers-receivers-first";
  }
  if (!isSpaceInvitationReceiverFirstDiff(changedPaths)) {
    return profile;
  }
  if (
    profile !== "default-auth-receiver-first" &&
    profile !== "local-service-runtime-receiver-first"
  ) {
    throw new Error(
      `Space invitation receiver order must be reviewed together with ${profile}; split incompatible receiver-first releases.`
    );
  }
  return "space-invitation-receivers-first";
}

function assertComposableDeviceWaitReleaseProfile(changedPaths, profile) {
  if (
    ![
      "default-auth-receiver-first",
      "local-service-runtime-receiver-first",
      "core-worker-response-reader-first",
    ].includes(profile) ||
    isPeopleComputersReceiverFirstDiff(changedPaths) ||
    isSpaceInvitationReceiverFirstDiff(changedPaths)
  ) {
    throw new Error(
      `Device wait requires Core before Gateway and Web; review conflicting receiver orders (${profile}) in a separate release.`
    );
  }
}

function isSpaceCallerContextDiff(changedPaths) {
  return [
    "packages/schemas/src/schemas/protocol/space-caller-context.ts",
    "services/core/src/space/transport/do/space.ts",
    "clients/openmeld-cli/src/local-service/dispatch/parse-dispatch-task.ts",
  ].every((file) => changedPaths.includes(file));
}

function isDeviceWaitReceiverFirstDiff(changedPaths) {
  return [
    "packages/schemas/src/schemas/protocol/wake-device-wait.ts",
    "services/core/src/space/transport/do/space.ts",
    "services/gateway/src/routes/rpc-http.signals.ts",
  ].every((file) => changedPaths.includes(file));
}

function isSpaceInvitationReceiverFirstDiff(changedPaths) {
  return [
    "packages/schemas/src/space-invitation.ts",
    "services/core/src/organizations/space-invitations.ts",
    "services/auth/src/lib/hono/space-invitation-routes.ts",
  ].every((path) => changedPaths.includes(path));
}

function isPersonalRemoteToolsReceiverFirstDiff(changedPaths) {
  return [
    "packages/schemas/src/schemas/runtime/personal-remote-agent.ts",
    "services/core/src/remote-agent/application/remote-agent-tool-caller.ts",
    "services/remote-agent/agent-core/personal-remote-agent-tools.ts",
  ].every((file) => changedPaths.includes(file));
}

function isPeopleComputersReceiverFirstDiff(changedPaths) {
  return [
    [
      "packages/schemas/src/schemas/http/people-computers.ts",
      "services/core/src/people-computers/projection.ts",
      "services/gateway/src/routes/rpc-http.people-computers.ts",
    ],
    [
      "packages/schemas/src/schemas/daemon/service-connection-evidence.ts",
      "services/core/src/computers/service-connection-evidence-rpc.ts",
      "services/gateway/src/routes/rpc-http.service-connection-evidence.ts",
    ],
  ].some((contractPaths) =>
    contractPaths.every((file) => changedPaths.includes(file))
  );
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
    profile === "center-agent-evidence-receivers-first" ||
    profile === "space-message-search-receivers-first" ||
    profile === "space-message-search-and-evidence-receivers-first" ||
    profile === "space-caller-context-receivers-first" ||
    profile === "default-auth-receiver-first" ||
    profile === "connect-computer-cli-receiver-first" ||
    profile === "core-worker-response-and-connect-computer-receivers-first" ||
    profile === "remote-agent-and-connect-computer-receivers-first"
  );
}

const SPACE_IMAGE_GEOMETRY_PRODUCER_PATH =
  "services/core/src/space/application/space-file-image-metadata.ts";
const SPACE_MESSAGE_SEARCH_SCHEMA_PATH =
  "packages/schemas/src/schemas/http/space-message-search.ts";
const CENTER_AGENT_EVIDENCE_SCHEMA_PATHS = new Set([
  "packages/schemas/src/schemas/http/center-agent-evidence.ts",
  "packages/schemas/src/schemas/http/agent-activity-overview.ts",
  "packages/schemas/src/schemas/http/center-agent-routine-evidence.ts",
  "packages/schemas/src/schemas/http/center-agent-memory-search.ts",
]);

function isSpaceImageGeometryDiff(paths) {
  return (
    paths.includes(SPACE_IMAGE_GEOMETRY_PRODUCER_PATH) &&
    paths.includes("packages/schemas/src/schemas/http/space-files.ts") &&
    paths.includes("services/core/src/space/transport/do/space.ts")
  );
}

function isCenterAgentEvidenceDiff(paths) {
  return (
    paths.some((file) => CENTER_AGENT_EVIDENCE_SCHEMA_PATHS.has(file)) &&
    paths.includes("services/core/src/index.ts") &&
    paths.includes("services/remote-agent/agent-core/tools.ts")
  );
}

function isSpaceMessageSearchReceiverFirstDiff(paths) {
  return [
    SPACE_MESSAGE_SEARCH_SCHEMA_PATH,
    "services/core/src/space/infrastructure/sql/space-message-search-repo.ts",
    "services/gateway/src/routes/rpc-http.message-search.ts",
    "clients/web/src/components/search/message-search.tsx",
  ].every((file) => paths.includes(file));
}

function assertCenterAgentEvidenceReleaseScopes(scopes, paths) {
  const selected = new Set(scopes);
  if (
    isCenterAgentEvidenceDiff(paths) &&
    selected.has("remote-agent") &&
    !selected.has("core")
  ) {
    throw new Error(
      "Center Agent evidence tools require the Core RPC receiver before Remote Agent; include Core in the ordered plan."
    );
  }
}

function assertSpaceMessageSearchReleaseScopes(scopes, paths) {
  if (!isSpaceMessageSearchReceiverFirstDiff(paths)) {
    return;
  }
  const selected = new Set(scopes);
  if (
    selected.has("web") &&
    !(selected.has("gateway") && selected.has("core"))
  ) {
    throw new Error(
      "Space message search Web callers require the Gateway and Core short-query receivers in the same guarded plan."
    );
  }
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
    isIndependentSkillBridgeDiff(changedPaths) ||
    (changedPaths.includes(LOCAL_SERVICE_RUNTIME_TRANSPORT_SCHEMA_PATH) &&
      changedPaths.some((path) =>
        path.startsWith(LOCAL_SERVICE_RUNTIME_CORE_RECEIVER_PATH_PREFIX)
      ) &&
      changedPaths.some((path) =>
        LOCAL_SERVICE_RUNTIME_PRODUCER_PATH_PREFIXES.some((prefix) =>
          path.startsWith(prefix)
        )
      ))
  );
}

function isIndependentSkillBridgeDiff(changedPaths) {
  return (
    changedPaths.includes("packages/schemas/src/schemas/local-components.ts") &&
    changedPaths.includes(
      "clients/openmeld-cli/src/local-components/manifest.ts"
    ) &&
    changedPaths.includes(
      "services/core/src/local-components/update-projection.ts"
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

function isSpaceTaskReceiverFirstDiff(changedPaths) {
  return (
    changedPaths.includes(SPACE_TASK_SCHEMA_PATH) &&
    changedPaths.includes("services/core/src/rpc/methods.ts") &&
    changedPaths.includes("services/core/src/space/transport/do/space.ts") &&
    SPACE_TASK_CALLER_PATHS.some((file) => changedPaths.includes(file))
  );
}

function assertSpaceTaskReleaseScopes(scopes, changedPaths) {
  if (!isSpaceTaskReceiverFirstDiff(changedPaths)) {
    return;
  }
  const selected = new Set(scopes);
  if (
    ["gateway", "web", "cli", "remote-agent"].some((scope) =>
      selected.has(scope)
    ) &&
    !selected.has("core")
  ) {
    throw new Error("Space Task consumers require the Core receiver scope.");
  }
  // Web and CLI use Gateway HTTP; Remote Agent calls the Core binding directly.
  if (
    (selected.has("web") || selected.has("cli")) &&
    !selected.has("gateway")
  ) {
    throw new Error(
      "Space Task Web and CLI consumers require the Gateway receiver scope."
    );
  }
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
    isIndependentSkillBridgeDiff(changedPaths) &&
    scopes.includes("cli") &&
    !["core", "gateway", "web"].every((scope) => scopes.includes(scope))
  ) {
    throw new Error(
      "The independent Skill bridge requires Core, Gateway, and Web before CLI/Service publication."
    );
  }
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
    changedPaths.includes(INBOX_SCHEMA_PATH) &&
    changedPaths.some((path) => INBOX_SOURCE_TARGET_WRITER_PATHS.has(path))
  );
}

function assertInboxSourceTargetReleaseScopes(
  scopes,
  changedPaths,
  taskInboxRetired = false
) {
  if (
    !(taskInboxRetired || isInboxSourceTargetReceiverFirstDiff(changedPaths))
  ) {
    return;
  }
  const selected = new Set(scopes);
  const missing = INBOX_CLOUD_SCOPES.filter((scope) => !selected.has(scope));
  if (missing.length > 0) {
    throw new Error(
      `Inbox source-target receiver-first release requires the Web, Gateway, and Core scopes before Core can write durable targets. Missing: ${missing.join(", ")}.`
    );
  }
  if (
    [
      "remote-agent-and-inbox-receivers-first",
      "remote-agent-and-inbox-task-retirement-first",
    ].includes(
      resolveProductionDeployOrderProfile(changedPaths, taskInboxRetired)
    ) &&
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

function isReviewedHostedProgressCompatibilityBridge(input) {
  if (
    !(
      input.base &&
      input.sourceSha &&
      [
        REMOTE_AGENT_WORKER_RESPONSE_SCHEMA_PATH,
        "services/remote-agent/flue-adapter/streaming.ts",
      ].every((path) => input.changedPaths.includes(path))
    )
  ) {
    return false;
  }
  const readGitFile =
    input.readGitFile ?? ((ref, path) => runGit(["show", `${ref}:${path}`]));
  try {
    const before = readGitFile(
      input.base,
      REMOTE_AGENT_WORKER_RESPONSE_SCHEMA_PATH
    );
    const after = readGitFile(
      input.sourceSha,
      REMOTE_AGENT_WORKER_RESPONSE_SCHEMA_PATH
    );
    const reasonAddition =
      '  TURN_OUTPUT_LIMIT_EXCEEDED: "remote_agent.turn.output_limit_exceeded",\n';
    const progressAddition = [
      "  z.strictObject({",
      "    ...typedRemoteAgentStreamDeltaCallbackIdentitySchema,",
      '    kind: z.literal("progress"),',
      '    source: z.literal("hosted.public_progress"),',
      "  }),",
      "",
    ].join("\n");
    if (
      !(after.includes(reasonAddition) && after.includes(progressAddition)) ||
      after.replace(reasonAddition, "").replace(progressAddition, "") !== before
    ) {
      return false;
    }
    const streamSource = readGitFile(
      input.sourceSha,
      "services/remote-agent/flue-adapter/streaming.ts"
    );
    return [
      'response.reasonCode === "agent_stream.invalid"',
      "state.sequence = previousSequence",
      "transientState.progressUnsupported = true",
    ].every((evidence) => streamSource.includes(evidence));
  } catch {
    // Missing historical content must never waive a compatibility dependency.
    return false;
  }
}

function isReviewedProviderConnectionMissingResponseAddition(input) {
  if (
    !(
      input.base &&
      input.sourceSha &&
      input.changedPaths.includes(REMOTE_AGENT_WORKER_RESPONSE_SCHEMA_PATH)
    ) ||
    input.changedPaths.some(
      (path) =>
        (REMOTE_AGENT_WORKER_REQUEST_SCHEMA_PATHS.has(path) &&
          path !== REMOTE_AGENT_WORKER_RESPONSE_SCHEMA_PATH) ||
        REMOTE_AGENT_WORKER_REQUEST_PRODUCER_PATHS.has(path)
    )
  ) {
    return false;
  }
  const readGitFile =
    input.readGitFile ?? ((ref, path) => runGit(["show", `${ref}:${path}`]));
  try {
    const before = readGitFile(
      input.base,
      REMOTE_AGENT_WORKER_RESPONSE_SCHEMA_PATH
    );
    const after = readGitFile(
      input.sourceSha,
      REMOTE_AGENT_WORKER_RESPONSE_SCHEMA_PATH
    );
    const addition =
      '  PROVIDER_CONNECTION_MISSING: "remote_agent.provider.connection_missing",\n';
    return (
      !before.includes(addition) &&
      after.includes(addition) &&
      after.replace(addition, "") === before
    );
  } catch {
    return false;
  }
}

function resolveProductionReleaseContext(input) {
  const changedPaths = input.changedPaths ?? resolveChangedPaths(input.base);
  const sourceSha = input.sourceSha ?? readHeadSha();
  const compatibilityContext = {
    base: input.base,
    sourceSha,
    readGitFile:
      input.readGitFile ?? ((ref, path) => runGit(["show", `${ref}:${path}`])),
  };
  const requestBridge =
    isRemoteAgentWorkerRequestReceiverFirstDiff(changedPaths) ||
    changedPaths.some(isRemoteAgentReceiverFirstContractPath)
      ? resolveRemoteAgentRequestCompatibilityBridge(compatibilityContext)
      : null;
  const compatibilityChangedPaths = isReviewedHostedProgressCompatibilityBridge(
    {
      base: input.base,
      changedPaths,
      readGitFile: input.readGitFile,
      sourceSha,
    }
  )
    ? changedPaths.filter(
        (path) => path !== REMOTE_AGENT_WORKER_RESPONSE_SCHEMA_PATH
      )
    : changedPaths;
  const taskInboxRetired = inspectTaskInboxRetirement({
    base: input.base,
    changedPaths,
    sourceSha: input.sourceSha,
  });
  const requested = expandRequestedReleaseScopes(input.scope);
  const affectedPackages = requested
    ? []
    : (input.affectedPackages ?? resolveAffectedPackages(changedPaths));
  const scopes =
    requested ??
    resolveAutomaticReleaseScopes({ affectedPackages, changedPaths });
  return {
    affectedPackages,
    base: input.base,
    changedPaths,
    compatibilityChangedPaths,
    compatibilityContext,
    requestBridge,
    scopes,
    sourceSha,
    taskInboxRetired,
  };
}

function describeProductionReleaseImpact(context) {
  return {
    affectedPackages: context.affectedPackages,
    base: context.base,
    changedPaths: context.changedPaths,
    compatibilityBridges: context.requestBridge ? [context.requestBridge] : [],
    compatibilityDependencies: resolveProductionCompatibilityDependencies(
      context.compatibilityChangedPaths,
      context.taskInboxRetired,
      context.compatibilityContext
    ),
    compatibilityPathSignals: describeCompatibilityPathSignals(
      context.compatibilityChangedPaths
    ),
    compatibilityReceiverWitnesses:
      resolveProductionCompatibilityReceiverWitnesses(
        context.compatibilityChangedPaths
      ),
    scopes: context.scopes,
    sourceSha: context.sourceSha,
  };
}

// Deployment evidence and source impact remain meaningful even when the
// affected components cannot safely be deployed together. Only the planner
// and stage admission own that ordering decision.
export function buildProductionReleaseImpact(input) {
  return describeProductionReleaseImpact(
    resolveProductionReleaseContext(input)
  );
}

export function buildProductionReleasePlan(input) {
  const context = resolveProductionReleaseContext(input);
  const {
    changedPaths,
    compatibilityChangedPaths,
    compatibilityContext,
    scopes,
    sourceSha,
    taskInboxRetired,
  } = context;
  // Both files carry requests and responses. Their shared-path footprint alone
  // cannot prove which strict receiver must go first (for example replyRecovery).
  // Keep explicit single-side stages available instead of guessing an order.
  if (
    scopes.includes("remote-agent") &&
    (scopes.includes("core") || scopes.includes("cli")) &&
    changedPaths.includes(
      "services/core/src/remote-agent/application/native-delivery-service.ts"
    ) &&
    compatibilityChangedPaths.includes(
      REMOTE_AGENT_WORKER_RESPONSE_SCHEMA_PATH
    ) &&
    compatibilityChangedPaths.includes(
      REMOTE_AGENT_WORKER_REQUEST_RECEIVER_PATH
    ) &&
    !isRemoteAgentWorkerRequestReceiverFirstDiff(compatibilityChangedPaths) &&
    !isReviewedProviderConnectionMissingResponseAddition({
      base: input.base,
      changedPaths: compatibilityChangedPaths,
      readGitFile: input.readGitFile,
      sourceSha,
    }) &&
    !compatibilityChangedPaths.some((file) =>
      REMOTE_AGENT_RECEIVER_FIRST_CONTRACT_PATHS.has(file)
    )
  ) {
    throw new Error(
      "Native delivery changes both sides of the Remote Agent contract without an unambiguous request owner. Split Core/CLI and Remote Agent into explicitly ordered releases after reviewing request and response compatibility."
    );
  }
  const deployOrderProfile = resolveProductionDeployOrderProfile(
    compatibilityChangedPaths,
    taskInboxRetired
  );
  const deployScopeOrder = resolveProductionDeployScopeOrder(
    scopes,
    compatibilityChangedPaths,
    taskInboxRetired,
    compatibilityContext
  );
  return {
    ...describeProductionReleaseImpact(context),
    coreProjectionFromCli: scopes.includes("cli"),
    deployOrderProfile,
    deployScopeOrder,
    deploySteps: buildProductionDeployStepSpecs(scopes, {
      databaseBackend: input.databaseBackend,
      databaseCutoverSnapshot: input.databaseCutoverSnapshot,
      compatibilityContext,
      changedPaths,
      compatibilityChangedPaths,
      taskInboxRetired,
      releaseSha: sourceSha,
    }),
    preflightSteps: buildProductionPreflightStepSpecs({
      changedPaths,
      releaseSha: sourceSha,
      scopes,
      taskInboxRetired,
    }),
    verifySteps: buildProductionVerifyStepSpecs({
      changedPaths,
      scopes,
      taskInboxRetired,
    }),
  };
}

function inspectTaskInboxRetirement({ base, changedPaths, sourceSha }) {
  if (
    !(
      changedPaths.includes(INBOX_SCHEMA_PATH) &&
      changedPaths.includes(RETIRED_TASK_INBOX_PRODUCER_PATH)
    )
  ) {
    return false;
  }
  const mergeBase = runGit(["merge-base", base, sourceSha ?? "HEAD"]).trim();
  const before = runGit(["show", `${mergeBase}:${INBOX_SCHEMA_PATH}`]);
  const after = sourceSha
    ? runGit(["show", `${sourceSha}:${INBOX_SCHEMA_PATH}`])
    : readFileSync(INBOX_SCHEMA_PATH, "utf8");
  const retiredPatterns = [
    TASK_INBOX_KIND_LINE,
    TASK_INBOX_SOURCE_KIND_LINE,
    TASK_INBOX_TARGET_BLOCK,
  ];
  if (
    !retiredPatterns.some(
      (pattern) => pattern.test(before) && !pattern.test(after)
    )
  ) {
    return false;
  }
  const producerStillExists = sourceSha
    ? runGit([
        "ls-tree",
        "--name-only",
        sourceSha,
        "--",
        RETIRED_TASK_INBOX_PRODUCER_PATH,
      ]).trim().length > 0
    : existsSync(RETIRED_TASK_INBOX_PRODUCER_PATH);
  const expected = retiredPatterns.reduce(
    (source, pattern) => source.replace(pattern, ""),
    before
  );
  if (
    !retiredPatterns.every(
      (pattern) => pattern.test(before) && !pattern.test(after)
    ) ||
    expected !== after ||
    producerStillExists
  ) {
    throw new Error(
      "Task Inbox retirement must remove its producer and only the retired contract. Mixed Inbox expansion or other contract edits require a separate compatibility rollout."
    );
  }
  return true;
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
  const command = step.controlPath
    ? (step.controlCommand ?? step.command)
    : step.command;
  const args = step.controlPath
    ? [
        ...(step.controlNodeArgs ?? []),
        fileURLToPath(new URL(`../../${step.controlPath}`, import.meta.url)),
        ...(step.controlArgs ?? step.args.slice(1)),
      ]
    : step.args;
  const result = spawnSync(resolveCommandBinary(command), args, {
    cwd: step.cwd,
    env: {
      ...(step.env ?? process.env),
      ...(step.controlPath
        ? { OPENMELD_VERIFICATION_ROOT: step.cwd ?? process.cwd() }
        : {}),
    },
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${String(result.status)}`
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
      await input.beforeStep?.(step);
      const publication = await adapters.publishCliRelease({
        cwd: input.cwd ?? process.cwd(),
        env: input.env ?? process.env,
        withBinary: true,
      });
      await input.afterStep?.(step, publication);
      continue;
    }
    let workerDeploymentState;
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
      workerDeploymentState = result;
    }
    await input.beforeStep?.(step, workerDeploymentState);
    const result = await adapters.runStep({
      ...step,
      cwd: input.cwd,
      env: input.env ?? process.env,
    });
    await input.afterStep?.(step, result);
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

function formatCompatibilityPathSignals(signals = []) {
  return signals
    .filter(
      (signal) => signal.matchedPaths.length || signal.nonTriggerPaths.length
    )
    .map(
      (signal) =>
        `Compatibility path signal (${signal.contract}): ${signal.matchedPaths.join(", ") || "no changed producer/contract"}. Non-trigger paths: ${signal.nonTriggerPaths.join(", ") || "none"}. ${signal.reason}`
    );
}

function printPlan(plan, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  const lines = [
    plan.databaseCutover
      ? "PostgreSQL cutover preparation — promotion blocked"
      : "Production release plan",
    `Source: ${plan.sourceSha}${plan.worktreeDirty ? " (includes uncommitted changes)" : ""}`,
    `Base: ${plan.base}`,
    `Scopes: ${plan.scopes.length > 0 ? plan.scopes.join(", ") : "none"}`,
    `Deploy order: ${plan.deployScopeOrder.join(", ") || "none"}`,
  ];
  if (plan.databaseCutover) {
    const cutover = plan.databaseCutover;
    lines.push(
      `Target inventory: ${cutover.target.organization}/${cutover.target.database}, PostgreSQL ${cutover.target.majorVersion}`,
      `Evidence: ${cutover.evidenceStatus}; executor: ${cutover.executor}`,
      `Rolling release ordering: ${plan.rollingRelease.status}${plan.rollingRelease.reason ? ` (${plan.rollingRelease.reason})` : ""}`,
      "Compatibility baseline: source comparison only; deployed component receipts not inspected.",
      "",
      "Required before promotion:",
      ...cutover.requiredBeforePromotion.map(
        (requirement) => `- ${requirement}`
      ),
      "",
      "Maintenance sequence (not executable):",
      ...cutover.maintenanceSequence.map((stage) => `- ${stage}`),
      "",
      `Before the first PostgreSQL write: ${cutover.recovery.beforeFirstPostgresqlWrite}`,
      `After the first PostgreSQL write: ${cutover.recovery.afterFirstPostgresqlWrite}`
    );
  }
  lines.push(...formatCompatibilityPathSignals(plan.compatibilityPathSignals));
  for (const bridge of plan.compatibilityBridges ?? []) {
    lines.push(
      `Compatibility bridge: ${bridge.kind} from ${bridge.baselineSha} (${bridge.evidence}).`
    );
  }
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
  const options = {
    ...parseProductionReleaseArgs(argv),
    databaseBackend: "postgresql",
  };
  if (options.databaseCutover) {
    if (options.scope !== "auto") {
      throw new Error(
        "Cutover preparation reviews the complete source impact; keep --scope auto."
      );
    }
    const databaseCutover = await readPostgresqlCutoverPreparation();
    const impact = buildProductionReleaseImpact(options);
    let rollingRelease;
    try {
      const ordinary = buildProductionReleasePlan({
        ...options,
        changedPaths: impact.changedPaths,
        affectedPackages: impact.affectedPackages,
      });
      rollingRelease = {
        status: "ordering_resolved_only",
        deployScopeOrder: ordinary.deployScopeOrder,
      };
    } catch (error) {
      rollingRelease = {
        status: "blocked",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    printPlan(
      {
        ...impact,
        databaseCutover,
        rollingRelease,
        compatibilityEvidence: {
          basis: "source_comparison_only",
          deployedComponentReceipts: "not_inspected",
        },
        worktreeDirty: runGit(["status", "--porcelain=v1"]).trim().length > 0,
        coordinatedScopeReview: sortScopes([
          "db",
          ...CLOUD_SCOPES,
          ...impact.scopes,
        ]),
        deployScopeOrder: [],
        deploySteps: [],
        preflightSteps: [],
        verifySteps: [],
      },
      options.json
    );
    return;
  }
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
  // Domain preparation/restoration publishes no candidate application bytes.
  // Keep source and environment guards without requiring a new renderer build
  // to restore the exact previous deployment during an outage.
  let preparationSteps =
    options.command === "verify" ? plan.verifySteps : plan.preflightSteps;
  if (options.domainPhase) {
    preparationSteps = buildCommonReleaseStepSpecs([]);
  }
  for (const step of preparationSteps) {
    runStep(step);
  }
  assertSourceStillMatches(plan.sourceSha);
  if (options.command === "preflight" && options.databaseCutoverSnapshot) {
    await admitPostgresqlProductRelease({
      snapshot: options.databaseCutoverSnapshot,
      scopes: plan.scopes,
    });
  }
  if (options.command === "verify" || options.command === "preflight") {
    return;
  }
  const domainInput = {
    sourceSha: plan.sourceSha,
    scopes: plan.scopes,
    evidencePath: options.domainEvidence,
  };
  await executeWithProductionScopeLeases({
    execute: async () => {
      if (options.domainPhase) {
        const operation =
          options.domainPhase === "prepare"
            ? prepareWebsiteDomains
            : rollbackWebsiteDomains;
        const result = await operation(domainInput);
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return;
      }
      const databaseAdmission = await admitPostgresqlProductRelease({
        snapshot: options.databaseCutoverSnapshot,
        scopes: plan.scopes,
        sourceSha: plan.sourceSha,
        restoreCrons: options.databaseCutoverRestoreCrons,
      });
      process.stdout.write(`${JSON.stringify({ databaseAdmission })}\n`);
      if (options.databaseCutoverRestoreCrons) {
        await restoreProductCrons({
          runStep: (step) => {
            assertSourceStillMatches(plan.sourceSha);
            runStep(step);
            assertSourceStillMatches(plan.sourceSha);
          },
        });
        return;
      }
      const admission = await admitWebsiteDomainRelease(domainInput);
      await withPostgresqlCutoverConfig(
        process.cwd(),
        Boolean(options.databaseCutoverSnapshot),
        (env) =>
          executeObservedDomainRelease(domainInput, admission, () =>
            executeRecordedProductionDeploySteps({
              env,
              sourceSha: plan.sourceSha,
              executeSteps: executeProductionDeploySteps,
              redeploy: options.redeploy ?? false,
              beforeStep: () => {
                assertSourceStillMatches(plan.sourceSha);
                for (const scope of ["auth", "core"]) {
                  cutoverConfigArgs(scope, { env });
                }
              },
              runCommand: runReadOnlyCommand,
              afterStep: () => assertSourceStillMatches(plan.sourceSha),
              steps: options.databaseCutoverSnapshot
                ? cutoverDeploySteps(plan.deploySteps)
                : plan.deploySteps,
            })
          )
      );
      if (options.databaseCutoverSnapshot) {
        await verifyProductCrons({
          registered: await readCutoverTarget(),
          paused: true,
        });
      }
    },
    owner: resolveLocalReleaseOwner(),
    scopes: options.domainEvidence
      ? [...plan.scopes, "auth", "web", "website"]
      : plan.scopes,
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
    receiptWorkerDeploymentArgs: input.args,
  };
}

function isDatabaseSchemaPath(path) {
  if (
    path.startsWith(DB_MIGRATION_PATH_PREFIX) ||
    path.startsWith("packages/db/postgresql/migrations/")
  ) {
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
  return CENTER_AGENT_CONTEXT_MANIFEST_CONTRACT_PATHS.has(path);
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
