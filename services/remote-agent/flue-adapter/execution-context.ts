import { AsyncLocalStorage } from "node:async_hooks";
import {
  type FlueExecutionContext,
  type FlueExecutionOperation,
  type FlueInstrumentation,
  instrument,
} from "@flue/runtime";
import {
  REMOTE_AGENT_CALLBACK_CONTEXT_WAIT_MS,
  type RemoteAgentCallbackContext,
  type RemoteAgentReadableStorage,
  waitForRemoteAgentCallbackContext,
} from "../agent-core/callback-context";

const REMOTE_AGENT_EXECUTION_INSTRUMENTATION_KEY = Symbol.for(
  "openmeld.remote-agent.submission-execution-context"
);
const executionSubmissionStorage = new AsyncLocalStorage<string>();
let instrumentationInstalled = false;
let prepareExecution: (() => Promise<unknown>) | undefined;
const executionResources = new AsyncLocalStorage<unknown>();

export function registerRemoteAgentExecutionPreparation(
  prepare: () => Promise<unknown>
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
  observe: () => undefined,
  interceptor: async <T>(
    operation: FlueExecutionOperation,
    context: FlueExecutionContext,
    next: () => Promise<T>
  ): Promise<T> => {
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
        if (!prepareExecution) {
          return await next();
        }
        const resources = await prepareExecution();
        return await executionResources.run(resources, next);
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
