import {
  type DeletedAgentActivitySessionInventoryMemberProjection,
  readAgentActivitySessionInventoryMemberCleanupRequests,
  recordAgentActivitySessionInventoryMemberCleanupFailure,
  recordAgentActivitySessionInventoryMemberCleanupWaiting,
  requestAgentActivitySessionInventoryMemberCleanup,
} from "./activity-session-inventory-repository";

export type AgentActivitySessionInventoryMemberCleanupMembershipState =
  | "active"
  | "removed"
  | "unavailable";

type ResolveMembershipState = (input: {
  organizationId: string;
  ownerUserId: string;
}) => Promise<AgentActivitySessionInventoryMemberCleanupMembershipState>;

export async function acceptAgentActivitySessionInventoryMemberCleanup(input: {
  db: D1Database;
  nowMs: number;
  organizationId: string;
  ownerUserId: string;
  resolveMembershipState: ResolveMembershipState;
}): Promise<{
  deleted: DeletedAgentActivitySessionInventoryMemberProjection;
  pending: boolean;
}> {
  const membershipState = await resolveMembershipStateSafely({
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
    resolveMembershipState: input.resolveMembershipState,
  });
  const pending = membershipState !== "removed";
  const deleted = await requestAgentActivitySessionInventoryMemberCleanup({
    db: input.db,
    finalize: !pending,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
  });
  return { deleted, pending };
}

export async function retryAgentActivitySessionInventoryMemberCleanups(input: {
  db: D1Database;
  limit?: number;
  nowMs: number;
  resolveMembershipState: ResolveMembershipState;
}): Promise<{
  errors: number;
  finalized: number;
  scanned: number;
  waitingForRemoval: number;
}> {
  const requests = await readAgentActivitySessionInventoryMemberCleanupRequests(
    {
      db: input.db,
      limit: input.limit ?? 100,
    }
  );
  let errors = 0;
  let finalized = 0;
  let waitingForRemoval = 0;
  for (const request of requests) {
    const membershipState = await resolveMembershipStateSafely({
      organizationId: request.organizationId,
      ownerUserId: request.ownerUserId,
      resolveMembershipState: input.resolveMembershipState,
    });
    if (membershipState === "active") {
      waitingForRemoval += 1;
      await recordAgentActivitySessionInventoryMemberCleanupWaiting({
        db: input.db,
        nowMs: input.nowMs,
        organizationId: request.organizationId,
        ownerUserId: request.ownerUserId,
      });
      continue;
    }
    if (membershipState === "unavailable") {
      errors += 1;
      await recordAgentActivitySessionInventoryMemberCleanupFailure({
        db: input.db,
        error: "organization_membership_unavailable",
        nowMs: input.nowMs,
        organizationId: request.organizationId,
        ownerUserId: request.ownerUserId,
      });
      continue;
    }
    try {
      await requestAgentActivitySessionInventoryMemberCleanup({
        db: input.db,
        finalize: true,
        nowMs: input.nowMs,
        organizationId: request.organizationId,
        ownerUserId: request.ownerUserId,
      });
      finalized += 1;
    } catch (error) {
      errors += 1;
      await recordAgentActivitySessionInventoryMemberCleanupFailure({
        db: input.db,
        error: error instanceof Error ? error.message : String(error),
        nowMs: input.nowMs,
        organizationId: request.organizationId,
        ownerUserId: request.ownerUserId,
      });
    }
  }
  return {
    errors,
    finalized,
    scanned: requests.length,
    waitingForRemoval,
  };
}

async function resolveMembershipStateSafely(input: {
  organizationId: string;
  ownerUserId: string;
  resolveMembershipState: ResolveMembershipState;
}): Promise<AgentActivitySessionInventoryMemberCleanupMembershipState> {
  try {
    return await input.resolveMembershipState({
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
    });
  } catch {
    return "unavailable";
  }
}
