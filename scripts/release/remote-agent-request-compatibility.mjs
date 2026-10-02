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
const REVIEWED_SOURCE_DIGEST =
  "d1f1c7f136ebb79df8f957cc60ca82662be7b65e1091c30a86643b77f558e0e4";

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
