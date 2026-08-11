import { describe, expect, it, vi } from "vitest";
import {
  resolveSpaceClaimTimeLiveness,
  type SpaceClaimTimeLivenessReaders,
} from "../src/space/application/space-claim-liveness-service";

describe("space claim-time liveness service", () => {
  it("accepts an active target member when Wake policy is currently allowed", async () => {
    const readers = createReaders();

    await expect(
      resolveSpaceClaimTimeLiveness({
        input: createInput(),
        readers,
      })
    ).resolves.toEqual({
      diagnosticPointer: {
        contractVersion: 1,
        dispatchRuleSetVersion: 1,
        evaluatedAtMs: 1000,
        livenessContractVersion: "space_claim_time_liveness.v1",
        relation: "wake",
        sourceClientMessageId: "message-1",
        sourceSignalId: "signal-1",
        spaceId: "space-1",
        targetProfileId: "agent-profile-1",
      },
      status: "valid",
    });

    expect(readers.readMember).toHaveBeenCalledWith({
      targetProfileId: "agent-profile-1",
    });
    expect(readers.readDispatchRule).toHaveBeenCalledTimes(1);
    expect(readers.readContract).toHaveBeenCalledWith({
      spaceId: "space-1",
    });
  });

  it.each([
    {
      expectedReason: "claim_eligibility.target_no_longer_member",
      expectedStatus: "target_no_longer_member" as const,
      label: "missing target member",
      setup: (readers: SpaceClaimTimeLivenessReaders) => {
        vi.mocked(readers.readMember).mockResolvedValue(null);
      },
    },
    {
      expectedReason: "claim_eligibility.target_no_longer_member",
      expectedStatus: "target_no_longer_member" as const,
      label: "removed target member",
      setup: (readers: SpaceClaimTimeLivenessReaders) => {
        vi.mocked(readers.readMember).mockResolvedValue({
          profileId: "agent-profile-1",
          profileKindSnapshot: "agent",
          status: "removed",
          updatedAtMs: 900,
        });
      },
    },
    {
      expectedReason: "claim_eligibility.wake_no_longer_allowed_by_policy",
      expectedStatus: "policy_denied" as const,
      label: "Wake policy denied",
      setup: (readers: SpaceClaimTimeLivenessReaders) => {
        vi.mocked(readers.readDispatchRule).mockResolvedValue({
          allow: false,
          ruleSetVersion: 1,
        });
      },
    },
    {
      expectedReason: "claim_eligibility.space_liveness_missing",
      expectedStatus: "missing" as const,
      label: "missing contract",
      setup: (readers: SpaceClaimTimeLivenessReaders) => {
        vi.mocked(readers.readContract).mockResolvedValue(null);
      },
    },
  ])("fails closed for $label", async ({
    expectedReason,
    expectedStatus,
    setup,
  }) => {
    const readers = createReaders();
    setup(readers);

    await expect(
      resolveSpaceClaimTimeLiveness({
        input: createInput(),
        readers,
      })
    ).resolves.toMatchObject({
      reasonCode: expectedReason,
      status: expectedStatus,
    });
  });

  it.each([
    {
      input: {
        expectedMemberUpdatedAtMs: 800,
      },
      expectedReason: "claim_eligibility.space_liveness_stale",
      expectedStatus: "stale" as const,
    },
    {
      input: {
        expectedDispatchRuleSetVersion: 2,
      },
      expectedReason: "claim_eligibility.policy_version_mismatch",
      expectedStatus: "policy_version_mismatch" as const,
    },
    {
      input: {
        expectedContractVersion: 2,
      },
      expectedReason: "claim_eligibility.policy_version_mismatch",
      expectedStatus: "policy_version_mismatch" as const,
    },
  ])("fails closed for stale or mismatched Space evidence %#", async ({
    expectedReason,
    expectedStatus,
    input,
  }) => {
    await expect(
      resolveSpaceClaimTimeLiveness({
        input: {
          ...createInput(),
          ...input,
        },
        readers: createReaders(),
      })
    ).resolves.toMatchObject({
      reasonCode: expectedReason,
      status: expectedStatus,
    });
  });

  it("rejects Reference because only Wake creates dispatch work", async () => {
    await expect(
      resolveSpaceClaimTimeLiveness({
        input: {
          ...createInput(),
          relation: "reference",
        },
        readers: createReaders(),
      })
    ).resolves.toMatchObject({
      reasonCode: "claim_eligibility.non_wake_relation_not_dispatchable",
      status: "policy_denied",
    });
  });
});

function createInput() {
  return {
    nowMs: 1000,
    relation: "wake" as const,
    sourceClientMessageId: "message-1",
    sourceSignalId: "signal-1",
    spaceId: "space-1",
    targetProfileId: "agent-profile-1",
  };
}

function createReaders(): SpaceClaimTimeLivenessReaders {
  return {
    readContract: vi.fn(async () => ({
      version: 1,
    })),
    readDispatchRule: vi.fn(async () => ({
      allow: true,
      ruleSetVersion: 1,
    })),
    readMember: vi.fn(async () => ({
      profileId: "agent-profile-1",
      profileKindSnapshot: "agent",
      status: "active",
      updatedAtMs: 900,
    })),
  };
}
