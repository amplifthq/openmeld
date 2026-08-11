import type {
  GetActiveSpaceWakeProgressResponse,
  GetSpaceWakeProgressResponse,
  OrganizationSpaceDirectoryWithMemberCountsResponse,
  PostSpaceMembersResponse,
  PostSpaceWakeStopResponse,
} from "@openmeld/schemas/types";

export const COLLABORATION_CONTROL_SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export const COLLABORATION_CONTROL_HUMAN_PROFILE_ID =
  "11111111-1111-4111-8111-111111111111";

export const COLLABORATION_CONTROL_AGENT_PROFILE_ID =
  "agt_22222222-2222-4222-8222-222222222222";

/**
 * Captured from the shared Space API contract exercised by
 * packages/api-client/tests/space-api.test.ts. Keep every strict response
 * field here so CLI tests cannot invent a narrower payload.
 */
export const ACTIVE_WAKE_PROGRESS_FIXTURE = {
  query: {
    spaceId: COLLABORATION_CONTROL_SPACE_ID,
    targetProfileId: null,
  },
  items: [
    {
      clientMessageId: "client-message-1",
      sourceSignalId: "sig-source-1",
      dispatchId: "dispatch-1",
      targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
      targetLabel: "@builder",
      phase: "running",
      message: "@builder is working on this computer...",
      updatedAtMs: 1_805_000_000_000,
      terminal: false,
      wakeStopEligibility: {
        controlMode: "cancel",
        reasonCode: null,
        reliability: "native_cancel",
        status: "eligible",
      },
    },
  ],
} as const satisfies GetActiveSpaceWakeProgressResponse;

export const SELECTED_WAKE_PROGRESS_FIXTURE = {
  query: {
    spaceId: COLLABORATION_CONTROL_SPACE_ID,
    clientMessageId: "client-message-1",
    targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
  },
  items: ACTIVE_WAKE_PROGRESS_FIXTURE.items,
} as const satisfies GetSpaceWakeProgressResponse;

/**
 * Captured mixed-version response shape from
 * packages/api-client/tests/space-api.test.ts before Stop eligibility opt-in.
 */
export const SELECTED_WAKE_PROGRESS_WITHOUT_ELIGIBILITY_FIXTURE = {
  query: {
    spaceId: COLLABORATION_CONTROL_SPACE_ID,
    clientMessageId: "client-message-1",
    targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
  },
  items: [
    {
      clientMessageId: "client-message-1",
      sourceSignalId: "sig-source-1",
      dispatchId: "dispatch-1",
      targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
      targetLabel: "@builder",
      phase: "running",
      message: "@builder is working on this computer...",
      updatedAtMs: 1_805_000_000_000,
      terminal: false,
    },
  ],
} as const satisfies GetSpaceWakeProgressResponse;

export const TERMINAL_WAKE_PROGRESS_FIXTURE = {
  query: {
    spaceId: COLLABORATION_CONTROL_SPACE_ID,
    clientMessageId: "client-message-terminal",
    targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
  },
  items: [
    {
      clientMessageId: "client-message-terminal",
      sourceSignalId: "sig-source-terminal",
      dispatchId: "dispatch-terminal",
      targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
      targetLabel: "@builder",
      phase: "replied",
      message: "@builder replied in this Space.",
      updatedAtMs: 1_805_000_001_000,
      terminal: true,
    },
  ],
} as const satisfies GetSpaceWakeProgressResponse;

/** Captured from packages/api-client/tests/space-api.test.ts. */
export const WAKE_STOP_REQUESTED_FIXTURE = {
  ok: true,
  runtimeCoordinatorExecutionId: "rce_01HZX6ZAQ2JX1K7K3X3HYD6P8C",
  status: "cancellation_requested",
  targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
  cancellationState: {
    observedAtMs: 1_805_000_000_000,
    reasonCode: "runtime_coordinator.wake_stop_requested",
    status: "requested",
  },
} as const satisfies PostSpaceWakeStopResponse;

/** Captured from Core's buildSpaceWakeStopPreAgentCancelledResponse. */
export const WAKE_STOP_CANCELLED_FIXTURE = {
  ok: true,
  runtimeCoordinatorExecutionId: null,
  stopMode: "openmeld_owned_pre_agent",
  status: "cancelled",
  targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
  cancellationState: {
    observedAtMs: 1_805_000_001_000,
    reasonCode: "runtime_coordinator.pre_agent_stop_requested",
    status: "cancelled",
  },
} as const satisfies PostSpaceWakeStopResponse;

/** Captured from Core's terminal RuntimeCoordinator Wake Stop contract test. */
export const WAKE_STOP_NOT_STOPPABLE_FIXTURE = {
  ok: false,
  reasonCode: "runtime_coordinator.wake_stop_execution_terminal",
  runtimeCoordinatorExecutionId: "rce_01HZX6ZAQ2JX1K7K3X3HYD6P8C",
  status: "not_stoppable",
  targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
  cancellationState: {
    observedAtMs: 1_805_000_001_000,
    reasonCode: "runtime_coordinator.wake_stop_execution_terminal",
    status: "not_requested",
  },
} as const satisfies PostSpaceWakeStopResponse;

/** Captured from packages/api-client/tests/organization-api.test.ts. */
export const ORGANIZATION_SPACE_DIRECTORY_FIXTURE = {
  organizationId: "org-1",
  generatedAt: "2026-07-04T00:00:00.000Z",
  spaces: [
    {
      activeMemberCount: 12,
      spaceId: COLLABORATION_CONTROL_SPACE_ID,
      name: "Launch Room",
      organizationId: "org-1",
      visibility: "public",
      joined: false,
      lastJoinedAt: null,
      spaceCreatedAt: "2026-07-04T00:00:00.000Z",
      spaceUpdatedAt: "2026-07-04T00:01:00.000Z",
      updatedAt: "2026-07-04T00:02:00.000Z",
    },
    {
      activeMemberCount: null,
      spaceId:
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      name: "Joined Private Room",
      organizationId: "org-1",
      visibility: "private",
      joined: true,
      lastJoinedAt: "2026-07-04T00:03:00.000Z",
      spaceCreatedAt: "2026-07-04T00:00:00.000Z",
      spaceUpdatedAt: null,
      updatedAt: "2026-07-04T00:03:00.000Z",
    },
  ],
} as const satisfies OrganizationSpaceDirectoryWithMemberCountsResponse;

/** Captured from packages/api-client/tests/space-api.test.ts. */
export const SELF_SERVE_SPACE_JOIN_FIXTURE = {
  addedMemberIds: [COLLABORATION_CONTROL_HUMAN_PROFILE_ID],
  alreadyMemberIds: [],
  items: [],
} as const satisfies PostSpaceMembersResponse;
