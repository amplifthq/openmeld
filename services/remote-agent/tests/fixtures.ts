import type {
  CenterAgentModelRoute,
  CenterAgentRoutineAuthorizedAction,
  RemoteAgentTurnEnvelope,
  RemoteAgentWorkerSubmitTurnRequestV1,
  RemoteAgentWorkerSubmitTurnRequestV2,
} from "@openmeld/schemas/types";

export const TEST_NOW_MS = Date.UTC(2026, 6, 6, 12, 0, 0);
export const TEST_REMOTE_AGENT_AI_GATEWAY_ENV = {
  CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-ai-gateway-token",
  OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID: "account_123",
  OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID: "gateway_123",
  OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS: "openrouter",
} as const;
export const TEST_CENTER_AGENT_MODEL_ROUTE = {
  automaticModelFallback: false,
  catalogUpdatedAt: "2026-07-31T00:00:00.000Z",
  contextWindow: 1_000_000,
  displayName: "DeepSeek V4 Flash",
  imageUnderstandingModel: {
    contextWindow: 500_000,
    displayName: "Grok 4.6",
    inputModalities: ["text", "image"],
    maxOutputTokens: 16_384,
    modelId: "x-ai/grok-4.6",
    provider: "openrouter",
    reasoningLevel: "high",
  },
  inputModalities: ["text"],
  maxOutputTokens: 16_384,
  modelId: "deepseek/deepseek-v4-flash",
  preference: {
    kind: "selected_model",
    modelId: "deepseek/deepseek-v4-flash",
  },
  provider: "openrouter",
  reasoningLevel: "high",
} as const satisfies CenterAgentModelRoute;

// Mirrors the shipped system-default route after GLM 5.3 Flash became the
// Center Agent default on 2026-08-27.
export const TEST_CENTER_AGENT_GLM_DEFAULT_MODEL_ROUTE = {
  automaticModelFallback: false,
  catalogUpdatedAt: "2026-08-27T00:00:00.000Z",
  contextWindow: 1_048_576,
  displayName: "GLM 5.3 Flash",
  imageUnderstandingModel: {
    contextWindow: 500_000,
    displayName: "Grok 4.6",
    inputModalities: ["text", "image"],
    maxOutputTokens: 16_384,
    modelId: "x-ai/grok-4.6",
    provider: "openrouter",
    reasoningLevel: "high",
  },
  inputModalities: ["text", "image"],
  maxOutputTokens: 16_384,
  modelId: "z-ai/glm-5.3-flash",
  preference: {
    kind: "system_default",
  },
  provider: "openrouter",
  reasoningLevel: "high",
} as const satisfies CenterAgentModelRoute;

export function createSubmitTurnRequest(
  overrides: Partial<RemoteAgentWorkerSubmitTurnRequestV1> = {}
): RemoteAgentWorkerSubmitTurnRequestV1 {
  return {
    agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
    agentProfileOwnerUserId: "user_1",
    author: {
      displayName: "Felix",
      profileId: "22222222-2222-4222-8222-222222222222",
      profileKind: "human",
    },
    bindingId: "binding_123",
    dispatchId: "dispatch_123",
    idempotencyKey: "remote-agent:dispatch_123",
    messages: [{ content: "Summarize the launch blocker.", role: "user" }],
    onBehalfOf: null,
    organizationId: "org_123",
    sourceClientMessageId: "client_msg_123",
    spaceId: "space_123",
    triggerMessageId: "signal_123",
    turnEnvelope: {
      sender: {
        kind: "member",
        id: "member_123",
        displayName: "Felix",
        ownerUserId: "user_1",
        profileId: "22222222-2222-4222-8222-222222222222",
        role: "owner",
        verified: true,
      },
      space: {
        id: "space_123",
        name: "Felix and Center Agent",
        kind: "dm",
        isCenterAgentDm: true,
      },
      organization: {
        id: "org_123",
        name: "Felix",
        personal: true,
        memberCount: 1,
      },
      centerAgent: {
        profileName: "Felix's Center Agent",
        profileHandle: "felixs-center-agent",
      },
      trigger: {
        source: "web_dm",
      },
    },
    v: 1,
    ...overrides,
  };
}

export function createSubmitTurnRequestV2(
  overrides: Partial<RemoteAgentWorkerSubmitTurnRequestV2> = {}
): RemoteAgentWorkerSubmitTurnRequestV2 {
  const { v: _legacyVersion, ...request } = createSubmitTurnRequest();
  return {
    ...request,
    modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
    v: 2,
    ...overrides,
  };
}

export function createRoutineTurnEnvelope(
  input: {
    authorizedActions?: CenterAgentRoutineAuthorizedAction[];
    delegatedMemberId?: string;
    destination?:
      | { kind: "space"; spaceId: string }
      | {
          channelId: string;
          conversationId: string;
          kind: "slack_thread";
          label?: string;
          teamId: string;
          threadTs: string;
        };
    routineId?: string;
    routineName?: string;
    runId?: string;
    scheduledFor?: number;
    externalActionPolicy?: "read_only" | "standard";
  } = {}
): RemoteAgentTurnEnvelope {
  const routineId = input.routineId ?? "routine_1";
  const runId = input.runId ?? "routine_run_1";
  const destination = input.destination ?? {
    kind: "space" as const,
    spaceId: "space_123",
  };
  const space =
    destination.kind === "space"
      ? createSubmitTurnRequest().turnEnvelope.space
      : {
          id: destination.conversationId,
          isCenterAgentDm: false,
          kind: "space" as const,
          name: destination.label ?? "Slack thread",
        };
  return {
    ...createSubmitTurnRequest().turnEnvelope,
    sender: {
      createdByUserId: "user_1",
      delegatedBy: {
        displayName: "Felix",
        id: input.delegatedMemberId ?? "member_123",
        ownerUserId: "user_1",
        profileId: "22222222-2222-4222-8222-222222222222",
        verified: true,
      },
      kind: "routine",
      routineId,
    },
    space,
    trigger: {
      authorizedActions: input.authorizedActions ?? [],
      destination,
      externalActionPolicy: input.externalActionPolicy ?? "standard",
      routineId,
      routineName: input.routineName ?? "Triage feedback",
      runId,
      scheduledFor: input.scheduledFor ?? TEST_NOW_MS,
      source: "routine",
    },
  };
}
