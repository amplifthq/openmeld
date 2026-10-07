import { createHash } from "node:crypto";

// Reviewed against the actual published Remote receiver, not an issue's version.
// This exception waives only its request-receiver-first edge. Metering and
// callback reader dependencies remain Core-first. Any owner change invalidates
// the witness; a method-name/string check must not bless future wire changes.
const REVIEWED_BASELINE = "e4454cf165b96c7f918e420f28205c2b2ed3c575";
export const REMOTE_AGENT_REQUEST_BRIDGE_PATHS = [
  "packages/schemas/src/schemas/runtime/remote-agent-worker.ts",
  "packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts",
  "services/core/src/remote-agent/application/native-delivery-service.ts",
  "services/core/src/remote-agent/application/remote-agent-worker-admission.ts",
  "services/core/src/remote-agent/application/remote-agent-conversation-continuity.ts",
  "services/core/src/remote-agent/application/native-delivery-cancellation-service.ts",
  "services/core/src/remote-agent/application/slack-signal-service.ts",
  "services/core/src/center-agent/application/task-summary-recovery-service.ts",
  "services/remote-agent/.flue/cloudflare.ts",
  "services/remote-agent/.flue/agents/center-agent.ts",
  "services/remote-agent/flue-adapter/cloudflare-entrypoint.ts",
  "services/remote-agent/flue-adapter/execution-reconciliation.ts",
];
// Revalidated with the archived e4454cf1 strict schema, built Remote workerd
// service-binding RPC, frozen-request replay and legacy completion callbacks.
// This witnesses request compatibility only; Core's metering admission remains
// mandatory and its verified deployment must precede the Remote stage.
const REVIEWED_SOURCE_DIGEST =
  "d6cd6588c816f1a5f9e2edfdcd3b247ee154bf092e36f2ce102e8a7988ecfa63";

const COMPUTER_ENTRYPOINT_ADDITIONS = [
  'import type { AgentComputerNamespace } from "../flue-adapter/agent-computer-workspace-access";\n',
  'import { personalComputerProviderName } from "../flue-adapter/computer-identity";\n',
  'import type { AgentComputer } from "../flue-adapter/computer-workspace";\n',
  "  cloudComputerOperationResultSchema,\n",
  "  cloudComputerWorkerRequestSchema,\n",
  `  async cloudComputerOperation(value: unknown) {
    const request = cloudComputerWorkerRequestSchema.parse(value);
    const namespace = env.AGENT_COMPUTER as AgentComputerNamespace;
    const stub = namespace.get(
      namespace.idFromName(personalComputerProviderName(request.computer.id))
    ) as DurableObjectStub<AgentComputer>;
    return cloudComputerOperationResultSchema.parse(
      await stub.computerOperation(request.operation)
    );
  },
`,
];

// The new Computer facet does not change existing Core-to-Remote requests.
// Compare the actual receipt baseline, permitting only these reviewed additions
// at the two changed Remote owners. Unknown request or receiver edits fail closed.
export function resolvePersonalCloudComputerRequestCompatibility(input) {
  if (!(input.base && input.sourceSha && input.readGitFile)) {
    return null;
  }
  try {
    for (const path of REMOTE_AGENT_REQUEST_BRIDGE_PATHS) {
      const before = String(input.readGitFile(input.base, path));
      let after = String(input.readGitFile(input.sourceSha, path));
      if (path === "services/remote-agent/.flue/cloudflare.ts") {
        for (const addition of COMPUTER_ENTRYPOINT_ADDITIONS) {
          if (!after.includes(addition)) {
            return null;
          }
          after = after.replace(addition, "");
        }
        after = after
          .replace(
            "// Account-owned personal Computers, the\n",
            "// The Center Agent's computer: org-level durable workspace DO, the\n"
          )
          .replace(
            "// and the WorkspaceProxy that carries the container's /api egress home.\n",
            "// and the WorkspaceProxy that carries the container's /ws egress home.\n"
          );
      } else if (
        path === "services/remote-agent/.flue/agents/center-agent.ts"
      ) {
        after = after
          .replace(
            "computerIsolationVersion === 3",
            "computerIsolationVersion === 2"
          )
          .replace(
            "checkRemoteAgentExecutionFinish({\n            env,\n",
            "checkRemoteAgentExecutionFinish({\n"
          );
      }
      if (after !== before) {
        return null;
      }
    }
    return {
      receiver: "remote-agent",
      producer: "core",
      kind: "additive-personal-cloud-computer",
      baselineSha: input.base,
      sourceSha: input.sourceSha,
      evidence: [...REMOTE_AGENT_REQUEST_BRIDGE_PATHS],
      recovery:
        "Existing native requests remain unchanged. Deploy the Core Computer identity receiver before Remote, then Gateway before publishing the CLI caller.",
    };
  } catch {
    return null;
  }
}

export function resolveRemoteAgentRequestCompatibilityBridge(input) {
  if (
    input.base !== REVIEWED_BASELINE ||
    !input.sourceSha ||
    !input.readGitFile
  ) {
    return null;
  }
  try {
    const digest = createHash("sha256");
    for (const path of REMOTE_AGENT_REQUEST_BRIDGE_PATHS) {
      digest.update(path).update("\0");
      digest.update(input.readGitFile(input.sourceSha, path)).update("\0");
    }
    if (digest.digest("hex") !== REVIEWED_SOURCE_DIGEST) {
      return null;
    }
    return {
      receiver: "remote-agent",
      producer: "core",
      kind: "negotiated-remote-task-attribution",
      baselineSha: input.base,
      sourceSha: input.sourceSha,
      evidence: REVIEWED_SOURCE_DIGEST,
      recovery:
        "Negotiate taskId before freezing new requests; replay frozen requests unchanged. Summary recovery remains capability-gated. Deploy Core readers before Remote producers.",
    };
  } catch {
    return null;
  }
}
