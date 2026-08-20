type AgentActivitySessionInventoryDeletionResult = {
  code?: string;
  deleted?: {
    candidateCount: number;
    inventoryCount: number;
    sourceCount: number;
  };
  ok: boolean;
};

export type AgentActivitySessionInventoryLifecycleWorker = {
  deleteAgentActivitySessionInventoryForOrganizationMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<AgentActivitySessionInventoryDeletionResult>;
};

type AgentActivitySessionInventoryLifecycleLogger = Pick<
  Console,
  "info" | "warn"
>;

export async function deleteAgentActivitySessionInventoryOnOrganizationMemberRemoval(input: {
  coreWorker?: AgentActivitySessionInventoryLifecycleWorker;
  logger?: AgentActivitySessionInventoryLifecycleLogger;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const logger = input.logger ?? console;
  if (!input.coreWorker) {
    logger.warn("[auth.agent_activity_session_inventory.delete_skipped]", {
      event: "auth.agent_activity_session_inventory.delete_skipped",
      organizationId: input.organizationId,
      reason: "openmeld_core_worker_unbound",
      userId: input.userId,
    });
    return;
  }

  try {
    const result =
      await input.coreWorker.deleteAgentActivitySessionInventoryForOrganizationMember(
        {
          organizationId: input.organizationId,
          userId: input.userId,
        }
      );
    if (!result.ok) {
      logger.warn("[auth.agent_activity_session_inventory.delete_failed]", {
        code: result.code ?? "unknown",
        event: "auth.agent_activity_session_inventory.delete_failed",
        organizationId: input.organizationId,
        userId: input.userId,
      });
      return;
    }
    logger.info("[auth.agent_activity_session_inventory.deleted]", {
      deleted: result.deleted,
      event: "auth.agent_activity_session_inventory.deleted",
      organizationId: input.organizationId,
      userId: input.userId,
    });
  } catch (error) {
    logger.warn("[auth.agent_activity_session_inventory.delete_failed]", {
      error: error instanceof Error ? error.message : String(error),
      event: "auth.agent_activity_session_inventory.delete_failed",
      organizationId: input.organizationId,
      userId: input.userId,
    });
  }
}
