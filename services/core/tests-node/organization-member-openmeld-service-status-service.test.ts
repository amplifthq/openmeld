import { describe, expect, it, vi } from "vitest";
import { listOrganizationMemberOpenMeldServiceStatuses } from "../src/organizations/organization-member-openmeld-service-status-service";

const COMPATIBLE = {
  expectedEpoch: "runtime-contract-v1",
  observedEpoch: "runtime-contract-v1",
  reasonCode: "daemon.runtime_contract.compatible",
  status: "compatible",
} as const;

const UPDATE_REQUIRED = {
  expectedEpoch: "runtime-contract-v2",
  observedEpoch: "runtime-contract-v1",
  reasonCode: "daemon.runtime_contract.mismatch",
  status: "update_required",
} as const;

describe("listOrganizationMemberOpenMeldServiceStatuses", () => {
  it("returns one coarse status per member without failing the whole list", async () => {
    const onLookupError = vi.fn();

    await expect(
      listOrganizationMemberOpenMeldServiceStatuses({
        generatedAt: "2026-07-21T00:00:00.000Z",
        lookupMemberServiceSessions: ({ userId }) => {
          if (userId === "connected-user") {
            return Promise.resolve([
              {
                executionCompatibility: COMPATIBLE,
                serviceUpdateWakeBlocked: false,
              },
            ]);
          }
          if (userId === "attention-user") {
            return Promise.resolve([
              {
                executionCompatibility: UPDATE_REQUIRED,
                serviceUpdateWakeBlocked: true,
              },
            ]);
          }
          if (userId === "unknown-user") {
            return Promise.reject(new Error("Runtime Transport lookup failed"));
          }
          return Promise.resolve([]);
        },
        memberUserIds: [
          "connected-user",
          "attention-user",
          "offline-user",
          "unknown-user",
        ],
        onLookupError,
        organizationId: "org-1",
      })
    ).resolves.toEqual({
      generatedAt: "2026-07-21T00:00:00.000Z",
      members: [
        { state: "connected", userId: "connected-user" },
        { state: "needs_attention", userId: "attention-user" },
        { state: "not_connected", userId: "offline-user" },
        { state: "unknown", userId: "unknown-user" },
      ],
      organizationId: "org-1",
    });
    expect(onLookupError).toHaveBeenCalledWith({
      error: expect.any(Error),
      userId: "unknown-user",
    });
  });
});
