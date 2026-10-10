import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { hasUnchangedInboxSourceTargetContract } from "./inbox-source-target-compatibility.mjs";
import {
  buildProductionReleasePlan,
  resolveProductionCompatibilityDependencies,
  resolveProductionCompatibilityObligations,
  resolveProductionCompatibilityReceiverWitnesses,
} from "./production-release.mjs";
import { assertProductionStageAdmission } from "./production-stage-admission.mjs";
import { parseUnambiguousConfig } from "./remote-ai-usage-compatibility.mjs";

const TARGET = "086b13c757830db13916b992587556f10f6284d0";
const CORE_BASE = "96cb28b5a32f3757c6fd2b78ede81044a45a5a6b";
const CLIENT_BASE = "2de34997f690f3c6bc87c396a2a40e040a96051c";
const INBOX = "packages/schemas/src/schemas/http/inbox.ts";
const CORE_RPC = "services/core/src/inbox/transport/rpc/inbox-rpc.ts";
const GW_RPC = "services/gateway/src/routes/rpc-http.inbox.ts";
const NATIVE =
  "services/core/src/remote-agent/application/native-delivery-service.ts";
const PATHS = [INBOX, NATIVE];
const originals = new Map();
const REQUIRED_TARGET_SCOPES = /requires the Web, Gateway, and Core scopes/u;
const PENDING_RECEIVER = /pending prerequisite/u;
const UNKNOWN_RECEIVER = /unresolved|unknown|prerequisite/u;
function readOriginal(sha, file) {
  const key = `${sha}:${file}`;
  if (!originals.has(key)) {
    originals.set(
      key,
      execFileSync("git", ["show", key], {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      })
    );
  }
  return originals.get(key);
}
function context(overrides = new Map(), base = CLIENT_BASE) {
  return {
    base,
    sourceSha: TARGET,
    readGitFile(sha, file) {
      if (![base, TARGET].includes(sha)) {
        throw new Error("Read exact product source, not release-control HEAD.");
      }
      return sha === TARGET && overrides.has(file)
        ? overrides.get(file)
        : readOriginal(sha, file);
    },
  };
}
function changed(file, before, after) {
  const original = readOriginal(TARGET, file);
  if (!original.includes(before)) {
    throw new Error(`Real counterexample location missing: ${file}`);
  }
  return new Map([[file, original.replace(before, after)]]);
}

test("actual deployed Inbox target boundaries remain equal across membership and retained time changes", () => {
  for (const base of [CORE_BASE, CLIENT_BASE]) {
    assert.equal(
      hasUnchangedInboxSourceTargetContract(context(new Map(), base)),
      true
    );
  }
});

test("actual legacy target repair, row mapping and route bindings keep the original gate", () => {
  const cases = [
    [
      "services/core/src/inbox/application/inbox-legacy-space-awareness.ts",
      '? { ...candidate, importance: "normal" }',
      '? { ...candidate, importance: "normal", sourceTarget: { kind: "settings", section: "computers" } }',
    ],
    [
      "services/core/src/inbox/application/inbox-legacy-interaction-attention.ts",
      "const { candidate, existing } = input;",
      'const { candidate, existing } = input; candidate.sourceTarget = { kind: "settings", section: "computers" };',
    ],
    [
      "services/core/src/inbox/application/inbox-service.ts",
      "sourceTarget: target,",
      'sourceTarget: { kind: "settings", section: "computers" },',
    ],
    [
      "services/core/src/inbox/application/inbox-service.ts",
      "return new Date(value).toISOString();",
      "return new Date(0).toISOString();",
    ],
    [
      "services/core/src/inbox/application/inbox-service.ts",
      "const nowMs = input.nowMs ?? Date.now;",
      'const mapInboxItemRow = (row: InboxItemRow) => ({ ...row, sourceTarget: { kind: "settings", section: "computers" } }); const nowMs = input.nowMs ?? Date.now;',
    ],
    [
      GW_RPC,
      "export function registerInboxRoutes(app: Hono<HonoBindings>): void {",
      'export function registerInboxRoutes(app: Hono<HonoBindings>): void { const executeRpcRoute = () => ({ sourceTarget: { kind: "settings", section: "computers" } });',
    ],
    [
      GW_RPC,
      "export function registerInboxRoutes(app: Hono<HonoBindings>): void {",
      'export function registerInboxRoutes(app: Hono<HonoBindings>): void { projectPluginRequestForClient = item => ({ ...item, sourceTarget: { kind: "settings", section: "computers" } });',
    ],
  ];
  for (const base of [CORE_BASE, CLIENT_BASE]) {
    for (const [file, before, after] of cases) {
      const value = context(changed(file, before, after), base);
      assert.equal(hasUnchangedInboxSourceTargetContract(value), false, file);
      assert.throws(
        () =>
          buildProductionReleasePlan({
            ...value,
            changedPaths: PATHS,
            scope: "core",
            databaseBackend: "postgresql",
          }),
        REQUIRED_TARGET_SCOPES,
        file
      );
    }
  }
});

test("actual target union, wrappers, writers and strict target dependencies keep the original gate", () => {
  const cases = [
    [
      INBOX,
      'kind: z.literal("settings"),',
      'kind: z.literal("unknown_target"),',
    ],
    [
      INBOX,
      "item: inboxItemSchema,",
      'item: inboxItemSchema.transform(item => ({ ...item, sourceTarget: { kind: "unknown_target" } })),',
    ],
    [
      INBOX,
      "sourceTarget: inboxSourceTargetSchema,",
      "sourceTarget: z.unknown(),",
    ],
    [
      INBOX,
      "const identifierSchema =",
      'const identifierSchema = z.literal("changed"); const unusedIdentifierSchema =',
    ],
    [
      "packages/schemas/src/schemas/daemon/service-contract.ts",
      "export const daemonServiceLaneSchema",
      'export const daemonServiceLaneSchema = z.literal("unknown"); const previousLaneSchema',
    ],
    [
      "services/core/src/remote-agent/application/native-delivery-inbox-producer.ts",
      "sourceTarget: {",
      "sourceTarget: { unknownTargetField: true,",
    ],
    [
      "clients/web/src/lib/inbox/source-target.ts",
      'case "computer_connection":',
      'case "unknown_target":',
    ],
    [
      "packages/api-client/src/inbox/api.ts",
      "function inboxSourceTargetVersionHeaders()",
      "function inboxSourceTargetVersionHeadersChanged()",
    ],
  ];
  for (const [file, before, after] of cases) {
    const value = context(changed(file, before, after));
    assert.equal(hasUnchangedInboxSourceTargetContract(value), false, file);
    assert.throws(
      () =>
        buildProductionReleasePlan({
          ...value,
          changedPaths: PATHS,
          scope: "core",
          databaseBackend: "postgresql",
        }),
      REQUIRED_TARGET_SCOPES,
      file
    );
  }
});

test("complete projection and actual transport structure reject target mutations and side effects", () => {
  const cases = [
    [
      CORE_RPC,
      "return { ...compatibleItem, sourceTarget };",
      'return { ...compatibleItem, sourceTarget: { kind: "settings", section: "computers" } };',
    ],
    [
      CORE_RPC,
      '? { ...item, kind: "system_issue" }',
      '? { ...item, kind: "system_issue", sourceTarget: { kind: "settings", section: "computers" } }',
    ],
    [
      GW_RPC,
      "projectMembershipNoticeForClient(value.item, value.itemKindVersion)",
      "projectMembershipNoticeForClient(value.item, changeTarget(value.item))",
    ],
    [
      GW_RPC,
      "row.item,\n                resolveInboxItemKindVersion(c)",
      "row.item,\n                changeTarget(row.item)",
    ],
    [
      GW_RPC,
      "itemId: params.data.itemId,",
      "itemId: mutateTarget(params.data.itemId),",
    ],
    [
      CORE_RPC,
      "response.item,\n            request.includeReplyToRecipient,",
      "{ ...response.item, sourceTarget: unknownTarget },\n            request.includeReplyToRecipient,",
    ],
    [
      "services/core/src/inbox/application/inbox-item-service.ts",
      'assertValidTimestamp(input.nowMs, "nowMs");',
      'candidate.sourceTarget = { kind: "settings", section: "computers" }; assertValidTimestamp(input.nowMs, "nowMs");',
    ],
    [
      NATIVE,
      "input.inheritedWorkerRequest.turnEnvelope.requestTimeContext",
      "input.inheritedWorkerRequest.turnEnvelope.unknownContext",
    ],
    [
      NATIVE,
      "continuationContext,\n        inheritedWorkerRequest,",
      "continuationContext,\n        inheritedWorkerRequest: mutateRequest(inheritedWorkerRequest),",
    ],
  ];
  for (const [file, before, after] of cases) {
    assert.equal(
      hasUnchangedInboxSourceTargetContract(
        context(changed(file, before, after))
      ),
      false,
      before
    );
  }
});

test("bindings, direct runtime imports, exports and inherited resolver config must remain known", () => {
  const cases = [
    [
      INBOX,
      'from "../daemon/service-contract"',
      'from "../daemon/other-contract"',
    ],
    [
      "packages/schemas/src/index.ts",
      'export * from "./schemas/index";',
      'export * from "./other-schemas/index";',
    ],
    [
      "packages/api-client/src/index.ts",
      'from "./inbox/notification-policy"',
      'from "./other/notification-policy"',
    ],
    [
      "services/core/src/index.ts",
      "export class GatewayRpcEntrypoint extends CoreRpcEntrypoint {",
      "export class GatewayRpcEntrypoint extends CoreRpcEntrypoint { constructor() { super(); this.env = changedBindings; }",
    ],
    [
      "services/core/src/index.ts",
      'from "./inbox/transport/rpc/inbox-rpc"',
      'from "./other/inbox-rpc"',
    ],

    [
      "tooling/typescript-config/base.jsonc",
      '"compilerOptions": {',
      '"compilerOptions": { "paths": { "@openmeld/db/postgresql": ["../../other-wrapper.ts"] },',
    ],
    [
      "packages/db/tsconfig.json",
      '"../../tooling/typescript-config/base.jsonc"',
      '"../../tooling/typescript-config/other.jsonc"',
    ],
    ["pnpm-workspace.yaml", "  zod: 4.6.5", "  zod: 4.6.4"],
  ];
  for (const [file, before, after] of cases) {
    assert.equal(
      hasUnchangedInboxSourceTargetContract(
        context(changed(file, before, after))
      ),
      false,
      file
    );
  }
  const gatewayConfigPath = "services/gateway/wrangler.jsonc";
  const gatewayConfig = parseUnambiguousConfig(
    gatewayConfigPath,
    readOriginal(TARGET, gatewayConfigPath)
  );
  gatewayConfig.env.prod.services.find(
    (binding) => binding.binding === "OPENMELD_CORE_WORKER"
  ).entrypoint = "OtherEntrypoint";
  assert.equal(
    hasUnchangedInboxSourceTargetContract(
      context(new Map([[gatewayConfigPath, JSON.stringify(gatewayConfig)]]))
    ),
    false
  );
});

test("unreadable, ambiguous or missing explicit product source keeps the original target obligation", () => {
  const duplicate = `${readOriginal(TARGET, INBOX)}\nexport const inboxSourceTargetSchema = z.unknown();\n`;
  for (const value of [
    {},
    { ...context(), sourceSha: "HEAD" },
    {
      ...context(),
      readGitFile() {
        throw new Error("unresolved product source");
      },
    },
    context(new Map([[INBOX, duplicate]])),
    context(
      new Map([
        [
          CORE_RPC,
          `${readOriginal(TARGET, CORE_RPC)}\nprojectReplyToRecipientForReceiver = unknownProjector;\n`,
        ],
      ])
    ),
  ]) {
    assert.equal(hasUnchangedInboxSourceTargetContract(value), false);
  }
});

test("actual plan and stage retain membership receiver-first without any target or pair witness", () => {
  const value = context();
  const obligations = resolveProductionCompatibilityObligations(
    PATHS,
    false,
    value
  );
  assert.deepEqual(obligations, [
    {
      contract: "inbox-membership-opt-in",
      receiver: "core",
      producer: "gateway",
    },
  ]);
  const dependencies = resolveProductionCompatibilityDependencies(
    PATHS,
    false,
    value
  );
  assert.deepEqual(dependencies, [["core", "gateway"]]);
  const plan = buildProductionReleasePlan({
    ...value,
    changedPaths: PATHS,
    scope: "core,gateway",
    databaseBackend: "postgresql",
  });
  assert.deepEqual(plan.deployScopeOrder, ["core", "gateway"]);
  assert.doesNotThrow(() =>
    buildProductionReleasePlan({
      ...value,
      changedPaths: PATHS,
      scope: "core",
      databaseBackend: "postgresql",
    })
  );
  assert.deepEqual(
    resolveProductionCompatibilityReceiverWitnesses(PATHS, value),
    []
  );
  const receiver = { scope: "core", state: "pending", sha: CORE_BASE };
  const producer = {
    scope: "gateway",
    state: "pending",
    sha: CLIENT_BASE,
    compatibilityObligations: obligations,
    compatibilityDependencies: dependencies,
    compatibilityReceiverWitnesses: [
      {
        receiver: "core",
        producer: "gateway",
        contracts: ["profile-workspace-read"],
        evidence: {
          result: "match",
          baselineSha: CORE_BASE,
          targetSha: TARGET,
        },
      },
    ],
  };
  const stage = {
    sourceSha: TARGET,
    components: [receiver, producer],
    selectedScopes: ["gateway"],
  };
  assert.throws(() => assertProductionStageAdmission(stage), PENDING_RECEIVER);
  receiver.state = "unknown";
  assert.throws(() => assertProductionStageAdmission(stage), UNKNOWN_RECEIVER);
  receiver.state = "current";
  receiver.sha = TARGET;
  assert.doesNotThrow(() => assertProductionStageAdmission(stage));
});
