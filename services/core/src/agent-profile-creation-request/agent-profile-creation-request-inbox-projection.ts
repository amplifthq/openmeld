import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import {
  projectAgentProfileCreationRequestInbox,
  resolveAgentProfileCreationRequestInbox,
} from "./agent-profile-creation-request-inbox";
import { createD1AgentProfileCreationRequestRepository } from "./agent-profile-creation-request-repository";
import {
  type AgentProfileCreationRequestInboxProjectionRecord,
  type AgentProfileCreationRequestRepository,
  toPublicRequest,
} from "./agent-profile-creation-request-service";

const RETRY_DELAYS_MS = [2000, 5000, 15_000, 60_000] as const;
const MAX_RETRY_DELAY_MS = 60_000;

export function createAgentProfileCreationRequestInboxProjectionService(input: {
  now?: () => number;
  project: (request: AgentProfileCreationRequest) => Promise<void>;
  repository: AgentProfileCreationRequestRepository;
  resolve: (request: AgentProfileCreationRequest) => Promise<void>;
}) {
  const now = input.now ?? Date.now;

  const attempt = async (
    projection: AgentProfileCreationRequestInboxProjectionRecord
  ): Promise<"completed" | "failed" | "superseded"> => {
    const request = toPublicRequest(projection.request);
    try {
      if (projection.operation === "project") {
        await input.project(request);
      } else {
        await input.resolve(request);
      }
      const completedAtMs = now();
      const completed = await input.repository.markInboxProjectionCompleted({
        completedAtMs,
        generation: projection.generation,
        requestId: request.id,
      });
      return completed ? "completed" : "superseded";
    } catch (error) {
      const failedAtMs = now();
      const lastError = normalizeProjectionError(error);
      try {
        const failed = await input.repository.markInboxProjectionFailed({
          failedAtMs,
          generation: projection.generation,
          lastError,
          nextRetryAtMs:
            failedAtMs + resolveRetryDelayMs(projection.attemptCount),
          requestId: request.id,
        });
        if (!failed) {
          return "superseded";
        }
      } catch (recordError) {
        console.error(
          "[core.agent_profile_creation_request.inbox_projection_failure_record_failed]",
          {
            error: normalizeProjectionError(recordError),
            operation: projection.operation,
            organizationId: request.organizationId,
            requestId: request.id,
          }
        );
      }
      console.error(
        "[core.agent_profile_creation_request.inbox_projection_failed]",
        {
          error: lastError,
          operation: projection.operation,
          organizationId: request.organizationId,
          requestId: request.id,
          targetOwnerUserId: request.targetOwnerUserId,
        }
      );
      return "failed";
    }
  };

  const attemptLatest = async (
    requestId: string,
    initial?: AgentProfileCreationRequestInboxProjectionRecord
  ): Promise<"completed" | "failed" | "superseded"> => {
    let projection =
      initial ??
      (await input.repository.getInboxProjectionByRequestId(requestId));
    for (let reconciliation = 0; reconciliation < 3; reconciliation += 1) {
      if (!projection || projection.status === "completed") {
        return "completed";
      }
      const result = await attempt(projection);
      if (result !== "superseded") {
        return result;
      }
      projection =
        await input.repository.getInboxProjectionByRequestId(requestId);
    }
    return "superseded";
  };

  return {
    attemptForRequest: async (requestId: string): Promise<void> => {
      await input.repository.synchronizeInboxProjectionIntents({ requestId });
      await attemptLatest(requestId);
    },

    retryDue: async (retryInput: {
      limit: number;
      nowMs: number;
    }): Promise<{ completed: number; failed: number; scanned: number }> => {
      await input.repository.synchronizeInboxProjectionIntents();
      const projections =
        await input.repository.listDueInboxProjections(retryInput);
      let completed = 0;
      let failed = 0;
      for (const projection of projections) {
        const result = await attemptLatest(projection.request.id, projection);
        if (result === "completed") {
          completed += 1;
        } else if (result === "failed") {
          failed += 1;
        }
      }
      return { completed, failed, scanned: projections.length };
    },
  };
}

export function createD1AgentProfileCreationRequestInboxProjectionService(input: {
  db: D1Database;
  now?: () => number;
}) {
  return createAgentProfileCreationRequestInboxProjectionService({
    ...(input.now ? { now: input.now } : {}),
    project: async (request) =>
      await projectAgentProfileCreationRequestInbox({
        db: input.db,
        nowMs: input.now?.() ?? Date.now(),
        request,
      }),
    repository: createD1AgentProfileCreationRequestRepository(input.db),
    resolve: async (request) =>
      await resolveAgentProfileCreationRequestInbox({
        db: input.db,
        nowMs: input.now?.() ?? Date.now(),
        request,
      }),
  });
}

export async function retryAgentProfileCreationRequestInboxProjections(input: {
  db: D1Database;
  limit?: number;
  nowMs: number;
}): Promise<{ completed: number; failed: number; scanned: number }> {
  return await createD1AgentProfileCreationRequestInboxProjectionService({
    db: input.db,
    now: () => input.nowMs,
  }).retryDue({
    limit: input.limit ?? 100,
    nowMs: input.nowMs,
  });
}

function resolveRetryDelayMs(attemptCount: number): number {
  return (
    RETRY_DELAYS_MS[Math.min(attemptCount, RETRY_DELAYS_MS.length - 1)] ??
    MAX_RETRY_DELAY_MS
  );
}

function normalizeProjectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.trim() || "Unknown Inbox projection failure").slice(0, 500);
}
