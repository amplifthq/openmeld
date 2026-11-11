import { env as workerEnv } from "cloudflare:workers";
import {
  pluginComputerConnectionRequestSchema,
  pluginConnectionDescribeRequestSchema,
} from "@openmeld/schemas";
import {
  describePluginConnection,
  pluginConnectionInstructions,
} from "../connectors/plugin-connection";
import { executePluginRuntime } from "../connectors/plugin-runtime";
import { acknowledgeAccountErasure } from "../flue-adapter/account-deletion";
import type { AgentComputerNamespace } from "../flue-adapter/agent-computer-workspace-access";
import { personalComputerProviderName } from "../flue-adapter/computer-identity";
import type { AgentComputer } from "../flue-adapter/computer-workspace";

// biome-ignore lint/performance/noBarrelFile: Native browser code execution uses a Durable Object facet.
export { CodemodeRuntime } from "@cloudflare/codemode";
// Account-owned personal Computers, the
// loopback WorkerEntrypoint its worker-shell isolate dials back through,
// and the WorkspaceProxy that carries the container's /api egress home.
export { WorkspaceServiceProxy } from "@cloudflare/computer";
export { ComputerPreviewOutbound } from "../flue-adapter/computer-preview";
export { AgentComputer } from "../flue-adapter/computer-workspace";
export { WorkspaceProxy } from "../flue-adapter/computer-workspace-proxy";

import {
  accountDeletionComputerSchema,
  accountDeletionConversationSchema,
  cloudComputerOperationResultSchema,
  cloudComputerWorkerRequestSchema,
  remoteAgentWorkerCancellationRequestSchema,
  remoteAgentWorkerExecutionInputQuerySchema,
  remoteAgentWorkerExecutionInputRequestSchema,
  remoteAgentWorkerExecutionQuerySchema,
  remoteAgentWorkerReadUsageDiagnosticsRequestSchema,
  remoteAgentWorkerRuntimeDiagnosticsRequestSchema,
  remoteAgentWorkerSubmitCapabilitiesRequestSchema,
  remoteAgentWorkerSubmitCapabilitiesSchema,
  remoteAgentWorkerSubmitTurnRequestSchema,
} from "@openmeld/schemas";
import {
  type CenterAgentNamespace,
  cancelExecutionInCenterAgent,
  readAdmissionFromCenterAgent,
  readAdmissionStopFromCenterAgent,
  readExecutionInputFromCenterAgent,
  readExecutionStateFromCenterAgent,
  readRuntimeDiagnosticsFromCenterAgent,
  readUsageDiagnosticsFromCenterAgent,
  receiveExecutionInputInCenterAgent,
  reconcileExecutionInCenterAgent,
  runDurableAuxiliaryInference,
  submitConversationTurnToCenterAgent,
} from "../flue-adapter/cloudflare-entrypoint";
import {
  observeRemoteAgentRpc,
  resolveSubmitConversationTurnOutcome,
} from "../flue-adapter/cloudflare-runtime-evidence";

const env = workerEnv as unknown as CloudflareBindings;

export default {
  async describePluginConnection(value: unknown) {
    const request = pluginConnectionDescribeRequestSchema.parse(value);
    return await describePluginConnection({
      ...request,
      connectorExecution: {
        baseUrl: env.OPENMELD_CONNECTORS_BASE_URL,
        runtimeToken: env.OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN,
      },
    });
  },
  async createPluginComputerConnection(value: unknown) {
    const request = pluginComputerConnectionRequestSchema.parse(value);
    if (request.computer.ownerUserId !== request.grant.requesterUserId) {
      throw new Error("plugin.computer_owner_mismatch");
    }
    const namespace = env.AGENT_COMPUTER as AgentComputerNamespace;
    const stub = namespace.get(
      namespace.idFromName(personalComputerProviderName(request.computer.id))
    ) as DurableObjectStub<AgentComputer>;
    await stub.registerPluginConnectionGrant(request.grant);
    const description = await describePluginConnection({
      service: request.grant.service,
      connectionName: request.grant.connectionName,
      connectorExecution: {
        baseUrl: env.OPENMELD_CONNECTORS_BASE_URL,
        runtimeToken: env.OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN,
      },
    });
    return pluginConnectionInstructions(
      description,
      `http://computer.internal/connections/${request.grant.id}`
    );
  },
  async eraseAccountComputer(input: unknown) {
    const request = accountDeletionComputerSchema.parse(input);
    const namespace = env.AGENT_COMPUTER as AgentComputerNamespace;
    await acknowledgeAccountErasure(
      async () =>
        await (
          namespace.get(
            namespace.idFromName(
              personalComputerProviderName(request.computerId)
            )
          ) as DurableObjectStub<AgentComputer>
        ).eraseAccountComputer()
    );
  },
  async eraseAccountConversation(input: unknown) {
    const request = accountDeletionConversationSchema.parse(input);
    const namespace = env.FLUE_CENTER_AGENT_V2_AGENT as CenterAgentNamespace;
    await acknowledgeAccountErasure(
      async () =>
        await namespace
          .get(namespace.idFromName(request.runtimeConversationId))
          .eraseAccountConversation(request)
    );
  },
  async cloudComputerOperation(value: unknown) {
    const request = cloudComputerWorkerRequestSchema.parse(value);
    const namespace = env.AGENT_COMPUTER as AgentComputerNamespace;
    const stub = namespace.get(
      namespace.idFromName(personalComputerProviderName(request.computer.id))
    ) as DurableObjectStub<AgentComputer>;
    return cloudComputerOperationResultSchema.parse(
      await stub.computerOperation(request.operation)
    );
  },
  readSubmitTurnCapabilities(input: unknown) {
    const request =
      remoteAgentWorkerSubmitCapabilitiesRequestSchema.safeParse(input);
    if (!request.success) {
      throw request.error;
    }
    return Promise.resolve(
      remoteAgentWorkerSubmitCapabilitiesSchema.parse({
        v: 1,
        taskId: true,
        ...(request.data.includePluginActionRecovery
          ? { pluginActionRecovery: true }
          : {}),
      })
    );
  },
  async generateCenterAgentSessionTitle(input: unknown) {
    return await runDurableAuxiliaryInference({
      namespace: env.FLUE_CENTER_AGENT_V2_AGENT as CenterAgentNamespace,
      operation: "generateCenterAgentSessionTitle",
      request: input,
    });
  },
  async pluginRuntime(input: unknown) {
    return await executePluginRuntime(input, {
      baseUrl: env.OPENMELD_CONNECTORS_BASE_URL,
      runtimeToken: env.OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN,
    });
  },
  async receiveExecutionInput(input: unknown) {
    const request = remoteAgentWorkerExecutionInputRequestSchema.parse(input);
    return await observeRemoteAgentRpc({
      env,
      operation: "receiveExecutionInput",
      requestId: request.inputId,
      spaceId: request.target.spaceId,
      execute: () =>
        receiveExecutionInputInCenterAgent({
          namespace: env.FLUE_CENTER_AGENT_V2_AGENT as CenterAgentNamespace,
          request,
        }),
    });
  },
  async readExecutionInput(input: unknown) {
    const request = remoteAgentWorkerExecutionInputQuerySchema.parse(input);
    return await observeRemoteAgentRpc({
      env,
      operation: "readExecutionInput",
      requestId: request.inputId,
      spaceId: request.target.spaceId,
      execute: () =>
        readExecutionInputFromCenterAgent({
          namespace: env.FLUE_CENTER_AGENT_V2_AGENT as CenterAgentNamespace,
          request,
        }),
    });
  },
  async cancelExecution(input: unknown) {
    const namespace = env.FLUE_CENTER_AGENT_V2_AGENT as CenterAgentNamespace;
    return await observeRemoteAgentRpc({
      ...readCancellationCorrelation(input),
      env,
      execute: () =>
        cancelExecutionInCenterAgent({ namespace, request: input }),
      operation: "cancelExecution",
    });
  },

  async readExecutionState(input: unknown) {
    const namespace = env.FLUE_CENTER_AGENT_V2_AGENT as CenterAgentNamespace;
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

  async readAdmission(input: unknown) {
    const request = remoteAgentWorkerSubmitTurnRequestSchema.parse(input);
    return await observeRemoteAgentRpc({
      env,
      operation: "readAdmission",
      requestId: request.dispatchId,
      spaceId: request.spaceId,
      execute: () =>
        readAdmissionFromCenterAgent({
          namespace: env.FLUE_CENTER_AGENT_V2_AGENT as CenterAgentNamespace,
          request,
        }),
    });
  },

  async reconcileExecution(input: unknown) {
    const namespace = env.FLUE_CENTER_AGENT_V2_AGENT as CenterAgentNamespace;
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

  async readAdmissionStop(input: unknown) {
    const request = remoteAgentWorkerSubmitTurnRequestSchema.parse(input);
    return await observeRemoteAgentRpc({
      env,
      operation: "readAdmissionStop",
      requestId: request.dispatchId,
      spaceId: request.spaceId,
      execute: () =>
        readAdmissionStopFromCenterAgent({
          namespace: env.FLUE_CENTER_AGENT_V2_AGENT as CenterAgentNamespace,
          request,
        }),
    });
  },

  async summarizeAgentActivityDigest(input: unknown) {
    return await observeRemoteAgentRpc({
      env,
      execute: () =>
        runDurableAuxiliaryInference({
          namespace: env.FLUE_CENTER_AGENT_V2_AGENT as CenterAgentNamespace,
          operation: "summarizeAgentActivityDigest",
          request: input,
        }),
      operation: "summarizeAgentActivityDigest",
    });
  },
  async submitConversationTurn(input: unknown) {
    const namespace = env.FLUE_CENTER_AGENT_V2_AGENT as CenterAgentNamespace;
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
    runtimeConversationId: string;
    spaceId: string;
  }) {
    const namespace = env.FLUE_CENTER_AGENT_V2_AGENT as CenterAgentNamespace;
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
    const namespace = env.FLUE_CENTER_AGENT_V2_AGENT as CenterAgentNamespace;
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
