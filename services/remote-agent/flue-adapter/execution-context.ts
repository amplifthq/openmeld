import { AsyncLocalStorage } from "node:async_hooks";
import {
  type FlueExecutionContext,
  type FlueExecutionOperation,
  type FlueInstrumentation,
  instrument,
  type LlmTurnPurpose,
} from "@flue/runtime";
import {
  remoteAgentCoreAdmissionCallbackSchema,
  remoteAgentCoreCallbackResponseSchema,
} from "@openmeld/schemas";
import {
  REMOTE_AGENT_CALLBACK_CONTEXT_WAIT_MS,
  type RemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
  type RemoteAgentReadableStorage,
  waitForRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  assertRemoteAgentExecutionCanContinue,
  buildRemoteAgentExecutionIdentity,
  RemoteAgentExecutionCancelledError,
} from "../agent-core/execution-state";

export async function acknowledgeRemoteAgentExecutionPreparation(input: {
  context: RemoteAgentCallbackContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  storage: RemoteAgentReadableStorage;
}): Promise<void> {
  const identity = buildRemoteAgentExecutionIdentity(input.context);
  await assertRemoteAgentExecutionCanContinue({
    identity,
    storage: input.storage,
  });
  if (!input.coreWorker.acknowledgeRemoteAgentAdmission) {
    throw new Error("remote_agent.admission_acknowledgement_unavailable");
  }
  const context = input.context;
  const result = remoteAgentCoreCallbackResponseSchema.parse(
    await input.coreWorker.acknowledgeRemoteAgentAdmission(
      remoteAgentCoreAdmissionCallbackSchema.parse({
        agentProfileId: context.agentProfileId,
        bindingId: context.bindingId,
        dispatchId: context.dispatchId,
        idempotencyKey: context.idempotencyKey,
        organizationId: context.organizationId,
        spaceId: context.spaceId,
        submissionId: context.submissionId,
        triggerMessageId: context.triggerMessageId,
      })
    )
  );
  if (result.status !== "accepted") {
    if (result.reasonCode === "remote_agent.execution_cancelled") {
      throw new RemoteAgentExecutionCancelledError();
    }
    throw new Error(
      result.reasonCode ?? "remote_agent.admission_acknowledgement_rejected"
    );
  }
  // Stop may have arrived while Core was persisting the same admission.
  await assertRemoteAgentExecutionCanContinue({
    identity,
    storage: input.storage,
  });
}

const REMOTE_AGENT_EXECUTION_INSTRUMENTATION_KEY = Symbol.for(
  "openmeld.remote-agent.submission-execution-context"
);
const executionSubmissionStorage = new AsyncLocalStorage<string>();
let instrumentationInstalled = false;
export type RemoteAgentMessageReadBudget = { remainingBytes: number };
type PreparedExecutionResources = {
  interactiveResponseId?: () => string | null;
  messageReadBudget?: RemoteAgentMessageReadBudget;
  beforeModel?: () => Promise<void>;
  deferredToolCount?: number;
  [name: string]: unknown;
};
let prepareExecution: (() => Promise<PreparedExecutionResources>) | undefined;
const executionResources = new AsyncLocalStorage<PreparedExecutionResources>();
const modelTurnPurposes = new AsyncLocalStorage<Map<string, LlmTurnPurpose>>();
const modelPurposeStorage = new AsyncLocalStorage<LlmTurnPurpose>();

export function registerRemoteAgentExecutionPreparation(
  prepare: () => Promise<PreparedExecutionResources>
): () => void {
  const previous = prepareExecution;
  prepareExecution = prepare;
  return () => {
    if (prepareExecution === prepare) {
      prepareExecution = previous;
    }
  };
}

export function requireRemoteAgentExecutionResources<T>(): T {
  const resources = executionResources.getStore();
  if (!resources) {
    throw new Error(
      "Center Agent render requires prepared execution resources."
    );
  }
  return resources as T;
}

export const REMOTE_AGENT_EXECUTION_INSTRUMENTATION: FlueInstrumentation = {
  key: REMOTE_AGENT_EXECUTION_INSTRUMENTATION_KEY,
  observe: (event) => {
    if (
      event.type === "turn_request" &&
      event.submissionId === getRemoteAgentExecutionSubmissionId()
    ) {
      // Join the public Flue request event to its exact interceptor. Keep only
      // IDs and purpose, never prompts; consume before starting the request.
      modelTurnPurposes.getStore()?.set(event.turnId, event.purpose);
    }
  },
  interceptor: async <T>(
    operation: FlueExecutionOperation,
    context: FlueExecutionContext,
    next: () => Promise<T>
  ): Promise<T> => {
    if (operation.type === "model") {
      // A fenced tool round must not become an unbounded model/error loop.
      // Throw through the existing runtime boundary; its lifecycle still owns
      // settlement and Computer cleanup, not the admission guard.
      await executionResources.getStore()?.beforeModel?.();
      const purposes = modelTurnPurposes.getStore();
      const purpose = purposes?.get(operation.turnId) ?? "agent";
      purposes?.delete(operation.turnId);
      return await modelPurposeStorage.run(purpose, next);
    }
    if (operation.type !== "agent" || !context.submissionId) {
      return await next();
    }
    if (
      getRemoteAgentExecutionSubmissionId() === context.submissionId &&
      executionResources.getStore() !== undefined
    ) {
      return await next();
    }
    return await runWithRemoteAgentSubmissionExecution(
      context.submissionId,
      async () => {
        const resources = prepareExecution ? await prepareExecution() : {};
        return await modelTurnPurposes.run(new Map(), () =>
          executionResources.run(resources, next)
        );
      }
    );
  },
  dispose: () => undefined,
};

export function installRemoteAgentExecutionInstrumentation(): void {
  if (instrumentationInstalled) {
    return;
  }
  instrument(REMOTE_AGENT_EXECUTION_INSTRUMENTATION);
  instrumentationInstalled = true;
}

export function getRemoteAgentExecutionSubmissionId(): string | null {
  return executionSubmissionStorage.getStore() ?? null;
}

export function getRemoteAgentResponseInputId(): string | null {
  return executionResources.getStore()?.interactiveResponseId?.() ?? null;
}

export function getRemoteAgentModelPurpose(): LlmTurnPurpose {
  return modelPurposeStorage.getStore() ?? "agent";
}

export function getRemoteAgentDeferredToolCount(): number {
  return executionResources.getStore()?.deferredToolCount ?? 0;
}

/** A per-model-round allocation from the existing provider capacity measurement. */
export function updateRemoteAgentMessageReadBudget(input: {
  inputTokenBudget: number;
  estimatedInputTokens: number;
}): void {
  const resources = executionResources.getStore();
  if (!resources || getRemoteAgentModelPurpose() !== "agent") {
    return;
  }
  // Leave room for the model's tool arguments and subsequent reasoning. The
  // provider guard and Flue working-context maintenance remain authoritative.
  resources.messageReadBudget ??= { remainingBytes: 8192 };
  resources.messageReadBudget.remainingBytes = Math.max(
    0,
    Math.min(16_384, input.inputTokenBudget - input.estimatedInputTokens - 4096)
  );
}

export function reserveRemoteAgentMessageReadBytes(
  requested: number,
  boundBudget?: RemoteAgentMessageReadBudget
): number {
  const resources = executionResources.getStore();
  const budget = boundBudget ?? resources?.messageReadBudget;
  if (!budget) {
    return 0;
  }
  const granted = Math.min(requested, budget.remainingBytes);
  // Reserve synchronously before I/O, so concurrent Code Mode calls share it.
  budget.remainingBytes -= granted;
  return granted;
}

export function runWithRemoteAgentSubmissionExecution<T>(
  submissionId: string,
  execute: () => T
): T {
  return executionSubmissionStorage.run(submissionId, execute);
}

export async function resolveRemoteAgentExecutionCallbackContext(input: {
  storage: RemoteAgentReadableStorage;
  waitMs?: number;
}): Promise<RemoteAgentCallbackContext | null> {
  const submissionId = getRemoteAgentExecutionSubmissionId();
  if (!submissionId) {
    // Flue initializes once while materializing the durable user input. No
    // model or tool runs in that phase; the execution initializer below is
    // bound to an immutable submission id by the Flue agent interceptor.
    return null;
  }
  const context = await waitForRemoteAgentCallbackContext({
    storage: input.storage,
    submissionId,
    waitMs: input.waitMs ?? REMOTE_AGENT_CALLBACK_CONTEXT_WAIT_MS,
  });
  if (!context) {
    throw new Error(
      `Remote Agent submission ${submissionId} exact durable callback context is unavailable.`
    );
  }
  return context;
}
