import { agentInteractionResolutionSchema } from "@openmeld/schemas";
import type {
  AgentInteractionRequest,
  AgentInteractionResponse,
  RuntimeCoordinatorExecutionTokenEcho,
  RuntimeTransportRuntimeEvidenceIdentityEcho,
} from "@openmeld/schemas/types";

export type PendingAgentInteractionExecutionAuthority = {
  attemptId: string;
  dispatchId: string;
  executionIdentityEcho: RuntimeTransportRuntimeEvidenceIdentityEcho;
  executionTokenEcho: RuntimeCoordinatorExecutionTokenEcho;
  runtimeCoordinatorExecutionId: string;
  targetProfileId: string;
};

type PendingAgentInteractionRecord = {
  authority: PendingAgentInteractionExecutionAuthority;
  request: AgentInteractionRequest;
  response: AgentInteractionResponse | null;
  taskId: string;
};

type PendingAgentInteractionResolution =
  | {
      record: PendingAgentInteractionRecord;
      status: "already_resolved" | "resolved";
    }
  | {
      record: null;
      status: "not_found" | "response_invalid";
    };

type InternalPendingAgentInteractionRecord = PendingAgentInteractionRecord & {
  reject: (error: Error) => void;
  resolve: (response: AgentInteractionResponse) => void;
  timeout: NodeJS.Timeout;
};

class PendingAgentInteractionError extends Error {
  readonly code: "interaction.cancelled" | "interaction.expired";
  readonly errorType: "adapter" | "timeout";

  constructor(input: {
    code: "interaction.cancelled" | "interaction.expired";
    errorType: "adapter" | "timeout";
    message: string;
  }) {
    super(input.message);
    this.name = "PendingAgentInteractionError";
    this.code = input.code;
    this.errorType = input.errorType;
  }
}

const createInteractionExpiredError = (interactionId: string): Error =>
  new PendingAgentInteractionError({
    code: "interaction.expired",
    errorType: "timeout",
    message: `interaction.expired: local agent interaction '${interactionId}' expired before the user responded`,
  });

export function createPendingAgentInteractionRegistry() {
  const recordByInteractionId = new Map<
    string,
    InternalPendingAgentInteractionRecord
  >();
  const interactionIdsByTaskId = new Map<string, Set<string>>();

  const removeRecord = (
    record: InternalPendingAgentInteractionRecord
  ): void => {
    clearTimeout(record.timeout);
    recordByInteractionId.delete(record.request.interactionId);
    const taskInteractionIds = interactionIdsByTaskId.get(record.taskId);
    taskInteractionIds?.delete(record.request.interactionId);
    if (taskInteractionIds?.size === 0) {
      interactionIdsByTaskId.delete(record.taskId);
    }
  };

  return {
    register(input: {
      authority: PendingAgentInteractionExecutionAuthority;
      request: AgentInteractionRequest;
      taskId: string;
    }): Promise<AgentInteractionResponse> {
      if (recordByInteractionId.has(input.request.interactionId)) {
        throw new Error(
          `interaction.conflict: local agent interaction '${input.request.interactionId}' is already registered`
        );
      }

      return new Promise<AgentInteractionResponse>((resolve, reject) => {
        const timeout = setTimeout(
          () => {
            const record = recordByInteractionId.get(
              input.request.interactionId
            );
            if (!record || record.response) {
              return;
            }
            removeRecord(record);
            reject(createInteractionExpiredError(input.request.interactionId));
          },
          Math.max(0, input.request.expiresAtMs - Date.now())
        );
        const record: InternalPendingAgentInteractionRecord = {
          authority: input.authority,
          reject,
          request: input.request,
          resolve,
          response: null,
          taskId: input.taskId,
          timeout,
        };
        recordByInteractionId.set(input.request.interactionId, record);
        const taskInteractionIds =
          interactionIdsByTaskId.get(input.taskId) ?? new Set<string>();
        taskInteractionIds.add(input.request.interactionId);
        interactionIdsByTaskId.set(input.taskId, taskInteractionIds);
      });
    },

    resolve(input: {
      interactionId: string;
      response: AgentInteractionResponse;
    }): PendingAgentInteractionResolution {
      const record = recordByInteractionId.get(input.interactionId);
      if (!record) {
        return {
          record: null,
          status: "not_found",
        };
      }
      if (
        !agentInteractionResolutionSchema.safeParse({
          request: record.request,
          response: input.response,
        }).success
      ) {
        return {
          record: null,
          status: "response_invalid",
        };
      }
      if (record.response) {
        return {
          record,
          status: "already_resolved",
        };
      }
      record.response = input.response;
      clearTimeout(record.timeout);
      record.resolve(input.response);
      return {
        record,
        status: "resolved",
      };
    },

    reject(interactionId: string, error: Error): boolean {
      const record = recordByInteractionId.get(interactionId);
      if (!record) {
        return false;
      }
      if (!record.response) {
        record.reject(error);
      }
      removeRecord(record);
      return true;
    },

    get(interactionId: string): PendingAgentInteractionRecord | null {
      return recordByInteractionId.get(interactionId) ?? null;
    },

    removeTask(taskId: string, error?: Error): void {
      const interactionIds = interactionIdsByTaskId.get(taskId);
      if (!interactionIds) {
        return;
      }
      for (const interactionId of interactionIds) {
        const record = recordByInteractionId.get(interactionId);
        if (!record) {
          continue;
        }
        if (!record.response) {
          record.reject(
            error ??
              new PendingAgentInteractionError({
                code: "interaction.cancelled",
                errorType: "adapter",
                message: `interaction.cancelled: local agent task '${taskId}' ended before the interaction was resolved`,
              })
          );
        }
        removeRecord(record);
      }
    },

    list(): PendingAgentInteractionRecord[] {
      return [...recordByInteractionId.values()]
        .map(({ authority, request, response, taskId }) => ({
          authority,
          request,
          response,
          taskId,
        }))
        .sort(
          (left, right) =>
            left.request.requestedAtMs - right.request.requestedAtMs ||
            left.request.interactionId.localeCompare(
              right.request.interactionId
            )
        );
    },
  } as const;
}

export type PendingAgentInteractionRegistry = ReturnType<
  typeof createPendingAgentInteractionRegistry
>;
