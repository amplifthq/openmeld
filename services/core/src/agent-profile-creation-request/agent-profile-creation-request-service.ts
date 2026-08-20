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
  insert(
    record: AgentProfileCreationRequestRecord
  ): Promise<AgentProfileCreationRequestRecord>;
  listForParticipant(input: {
    organizationId: string;
    userId: string;
  }): Promise<AgentProfileCreationRequestRecord[]>;
  transition(input: {
    expectedStatuses: AgentProfileCreationRequestStatus[];
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

export function createAgentProfileCreationRequestService(input: {
  createAgentProfile: (
    request: AgentProfileCreationRequestRecord
  ) => Promise<string>;
  now?: () => number;
  projectApprovalInbox: (request: AgentProfileCreationRequest) => Promise<void>;
  randomUuid?: () => string;
  repository: AgentProfileCreationRequestRepository;
  resolveApprovalInbox: (request: AgentProfileCreationRequest) => Promise<void>;
}) {
  const now = input.now ?? Date.now;
  const randomUuid = input.randomUuid ?? (() => crypto.randomUUID());

  const completeApprovedRequest = async (
    record: AgentProfileCreationRequestRecord
  ): Promise<AgentProfileCreationRequest> => {
    if (record.status !== "approved") {
      return toPublicRequest(record);
    }
    const nowMs = now();
    let createdAgentProfileId: string;
    try {
      createdAgentProfileId = await input.createAgentProfile(record);
    } catch (error) {
      const executionError =
        error instanceof AgentProfileCreationRequestExecutionError
          ? error
          : null;
      const failed = await input.repository.transition({
        expectedStatuses: ["approved"],
        requestId: record.id,
        update: {
          createdAgentProfileId:
            executionError?.createdAgentProfileId ??
            record.createdAgentProfileId,
          failureMessage: normalizeFailureMessage(error),
          status: "failed",
          statusReason: "profile_creation_failed",
          updatedAtMs: nowMs,
        },
      });
      const current = failed ?? (await requireRequest(record));
      const response = toPublicRequest(current);
      await projectInboxSafely("resolve", response, input.resolveApprovalInbox);
      return response;
    }
    const completed = await input.repository.transition({
      expectedStatuses: ["approved"],
      requestId: record.id,
      update: {
        completedAtMs: nowMs,
        createdAgentProfileId,
        failureMessage: null,
        status: "completed",
        statusReason: "profile_created",
        updatedAtMs: nowMs,
      },
    });
    const current = completed ?? (await requireRequest(record));
    const response = toPublicRequest(current);
    await projectInboxSafely("resolve", response, input.resolveApprovalInbox);
    return response;
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
      const nowMs = now();
      const cancelled = await input.repository.transition({
        expectedStatuses: ["pending", "approved", "failed"],
        requestId: current.id,
        update: {
          decidedAtMs: current.decidedAtMs ?? nowMs,
          failureMessage: null,
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
      await projectInboxSafely("resolve", response, input.resolveApprovalInbox);
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
        assertSameIntent(existing, request.actorProfileId, body);
        return { replayed: true, request: toPublicRequest(existing) };
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
        inserted = await input.repository.insert(record);
      } catch (error) {
        const raced = await input.repository.findByIdempotencyKey({
          idempotencyKey: body.idempotencyKey,
          organizationId: request.organizationId,
          requesterUserId: request.requesterUserId,
        });
        if (!raced) {
          throw error;
        }
        assertSameIntent(raced, request.actorProfileId, body);
        return { replayed: true, request: toPublicRequest(raced) };
      }

      if (inserted.status === "pending") {
        const response = toPublicRequest(inserted);
        await projectInboxSafely(
          "create",
          response,
          input.projectApprovalInbox
        );
        return { replayed: false, request: response };
      }
      if (inserted.status === "approved") {
        return {
          replayed: false,
          request: await completeApprovedRequest(inserted),
        };
      }
      return { replayed: false, request: toPublicRequest(inserted) };
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
      const nowMs = now();
      if (request.decision === "decline") {
        const declined = await input.repository.transition({
          expectedStatuses: ["pending"],
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
        await projectInboxSafely(
          "resolve",
          response,
          input.resolveApprovalInbox
        );
        return response;
      }

      const approved = await input.repository.transition({
        expectedStatuses: ["pending"],
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
      const nowMs = now();
      const approved = await input.repository.transition({
        expectedStatuses: ["failed", "approved"],
        requestId: current.id,
        update: {
          failureMessage: null,
          status: "approved",
          statusReason:
            current.statusReason === "target_approved"
              ? "target_approved"
              : "automatically_allowed",
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

async function projectInboxSafely(
  operation: "create" | "resolve",
  request: AgentProfileCreationRequest,
  project: (request: AgentProfileCreationRequest) => Promise<void>
): Promise<void> {
  try {
    await project(request);
  } catch (error) {
    console.error(
      "[core.agent_profile_creation_request.inbox_projection_failed]",
      {
        error: error instanceof Error ? error.message : String(error),
        operation,
        organizationId: request.organizationId,
        requestId: request.id,
        targetOwnerUserId: request.targetOwnerUserId,
      }
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

function toPublicRequest(
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

function normalizeFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized =
    raw.trim() || "OpenMeld couldn't finish creating this Agent.";
  return normalized.slice(0, 1000);
}
