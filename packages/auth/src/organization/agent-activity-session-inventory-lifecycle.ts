import { APIError } from "better-auth";

type AgentActivitySessionInventoryCleanupResult = {
  accepted?: boolean;
  code?: string;
  deleted?: {
    candidateCount: number;
    inventoryCount: number;
    sourceCount: number;
  };
  ok: boolean;
  pending?: boolean;
};

export type AgentActivitySessionInventoryLifecycleWorker = {
  requestAgentActivitySessionInventoryCleanupForOrganizationMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<AgentActivitySessionInventoryCleanupResult>;
};

type AgentActivitySessionInventoryLifecycleLogger = Pick<
  Console,
  "info" | "warn"
>;

const CLEANUP_UNAVAILABLE = {
  code: "organization.session_inventory_cleanup_unavailable",
  message:
    "OpenMeld couldn't safely prepare this member's Session Inventory cleanup. The member was not removed.",
} as const;

export async function requireAgentActivitySessionInventoryCleanupBeforeOrganizationMemberRemoval(input: {
  coreWorker?: AgentActivitySessionInventoryLifecycleWorker;
  logger?: AgentActivitySessionInventoryLifecycleLogger;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const logger = input.logger ?? console;
  if (!input.coreWorker) {
    failClosed({
      logger,
      organizationId: input.organizationId,
      reason: "openmeld_core_worker_unbound",
      userId: input.userId,
    });
  }

  let result: AgentActivitySessionInventoryCleanupResult;
  try {
    result =
      await input.coreWorker.requestAgentActivitySessionInventoryCleanupForOrganizationMember(
        {
          organizationId: input.organizationId,
          userId: input.userId,
        }
      );
  } catch (error) {
    failClosed({
      error,
      logger,
      organizationId: input.organizationId,
      reason: "core_cleanup_request_failed",
      userId: input.userId,
    });
  }
  if (!(result.ok && result.accepted && result.pending === true)) {
    failClosed({
      code: result.code,
      logger,
      organizationId: input.organizationId,
      reason: "core_cleanup_request_rejected",
      userId: input.userId,
    });
  }

  logger.info("[auth.agent_activity_session_inventory.cleanup_accepted]", {
    deleted: result.deleted,
    event: "auth.agent_activity_session_inventory.cleanup_accepted",
    organizationId: input.organizationId,
    pending: result.pending,
    userId: input.userId,
  });
}

export async function finalizeAgentActivitySessionInventoryCleanupAfterOrganizationMemberRemoval(input: {
  coreWorker?: AgentActivitySessionInventoryLifecycleWorker;
  logger?: AgentActivitySessionInventoryLifecycleLogger;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const logger = input.logger ?? console;
  if (!input.coreWorker) {
    logger.warn(
      "[auth.agent_activity_session_inventory.cleanup_finalize_skipped]",
      {
        event: "auth.agent_activity_session_inventory.cleanup_finalize_skipped",
        organizationId: input.organizationId,
        reason: "openmeld_core_worker_unbound",
        userId: input.userId,
      }
    );
    return;
  }

  try {
    const result =
      await input.coreWorker.requestAgentActivitySessionInventoryCleanupForOrganizationMember(
        {
          organizationId: input.organizationId,
          userId: input.userId,
        }
      );
    if (!(result.ok && result.accepted)) {
      logger.warn(
        "[auth.agent_activity_session_inventory.cleanup_finalize_failed]",
        {
          code: result.code ?? "unknown",
          event:
            "auth.agent_activity_session_inventory.cleanup_finalize_failed",
          organizationId: input.organizationId,
          userId: input.userId,
        }
      );
      return;
    }
    logger.info("[auth.agent_activity_session_inventory.cleanup_finalized]", {
      deleted: result.deleted,
      event: "auth.agent_activity_session_inventory.cleanup_finalized",
      organizationId: input.organizationId,
      pending: result.pending,
      userId: input.userId,
    });
  } catch (error) {
    logger.warn(
      "[auth.agent_activity_session_inventory.cleanup_finalize_failed]",
      {
        error: error instanceof Error ? error.message : String(error),
        event: "auth.agent_activity_session_inventory.cleanup_finalize_failed",
        organizationId: input.organizationId,
        userId: input.userId,
      }
    );
  }
}

function failClosed(input: {
  code?: string;
  error?: unknown;
  logger: AgentActivitySessionInventoryLifecycleLogger;
  organizationId: string;
  reason: string;
  userId: string;
}): never {
  input.logger.warn(
    "[auth.agent_activity_session_inventory.cleanup_request_failed]",
    {
      ...(input.code ? { code: input.code } : {}),
      ...(input.error
        ? {
            error:
              input.error instanceof Error
                ? input.error.message
                : String(input.error),
          }
        : {}),
      event: "auth.agent_activity_session_inventory.cleanup_request_failed",
      organizationId: input.organizationId,
      reason: input.reason,
      userId: input.userId,
    }
  );
  throw new APIError("SERVICE_UNAVAILABLE", CLEANUP_UNAVAILABLE);
}
