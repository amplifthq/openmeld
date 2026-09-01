import {
  agentProfileCreationRequestSchema,
  createAgentProfileCreationRequestBodySchema,
  DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
  setAgentProfileCreationApprovalPreferenceBodySchema,
} from "@openmeld/schemas";
import type {
  AgentProfileCreationApprovalPolicy,
  AgentProfileCreationApprovalPreference,
  AgentProfileCreationConfiguration,
  AgentProfileCreationRequest,
  AgentProfileCreationRequestSource,
  AgentProfileCreationRequestStatus,
  AgentProfileCreationRequestStatusReason,
  AgentProfileCreationSessionStrategy,
  CreateAgentProfileCreationRequestBody,
  SetAgentProfileCreationApprovalPreferenceBody,
} from "@openmeld/schemas/types";

const DEFAULT_APPROVAL_POLICY = "ask_every_time" as const;
export const AGENT_PROFILE_CREATION_STALE_AFTER_MS = 30 * 60 * 1000;

export type AgentProfileCreationRequestRecord = {
  actorProfileId: string;
  completedAtMs: number | null;
  configuration: AgentProfileCreationConfiguration;
  createdAgentProfileId: string | null;
  createdAtMs: number;
  decidedAtMs: number | null;
  id: string;
  idempotencyKey: string;
  failureMessage: string | null;
  nativeSessionId: string | null;
  organizationId: string;
  profileCreationAttempt: number;
  profileCreationStartedAtMs: number | null;
  profileName: string;
  requestedSpaceId: string | null;
  requesterUserId: string;
  sessionStrategy: AgentProfileCreationSessionStrategy;
  source: AgentProfileCreationRequestSource;
  status: AgentProfileCreationRequestStatus;
  statusReason: AgentProfileCreationRequestStatusReason;
  targetOwnerUserId: string;
  updatedAtMs: number;
};

export type AgentProfileCreationApprovalPreferenceRecord = {
  existingSessionPolicy: AgentProfileCreationApprovalPolicy;
  newSessionPolicy: AgentProfileCreationApprovalPolicy;
  organizationId: string;
  updatedAtMs: number;
  userId: string;
};

export type AgentProfileCreationRequestInboxProjectionOperation =
  | "project"
  | "resolve";

export type AgentProfileCreationRequestInboxProjectionRecord = {
  attemptCount: number;
  generation: number;
  lastError: string | null;
  nextRetryAtMs: number | null;
  operation: AgentProfileCreationRequestInboxProjectionOperation;
  request: AgentProfileCreationRequestRecord;
  status: "completed" | "failed" | "pending";
};

export type AgentProfileCreationRequestRepository = {
  findByIdempotencyKey(input: {
    idempotencyKey: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<AgentProfileCreationRequestRecord | null>;
  getById(input: {
    organizationId: string;
    requestId: string;
  }): Promise<AgentProfileCreationRequestRecord | null>;
  getPreference(input: {
    organizationId: string;
    userId: string;
  }): Promise<AgentProfileCreationApprovalPreferenceRecord | null>;
  getInboxProjectionByRequestId(
    requestId: string
  ): Promise<AgentProfileCreationRequestInboxProjectionRecord | null>;
  listDueInboxProjections(input: {
    limit: number;
    nowMs: number;
  }): Promise<AgentProfileCreationRequestInboxProjectionRecord[]>;
  listStaleProfileCreations(input: {
    limit: number;
    staleBeforeMs: number;
  }): Promise<AgentProfileCreationRequestRecord[]>;
  insert(
    record: AgentProfileCreationRequestRecord,
    input?: {
      inboxProjection?: AgentProfileCreationRequestInboxProjectionOperation;
    }
  ): Promise<AgentProfileCreationRequestRecord>;
  listForParticipant(input: {
    organizationId: string;
    userId: string;
  }): Promise<AgentProfileCreationRequestRecord[]>;
  claimProfileCreation(input: {
    expectedProfileCreationStartedAtMs: number | null;
    expectedUpdatedAtMs: number;
    requestId: string;
    startedAtMs: number;
  }): Promise<AgentProfileCreationRequestRecord | null>;
  markInboxProjectionCompleted(input: {
    completedAtMs: number;
    generation: number;
    requestId: string;
  }): Promise<boolean>;
  markInboxProjectionFailed(input: {
    failedAtMs: number;
    generation: number;
    lastError: string;
    nextRetryAtMs: number;
    requestId: string;
  }): Promise<boolean>;
  synchronizeInboxProjectionIntents(input?: {
    requestId?: string;
  }): Promise<number>;
  transition(input: {
    expectedProfileCreationAttempt?: number;
    expectedStatuses: AgentProfileCreationRequestStatus[];
    expectedUpdatedAtMs: number;
    inboxProjection?: AgentProfileCreationRequestInboxProjectionOperation;
    requestId: string;
    update: Partial<AgentProfileCreationRequestRecord>;
  }): Promise<AgentProfileCreationRequestRecord | null>;
  upsertPreference(input: {
    existingSessionPolicy: AgentProfileCreationApprovalPolicy;
    newSessionPolicy: AgentProfileCreationApprovalPolicy;
    nowMs: number;
    organizationId: string;
    userId: string;
  }): Promise<AgentProfileCreationApprovalPreferenceRecord>;
};

export class AgentProfileCreationRequestConflictError extends Error {
  constructor(
    message = "This idempotency key is already used by another request."
  ) {
    super(message);
    this.name = "AgentProfileCreationRequestConflictError";
  }
}

export type AgentProfileCreationRequestExecutionCheckpoint = {
  checkpointCreatedAgentProfileId: (agentProfileId: string) => Promise<void>;
};

export class AgentProfileCreationRequestForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentProfileCreationRequestForbiddenError";
  }
}

export class AgentProfileCreationRequestNotFoundError extends Error {
  constructor() {
    super("Agent Profile creation request not found.");
    this.name = "AgentProfileCreationRequestNotFoundError";
  }
}

export class AgentProfileCreationRequestStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentProfileCreationRequestStateError";
  }
}

export class AgentProfileCreationRequestExecutionError extends Error {
  readonly createdAgentProfileId: string | null;

  constructor(input: {
    cause: unknown;
    createdAgentProfileId?: string | null;
    message?: string;
  }) {
    const causeMessage =
      input.cause instanceof Error ? input.cause.message : String(input.cause);
    super(input.message ?? causeMessage, { cause: input.cause });
    this.name = "AgentProfileCreationRequestExecutionError";
    this.createdAgentProfileId = input.createdAgentProfileId ?? null;
  }
}

class AgentProfileCreationRequestCheckpointStorageError extends Error {
  constructor(cause: unknown) {
    super("Agent Profile creation checkpoint storage failed.", { cause });
    this.name = "AgentProfileCreationRequestCheckpointStorageError";
  }
}

export async function failStaleAgentProfileCreationRequests(input: {
  limit?: number;
  nowMs: number;
  repository: AgentProfileCreationRequestRepository;
}): Promise<{ markedFailed: number; scanned: number; superseded: number }> {
  const stale = await input.repository.listStaleProfileCreations({
    limit: input.limit ?? 25,
    staleBeforeMs: input.nowMs - AGENT_PROFILE_CREATION_STALE_AFTER_MS,
  });
  let markedFailed = 0;
  let superseded = 0;
  for (const record of stale) {
    const setupIncomplete = record.createdAgentProfileId !== null;
    const failed = await input.repository.transition({
      expectedProfileCreationAttempt: record.profileCreationAttempt,
      expectedStatuses: ["approved"],
      expectedUpdatedAtMs: record.updatedAtMs,
      requestId: record.id,
      update: {
        failureMessage: setupIncomplete
          ? "OpenMeld lost contact while finishing setup for this Agent. Retry setup to continue safely."
          : "OpenMeld lost contact while creating this Agent. Retry to continue safely.",
        status: "failed",
        statusReason: setupIncomplete
          ? "profile_created"
          : "profile_creation_failed",
        updatedAtMs: Math.max(input.nowMs, record.updatedAtMs + 1),
      },
    });
    if (failed) {
      markedFailed += 1;
    } else {
      superseded += 1;
    }
  }
  return { markedFailed, scanned: stale.length, superseded };
}

export function createAgentProfileCreationRequestService(input: {
  attemptInboxProjection: (requestId: string) => Promise<void>;
  createAgentProfile: (
    request: AgentProfileCreationRequestRecord,
    checkpoint: AgentProfileCreationRequestExecutionCheckpoint
  ) => Promise<string>;
  now?: () => number;
  randomUuid?: () => string;
  repository: AgentProfileCreationRequestRepository;
}) {
  const now = input.now ?? Date.now;
  const randomUuid = input.randomUuid ?? (() => crypto.randomUUID());

  const completeApprovedRequest = async (
    record: AgentProfileCreationRequestRecord
  ): Promise<AgentProfileCreationRequest> => {
    if (record.status !== "approved") {
      return toPublicRequest(record);
    }
    const startedAtMs = Math.max(now(), record.updatedAtMs + 1);
    const claimed = await input.repository.claimProfileCreation({
      expectedProfileCreationStartedAtMs: record.profileCreationStartedAtMs,
      expectedUpdatedAtMs: record.updatedAtMs,
      requestId: record.id,
      startedAtMs,
    });
    if (!claimed) {
      return toPublicRequest(await requireRequest(record));
    }
    let activeClaim = claimed;
    let committedAgentProfileId = claimed.createdAgentProfileId;
    let createdAgentProfileId: string;
    try {
      createdAgentProfileId = await input.createAgentProfile(claimed, {
        checkpointCreatedAgentProfileId: async (agentProfileId) => {
          if (activeClaim.createdAgentProfileId) {
            if (activeClaim.createdAgentProfileId !== agentProfileId) {
              throw new AgentProfileCreationRequestStateError(
                "This request already belongs to another Agent Profile."
              );
            }
            return;
          }
          committedAgentProfileId = agentProfileId;
          const checkpointedAtMs = Math.max(now(), activeClaim.updatedAtMs + 1);
          const checkpointed = await input.repository
            .transition({
              expectedProfileCreationAttempt:
                activeClaim.profileCreationAttempt,
              expectedStatuses: ["approved"],
              expectedUpdatedAtMs: activeClaim.updatedAtMs,
              requestId: activeClaim.id,
              update: {
                createdAgentProfileId: agentProfileId,
                statusReason: "profile_created",
                updatedAtMs: checkpointedAtMs,
              },
            })
            .catch((cause) => {
              throw new AgentProfileCreationRequestCheckpointStorageError(
                cause
              );
            });
          if (!checkpointed) {
            throw new AgentProfileCreationRequestStateError(
              "This Agent Profile setup attempt was superseded."
            );
          }
          activeClaim = checkpointed;
        },
      });
    } catch (error) {
      const failedAtMs = Math.max(now(), activeClaim.updatedAtMs + 1);
      const executionError =
        error instanceof AgentProfileCreationRequestExecutionError
          ? error
          : null;
      const createdAgentProfileId =
        executionError?.createdAgentProfileId ??
        committedAgentProfileId ??
        activeClaim.createdAgentProfileId ??
        record.createdAgentProfileId;
      if (error instanceof AgentProfileCreationRequestCheckpointStorageError) {
        console.error(
          "[core.agent_profile_creation_request.execution_failed]",
          {
            error: readFailureMessage(error.cause),
            organizationId: record.organizationId,
            requestId: record.id,
          }
        );
      }
      const failed = await input.repository.transition({
        expectedProfileCreationAttempt: activeClaim.profileCreationAttempt,
        expectedStatuses: ["approved"],
        expectedUpdatedAtMs: activeClaim.updatedAtMs,
        requestId: record.id,
        update: {
          createdAgentProfileId,
          failureMessage: normalizeFailureMessage(error, {
            createdAgentProfileId,
          }),
          status: "failed",
          statusReason: createdAgentProfileId
            ? "profile_created"
            : "profile_creation_failed",
          updatedAtMs: failedAtMs,
        },
      });
      const current = failed ?? (await requireRequest(record));
      return toPublicRequest(current);
    }
    const completedAtMs = Math.max(now(), activeClaim.updatedAtMs + 1);
    const completed = await input.repository.transition({
      expectedProfileCreationAttempt: activeClaim.profileCreationAttempt,
      expectedStatuses: ["approved"],
      expectedUpdatedAtMs: activeClaim.updatedAtMs,
      requestId: record.id,
      update: {
        completedAtMs,
        createdAgentProfileId,
        failureMessage: null,
        status: "completed",
        statusReason: "profile_created",
        updatedAtMs: completedAtMs,
      },
    });
    const current = completed ?? (await requireRequest(record));
    return toPublicRequest(current);
  };

  const requireRequest = async (selector: {
    id: string;
    organizationId: string;
  }): Promise<AgentProfileCreationRequestRecord> => {
    const record = await input.repository.getById({
      organizationId: selector.organizationId,
      requestId: selector.id,
    });
    if (!record) {
      throw new AgentProfileCreationRequestNotFoundError();
    }
    return record;
  };

  const replayExistingRequest = async (
    record: AgentProfileCreationRequestRecord,
    actorProfileId: string,
    body: CreateAgentProfileCreationRequestBody
  ) => {
    assertSameIntent(record, actorProfileId, body);
    await input.attemptInboxProjection(record.id);
    return { replayed: true, request: toPublicRequest(record) } as const;
  };

  const completeInsertedRequest = async (
    record: AgentProfileCreationRequestRecord
  ) => {
    if (record.status === "pending") {
      const response = toPublicRequest(record);
      await input.attemptInboxProjection(record.id);
      return { replayed: false, request: response } as const;
    }
    return {
      replayed: false,
      request:
        record.status === "approved"
          ? await completeApprovedRequest(record)
          : toPublicRequest(record),
    } as const;
  };

  return {
    cancel: async (request: {
      organizationId: string;
      requesterUserId: string;
      requestId: string;
    }): Promise<AgentProfileCreationRequest> => {
      const current = await requireRequest({
        id: request.requestId,
        organizationId: request.organizationId,
      });
      if (current.requesterUserId !== request.requesterUserId) {
        throw new AgentProfileCreationRequestForbiddenError(
          "Only the requester can cancel this request."
        );
      }
      if (
        current.createdAgentProfileId !== null ||
        (current.status === "approved" &&
          current.profileCreationStartedAtMs !== null)
      ) {
        throw new AgentProfileCreationRequestStateError(
          "This request can no longer be cancelled."
        );
      }
      const nowMs = Math.max(now(), current.updatedAtMs + 1);
      const cancelled = await input.repository.transition({
        expectedStatuses: ["pending", "approved", "failed"],
        expectedUpdatedAtMs: current.updatedAtMs,
        inboxProjection: "resolve",
        requestId: current.id,
        update: {
          decidedAtMs: current.decidedAtMs ?? nowMs,
          failureMessage: null,
          profileCreationStartedAtMs: null,
          status: "cancelled",
          statusReason: "requester_cancelled",
          updatedAtMs: nowMs,
        },
      });
      if (!cancelled) {
        throw new AgentProfileCreationRequestStateError(
          "This request can no longer be cancelled."
        );
      }
      const response = toPublicRequest(cancelled);
      await input.attemptInboxProjection(cancelled.id);
      return response;
    },

    create: async (request: {
      actorProfileId: string;
      body: CreateAgentProfileCreationRequestBody;
      organizationId: string;
      requesterUserId: string;
    }): Promise<{
      replayed: boolean;
      request: AgentProfileCreationRequest;
    }> => {
      const body = createAgentProfileCreationRequestBodySchema.parse(
        request.body
      );
      const configuration =
        body.configuration ?? DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION;
      const existing = await input.repository.findByIdempotencyKey({
        idempotencyKey: body.idempotencyKey,
        organizationId: request.organizationId,
        requesterUserId: request.requesterUserId,
      });
      if (existing) {
        return await replayExistingRequest(
          existing,
          request.actorProfileId,
          body
        );
      }

      const preference = await input.repository.getPreference({
        organizationId: request.organizationId,
        userId: body.targetOwnerUserId,
      });
      const policy =
        body.sessionStrategy === "new"
          ? (preference?.newSessionPolicy ?? DEFAULT_APPROVAL_POLICY)
          : (preference?.existingSessionPolicy ?? DEFAULT_APPROVAL_POLICY);
      const isSelfRequest = request.requesterUserId === body.targetOwnerUserId;
      const initial = resolveInitialStatus({ isSelfRequest, policy });
      const nowMs = now();
      const record: AgentProfileCreationRequestRecord = {
        actorProfileId: request.actorProfileId,
        completedAtMs: null,
        configuration,
        createdAgentProfileId: null,
        createdAtMs: nowMs,
        decidedAtMs: initial.status === "pending" ? null : nowMs,
        id: `apcr_${randomUuid()}`,
        idempotencyKey: body.idempotencyKey,
        failureMessage: null,
        nativeSessionId: body.nativeSessionId ?? null,
        organizationId: request.organizationId,
        profileCreationAttempt: 0,
        profileCreationStartedAtMs: null,
        profileName: body.profileName,
        requestedSpaceId: body.requestedSpaceId ?? null,
        requesterUserId: request.requesterUserId,
        sessionStrategy: body.sessionStrategy,
        source: body.source,
        status: initial.status,
        statusReason: initial.statusReason,
        targetOwnerUserId: body.targetOwnerUserId,
        updatedAtMs: nowMs,
      };

      let inserted: AgentProfileCreationRequestRecord;
      try {
        inserted = await input.repository.insert(
          record,
          record.status === "pending"
            ? { inboxProjection: "project" }
            : undefined
        );
      } catch (error) {
        const raced = await input.repository.findByIdempotencyKey({
          idempotencyKey: body.idempotencyKey,
          organizationId: request.organizationId,
          requesterUserId: request.requesterUserId,
        });
        if (!raced) {
          throw error;
        }
        return await replayExistingRequest(raced, request.actorProfileId, body);
      }
      return await completeInsertedRequest(inserted);
    },

    decide: async (request: {
      decision: "approve" | "decline";
      organizationId: string;
      requestId: string;
      userId: string;
    }): Promise<AgentProfileCreationRequest> => {
      const current = await requireRequest({
        id: request.requestId,
        organizationId: request.organizationId,
      });
      if (current.targetOwnerUserId !== request.userId) {
        throw new AgentProfileCreationRequestForbiddenError(
          "Only the requested member can decide this request."
        );
      }
      const nowMs = Math.max(now(), current.updatedAtMs + 1);
      if (request.decision === "decline") {
        const declined = await input.repository.transition({
          expectedStatuses: ["pending"],
          expectedUpdatedAtMs: current.updatedAtMs,
          inboxProjection: "resolve",
          requestId: current.id,
          update: {
            decidedAtMs: nowMs,
            status: "declined",
            statusReason: "target_declined",
            updatedAtMs: nowMs,
          },
        });
        if (!declined) {
          throw new AgentProfileCreationRequestStateError(
            "This request has already been decided."
          );
        }
        const response = toPublicRequest(declined);
        await input.attemptInboxProjection(declined.id);
        return response;
      }

      const approved = await input.repository.transition({
        expectedStatuses: ["pending"],
        expectedUpdatedAtMs: current.updatedAtMs,
        inboxProjection: "resolve",
        requestId: current.id,
        update: {
          decidedAtMs: nowMs,
          status: "approved",
          statusReason: "target_approved",
          updatedAtMs: nowMs,
        },
      });
      if (!approved) {
        throw new AgentProfileCreationRequestStateError(
          "This request has already been decided."
        );
      }
      await input.attemptInboxProjection(approved.id);
      return await completeApprovedRequest(approved);
    },

    getPreference: async (request: {
      organizationId: string;
      userId: string;
    }): Promise<AgentProfileCreationApprovalPreference> => {
      const record = await input.repository.getPreference(request);
      return {
        existingSessionPolicy:
          record?.existingSessionPolicy ?? DEFAULT_APPROVAL_POLICY,
        newSessionPolicy: record?.newSessionPolicy ?? DEFAULT_APPROVAL_POLICY,
        organizationId: request.organizationId,
        updatedAt: record ? new Date(record.updatedAtMs).toISOString() : null,
        userId: request.userId,
      };
    },

    list: async (request: {
      organizationId: string;
      userId: string;
    }): Promise<AgentProfileCreationRequest[]> => {
      const records = await input.repository.listForParticipant(request);
      return records.map(toPublicRequest);
    },

    retry: async (request: {
      organizationId: string;
      requestId: string;
      userId: string;
    }): Promise<AgentProfileCreationRequest> => {
      const current = await requireRequest({
        id: request.requestId,
        organizationId: request.organizationId,
      });
      if (
        current.requesterUserId !== request.userId &&
        current.targetOwnerUserId !== request.userId
      ) {
        throw new AgentProfileCreationRequestForbiddenError(
          "Only a participant can retry this request."
        );
      }
      if (current.status === "approved") {
        if (current.profileCreationStartedAtMs !== null) {
          throw new AgentProfileCreationRequestStateError(
            "This Agent is already being created."
          );
        }
        return await completeApprovedRequest(current);
      }
      const nowMs = Math.max(now(), current.updatedAtMs + 1);
      let retryStatusReason: AgentProfileCreationRequestStatusReason =
        "automatically_allowed";
      if (current.createdAgentProfileId) {
        retryStatusReason = "profile_created";
      } else if (current.statusReason === "target_approved") {
        retryStatusReason = "target_approved";
      }
      const approved = await input.repository.transition({
        expectedStatuses: ["failed"],
        expectedUpdatedAtMs: current.updatedAtMs,
        requestId: current.id,
        update: {
          failureMessage: null,
          profileCreationStartedAtMs: null,
          status: "approved",
          statusReason: retryStatusReason,
          updatedAtMs: nowMs,
        },
      });
      if (!approved) {
        throw new AgentProfileCreationRequestStateError(
          "This request cannot be retried."
        );
      }
      return await completeApprovedRequest(approved);
    },

    setPreference: async (request: {
      body: SetAgentProfileCreationApprovalPreferenceBody;
      organizationId: string;
      userId: string;
    }): Promise<AgentProfileCreationApprovalPreference> => {
      const body = setAgentProfileCreationApprovalPreferenceBodySchema.parse(
        request.body
      );
      const record = await input.repository.upsertPreference({
        ...body,
        nowMs: now(),
        organizationId: request.organizationId,
        userId: request.userId,
      });
      return {
        ...body,
        organizationId: record.organizationId,
        updatedAt: new Date(record.updatedAtMs).toISOString(),
        userId: record.userId,
      };
    },
  };
}

function resolveInitialStatus(input: {
  isSelfRequest: boolean;
  policy: AgentProfileCreationApprovalPolicy;
}): Pick<AgentProfileCreationRequestRecord, "status" | "statusReason"> {
  if (input.isSelfRequest) {
    return { status: "approved", statusReason: "self_request" };
  }
  switch (input.policy) {
    case "automatically_allow":
      return { status: "approved", statusReason: "automatically_allowed" };
    case "never_allow":
      return { status: "declined", statusReason: "target_policy_denied" };
    case "ask_every_time":
      return { status: "pending", statusReason: "approval_required" };
    default:
      throw new Error(
        `Unsupported Agent Profile creation policy: ${input.policy}`
      );
  }
}

function assertSameIntent(
  record: AgentProfileCreationRequestRecord,
  actorProfileId: string,
  body: CreateAgentProfileCreationRequestBody
): void {
  if (
    record.actorProfileId !== actorProfileId ||
    JSON.stringify(record.configuration) !==
      JSON.stringify(
        body.configuration ?? DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION
      ) ||
    record.targetOwnerUserId !== body.targetOwnerUserId ||
    record.profileName !== body.profileName ||
    record.sessionStrategy !== body.sessionStrategy ||
    record.nativeSessionId !== (body.nativeSessionId ?? null) ||
    record.requestedSpaceId !== (body.requestedSpaceId ?? null) ||
    record.source !== body.source
  ) {
    throw new AgentProfileCreationRequestConflictError();
  }
}

export function toPublicRequest(
  record: AgentProfileCreationRequestRecord
): AgentProfileCreationRequest {
  return agentProfileCreationRequestSchema.parse({
    actorProfileId: record.actorProfileId,
    completedAt:
      record.completedAtMs === null
        ? null
        : new Date(record.completedAtMs).toISOString(),
    configuration: record.configuration,
    createdAgentProfileId: record.createdAgentProfileId,
    createdAt: new Date(record.createdAtMs).toISOString(),
    decidedAt:
      record.decidedAtMs === null
        ? null
        : new Date(record.decidedAtMs).toISOString(),
    id: record.id,
    failureMessage: record.failureMessage,
    nativeSessionId: record.nativeSessionId,
    organizationId: record.organizationId,
    profileName: record.profileName,
    requestedSpaceId: record.requestedSpaceId,
    requesterUserId: record.requesterUserId,
    sessionStrategy: record.sessionStrategy,
    source: record.source,
    status: record.status,
    statusReason: record.statusReason,
    targetOwnerUserId: record.targetOwnerUserId,
    updatedAt: new Date(record.updatedAtMs).toISOString(),
  });
}

function normalizeFailureMessage(
  error: unknown,
  input: { createdAgentProfileId: string | null }
): string {
  const raw = readFailureMessage(error);
  if (error instanceof AgentProfileCreationRequestCheckpointStorageError) {
    return input.createdAgentProfileId
      ? "OpenMeld created the Agent, but couldn't finish setup. Retry setup to continue safely."
      : "OpenMeld couldn't finish creating this Agent. Retry to continue safely.";
  }
  const normalized =
    raw.trim() || "OpenMeld couldn't finish creating this Agent.";
  return normalized.slice(0, 1000);
}

function readFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
