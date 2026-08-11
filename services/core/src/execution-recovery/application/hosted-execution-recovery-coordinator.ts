import type {
  ExecuteExecutionRecoveryBody,
  ExecuteExecutionRecoveryResponse,
  InspectExecutionRecoveryResponse,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import {
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByDispatchAndConversation,
} from "../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { executeFencedExecutionRecoveryOperation } from "./execution-recovery-fenced-operation";
import type { ExecutionRecoveryOperationStorage } from "./execution-recovery-operation-state";
import {
  projectHostedExecutionRecovery,
  replayHostedRetainedExecutionResult,
  resolveAuthoritativeHostedExecutionRecovery,
  submitHostedExecutionRecovery,
} from "./hosted-execution-recovery-service";

export type HostedExecutionRecoveryInspectRequest = {
  activeOrganizationId: string;
  conversationId: string;
  dispatchId: string;
};

export type HostedExecutionRecoveryExecuteRequest = {
  activeOrganizationId: string;
  body: ExecuteExecutionRecoveryBody;
  conversationId: string;
};

export async function inspectHostedExecutionRecovery(input: {
  db: D1Database;
  env: CoreBindings;
  request: HostedExecutionRecoveryInspectRequest;
}): Promise<InspectExecutionRecoveryResponse> {
  const delivery = await requireHostedExecutionRecoveryDelivery({
    db: input.db,
    request: input.request,
  });
  return {
    recovery: await projectHostedExecutionRecovery({
      delivery,
      env: input.env,
      nowMs: Date.now(),
    }),
  };
}

export async function executeHostedExecutionRecovery(input: {
  db: D1Database;
  env: CoreBindings;
  request: HostedExecutionRecoveryExecuteRequest;
  storage: ExecutionRecoveryOperationStorage;
}): Promise<ExecuteExecutionRecoveryResponse> {
  const readCurrentDelivery = async () =>
    await requireHostedExecutionRecoveryDelivery({
      db: input.db,
      request: {
        activeOrganizationId: input.request.activeOrganizationId,
        conversationId: input.request.conversationId,
        dispatchId: input.request.body.expectedIdentity.dispatchId,
      },
    });
  const projection = await projectHostedExecutionRecovery({
    delivery: await readCurrentDelivery(),
    env: input.env,
    nowMs: Date.now(),
  });
  return await executeFencedExecutionRecoveryOperation({
    command: input.request.body,
    dependencies: {
      replayDurableResult: async ({
        command,
        markEffectStarted,
        projection: current,
      }) =>
        await replayHostedRetainedExecutionResult({
          command,
          db: input.db,
          delivery: await readCurrentDelivery(),
          env: input.env,
          markEffectStarted,
          projection: current,
        }),
      resumeControllerConversation: async ({ command, markEffectStarted }) => {
        const submitted = await submitHostedExecutionRecovery({
          action: "resume_controller_conversation",
          db: input.db,
          delivery: await readCurrentDelivery(),
          env: input.env,
          markEffectStarted,
          operationId: command.operationId,
        });
        if (!("publicationId" in submitted)) {
          throw new Error("execution_recovery.action_mismatch");
        }
        return submitted;
      },
      retryAsNewExecution: async ({ command, markEffectStarted }) => {
        const submitted = await submitHostedExecutionRecovery({
          action: "retry_as_new_execution",
          db: input.db,
          delivery: await readCurrentDelivery(),
          env: input.env,
          markEffectStarted,
          operationId: command.operationId,
        });
        if (!("newExecutionId" in submitted)) {
          throw new Error("execution_recovery.action_mismatch");
        }
        return submitted;
      },
    },
    inspectProjection: async () =>
      await projectHostedExecutionRecovery({
        delivery: await readCurrentDelivery(),
        env: input.env,
        nowMs: Date.now(),
      }),
    projection,
    resolveAuthoritative: async ({
      claimStorageKey,
      command,
      projection: current,
    }) =>
      await resolveAuthoritativeHostedExecutionRecovery({
        claimStorageKey,
        command,
        db: input.db,
        delivery: await readCurrentDelivery(),
        env: input.env,
        projection: current,
      }),
    storage: input.storage,
  });
}

async function requireHostedExecutionRecoveryDelivery(input: {
  db: D1Database;
  request: HostedExecutionRecoveryInspectRequest;
}): Promise<RemoteAgentNativeDeliveryRecord> {
  const activeOrganizationId = input.request.activeOrganizationId.trim();
  const conversationId = input.request.conversationId.trim();
  const dispatchId = input.request.dispatchId.trim();
  if (!(activeOrganizationId && conversationId && dispatchId)) {
    throw new Error("execution_recovery.invalid_request");
  }
  const delivery = await readRemoteAgentNativeDeliveryByDispatchAndConversation(
    {
      conversationId,
      db: input.db,
      dispatchId,
    }
  );
  if (
    !delivery ||
    delivery.conversationKind === "space" ||
    delivery.organizationId !== activeOrganizationId
  ) {
    throw new Error("execution_recovery.execution_not_found");
  }
  return delivery;
}
