import {
  agentProfileCreationRequestMutationResponseSchema,
  createAgentProfileCreationRequestBodySchema,
  createAgentProfileCreationRequestResponseSchema,
  decideAgentProfileCreationRequestBodySchema,
  getAgentProfileCreationApprovalPreferenceResponseSchema,
  listAgentProfileCreationRequestsResponseSchema,
  openMeldRequestContextSchema,
  setAgentProfileCreationApprovalPreferenceBodySchema,
  setAgentProfileCreationApprovalPreferenceResponseSchema,
} from "@openmeld/schemas";
import type {
  AgentProfileCreationApprovalPolicy,
  AgentProfileCreationConfiguration,
  AgentProfileCreationRequestMutationResponse,
  AgentProfileCreationSessionStrategy,
  CenterAgentOnBehalfOfInput,
  CreateAgentProfileCreationRequestBody,
  CreateAgentProfileCreationRequestResponse,
  DecideAgentProfileCreationRequestBody,
  GetAgentProfileCreationApprovalPreferenceResponse,
  ListAgentProfileCreationRequestsResponse,
  OpenMeldRequestContext,
  SetAgentProfileCreationApprovalPreferenceBody,
  SetAgentProfileCreationApprovalPreferenceResponse,
} from "@openmeld/schemas/types";
import { projectCenterAgentLocalAgentConnectionCandidates } from "../center-agent/application/product-operations";
import { resolveCenterAgentAuditAttribution } from "../center-agent/center-agent-audit";
import { requireCurrentDesignatedCenterAgentCaller } from "../center-agent/current-designated-center-agent";
import { type CoreBindings, identityDb } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  rpcAddOrganizationDirectoryProfilesToSpace,
  rpcAuthorizeAgentProfileBindingForOrganization,
  rpcEnsureAgentProfilePrimaryBinding,
  rpcListLocalRuntimes,
  rpcSetCurrentAgentProfileWorkspace,
  rpcUpdateAgentProfileDefaultProject,
} from "../rpc/methods";
import {
  projectAgentProfileCreationRequestInbox,
  resolveAgentProfileCreationRequestInbox,
} from "./agent-profile-creation-request-inbox";
import { createD1AgentProfileCreationRequestRepository } from "./agent-profile-creation-request-repository";
import {
  AgentProfileCreationRequestConflictError,
  AgentProfileCreationRequestExecutionError,
  AgentProfileCreationRequestForbiddenError,
  AgentProfileCreationRequestNotFoundError,
  type AgentProfileCreationRequestRecord,
  AgentProfileCreationRequestStateError,
  createAgentProfileCreationRequestService,
} from "./agent-profile-creation-request-service";

export type CreateAgentProfileCreationRequestRpcInput =
  CreateAgentProfileCreationRequestBody & {
    context?: OpenMeldRequestContext;
    organizationId: string;
  };

export type ListAgentProfileCreationRequestsRpcInput = {
  context?: OpenMeldRequestContext;
  organizationId: string;
};

export type DecideAgentProfileCreationRequestRpcInput =
  DecideAgentProfileCreationRequestBody & {
    context?: OpenMeldRequestContext;
    organizationId: string;
    requestId: string;
  };

export type MutateAgentProfileCreationRequestRpcInput = {
  context?: OpenMeldRequestContext;
  organizationId: string;
  requestId: string;
};

export type GetAgentProfileCreationApprovalPreferenceRpcInput = {
  context?: OpenMeldRequestContext;
  organizationId: string;
};

export type SetAgentProfileCreationApprovalPreferenceRpcInput =
  SetAgentProfileCreationApprovalPreferenceBody & {
    context?: OpenMeldRequestContext;
    organizationId: string;
  };

export type CenterAgentCreateAgentProfileCreationRequestRpcInput = {
  configuration?: AgentProfileCreationConfiguration;
  context?: OpenMeldRequestContext;
  nativeSessionId?: string | null;
  onBehalfOf: CenterAgentOnBehalfOfInput;
  profileName: string;
  requestedSpaceId?: string | null;
  sessionStrategy: AgentProfileCreationSessionStrategy;
  targetOwnerUserId: string;
};

export type CenterAgentListAgentProfileCreationRequestsRpcInput = {
  context?: OpenMeldRequestContext;
  onBehalfOf: CenterAgentOnBehalfOfInput;
};

export type CenterAgentManageAgentProfileCreationRequestRpcInput = {
  action: "approve" | "decline" | "cancel" | "retry";
  context?: OpenMeldRequestContext;
  onBehalfOf: CenterAgentOnBehalfOfInput;
  requestId: string;
};

export type CenterAgentGetAgentProfileCreationApprovalPreferenceRpcInput = {
  context?: OpenMeldRequestContext;
  onBehalfOf: CenterAgentOnBehalfOfInput;
};

export type CenterAgentSetAgentProfileCreationApprovalPreferenceRpcInput = {
  context?: OpenMeldRequestContext;
  existingSessionPolicy: AgentProfileCreationApprovalPolicy;
  newSessionPolicy: AgentProfileCreationApprovalPolicy;
  onBehalfOf: CenterAgentOnBehalfOfInput;
};

export async function rpcCenterAgentCreateAgentProfileCreationRequest(
  env: CoreBindings,
  input: CenterAgentCreateAgentProfileCreationRequestRpcInput
): Promise<CreateAgentProfileCreationRequestResponse> {
  const prepared = await prepareCenterAgentRepresentedMemberRequest({
    context: input.context,
    env,
    onBehalfOf: input.onBehalfOf,
  });
  return await rpcCreateAgentProfileCreationRequest(env, {
    configuration: input.configuration,
    context: prepared.context,
    idempotencyKey: await buildCenterAgentCreationRequestIdempotencyKey({
      configuration: input.configuration,
      context: prepared.context,
      nativeSessionId: input.nativeSessionId ?? null,
      profileName: input.profileName,
      sessionStrategy: input.sessionStrategy,
      targetOwnerUserId: input.targetOwnerUserId,
    }),
    nativeSessionId: input.nativeSessionId,
    organizationId: prepared.organizationId,
    profileName: input.profileName,
    requestedSpaceId: input.requestedSpaceId,
    sessionStrategy: input.sessionStrategy,
    source: "center_agent",
    targetOwnerUserId: input.targetOwnerUserId,
  });
}

export async function rpcCenterAgentListAgentProfileCreationRequests(
  env: CoreBindings,
  input: CenterAgentListAgentProfileCreationRequestsRpcInput
): Promise<ListAgentProfileCreationRequestsResponse> {
  const prepared = await prepareCenterAgentRepresentedMemberRequest({
    context: input.context,
    env,
    onBehalfOf: input.onBehalfOf,
  });
  return await rpcListAgentProfileCreationRequests(env, {
    context: prepared.context,
    organizationId: prepared.organizationId,
  });
}

export async function rpcCenterAgentManageAgentProfileCreationRequest(
  env: CoreBindings,
  input: CenterAgentManageAgentProfileCreationRequestRpcInput
): Promise<AgentProfileCreationRequestMutationResponse> {
  const prepared = await prepareCenterAgentRepresentedMemberRequest({
    context: input.context,
    env,
    onBehalfOf: input.onBehalfOf,
  });
  const request = {
    context: prepared.context,
    organizationId: prepared.organizationId,
    requestId: input.requestId,
  };
  switch (input.action) {
    case "approve":
    case "decline":
      return await rpcDecideAgentProfileCreationRequest(env, {
        ...request,
        decision: input.action,
      });
    case "cancel":
      return await rpcCancelAgentProfileCreationRequest(env, request);
    case "retry":
      return await rpcRetryAgentProfileCreationRequest(env, request);
    default:
      throw invalidPayload("Unsupported Agent Profile request action.");
  }
}

export async function rpcCenterAgentGetAgentProfileCreationApprovalPreference(
  env: CoreBindings,
  input: CenterAgentGetAgentProfileCreationApprovalPreferenceRpcInput
): Promise<GetAgentProfileCreationApprovalPreferenceResponse> {
  const prepared = await prepareCenterAgentRepresentedMemberRequest({
    context: input.context,
    env,
    onBehalfOf: input.onBehalfOf,
  });
  return await rpcGetAgentProfileCreationApprovalPreference(env, {
    context: prepared.context,
    organizationId: prepared.organizationId,
  });
}

export async function rpcCenterAgentSetAgentProfileCreationApprovalPreference(
  env: CoreBindings,
  input: CenterAgentSetAgentProfileCreationApprovalPreferenceRpcInput
): Promise<SetAgentProfileCreationApprovalPreferenceResponse> {
  const prepared = await prepareCenterAgentRepresentedMemberRequest({
    context: input.context,
    env,
    onBehalfOf: input.onBehalfOf,
  });
  return await rpcSetAgentProfileCreationApprovalPreference(env, {
    context: prepared.context,
    existingSessionPolicy: input.existingSessionPolicy,
    newSessionPolicy: input.newSessionPolicy,
    organizationId: prepared.organizationId,
  });
}

export async function rpcCreateAgentProfileCreationRequest(
  env: CoreBindings,
  input: CreateAgentProfileCreationRequestRpcInput
): Promise<CreateAgentProfileCreationRequestResponse> {
  const context = requireContext(input.context);
  const organizationId = requireIdentifier(
    input.organizationId,
    "Organization"
  );
  const body = createAgentProfileCreationRequestBodySchema.safeParse({
    configuration: input.configuration,
    idempotencyKey: input.idempotencyKey,
    nativeSessionId: input.nativeSessionId,
    profileName: input.profileName,
    requestedSpaceId: input.requestedSpaceId,
    sessionStrategy: input.sessionStrategy,
    source: input.source,
    targetOwnerUserId: input.targetOwnerUserId,
  });
  if (!body.success) {
    throw invalidPayload(body.error.issues[0]?.message);
  }
  if (body.data.sessionStrategy !== "new") {
    throw createCoreRpcHttpError({
      code: "agent_profile_creation_request.session_strategy_unavailable",
      reason:
        "Resume and fork requests will be available after OpenMeld can verify the selected local session.",
      status: 409,
    });
  }
  const db = requireDb(env);
  const requesterUserId = requireCallerUserId(context);
  await requireOrganizationMember({
    db,
    organizationId,
    userId: requesterUserId,
  });
  await requireOrganizationMember({
    db,
    organizationId,
    userId: body.data.targetOwnerUserId,
  });

  const service = createService(env, db);
  try {
    const response = await service.create({
      actorProfileId: requireIdentifier(
        context.actorContext.openMeldProfileId,
        "Actor Profile"
      ),
      body: body.data,
      organizationId,
      requesterUserId,
    });
    return createAgentProfileCreationRequestResponseSchema.parse(response);
  } catch (error) {
    throw translateDomainError(error);
  }
}

export async function rpcListAgentProfileCreationRequests(
  env: CoreBindings,
  input: ListAgentProfileCreationRequestsRpcInput
): Promise<ListAgentProfileCreationRequestsResponse> {
  const context = requireContext(input.context);
  const organizationId = requireIdentifier(
    input.organizationId,
    "Organization"
  );
  const db = requireDb(env);
  const userId = requireCallerUserId(context);
  await requireOrganizationMember({ db, organizationId, userId });
  const requests = await createService(env, db).list({
    organizationId,
    userId,
  });
  return listAgentProfileCreationRequestsResponseSchema.parse({
    organizationId,
    requests,
  });
}

export async function rpcDecideAgentProfileCreationRequest(
  env: CoreBindings,
  input: DecideAgentProfileCreationRequestRpcInput
): Promise<AgentProfileCreationRequestMutationResponse> {
  const context = requireContext(input.context);
  const organizationId = requireIdentifier(
    input.organizationId,
    "Organization"
  );
  const requestId = requireIdentifier(input.requestId, "Request");
  const body = decideAgentProfileCreationRequestBodySchema.safeParse({
    decision: input.decision,
  });
  if (!body.success) {
    throw invalidPayload(body.error.issues[0]?.message);
  }
  const db = requireDb(env);
  const userId = requireCallerUserId(context);
  await requireOrganizationMember({ db, organizationId, userId });
  try {
    const request = await createService(env, db).decide({
      decision: body.data.decision,
      organizationId,
      requestId,
      userId,
    });
    return agentProfileCreationRequestMutationResponseSchema.parse({ request });
  } catch (error) {
    throw translateDomainError(error);
  }
}

export async function rpcCancelAgentProfileCreationRequest(
  env: CoreBindings,
  input: MutateAgentProfileCreationRequestRpcInput
): Promise<AgentProfileCreationRequestMutationResponse> {
  const context = requireContext(input.context);
  const organizationId = requireIdentifier(
    input.organizationId,
    "Organization"
  );
  const requestId = requireIdentifier(input.requestId, "Request");
  const db = requireDb(env);
  const requesterUserId = requireCallerUserId(context);
  await requireOrganizationMember({
    db,
    organizationId,
    userId: requesterUserId,
  });
  try {
    const request = await createService(env, db).cancel({
      organizationId,
      requesterUserId,
      requestId,
    });
    return agentProfileCreationRequestMutationResponseSchema.parse({ request });
  } catch (error) {
    throw translateDomainError(error);
  }
}

export async function rpcRetryAgentProfileCreationRequest(
  env: CoreBindings,
  input: MutateAgentProfileCreationRequestRpcInput
): Promise<AgentProfileCreationRequestMutationResponse> {
  const context = requireContext(input.context);
  const organizationId = requireIdentifier(
    input.organizationId,
    "Organization"
  );
  const requestId = requireIdentifier(input.requestId, "Request");
  const db = requireDb(env);
  const userId = requireCallerUserId(context);
  await requireOrganizationMember({ db, organizationId, userId });
  try {
    const request = await createService(env, db).retry({
      organizationId,
      requestId,
      userId,
    });
    return agentProfileCreationRequestMutationResponseSchema.parse({ request });
  } catch (error) {
    throw translateDomainError(error);
  }
}

export async function rpcGetAgentProfileCreationApprovalPreference(
  env: CoreBindings,
  input: GetAgentProfileCreationApprovalPreferenceRpcInput
): Promise<GetAgentProfileCreationApprovalPreferenceResponse> {
  const context = requireContext(input.context);
  const organizationId = requireIdentifier(
    input.organizationId,
    "Organization"
  );
  const db = requireDb(env);
  const userId = requireCallerUserId(context);
  await requireOrganizationMember({ db, organizationId, userId });
  const preference = await createService(env, db).getPreference({
    organizationId,
    userId,
  });
  return getAgentProfileCreationApprovalPreferenceResponseSchema.parse(
    preference
  );
}

export async function rpcSetAgentProfileCreationApprovalPreference(
  env: CoreBindings,
  input: SetAgentProfileCreationApprovalPreferenceRpcInput
): Promise<SetAgentProfileCreationApprovalPreferenceResponse> {
  const context = requireContext(input.context);
  const organizationId = requireIdentifier(
    input.organizationId,
    "Organization"
  );
  const body = setAgentProfileCreationApprovalPreferenceBodySchema.safeParse({
    existingSessionPolicy: input.existingSessionPolicy,
    newSessionPolicy: input.newSessionPolicy,
  });
  if (!body.success) {
    throw invalidPayload(body.error.issues[0]?.message);
  }
  const db = requireDb(env);
  const userId = requireCallerUserId(context);
  await requireOrganizationMember({ db, organizationId, userId });
  const preference = await createService(env, db).setPreference({
    body: body.data,
    organizationId,
    userId,
  });
  return setAgentProfileCreationApprovalPreferenceResponseSchema.parse(
    preference
  );
}

function createService(env: CoreBindings, db: D1Database) {
  return createAgentProfileCreationRequestService({
    createAgentProfile: async (request) =>
      await createRequestedAgentProfile(env, request),
    projectApprovalInbox: async (request) =>
      await projectAgentProfileCreationRequestInbox({
        db,
        nowMs: Date.now(),
        request,
      }),
    repository: createD1AgentProfileCreationRequestRepository(db),
    resolveApprovalInbox: async (request) =>
      await resolveAgentProfileCreationRequestInbox({
        db,
        nowMs: Date.now(),
        request,
      }),
  });
}

async function prepareCenterAgentRepresentedMemberRequest(input: {
  context: OpenMeldRequestContext | undefined;
  env: CoreBindings;
  onBehalfOf: CenterAgentOnBehalfOfInput;
}): Promise<{ context: OpenMeldRequestContext; organizationId: string }> {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireContext(input.context),
    env: input.env,
  });
  const attribution = await resolveCenterAgentAuditAttribution({
    authorization,
    onBehalfOfProfileId: input.onBehalfOf.profileId,
  });
  if (!attribution.onBehalfOf) {
    throw createCoreRpcHttpError({
      code: "agent_profile_creation_request.represented_member_required",
      reason:
        "Agent Profile creation request tools require a represented Organization member.",
      status: 403,
    });
  }
  const representedUserId = requireIdentifier(
    attribution.onBehalfOf.userId,
    "Represented member"
  );
  return {
    context: {
      ...authorization.context,
      actorContext: {
        ...authorization.context.actorContext,
        callerPrincipalId: representedUserId,
        ownerUserId: representedUserId,
      },
    },
    organizationId: authorization.activeOrganization.organizationId,
  };
}

async function buildCenterAgentCreationRequestIdempotencyKey(input: {
  configuration?: AgentProfileCreationConfiguration;
  context: OpenMeldRequestContext;
  nativeSessionId: string | null;
  profileName: string;
  sessionStrategy: AgentProfileCreationSessionStrategy;
  targetOwnerUserId: string;
}): Promise<string> {
  const payload = JSON.stringify({
    configuration: input.configuration,
    nativeSessionId: input.nativeSessionId,
    profileName: input.profileName,
    requestId: input.context.actorContext.requestId,
    sessionStrategy: input.sessionStrategy,
    targetOwnerUserId: input.targetOwnerUserId,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload)
  );
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `center-agent:agent-profile-request:${fingerprint}`;
}

async function createRequestedAgentProfile(
  env: CoreBindings,
  request: AgentProfileCreationRequestRecord
): Promise<string> {
  const authWorker = env.OPENMELD_AUTH_WORKER;
  if (!authWorker?.createAgentProfileInOrganization) {
    throw new Error("Auth Agent Profile creation RPC is unavailable.");
  }
  const result = await authWorker.createAgentProfileInOrganization({
    createdByUserId: request.requesterUserId,
    creationActorProfileId: request.actorProfileId,
    idempotencyKey: `agent-profile-creation-request:${request.id}`,
    organizationId: request.organizationId,
    ownerUserId: request.targetOwnerUserId,
    profileName: request.profileName,
    source: mapProfileSource(request.source),
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  if (!result.profile.openMeldProfileId) {
    throw new Error("Auth could not create the requested Agent Profile.");
  }
  const agentProfileId = result.profile.openMeldProfileId;
  try {
    await completeRequestedAgentProfileSetup({
      agentProfileId,
      env,
      request,
    });
  } catch (cause) {
    throw new AgentProfileCreationRequestExecutionError({
      cause,
      createdAgentProfileId: agentProfileId,
    });
  }
  return agentProfileId;
}

async function completeRequestedAgentProfileSetup(input: {
  agentProfileId: string;
  env: CoreBindings;
  request: AgentProfileCreationRequestRecord;
}): Promise<void> {
  if (input.request.requestedSpaceId) {
    await addRequestedAgentProfileToSpace({
      ...input,
      spaceId: input.request.requestedSpaceId,
    });
  }

  if (
    input.request.configuration.agentControllerRef &&
    input.request.configuration.targetComputerId
  ) {
    await connectRequestedAgentProfile(input);
  }
}

async function addRequestedAgentProfileToSpace(input: {
  agentProfileId: string;
  env: CoreBindings;
  request: AgentProfileCreationRequestRecord;
  spaceId: string;
}): Promise<void> {
  const requesterContext = await buildMemberHumanContext({
    env: input.env,
    organizationId: input.request.organizationId,
    requestId: `agent-profile-creation-request:${input.request.id}:space`,
    userId: input.request.requesterUserId,
  });
  await rpcAddOrganizationDirectoryProfilesToSpace(input.env, {
    context: requesterContext,
    directoryProfileIds: [input.agentProfileId],
    spaceId: input.spaceId,
  });
}

async function connectRequestedAgentProfile(input: {
  agentProfileId: string;
  env: CoreBindings;
  request: AgentProfileCreationRequestRecord;
}): Promise<void> {
  const configuration = input.request.configuration;
  const targetContext = await buildMemberHumanContext({
    env: input.env,
    organizationId: input.request.organizationId,
    requestId: `agent-profile-creation-request:${input.request.id}:target`,
    userId: input.request.targetOwnerUserId,
  });
  const localRuntimes = await rpcListLocalRuntimes(input.env, {
    connectionIdentityAdoption: "safe_legacy_current",
    context: targetContext,
  });
  const candidates = projectCenterAgentLocalAgentConnectionCandidates({
    localRuntimes,
    organizationId: input.request.organizationId,
  });
  const candidate = candidates.candidates.find(
    (item) =>
      item.deviceId === configuration.targetComputerId &&
      item.agentControllerRef === configuration.agentControllerRef
  );
  if (!candidate) {
    throw new Error(
      "The selected local agent is no longer available on that Computer."
    );
  }
  if (!candidate.connectable) {
    throw new Error(
      `${candidate.agentDisplayName} on ${candidate.deviceDisplayName} is not ready to connect.`
    );
  }
  const binding = await rpcEnsureAgentProfilePrimaryBinding(input.env, {
    agentControllerRef: candidate.agentControllerRef,
    agentProfileId: input.agentProfileId,
    context: targetContext,
    deviceId: candidate.deviceId,
    lane: candidate.runtimeLane,
    openMeldServiceRuntimeId: candidate.openMeldServiceRuntimeId,
    writeMode: "reconnect",
    ...(configuration.agentControllerPermissionMode
      ? {
          agentControllerPermissionMode:
            configuration.agentControllerPermissionMode,
        }
      : {}),
    ...(configuration.modelId ? { modelId: configuration.modelId } : {}),
    ...(configuration.openCodePermission
      ? { openCodePermission: configuration.openCodePermission }
      : {}),
    ...(configuration.reasoningLevel
      ? { reasoningLevel: configuration.reasoningLevel }
      : {}),
  });
  if (binding.status !== "accepted") {
    throw new Error(
      `OpenMeld couldn't connect the selected local agent: ${binding.reasonCodes.join(", ") || "unknown reason"}.`
    );
  }
  await rpcSetCurrentAgentProfileWorkspace(input.env, {
    agentProfileId: input.agentProfileId,
    context: targetContext,
    workspaceMode: "openmeld_managed",
  });
  if (configuration.defaultProjectId) {
    await rpcUpdateAgentProfileDefaultProject(input.env, {
      agentProfileId: input.agentProfileId,
      context: targetContext,
      defaultProjectId: configuration.defaultProjectId,
      expectedOrganizationId: input.request.organizationId,
    });
  }
  if (configuration.authorizeForOrganization) {
    await rpcAuthorizeAgentProfileBindingForOrganization(input.env, {
      agentProfileId: input.agentProfileId,
      context: targetContext,
    });
  }
}

async function buildMemberHumanContext(input: {
  env: CoreBindings;
  organizationId: string;
  requestId: string;
  userId: string;
}): Promise<OpenMeldRequestContext> {
  const db = requireDb(input.env);
  const human = await db
    .prepare(
      `
        SELECT profile_handle, profile_id, profile_name
        FROM openmeld_profiles
        WHERE owner_user_id = ?
          AND profile_kind = 'human'
          AND is_default = 1
          AND status = 'active'
        LIMIT 1
      `
    )
    .bind(input.userId)
    .first<{
      profile_handle: string;
      profile_id: string;
      profile_name: string;
    }>();
  if (!human) {
    throw new Error("The Agent owner needs an active Human Profile.");
  }
  return openMeldRequestContextSchema.parse({
    activeOrganizationId: input.organizationId,
    actorContext: {
      callerPrincipalId: input.userId,
      openMeldProfileId: human.profile_id,
      ownerUserId: input.userId,
      profileHandle: human.profile_handle,
      profileKind: "human",
      profileName: human.profile_name,
      requestId: input.requestId,
    },
  });
}

function mapProfileSource(
  source: CreateAgentProfileCreationRequestBody["source"]
): "web_create" | "cli_create" | "local_agent_create" | "center_agent_create" {
  switch (source) {
    case "web":
      return "web_create";
    case "cli":
      return "cli_create";
    case "local_agent":
      return "local_agent_create";
    case "center_agent":
      return "center_agent_create";
    default:
      throw new Error(`Unsupported Agent Profile creation source: ${source}`);
  }
}

function requireContext(value: unknown): OpenMeldRequestContext {
  const parsed = openMeldRequestContextSchema.safeParse(value);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "agent_profile_creation_request.context_required",
      reason:
        "Agent Profile creation requests require an authenticated profile.",
      status: 403,
    });
  }
  return parsed.data;
}

function requireCallerUserId(context: OpenMeldRequestContext): string {
  return requireIdentifier(
    context.actorContext.callerPrincipalId,
    "Authenticated caller"
  );
}

function requireIdentifier(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw invalidPayload(`${label} id is required.`);
  }
  return normalized;
}

function requireDb(env: CoreBindings): D1Database {
  const db = identityDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "agent_profile_creation_request.unavailable",
      reason: "Agent Profile creation requests are temporarily unavailable.",
      status: 503,
    });
  }
  return db;
}

async function requireOrganizationMember(input: {
  db: D1Database;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const member = await input.db
    .prepare(
      `
        SELECT id
        FROM members
        WHERE organization_id = ?
          AND user_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.userId)
    .first<{ id: string }>();
  if (!member?.id) {
    throw createCoreRpcHttpError({
      code: "organization.membership_required",
      reason: "The selected person is not a member of this Organization.",
      status: 403,
    });
  }
}

function invalidPayload(reason?: string) {
  return createCoreRpcHttpError({
    code: "invalid_payload",
    reason: reason ?? "Invalid Agent Profile creation request.",
    status: 400,
  });
}

function translateDomainError(error: unknown) {
  if (error instanceof AgentProfileCreationRequestConflictError) {
    return createCoreRpcHttpError({
      code: "agent_profile_creation_request.idempotency_conflict",
      reason: error.message,
      status: 409,
    });
  }
  if (error instanceof AgentProfileCreationRequestForbiddenError) {
    return createCoreRpcHttpError({
      code: "agent_profile_creation_request.forbidden",
      reason: error.message,
      status: 403,
    });
  }
  if (error instanceof AgentProfileCreationRequestNotFoundError) {
    return createCoreRpcHttpError({
      code: "agent_profile_creation_request.not_found",
      reason: error.message,
      status: 404,
    });
  }
  if (error instanceof AgentProfileCreationRequestStateError) {
    return createCoreRpcHttpError({
      code: "agent_profile_creation_request.state_conflict",
      reason: error.message,
      status: 409,
    });
  }
  return error;
}
