type CenterAgentMemoryDeletionResult = {
  code?: string;
  ok: boolean;
  status?: "deleted" | "not_found";
};

export type CenterAgentMemoryLifecycleWorker = {
  deleteCenterAgentMemberMemory(input: {
    organizationId: string;
    userId: string;
  }): Promise<CenterAgentMemoryDeletionResult>;
  deleteCenterAgentOrganizationMemory(input: {
    organizationId: string;
  }): Promise<CenterAgentMemoryDeletionResult>;
};

type CenterAgentMemoryLifecycleLogger = Pick<Console, "info" | "warn">;

export async function deleteCenterAgentMemberMemoryOnOrganizationRemoval(input: {
  coreWorker?: CenterAgentMemoryLifecycleWorker;
  logger?: CenterAgentMemoryLifecycleLogger;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const logger = input.logger ?? console;
  if (!input.coreWorker) {
    logger.warn("[auth.center_agent_memory.member_delete_skipped]", {
      event: "auth.center_agent_memory.member_delete_skipped",
      organizationId: input.organizationId,
      reason: "openmeld_core_worker_unbound",
      userId: input.userId,
    });
    return;
  }

  try {
    const result = await input.coreWorker.deleteCenterAgentMemberMemory({
      organizationId: input.organizationId,
      userId: input.userId,
    });
    if (!result.ok) {
      logger.warn("[auth.center_agent_memory.member_delete_failed]", {
        code: result.code ?? "unknown",
        event: "auth.center_agent_memory.member_delete_failed",
        organizationId: input.organizationId,
        userId: input.userId,
      });
      return;
    }
    logger.info("[auth.center_agent_memory.member_deleted]", {
      event: "auth.center_agent_memory.member_deleted",
      organizationId: input.organizationId,
      status: result.status,
      userId: input.userId,
    });
  } catch (error) {
    logger.warn("[auth.center_agent_memory.member_delete_failed]", {
      error: error instanceof Error ? error.message : String(error),
      event: "auth.center_agent_memory.member_delete_failed",
      organizationId: input.organizationId,
      userId: input.userId,
    });
  }
}

export async function deleteCenterAgentOrganizationMemoryOnOrganizationDeletion(input: {
  coreWorker?: CenterAgentMemoryLifecycleWorker;
  logger?: CenterAgentMemoryLifecycleLogger;
  organizationId: string;
}): Promise<void> {
  const logger = input.logger ?? console;
  if (!input.coreWorker) {
    logger.warn("[auth.center_agent_memory.organization_delete_skipped]", {
      event: "auth.center_agent_memory.organization_delete_skipped",
      organizationId: input.organizationId,
      reason: "openmeld_core_worker_unbound",
    });
    return;
  }

  try {
    const result = await input.coreWorker.deleteCenterAgentOrganizationMemory({
      organizationId: input.organizationId,
    });
    if (!result.ok) {
      logger.warn("[auth.center_agent_memory.organization_delete_failed]", {
        code: result.code ?? "unknown",
        event: "auth.center_agent_memory.organization_delete_failed",
        organizationId: input.organizationId,
      });
      return;
    }
    logger.info("[auth.center_agent_memory.organization_deleted]", {
      event: "auth.center_agent_memory.organization_deleted",
      organizationId: input.organizationId,
      status: result.status,
    });
  } catch (error) {
    logger.warn("[auth.center_agent_memory.organization_delete_failed]", {
      error: error instanceof Error ? error.message : String(error),
      event: "auth.center_agent_memory.organization_delete_failed",
      organizationId: input.organizationId,
    });
  }
}
