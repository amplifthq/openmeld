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
const CURRENT_TARGET = "1eaeaa6fc189df89797d770291286a308d2d4b17";
const CORE_BASE = "96cb28b5a32f3757c6fd2b78ede81044a45a5a6b";
const CLIENT_BASE = "2de34997f690f3c6bc87c396a2a40e040a96051c";
const INBOX = "packages/schemas/src/schemas/http/inbox.ts";
const CORE_RPC = "services/core/src/inbox/transport/rpc/inbox-rpc.ts";
const GW_RPC = "services/gateway/src/routes/rpc-http.inbox.ts";
const NATIVE =
  "services/core/src/remote-agent/application/native-delivery-service.ts";
const PATHS = [INBOX, NATIVE];
const originals = new Map();
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
function context(overrides = new Map(), base = CLIENT_BASE, target = TARGET) {
  return {
    base,
    sourceSha: target,
    readGitFile(sha, file) {
      if (![base, target].includes(sha)) {
        throw new Error("Read exact product source, not release-control HEAD.");
      }
      return sha === target && overrides.has(file)
        ? overrides.get(file)
        : readOriginal(sha, file);
    },
  };
}
function changed(file, before, after, target = TARGET) {
  const original = readOriginal(target, file);
  if (!original.includes(before)) {
    throw new Error(`Real counterexample location missing: ${file}`);
  }
  return new Map([[file, original.replace(before, after)]]);
}

function assertTargetReceiverAdmission(value) {
  const plan = buildProductionReleasePlan({
    ...value,
    changedPaths: PATHS,
    scope: "core",
    databaseBackend: "postgresql",
  });
  for (const receiver of ["web", "gateway"]) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: Called synchronously by the mutation contract tests below.
    assert.ok(
      plan.compatibilityDependencies.some(
        ([from, to]) => from === receiver && to === "core"
      ),
      `${receiver} must precede the changed Core writer`
    );
  }
  const stage = {
    sourceSha: value.sourceSha,
    selectedScopes: ["core"],
    components: ["web", "gateway", "core"].map((scope) => ({
      scope,
      state: "pending",
      compatibilityDependencies: plan.compatibilityDependencies,
    })),
  };
  // biome-ignore lint/suspicious/noMisplacedAssertion: Called synchronously by the mutation contract tests below.
  assert.throws(() => assertProductionStageAdmission(stage), PENDING_RECEIVER);
  // biome-ignore lint/suspicious/noMisplacedAssertion: Called synchronously by the mutation contract tests below.
  assert.doesNotThrow(() =>
    assertProductionStageAdmission({
      ...stage,
      components: stage.components.map((component) => ({
        ...component,
        state: component.scope === "core" ? "pending" : "current",
      })),
    })
  );
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
      assertTargetReceiverAdmission(value);
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
    assertTargetReceiverAdmission(value);
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

test("merged product query, source-read and native rejection preserve both actual target baselines", () => {
  for (const base of [CORE_BASE, CLIENT_BASE]) {
    assert.equal(
      hasUnchangedInboxSourceTargetContract(
        context(new Map(), base, CURRENT_TARGET)
      ),
      true
    );
  }
});

test("merged query and source-read imports cannot change targets or escape the exact delegate", () => {
  const cases = [
    [
      "packages/api-client/src/inbox/api.ts",
      "const query = new URLSearchParams();",
      "client.requestJson = hijackedRequest; const query = new URLSearchParams();",
    ],
    [
      "packages/api-client/src/inbox/api.ts",
      'query.set("includeSourceKeys", "true");',
      'query.set("sourceTarget", "unknown");',
    ],
    [
      "packages/api-client/src/inbox/api.ts",
      "schema: spaceInboxUnreadTargetsResponseSchema,",
      "schema: inboxItemSchema,",
    ],
    [
      CORE_RPC,
      'from "../../../rpc/space-ref"',
      'from "../../../rpc/unknown-space-ref"',
    ],
    [
      CORE_RPC,
      "import { resolveSpaceStub }",
      "import { changedStub as resolveSpaceStub }",
    ],
    [
      CORE_RPC,
      "resolveReadCandidates: async (sources) => {",
      "resolveReadCandidates: async (sources) => { const resolveSpaceStub = changedStub;",
    ],
    [
      CORE_RPC,
      "const request = parseRequest(mutateSpaceInboxReadRpcInputSchema, input);",
      "const request = parseRequest(mutateSpaceInboxReadRpcInputSchema, input); resolveSpaceStub = changedStub;",
    ],
    [
      CORE_RPC,
      "const prepared = await prepareRequest(env, request.context);",
      'const prepared = await prepareRequest(env, request.context); await prepared.db.execute("UPDATE inbox_items SET source_target_json = \'{\\"kind\\":\\"settings\\",\\"section\\":\\"computers\\"}\' WHERE id = \'synthetic-only\'");',
    ],
    [
      CORE_RPC,
      "return inboxSourceCandidateSchema.array().parse(",
      "return inboxSourceCandidateSchema.transform(changeTarget).array().parse(",
    ],
    [
      CORE_RPC,
      "export async function rpcGetSpaceInboxUnreadTargets(",
      "function unrelatedTargetWriter() { return resolveSpaceStub(changedBindings, changedTarget); } export async function rpcGetSpaceInboxUnreadTargets(",
    ],
    [
      NATIVE,
      '...input,\n      failureCode: "space.handoff.code_receiver_unsupported",',
      '...input, message: changedTargetMessage,\n      failureCode: "space.handoff.code_receiver_unsupported",',
    ],
    [
      NATIVE,
      "const failureTarget = await resolveRemoteAgentFailureTarget({",
      "input.message.spaceId = changedTarget; const failureTarget = await resolveRemoteAgentFailureTarget({",
    ],
    [
      NATIVE,
      "const tasks: AgentTaskHandle[] = [",
      "input.delivery.spaceId = changedTarget; const tasks: AgentTaskHandle[] = [",
    ],
    [
      NATIVE,
      "  spaceCodeWorkHandoffSchema,",
      "  otherPredicate as spaceCodeWorkHandoffSchema,",
    ],
    [
      "packages/schemas/src/index.ts",
      '} from "./space-work-handoff";',
      '} from "./unknown-handoff";',
    ],
  ];
  for (const base of [CORE_BASE, CLIENT_BASE]) {
    for (const [file, before, after] of cases) {
      const value = context(
        changed(file, before, after, CURRENT_TARGET),
        base,
        CURRENT_TARGET
      );
      assert.equal(
        hasUnchangedInboxSourceTargetContract(value),
        false,
        `${base}:${file}:${before}`
      );
      assertTargetReceiverAdmission(value);
    }
  }
});

test("current actual plan keeps membership and visible-source obligations independent", () => {
  const value = context(new Map(), CLIENT_BASE, CURRENT_TARGET);
  const paths = execFileSync(
    "git",
    ["diff", "--name-only", CLIENT_BASE, CURRENT_TARGET],
    { encoding: "utf8" }
  )
    .trim()
    .split("\n");
  const obligations = resolveProductionCompatibilityObligations(
    paths,
    false,
    value
  ).filter(
    (item) =>
      item.receiver === "core" &&
      item.producer === "gateway" &&
      ["inbox-membership-opt-in", "visible-source-read"].includes(item.contract)
  );
  assert.deepEqual(obligations.map((item) => item.contract).sort(), [
    "inbox-membership-opt-in",
    "visible-source-read",
  ]);
  for (const proved of obligations) {
    const core = { scope: "core", state: "pending", sha: CORE_BASE };
    const gateway = {
      scope: "gateway",
      state: "pending",
      sha: CLIENT_BASE,
      compatibilityObligations: obligations,
      compatibilityDependencies: [["core", "gateway"]],
      compatibilityReceiverWitnesses: [
        {
          receiver: "core",
          producer: "gateway",
          contracts: [proved.contract],
          evidence: {
            result: "match",
            baselineSha: CORE_BASE,
            targetSha: CURRENT_TARGET,
          },
        },
      ],
    };
    const stage = {
      sourceSha: CURRENT_TARGET,
      components: [core, gateway],
      selectedScopes: ["gateway"],
    };
    assert.throws(
      () => assertProductionStageAdmission(stage),
      PENDING_RECEIVER
    );
    core.state = "unknown";
    assert.throws(
      () => assertProductionStageAdmission(stage),
      UNKNOWN_RECEIVER
    );
    core.state = "current";
    core.sha = CURRENT_TARGET;
    assert.doesNotThrow(() => assertProductionStageAdmission(stage));
  }
});
