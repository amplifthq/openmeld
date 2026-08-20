import { describe, expect, it, vi } from "vitest";
import {
  type AgentActivitySessionInventoryLifecycleWorker,
  finalizeAgentActivitySessionInventoryCleanupAfterOrganizationMemberRemoval,
  requireAgentActivitySessionInventoryCleanupBeforeOrganizationMemberRemoval,
} from "../src/organization/agent-activity-session-inventory-lifecycle";

function createCoreWorker(
  request = vi.fn(async () => ({
    accepted: true,
    deleted: { candidateCount: 0, inventoryCount: 1, sourceCount: 1 },
    ok: true,
    pending: true,
  }))
): AgentActivitySessionInventoryLifecycleWorker {
  return {
    requestAgentActivitySessionInventoryCleanupForOrganizationMember: request,
  };
}

describe("Agent Activity Session Inventory member cleanup lifecycle", () => {
  it("blocks member removal until Core durably accepts cleanup", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };

    await expect(
      requireAgentActivitySessionInventoryCleanupBeforeOrganizationMemberRemoval(
        {
          logger,
          organizationId: "org_1",
          userId: "user_1",
        }
      )
    ).rejects.toMatchObject({
      body: expect.objectContaining({
        code: "organization.session_inventory_cleanup_unavailable",
      }),
      status: "SERVICE_UNAVAILABLE",
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "[auth.agent_activity_session_inventory.cleanup_request_failed]",
      expect.objectContaining({ reason: "openmeld_core_worker_unbound" })
    );
  });

  it("accepts removal only after Core acknowledges the durable request", async () => {
    const request = vi.fn(async () => ({
      accepted: true,
      deleted: { candidateCount: 1, inventoryCount: 2, sourceCount: 1 },
      ok: true,
      pending: true,
    }));

    await expect(
      requireAgentActivitySessionInventoryCleanupBeforeOrganizationMemberRemoval(
        {
          coreWorker: createCoreWorker(request),
          organizationId: "org_1",
          userId: "user_1",
        }
      )
    ).resolves.toBeUndefined();

    expect(request).toHaveBeenCalledWith({
      organizationId: "org_1",
      userId: "user_1",
    });
  });

  it("leaves the accepted request for Core retry when finalization fails", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const request = vi.fn(() => Promise.reject(new Error("Core unavailable")));

    await expect(
      finalizeAgentActivitySessionInventoryCleanupAfterOrganizationMemberRemoval(
        {
          coreWorker: createCoreWorker(request),
          logger,
          organizationId: "org_1",
          userId: "user_1",
        }
      )
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      "[auth.agent_activity_session_inventory.cleanup_finalize_failed]",
      expect.objectContaining({ error: "Core unavailable" })
    );
  });
});
