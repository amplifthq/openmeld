import { projectTargetWakeLifecycleIdentity } from "@openmeld/schemas";
import type { RuntimeCoordinatorExecutionTokenAuthorityRecord } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { readRuntimeCoordinatorAgentProfileExecutionState } from "../runtime-transport/application/agent-profile-execution-state";
import type { RuntimeCoordinatorHeadLifecycleRecord } from "../runtime-transport/application/runtime-coordinator-authority";

const OWNER_USER_ID = "owner-1";
const TARGET_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

describe("RuntimeCoordinator Agent Profile execution state", () => {
  it("finds an active execution for the Agent even when it started in another Space", async () => {
    const response = await readRuntimeCoordinatorAgentProfileExecutionState({
      ownerUserId: OWNER_USER_ID,
      ports: {
        readCommandStates: async () => [],
        readHeadLifecycles: async () => [
          headLifecycle({
            runtimeCoordinatorExecutionId: "execution-in-another-space",
            spaceId: "another-space",
            status: "execution_linked",
          }),
        ],
        readTokenAuthority: vi.fn(async () => activeAuthority()),
      },
      targetProfileId: TARGET_PROFILE_ID,
    });

    expect(response).toEqual({ status: "active" });
  });

  it("ignores terminal executions and other Agent Profiles", async () => {
    const response = await readRuntimeCoordinatorAgentProfileExecutionState({
      ownerUserId: OWNER_USER_ID,
      ports: {
        readCommandStates: async () => [],
        readHeadLifecycles: async () => [
          headLifecycle({
            runtimeCoordinatorExecutionId: "terminal-execution",
            spaceId: "space-1",
            status: "execution_linked",
          }),
          headLifecycle({
            runtimeCoordinatorExecutionId: "other-agent-execution",
            spaceId: "space-2",
            status: "execution_linked",
            targetProfileId: "agt_22222222-2222-4222-8222-222222222222",
          }),
        ],
        readTokenAuthority: vi.fn(async (executionId) =>
          executionId === "terminal-execution"
            ? terminalAuthority()
            : activeAuthority()
        ),
      },
      targetProfileId: TARGET_PROFILE_ID,
    });

    expect(response).toEqual({ status: "inactive" });
  });

  it("fails closed when linked RuntimeCoordinator authority cannot be read", async () => {
    const response = await readRuntimeCoordinatorAgentProfileExecutionState({
      ownerUserId: OWNER_USER_ID,
      ports: {
        readCommandStates: async () => [],
        readHeadLifecycles: async () => [
          headLifecycle({
            runtimeCoordinatorExecutionId: "execution-1",
            spaceId: "space-1",
            status: "execution_linked",
          }),
        ],
        readTokenAuthority: vi.fn(async () => null),
      },
      targetProfileId: TARGET_PROFILE_ID,
    });

    expect(response).toEqual({
      reasonCode: "runtime_coordinator.execution_state_unavailable",
      status: "unavailable",
    });
  });
});

function headLifecycle(input: {
  runtimeCoordinatorExecutionId: string;
  spaceId: string;
  status: "execution_linked";
  targetProfileId?: string;
}): RuntimeCoordinatorHeadLifecycleRecord {
  const targetProfileId = input.targetProfileId ?? TARGET_PROFILE_ID;
  const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
    clientMessageId: null,
    dispatchId: `dispatch-${input.runtimeCoordinatorExecutionId}`,
    sourceSignalId: `signal-${input.runtimeCoordinatorExecutionId}`,
    spaceId: input.spaceId,
    targetProfileId,
  });
  return {
    createdAtMs: 1,
    duplicateDispatches: [],
    executionLinkedAtMs: 2,
    modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
    ownerUserId: OWNER_USER_ID,
    primaryDispatchId: `dispatch-${input.runtimeCoordinatorExecutionId}`,
    primaryIdempotencyKey: `idempotency-${input.runtimeCoordinatorExecutionId}`,
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    status: input.status,
    targetWakeLifecycleId: targetWakeLifecycleIdentity.targetWakeLifecycleId,
    targetWakeLifecycleIdentity,
    updatedAtMs: 2,
  };
}

function activeAuthority(): RuntimeCoordinatorExecutionTokenAuthorityRecord {
  return {
    terminalOutcome: null,
  } as RuntimeCoordinatorExecutionTokenAuthorityRecord;
}

function terminalAuthority(): RuntimeCoordinatorExecutionTokenAuthorityRecord {
  return {
    terminalOutcome: { status: "reply_published" },
  } as RuntimeCoordinatorExecutionTokenAuthorityRecord;
}
