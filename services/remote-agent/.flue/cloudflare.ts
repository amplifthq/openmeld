import { env as workerEnv } from "cloudflare:workers";

// The Center Agent's computer: org-level durable workspace DO, the
// loopback WorkerEntrypoint its worker-shell isolate dials back through,
// and the WorkspaceProxy that carries the container's /ws egress home.
// biome-ignore lint/performance/noBarrelFile: Cloudflare requires the Worker entrypoint to export the WorkspaceServiceProxy WorkerEntrypoint class.
export { WorkspaceProxy, WorkspaceServiceProxy } from "@cloudflare/computer";
export { AgentComputer } from "../flue-adapter/computer-workspace";

import {
  remoteAgentWorkerCancellationRequestSchema,
  remoteAgentWorkerExecutionQuerySchema,
  remoteAgentWorkerReadUsageDiagnosticsRequestSchema,
  remoteAgentWorkerRuntimeDiagnosticsRequestSchema,
  remoteAgentWorkerSubmitTurnRequestSchema,
} from "@openmeld/schemas";
import { summarizeAgentActivityDigest } from "../agent-core/agent-activity-digest";
import {
  type CenterAgentNamespace,
  cancelExecutionInCenterAgent,
  readExecutionStateFromCenterAgent,
  readRuntimeDiagnosticsFromCenterAgent,
  readUsageDiagnosticsFromCenterAgent,
  reconcileExecutionInCenterAgent,
  submitConversationTurnToCenterAgent,
} from "../flue-adapter/cloudflare-entrypoint";
import {
  observeRemoteAgentRpc,
  resolveSubmitConversationTurnOutcome,
} from "../flue-adapter/cloudflare-runtime-evidence";

const env = workerEnv as unknown as CloudflareBindings;

export default {
  async cancelExecution(input: unknown) {
    const namespace = env.FLUE_CENTER_AGENT_AGENT as CenterAgentNamespace;
    return await observeRemoteAgentRpc({
      ...readCancellationCorrelation(input),
      env,
      execute: () =>
        cancelExecutionInCenterAgent({ namespace, request: input }),
      operation: "cancelExecution",
    });
  },

  async readExecutionState(input: unknown) {
    const namespace = env.FLUE_CENTER_AGENT_AGENT as CenterAgentNamespace;
    return await observeRemoteAgentRpc({
      ...readExecutionStateCorrelation(input),
      env,
      execute: () =>
        readExecutionStateFromCenterAgent({
          namespace,
          request: input,
        }),
      operation: "readExecutionState",
    });
  },

  async reconcileExecution(input: unknown) {
    const namespace = env.FLUE_CENTER_AGENT_AGENT as CenterAgentNamespace;
    return await observeRemoteAgentRpc({
      ...readExecutionStateCorrelation(input),
      env,
      execute: () =>
        reconcileExecutionInCenterAgent({
          namespace,
          request: input,
        }),
      operation: "reconcileExecution",
    });
  },

  async summarizeAgentActivityDigest(input: unknown) {
    return await observeRemoteAgentRpc({
      env,
      execute: () =>
        summarizeAgentActivityDigest({
          env: env as unknown as Parameters<
            typeof summarizeAgentActivityDigest
          >[0]["env"],
          request: input as Parameters<
            typeof summarizeAgentActivityDigest
          >[0]["request"],
        }),
      operation: "summarizeAgentActivityDigest",
    });
  },
  async submitConversationTurn(input: unknown) {
    const namespace = env.FLUE_CENTER_AGENT_AGENT as CenterAgentNamespace;
    return await observeRemoteAgentRpc({
      ...readSubmitTurnCorrelation(input),
      env,
      execute: () =>
        submitConversationTurnToCenterAgent({
          namespace,
          request: input,
        }),
      operation: "submitConversationTurn",
      resolveOutcome: resolveSubmitConversationTurnOutcome,
    });
  },

  async readUsageDiagnostics(input: {
    organizationId?: string;
    spaceId: string;
  }) {
    const namespace = env.FLUE_CENTER_AGENT_AGENT as CenterAgentNamespace;
    return await observeRemoteAgentRpc({
      env,
      execute: () =>
        readUsageDiagnosticsFromCenterAgent({
          namespace,
          request: input,
        }),
      operation: "readUsageDiagnostics",
      spaceId: readUsageDiagnosticsSpaceId(input),
    });
  },

  async readRuntimeDiagnostics(input: unknown) {
    const namespace = env.FLUE_CENTER_AGENT_AGENT as CenterAgentNamespace;
    return await observeRemoteAgentRpc({
      env,
      execute: () =>
        readRuntimeDiagnosticsFromCenterAgent({
          namespace,
          request: input,
        }),
      operation: "readRuntimeDiagnostics",
      spaceId: readRuntimeDiagnosticsSpaceId(input),
    });
  },
};

function readCancellationCorrelation(input: unknown): {
  requestId: string | null;
  spaceId: string | null;
} {
  const parsed = remoteAgentWorkerCancellationRequestSchema.safeParse(input);
  return parsed.success
    ? { requestId: parsed.data.submissionId, spaceId: parsed.data.spaceId }
    : { requestId: null, spaceId: null };
}

function readExecutionStateCorrelation(input: unknown): {
  requestId: string | null;
  spaceId: string | null;
} {
  const parsed = remoteAgentWorkerExecutionQuerySchema.safeParse(input);
  return parsed.success
    ? { requestId: parsed.data.submissionId, spaceId: parsed.data.spaceId }
    : { requestId: null, spaceId: null };
}

function readSubmitTurnCorrelation(input: unknown): {
  bindingId: string | null;
  clientMessageId: string | null;
  dispatchId: string | null;
  spaceId: string | null;
  targetProfileId: string | null;
} {
  const parsed = remoteAgentWorkerSubmitTurnRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      bindingId: null,
      clientMessageId: null,
      dispatchId: null,
      spaceId: null,
      targetProfileId: null,
    };
  }
  return {
    bindingId: parsed.data.bindingId,
    clientMessageId: parsed.data.sourceClientMessageId ?? null,
    dispatchId: parsed.data.dispatchId,
    spaceId: parsed.data.spaceId,
    targetProfileId: parsed.data.agentProfileId,
  };
}

function readUsageDiagnosticsSpaceId(input: unknown): string | null {
  const parsed =
    remoteAgentWorkerReadUsageDiagnosticsRequestSchema.safeParse(input);
  return parsed.success ? parsed.data.spaceId : null;
}

function readRuntimeDiagnosticsSpaceId(input: unknown): string | null {
  const parsed =
    remoteAgentWorkerRuntimeDiagnosticsRequestSchema.safeParse(input);
  return parsed.success ? parsed.data.spaceId : null;
}
