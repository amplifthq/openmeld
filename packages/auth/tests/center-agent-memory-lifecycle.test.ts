import { describe, expect, it, type Mock, vi } from "vitest";
import {
  type CenterAgentMemoryLifecycleWorker,
  deleteCenterAgentMemberMemoryOnOrganizationRemoval,
  deleteCenterAgentOrganizationMemoryOnOrganizationDeletion,
} from "../src/organization/center-agent-memory-lifecycle";

function createCoreWorker(input: {
  deleteMember?: Mock<
    CenterAgentMemoryLifecycleWorker["deleteCenterAgentMemberMemory"]
  >;
  deleteOrganization?: Mock<
    CenterAgentMemoryLifecycleWorker["deleteCenterAgentOrganizationMemory"]
  >;
}): CenterAgentMemoryLifecycleWorker {
  return {
    deleteCenterAgentMemberMemory:
      input.deleteMember ??
      vi.fn(async () => ({ ok: true, status: "deleted" as const })),
    deleteCenterAgentOrganizationMemory:
      input.deleteOrganization ??
      vi.fn(async () => ({ ok: true, status: "deleted" as const })),
  };
}

describe("Center Agent memory lifecycle fan-out", () => {
  it("deletes the removed member's durable Center Agent memory in Core", async () => {
    const deleteMember = vi.fn(async () => ({
      ok: true,
      status: "deleted" as const,
    }));

    await deleteCenterAgentMemberMemoryOnOrganizationRemoval({
      coreWorker: createCoreWorker({ deleteMember }),
      logger: console,
      organizationId: "org_1",
      userId: "user_1",
    });

    expect(deleteMember).toHaveBeenCalledWith({
      organizationId: "org_1",
      userId: "user_1",
    });
    expect("deleteThread" in createCoreWorker({ deleteMember })).toBe(false);
  });

  it("deletes the organization graph when an organization is deleted", async () => {
    const deleteOrganization = vi.fn(async () => ({
      ok: true,
      status: "deleted" as const,
    }));

    await deleteCenterAgentOrganizationMemoryOnOrganizationDeletion({
      coreWorker: createCoreWorker({ deleteOrganization }),
      logger: console,
      organizationId: "org_1",
    });

    expect(deleteOrganization).toHaveBeenCalledWith({
      organizationId: "org_1",
    });
  });

  it("warns instead of blocking deletion when Core is unavailable", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    await expect(
      deleteCenterAgentMemberMemoryOnOrganizationRemoval({
        logger,
        organizationId: "org_1",
        userId: "user_1",
      })
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      "[auth.center_agent_memory.member_delete_skipped]",
      expect.objectContaining({
        reason: "openmeld_core_worker_unbound",
      })
    );
  });

  it("warns instead of throwing when Core reports a deletion failure", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    await expect(
      deleteCenterAgentOrganizationMemoryOnOrganizationDeletion({
        coreWorker: createCoreWorker({
          deleteOrganization: vi.fn(async () => ({
            code: "center_agent_memory.unavailable",
            ok: false,
          })),
        }),
        logger,
        organizationId: "org_1",
      })
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      "[auth.center_agent_memory.organization_delete_failed]",
      expect.objectContaining({
        code: "center_agent_memory.unavailable",
        organizationId: "org_1",
      })
    );
  });
});
