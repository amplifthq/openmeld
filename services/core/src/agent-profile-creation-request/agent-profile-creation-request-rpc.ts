import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  agentProfileCreationIntentSchema,
  agentProfileCreationRequestMutationResponseSchema,
  agentProfileCreationRequestSelectorSchema,
  centerAgentCreateConfiguredAgentProfileBodySchema,
  centerAgentCreateConfiguredAgentProfileResponseSchema,
  createAgentProfileCreationRequestBodySchema,
  createAgentProfileCreationRequestResponseSchema,
  DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
  daemonServiceLaneSchema,
  decideAgentProfileCreationRequestBodySchema,
  getAgentProfileCreationApprovalPreferenceResponseSchema,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
  listAgentProfileCreationRequestsResponseSchema,
  openMeldRequestContextSchema,
  retryAgentProfileCreationRequestBodySchema,
  setAgentProfileCreationApprovalPreferenceBodySchema,
  setAgentProfileCreationApprovalPreferenceResponseSchema,
} from "@openmeld/schemas";
import type {
  AgentProfileCreationApprovalPolicy,
  AgentProfileCreationConfiguration,
  AgentProfileCreationRequestMutationResponse,
  AgentProfileCreationRequestSelector,
  AgentProfileCreationRequestStatusReason,
  AgentProfileCreationSessionStrategy,
  CenterAgentCreateConfiguredAgentProfileResponse,
  CenterAgentOnBehalfOfInput,
  CenterAgentProductOperationStep,
  CreateAgentProfileCreationRequestBody,
  CreateAgentProfileCreationRequestResponse,
  DecideAgentProfileCreationRequestBody,
  GetAgentProfileCreationApprovalPreferenceResponse,
  ListAgentProfileCreationRequestsResponse,
  OpenMeldRequestContext,
  RetryAgentProfileCreationRequestBody,
  SetAgentProfileCreationApprovalPreferenceBody,
  SetAgentProfileCreationApprovalPreferenceResponse,
  SetCurrentAgentProfileWorkspaceResponse,
} from "@openmeld/schemas/types";
import { digestCanonicalJson } from "@openmeld/utils";
import { resolveAgentActivitySessionInventoryExecutionSelection } from "../agent-activity/activity-session-inventory-repository";
import { rememberAgentProfileCreationDefaults } from "../agent-profile-binding/application/agent-profile-creation-defaults-service";
import { readPrimaryAgentProfileBindingRecord } from "../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import { projectCenterAgentLocalAgentConnectionCandidates } from "../center-agent/application/product-operations";
import { resolveCenterAgentAuditAttribution } from "../center-agent/center-agent-audit";
import { requireCurrentDesignatedCenterAgentCaller } from "../center-agent/current-designated-center-agent";
import { validateAgentModelSelection } from "../config/agent-model-availability";
import { readAuthoredModelCatalog } from "../config/model-catalog";
import { forkRuntimeTransportAgentSession } from "../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import type { CoreBindings } from "../lib/bindings";
import { readCoreLocalComponentsRelease } from "../local-components/release-source";
import { assignBoundProfileToMemberAgent } from "../member-agent/member-agent-profile-assignment";
import { createPersonalRemoteAgentBinding } from "../remote-agent/application/personal-remote-agent-binding";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  type CenterAgentCreateConfiguredAgentProfileInput,
  rpcAddOrganizationDirectoryProfilesToSpace,
  rpcCenterAgentCheckAgentProfileReadiness,
  rpcEnsureAgentProfilePrimaryBinding,
  rpcListPeopleComputers,
  rpcSetCurrentAgentProfileWorkspace,
  rpcUpdateAgentProfileDefaultProject,
} from "../rpc/methods";
import { scheduleAgentProfileCreation } from "./agent-profile-creation-execution";
import { evaluateAgentProfileCreationModelGuard } from "./agent-profile-creation-model-guard";
import { runAgentProfileCreationPostBindingFollowUps } from "./agent-profile-creation-post-binding-follow-ups";
import {
  checkpointAgentProfileCreationPostBindingStep,
  readAgentProfileCreationPostBindingProgress,
} from "./agent-profile-creation-post-binding-progress";
import { createPostgresAgentProfileCreationRequestInboxProjectionService } from "./agent-profile-creation-request-inbox-projection";
import { createPostgresAgentProfileCreationRequestRepository } from "./agent-profile-creation-request-repository";
import {
  AgentProfileCreationRequestConflictError,
  type AgentProfileCreationRequestExecutionCheckpoint,
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
export type ListAgentProfileCreationRequestsRpcInput =
  AgentProfileCreationRequestSelector & {
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
  localAgentConnectionCandidateId?: string | null;
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
  requestId?: string;
};
export type CenterAgentManageAgentProfileCreationRequestRpcInput =
  RetryAgentProfileCreationRequestBody & {
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
  const configuration =
    await resolveCenterAgentProfileCreationRequestConfiguration({
      configuration: input.configuration,
      env,
      localAgentConnectionCandidateId:
        input.localAgentConnectionCandidateId ?? null,
      organizationId: prepared.organizationId,
      targetOwnerUserId: input.targetOwnerUserId,
    });
  const body = {
    configuration,
    nativeSessionId: input.nativeSessionId,
    profileName: input.profileName,
    requestedSpaceId: input.requestedSpaceId,
    sessionStrategy: input.sessionStrategy,
    source: "center_agent" as const,
    targetOwnerUserId: input.targetOwnerUserId,
  };
  return await rpcCreateAgentProfileCreationRequest(env, {
    ...body,
    context: prepared.context,
    idempotencyKey: await resolveCenterAgentCreationRequestIdempotencyKey({
      body,
      context: prepared.context,
      db: requireDb(env),
      organizationId: prepared.organizationId,
    }),
    organizationId: prepared.organizationId,
  });
}
async function resolveCenterAgentProfileCreationRequestConfiguration(input: {
  configuration: AgentProfileCreationConfiguration | undefined;
  env: CoreBindings;
  localAgentConnectionCandidateId: string | null;
  organizationId: string;
  targetOwnerUserId: string;
}): Promise<AgentProfileCreationConfiguration | undefined> {
  if (!input.localAgentConnectionCandidateId) {
    return input.configuration;
  }
  if (
    input.configuration?.agentControllerRef ===
    HOSTED_REMOTE_AGENT_CONTROLLER_REF
  ) {
    throw invalidPayload("Choose Remote or a Local Agent candidate, not both.");
  }
  const targetContext = await buildMemberHumanContext({
    env: input.env,
    organizationId: input.organizationId,
    requestId: `center-agent:resolve-local-agent:${crypto.randomUUID()}`,
    userId: input.targetOwnerUserId,
  });
  const peopleComputers = await rpcListPeopleComputers(input.env, {
    context: targetContext,
  });
  const candidate = projectCenterAgentLocalAgentConnectionCandidates({
    peopleComputers,
    organizationId: input.organizationId,
  }).candidates.find(
    (item) => item.candidateId === input.localAgentConnectionCandidateId
  );
  if (!candidate) {
    throw createCoreRpcHttpError({
      code: "agent_profile_creation_request.local_agent_unavailable",
      reason:
        "The selected local agent is no longer available on that Computer.",
      status: 409,
    });
  }
  if (!candidate.connectable) {
    throw createCoreRpcHttpError({
      code: "agent_profile_creation_request.local_agent_not_ready",
      reason: `${candidate.agentDisplayName} on ${candidate.deviceDisplayName} is not ready to connect.`,
      status: 409,
    });
  }
  return {
    ...(input.configuration ?? DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION),
    agentControllerRef: candidate.agentControllerRef,
    localAgentConnectionCandidateId: candidate.candidateId,
    targetComputerId: candidate.deviceId,
  };
}
/**
 * Admission-time ACI model precheck shared by every Agent Profile creation
 * entry. Blocks only explicit negative compatibility facts; missing or
 * unknown evidence must never block a request.
 */
function assertRequestedModelCompatibility(input: {
  configuration: AgentProfileCreationConfiguration;
  deviceId: string;
  runtimeLane: string;
  peopleComputers: Awaited<ReturnType<typeof rpcListPeopleComputers>>;
  target: {
    agentDisplayName: string;
    agentControllerRef: string;
    deviceDisplayName: string;
  };
}): void {
  const modelId = input.configuration.modelId ?? null;
  if (!modelId) {
    return;
  }
  const parsedRef = (() => {
    try {
      return parseAgentControllerRef(input.target.agentControllerRef);
    } catch {
      return null;
    }
  })();
  if (!parsedRef) {
    return;
  }
  const capability = input.peopleComputers.computers
    .flatMap((computer) => computer.executionTargets)
    .find(
      (target) =>
        target.deviceId === input.deviceId &&
        target.runtimeLane === input.runtimeLane
    )
    ?.capabilities.find(
      (candidateCapability) =>
        candidateCapability.agentControllerRef ===
        input.target.agentControllerRef
    );
  const controllerInterface = capability?.agentControllerInterface ?? null;
  const guard = evaluateAgentProfileCreationModelGuard({
    agentControllerRef: input.target.agentControllerRef,
    agentDisplayName: input.target.agentDisplayName,
    catalogControllers: readAuthoredModelCatalog().agentControllers,
    controllerId: controllerInterface?.controllerId ?? parsedRef.id,
    controllerInterfaceVersion: controllerInterface?.version ?? null,
    deviceDisplayName: input.target.deviceDisplayName,
    modelId,
    reasoningLevel: input.configuration.reasoningLevel,
    reportedModelIds:
      controllerInterface?.models.flatMap((model) =>
        model.id ? [model.id] : []
      ) ?? null,
  });
  if (!guard) {
    return;
  }
  throw new AgentProfileCreationRequestStateError(guard.reason, guard.code);
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
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
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
  if (
    input.action !== "retry" &&
    (input.modelSelection !== undefined ||
      input.expectedUpdatedAt !== undefined)
  ) {
    throw invalidPayload(
      "Model corrections apply only to a failed request retry."
    );
  }
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
      return await rpcRetryAgentProfileCreationRequest(env, {
        ...request,
        modelSelection: input.modelSelection,
        expectedUpdatedAt: input.expectedUpdatedAt,
      });
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
  const selector = agentProfileCreationRequestSelectorSchema.safeParse(input);
  if (!selector.success) {
    throw invalidPayload(selector.error.issues[0]?.message);
  }
  const requests = await createService(env, db).list({
    actorProfileId: context.actorContext.openMeldProfileId,
    ...selector.data,
    organizationId,
    userId,
  });
  return listAgentProfileCreationRequestsResponseSchema.parse({
    organizationId,
    ...(selector.data.idempotencyKey
      ? { matchedIdempotencyKey: selector.data.idempotencyKey }
      : {}),
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
  input: MutateAgentProfileCreationRequestRpcInput &
    RetryAgentProfileCreationRequestBody
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
  const body = retryAgentProfileCreationRequestBodySchema.safeParse({
    expectedUpdatedAt: input.expectedUpdatedAt,
    modelSelection: input.modelSelection,
  });
  if (!body.success) {
    throw invalidPayload(body.error.issues[0]?.message);
  }
  try {
    const request = await createService(env, db).retry({
      ...body.data,
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
function createService(env: CoreBindings, db: PostgresDatabase) {
  const inboxProjection =
    createPostgresAgentProfileCreationRequestInboxProjectionService({ db });
  return createAgentProfileCreationRequestService({
    readLocalComponentsManifest: async () =>
      (await readCoreLocalComponentsRelease(env.OPENMELD_CLI_RELEASES))
        .manifest,
    validateRetryConfiguration: async ({ current, configuration }) => {
      if (!current.createdAgentProfileId) {
        return;
      }
      const binding = await readPrimaryAgentProfileBindingRecord({
        agentProfileId: current.createdAgentProfileId,
        db,
        owner: { id: current.targetOwnerUserId, kind: "owner_account" },
      });
      if (
        binding &&
        (binding.modelId !== configuration.modelId ||
          binding.reasoningLevel !== configuration.reasoningLevel)
      ) {
        throw new AgentProfileCreationRequestStateError(
          "This Agent already has model settings. Change its model in Agent settings, then retry setup."
        );
      }
    },
    validateNewRequest: async ({ body, organizationId }) => {
      const configuration = body.configuration;
      if (
        configuration?.agentControllerRef &&
        configuration.modelId &&
        configuration.agentControllerRef !== HOSTED_REMOTE_AGENT_CONTROLLER_REF
      ) {
        const issue = validateAgentModelSelection({
          agentControllerRef: configuration.agentControllerRef,
          catalog: readAuthoredModelCatalog(),
          modelId: configuration.modelId,
          nowMs: Date.now(),
          reasoningLevel: configuration.reasoningLevel,
        });
        if (issue) {
          throw createCoreRpcHttpError({
            code: issue.code,
            reason: issue.reason,
            status: 400,
          });
        }
      }
      if (body.sessionStrategy !== "new") {
        await requireRequestedSessionSelection({
          configuration: body.configuration,
          db,
          nativeSessionId: body.nativeSessionId,
          organizationId,
          ownerUserId: body.targetOwnerUserId,
          sessionStrategy: body.sessionStrategy,
        });
      }
    },
    scheduleExecution: async (request) =>
      await scheduleAgentProfileCreation(env, request),
    attemptInboxProjection: inboxProjection.attemptForRequest,
    createAgentProfile: async (request, checkpoint) =>
      await createRequestedAgentProfile(env, request, checkpoint),
    repository: createPostgresAgentProfileCreationRequestRepository(db),
  });
}
export async function executeAgentProfileCreationRequest(
  env: CoreBindings,
  selector: {
    organizationId: string;
    id: string;
  }
) {
  return await createService(env, requireDb(env)).execute(selector);
}
async function prepareCenterAgentRepresentedMemberRequest(input: {
  context: OpenMeldRequestContext | undefined;
  env: CoreBindings;
  onBehalfOf: CenterAgentOnBehalfOfInput;
}): Promise<{
  context: OpenMeldRequestContext;
  organizationId: string;
}> {
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
async function resolveCenterAgentCreationRequestIdempotencyKey(input: {
  body: Omit<CreateAgentProfileCreationRequestBody, "idempotencyKey">;
  context: OpenMeldRequestContext;
  db: PostgresDatabase;
  organizationId: string;
}): Promise<string> {
  // The intent owner drops transport fields, including this placeholder key.
  // Hash exactly what replay equality compares, including the target Space.
  const intent = agentProfileCreationIntentSchema.safeParse({
    ...input.body,
    idempotencyKey: "center-agent",
  });
  if (!intent.success) {
    throw invalidPayload(intent.error.issues[0]?.message);
  }
  const requestId = input.context.actorContext.requestId;
  const fingerprint = await digestCanonicalJson({
    requestId,
    intent: intent.data,
  });
  const legacyKey =
    await buildLegacyCenterAgentCreationRequestIdempotencyKey(input);
  const legacy = await createPostgresAgentProfileCreationRequestRepository(
    input.db
  ).findByIdempotencyKey({
    idempotencyKey: legacyKey,
    organizationId: input.organizationId,
    requesterUserId: requireCallerUserId(input.context),
  });
  // The old key omitted Space. Reuse only an exact, actor-bound intent; the
  // normal service still authorizes and replays the existing durable request.
  if (
    legacy &&
    legacy.actorProfileId === input.context.actorContext.openMeldProfileId &&
    (await digestCanonicalJson({
      requestId,
      intent: agentProfileCreationIntentSchema.parse(legacy),
    })) === fingerprint
  ) {
    return legacyKey;
  }
  return `center-agent:agent-profile-request:${fingerprint}`;
}
// Lookup-only compatibility for persisted pre-canonical requests. Keep the
// original field order and omitted-value behavior; never create with this key.
async function buildLegacyCenterAgentCreationRequestIdempotencyKey(input: {
  body: Omit<CreateAgentProfileCreationRequestBody, "idempotencyKey">;
  context: OpenMeldRequestContext;
}): Promise<string> {
  const payload = JSON.stringify({
    configuration: input.body.configuration,
    nativeSessionId: input.body.nativeSessionId ?? null,
    profileName: input.body.profileName,
    requestId: input.context.actorContext.requestId,
    sessionStrategy: input.body.sessionStrategy,
    targetOwnerUserId: input.body.targetOwnerUserId,
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
  request: AgentProfileCreationRequestRecord,
  checkpoint: AgentProfileCreationRequestExecutionCheckpoint
): Promise<string> {
  const db = requireDb(env);
  await requireOrganizationMember({
    db,
    organizationId: request.organizationId,
    userId: request.requesterUserId,
  });
  if (request.targetOwnerUserId !== request.requesterUserId) {
    await requireOrganizationMember({
      db,
      organizationId: request.organizationId,
      userId: request.targetOwnerUserId,
    });
  }
  const localAgentConnection = await prepareRequestedLocalAgentConnection({
    env,
    request,
  });
  const agentProfileId =
    request.createdAgentProfileId ??
    (await createRequestedAgentProfileIdentity(env, request));
  if (!request.createdAgentProfileId) {
    await checkpoint.checkpointCreatedAgentProfileId(agentProfileId);
  }
  try {
    await completeRequestedAgentProfileSetup({
      agentProfileId,
      env,
      localAgentConnection,
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
async function createRequestedAgentProfileIdentity(
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
  return result.profile.openMeldProfileId;
}
async function completeRequestedAgentProfileSetup(input: {
  agentProfileId: string;
  env: CoreBindings;
  localAgentConnection: Awaited<
    ReturnType<typeof prepareRequestedLocalAgentConnection>
  >;
  request: AgentProfileCreationRequestRecord;
}): Promise<void> {
  if (input.request.requestedSpaceId) {
    await addRequestedAgentProfileToSpace({
      ...input,
      spaceId: input.request.requestedSpaceId,
    });
  }
  const agentControllerRef = input.request.configuration.agentControllerRef;
  if (agentControllerRef === HOSTED_REMOTE_AGENT_CONTROLLER_REF) {
    await createPersonalRemoteAgentBinding({
      agentProfileId: input.agentProfileId,
      createdByProfileId: input.request.actorProfileId,
      db: requireDb(input.env),
      modelId: input.request.configuration.modelId,
      reasoningLevel: input.request.configuration.reasoningLevel,
      organizationId: input.request.organizationId,
      ownerUserId: input.request.targetOwnerUserId,
    });
    // This Binding write does not go through the primary Binding RPC.
    await assignBoundProfileToMemberAgent(input.env, {
      agentProfileId: input.agentProfileId,
      db: requireDb(input.env),
      ownerUserId: input.request.targetOwnerUserId,
    });
    return;
  }
  if (input.localAgentConnection && agentControllerRef) {
    await connectRequestedAgentProfile({
      ...input,
      localAgentConnection: input.localAgentConnection,
    });
    const configuration = input.request.configuration;
    await rememberAgentProfileCreationDefaults({
      localComponentsManifest: (
        await readCoreLocalComponentsRelease(input.env.OPENMELD_CLI_RELEASES)
      ).manifest,
      agentControllerRef,
      db: requireDb(input.env),
      nowMs: Date.now(),
      organizationId: input.request.organizationId,
      selection: {
        agentControllerCollaborationMode:
          configuration.agentControllerCollaborationMode,
        agentControllerPermissionMode:
          configuration.agentControllerPermissionMode,
        defaultProjectId: configuration.defaultProjectId,
        modelId: configuration.modelId,
        openCodePermission: configuration.openCodePermission,
        reasoningLevel: configuration.reasoningLevel,
      },
      userId: input.request.targetOwnerUserId,
    }).catch((error) => {
      console.error(
        "[core.agent_profile_creation_request.defaults_write_failed]",
        {
          error: error instanceof Error ? error.message : String(error),
          organizationId: input.request.organizationId,
          requestId: input.request.id,
          targetOwnerUserId: input.request.targetOwnerUserId,
        }
      );
    });
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
  localAgentConnection: NonNullable<
    Awaited<ReturnType<typeof prepareRequestedLocalAgentConnection>>
  >;
  request: AgentProfileCreationRequestRecord;
}): Promise<void> {
  const configuration = input.request.configuration;
  const { candidate, sessionExecutionSelection, targetContext } =
    input.localAgentConnection;
  const sessionInventorySelection =
    sessionExecutionSelection?.selection ?? null;
  const agentControllerConversationId =
    input.request.sessionStrategy === "fork" && sessionInventorySelection
      ? await forkRequestedAgentSession({
          candidate,
          env: input.env,
          request: input.request,
          sourceNativeSessionId: sessionInventorySelection.nativeSessionId,
        })
      : (configuration.sharedConversation?.conversationId ??
        sessionInventorySelection?.nativeSessionId);
  const binding = await rpcEnsureAgentProfilePrimaryBinding(input.env, {
    ...(configuration.sharedConversation
      ? { sharedConversationAcknowledged: true as const }
      : {}),
    agentControllerRef: candidate.agentControllerRef,
    ...(agentControllerConversationId
      ? {
          agentControllerConversationId,
          ...(input.request.sessionStrategy === "resume" &&
          sessionInventorySelection
            ? { sessionInventorySelection }
            : {}),
        }
      : {}),
    agentProfileId: input.agentProfileId,
    context: targetContext,
    deviceId: candidate.deviceId,
    lane: candidate.runtimeLane,
    openMeldServiceRuntimeId: candidate.openMeldServiceRuntimeId,
    writeMode: "initialize",
    ...(configuration.agentControllerCollaborationMode
      ? {
          agentControllerCollaborationMode:
            configuration.agentControllerCollaborationMode,
        }
      : {}),
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
  const progress = await readAgentProfileCreationPostBindingProgress({
    agentProfileId: input.agentProfileId,
    db: requireDb(input.env),
    profileCreationAttempt: input.request.profileCreationAttempt,
    requestId: input.request.id,
  });
  await runAgentProfileCreationPostBindingFollowUps({
    checkpoint: async (step) =>
      await checkpointAgentProfileCreationPostBindingStep({
        agentProfileId: input.agentProfileId,
        db: requireDb(input.env),
        profileCreationAttempt: input.request.profileCreationAttempt,
        requestId: input.request.id,
        step,
      }),
    completed: progress,
    setWorkspace: async () =>
      await rpcSetCurrentAgentProfileWorkspace(
        input.env,
        {
          agentProfileId: input.agentProfileId,
          context: targetContext,
          workspaceMode: "openmeld_managed",
          onlyIfUnconfigured: true,
        },
        {
          deviceId: candidate.deviceId,
          runtimeLane: daemonServiceLaneSchema.parse(candidate.runtimeLane),
        }
      ),
    ...(configuration.defaultProjectId
      ? {
          updateDefaultProject: async () =>
            await rpcUpdateAgentProfileDefaultProject(input.env, {
              agentProfileId: input.agentProfileId,
              context: targetContext,
              defaultProjectId: configuration.defaultProjectId,
              onlyIfUnmodified: true,
              expectedOrganizationId: input.request.organizationId,
            }),
        }
      : {}),
  });
}
async function prepareRequestedLocalAgentConnection(input: {
  env: CoreBindings;
  request: AgentProfileCreationRequestRecord;
}) {
  const configuration = input.request.configuration;
  if (!(configuration.agentControllerRef && configuration.targetComputerId)) {
    return null;
  }
  const sessionExecutionSelection =
    input.request.sessionStrategy === "new"
      ? null
      : await requireRequestedSessionSelection({
          configuration,
          db: requireDb(input.env),
          nativeSessionId: input.request.nativeSessionId,
          organizationId: input.request.organizationId,
          ownerUserId: input.request.targetOwnerUserId,
          sessionStrategy: input.request.sessionStrategy,
        });
  const targetContext = await buildMemberHumanContext({
    env: input.env,
    organizationId: input.request.organizationId,
    requestId: `agent-profile-creation-request:${input.request.id}:target`,
    userId: input.request.targetOwnerUserId,
  });
  const peopleComputers = await rpcListPeopleComputers(input.env, {
    context: targetContext,
  });
  const candidates = projectCenterAgentLocalAgentConnectionCandidates({
    peopleComputers,
    organizationId: input.request.organizationId,
  });
  const candidate = candidates.candidates.find((item) => {
    if (configuration.localAgentConnectionCandidateId) {
      return item.candidateId === configuration.localAgentConnectionCandidateId;
    }
    return (
      item.deviceId ===
        (sessionExecutionSelection?.runtimeDeviceId ??
          configuration.targetComputerId) &&
      item.agentControllerRef === configuration.agentControllerRef
    );
  });
  if (!candidate) {
    throw new Error(
      "The selected local agent is no longer available on that Computer."
    );
  }
  if (!candidate.connectable) {
    throw new AgentProfileCreationRequestStateError(
      `${candidate.agentDisplayName} on ${candidate.deviceDisplayName} is not ready to connect.`,
      "agent_profile_creation_request.local_agent_not_ready"
    );
  }
  const retainedBinding = input.request.createdAgentProfileId
    ? await readPrimaryAgentProfileBindingRecord({
        agentProfileId: input.request.createdAgentProfileId,
        db: requireDb(input.env),
        owner: { id: input.request.targetOwnerUserId, kind: "owner_account" },
      })
    : null;
  assertRequestedModelCompatibility({
    configuration: retainedBinding
      ? {
          ...configuration,
          modelId: retainedBinding.modelId ?? null,
          reasoningLevel: retainedBinding.reasoningLevel ?? null,
        }
      : configuration,
    deviceId: candidate.deviceId,
    runtimeLane: candidate.runtimeLane,
    peopleComputers,
    target: {
      agentControllerRef: candidate.agentControllerRef,
      agentDisplayName: candidate.agentDisplayName,
      deviceDisplayName: candidate.deviceDisplayName,
    },
  });
  return { candidate, sessionExecutionSelection, targetContext };
}
async function forkRequestedAgentSession(input: {
  candidate: ReturnType<
    typeof projectCenterAgentLocalAgentConnectionCandidates
  >["candidates"][number];
  env: CoreBindings;
  request: AgentProfileCreationRequestRecord;
  sourceNativeSessionId: string;
}): Promise<string> {
  const projectId = input.request.configuration.defaultProjectId;
  if (!projectId) {
    throw new Error("Fork requires the selected Session's Project.");
  }
  const result = await forkRuntimeTransportAgentSession({
    agentControllerRef: input.candidate.agentControllerRef,
    deviceId: input.candidate.deviceId,
    env: input.env,
    operationId: input.request.id,
    organizationId: input.request.organizationId,
    ownerUserId: input.request.targetOwnerUserId,
    profileName: input.request.profileName,
    projectId,
    runtimeLane: daemonServiceLaneSchema.parse(input.candidate.runtimeLane),
    sourceNativeSessionId: input.sourceNativeSessionId,
  });
  if (result.status !== "completed") {
    throw new Error(
      `OpenMeld couldn't fork the selected Session: ${result.message} (${result.reasonCode}).`
    );
  }
  return result.childNativeSessionId;
}
async function requireRequestedSessionSelection(input: {
  configuration: AgentProfileCreationConfiguration | undefined;
  db: PostgresDatabase;
  nativeSessionId: string | null | undefined;
  organizationId: string;
  ownerUserId: string;
  sessionStrategy: Exclude<AgentProfileCreationSessionStrategy, "new">;
}) {
  const agentControllerRef = input.configuration?.agentControllerRef;
  const computerId = input.configuration?.targetComputerId;
  const projectId = input.configuration?.defaultProjectId;
  if (
    !(agentControllerRef && computerId && projectId && input.nativeSessionId)
  ) {
    throw invalidPayload(
      "Resume and fork requests require a Session, its Project, Computer, and local agent."
    );
  }
  const selection =
    await resolveAgentActivitySessionInventoryExecutionSelection({
      agentControllerRef,
      capability: input.sessionStrategy,
      computerId,
      db: input.db,
      nativeSessionId: input.nativeSessionId,
      nowMs: Date.now(),
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      projectId,
    });
  if (!selection) {
    throw createCoreRpcHttpError({
      code: "agent_profile_creation_request.session_strategy_unavailable",
      reason:
        input.sessionStrategy === "resume"
          ? "This Session is no longer current, available, or resumable for the selected member."
          : "This Session is no longer current, available, or forkable for the selected member.",
      status: 409,
    });
  }
  return selection;
}
async function buildMemberHumanContext(input: {
  env: CoreBindings;
  organizationId: string;
  requestId: string;
  userId: string;
}): Promise<OpenMeldRequestContext> {
  const db = requireDb(input.env);
  const human = await db
    .query<{
      profile_handle: string;
      profile_id: string;
      profile_name: string;
    }>({
      text: `
        SELECT profile_handle, profile_id, profile_name
        FROM "openmeld"."openmeld_profiles"
        WHERE owner_user_id = $1
          AND profile_kind = 'human'
          AND is_default = 1
          AND status = 'active'
        LIMIT 1
      `,
      values: [input.userId],
    })
    .then((result) => result.rows[0] ?? null);
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
function requireDb(env: CoreBindings): PostgresDatabase {
  const db = getPostgresDatabase(env);
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
  db: PostgresDatabase;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const member = await input.db
    .query<{
      id: string;
    }>({
      text: `
        SELECT id
        FROM "openmeld"."members"
        WHERE organization_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      values: [input.organizationId, input.userId],
    })
    .then((result) => result.rows[0] ?? null);
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
/**
 * Compatibility shim for the pre-Creation-Request "create configured Agent
 * Profile" Center Agent RPC. It exists so Workers deployed before the unified
 * creation contract still get state-machine semantics; every current model-
 * visible surface uses openmeld_create_agent_profile_request instead. The
 * call is forwarded into the same Creation Request pipeline (request,
 * approval, admission model precheck, execution, recovery) as the Web, CLI,
 * and local-agent entries.
 */
export async function rpcCenterAgentCreateConfiguredAgentProfile(
  env: CoreBindings,
  input: CenterAgentCreateConfiguredAgentProfileInput
): Promise<CenterAgentCreateConfiguredAgentProfileResponse> {
  const body = parseConfiguredShimBody(input);
  const actor = await prepareConfiguredShimActor({ body, env, input });
  const requestedConfiguration =
    await resolveCenterAgentProfileCreationRequestConfiguration({
      configuration: resolveUnifiedCreationRequestConfiguration(body),
      env,
      localAgentConnectionCandidateId: body.candidateId,
      organizationId: actor.organizationId,
      targetOwnerUserId: actor.representedUserId,
    });
  const response = await rpcCreateAgentProfileCreationRequest(env, {
    configuration: requestedConfiguration,
    context: actor.representedContext,
    idempotencyKey: await buildConfiguredShimIdempotencyKey({
      configuration: requestedConfiguration,
      organizationId: actor.organizationId,
      profileName: body.profileName,
      representedUserId: actor.representedUserId,
      spaceId: body.spaceId,
      workspaceMode: body.workspaceMode ?? null,
      workspacePath: body.workspacePath ?? null,
    }),
    nativeSessionId: null,
    organizationId: actor.organizationId,
    profileName: body.profileName,
    requestedSpaceId: body.spaceId,
    sessionStrategy: "new",
    source: "center_agent",
    targetOwnerUserId: actor.representedUserId,
  });
  return await projectConfiguredShimResponse({
    authorizationContext: actor.authorizationContext,
    body,
    env,
    organizationId: actor.organizationId,
    representedContext: actor.representedContext,
    request: response.request,
  });
}
function parseConfiguredShimBody(
  input: CenterAgentCreateConfiguredAgentProfileInput
) {
  const { context: _context, ...unparsedBody } = input;
  const parsedBody =
    centerAgentCreateConfiguredAgentProfileBodySchema.safeParse(unparsedBody);
  if (!parsedBody.success) {
    throw createCoreRpcHttpError({
      code: "agent_profile_creation_request.invalid_compatibility_input",
      reason: `Agent Profile creation input is invalid: ${parsedBody.error.issues[0]?.message ?? "unknown validation error"}`,
      status: 400,
    });
  }
  return parsedBody.data;
}
async function prepareConfiguredShimActor(input: {
  body: ReturnType<typeof parseConfiguredShimBody>;
  env: CoreBindings;
  input: CenterAgentCreateConfiguredAgentProfileInput;
}) {
  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: requireContext(input.input.context),
    env: input.env,
  });
  const onBehalfOfProfileId = input.body.onBehalfOf?.profileId ?? null;
  if (!onBehalfOfProfileId) {
    throw createCoreRpcHttpError({
      status: 403,
      reason:
        "Agent Profile creation requires a represented Organization member.",
      code: "agent_profile_creation_request.represented_member_required",
    });
  }
  const attribution = await resolveCenterAgentAuditAttribution({
    authorization,
    onBehalfOfProfileId,
  });
  const representedUserId = attribution.onBehalfOf?.userId ?? null;
  if (!representedUserId) {
    throw createCoreRpcHttpError({
      status: 403,
      reason:
        "The represented Organization member could not be resolved for Agent Profile creation.",
      code: "agent_profile_creation_request.represented_member_unresolved",
    });
  }
  const organizationId = authorization.activeOrganization.organizationId;
  const representedContext: OpenMeldRequestContext = {
    ...authorization.context,
    actorContext: {
      ...authorization.context.actorContext,
      callerPrincipalId: representedUserId,
      ownerUserId: representedUserId,
    },
  };
  return {
    authorizationContext: authorization.context,
    organizationId,
    representedContext,
    representedUserId,
  };
}
async function projectConfiguredShimResponse(input: {
  authorizationContext: OpenMeldRequestContext;
  body: ReturnType<typeof parseConfiguredShimBody>;
  env: CoreBindings;
  organizationId: string;
  representedContext: OpenMeldRequestContext;
  request: CreateAgentProfileCreationRequestResponse["request"];
}): Promise<CenterAgentCreateConfiguredAgentProfileResponse> {
  const { request } = input;
  const completed =
    request.status === "completed" && request.createdAgentProfileId !== null;
  const workspaceResult = await applyConfiguredShimWorkspace({
    body: input.body,
    completed,
    env: input.env,
    representedContext: input.representedContext,
    request,
  });
  const readinessResult = await readConfiguredShimReadiness({
    authorizationContext: input.authorizationContext,
    completed,
    env: input.env,
    setupFailed: workspaceResult.failed,
    request,
  });
  const canReply = Boolean(readinessResult.readiness?.canReply);
  const steps: CenterAgentProductOperationStep[] = [
    {
      message:
        request.failureMessage ??
        CONFIGURED_PROFILE_STATUS_STEP_COPY[request.statusReason] ??
        `Agent Profile creation request is ${request.status}.`,
      name: "create_agent_profile",
      status: resolveConfiguredShimCreationStepStatus({ completed, request }),
    },
    ...(workspaceResult.step ? [workspaceResult.step] : []),
    readinessResult.step,
  ];
  return centerAgentCreateConfiguredAgentProfileResponseSchema.parse({
    ...(completed
      ? { agentProfileId: request.createdAgentProfileId ?? undefined }
      : {}),
    canReply,
    ...(readinessResult.readiness
      ? { readiness: readinessResult.readiness }
      : {}),
    organizationId: input.organizationId,
    spaceId: input.body.spaceId,
    status: canReply ? "completed" : "blocked",
    steps,
    ...(workspaceResult.workspace
      ? { workspace: workspaceResult.workspace }
      : {}),
  });
}
function resolveConfiguredShimCreationStepStatus(input: {
  completed: boolean;
  request: CreateAgentProfileCreationRequestResponse["request"];
}): CenterAgentProductOperationStep["status"] {
  if (input.completed) {
    return "completed";
  }
  return input.request.status === "failed" ? "failed" : "skipped";
}
async function applyConfiguredShimWorkspace(input: {
  body: ReturnType<typeof parseConfiguredShimBody>;
  completed: boolean;
  env: CoreBindings;
  representedContext: OpenMeldRequestContext;
  request: CreateAgentProfileCreationRequestResponse["request"];
}): Promise<{
  failed: boolean;
  step?: CenterAgentProductOperationStep;
  workspace?: SetCurrentAgentProfileWorkspaceResponse;
}> {
  if (!(input.completed && input.body.workspaceMode)) {
    return { failed: false };
  }
  try {
    const workspace = await rpcSetCurrentAgentProfileWorkspace(input.env, {
      agentProfileId: input.request.createdAgentProfileId ?? "",
      context: input.representedContext,
      workspaceMode: input.body.workspaceMode,
      ...(input.body.workspacePath
        ? { workspacePath: input.body.workspacePath }
        : {}),
    });
    return {
      failed: false,
      step: {
        message: "Agent Profile workspace was updated.",
        name: "update_agent_profile_workspace",
        status: "completed",
      },
      workspace,
    };
  } catch (error) {
    return {
      failed: true,
      step: {
        message: error instanceof Error ? error.message : String(error),
        name: "update_agent_profile_workspace",
        nextAction: "Fix the workspace setting, then retry this operation.",
        status: "failed",
      },
    };
  }
}
async function readConfiguredShimReadiness(input: {
  authorizationContext: OpenMeldRequestContext;
  completed: boolean;
  env: CoreBindings;
  request: CreateAgentProfileCreationRequestResponse["request"];
  setupFailed: boolean;
}): Promise<{
  readiness?: Awaited<
    ReturnType<typeof rpcCenterAgentCheckAgentProfileReadiness>
  >;
  step: CenterAgentProductOperationStep;
}> {
  if (!(input.completed && !input.setupFailed)) {
    return {
      step: {
        message: input.completed
          ? "Readiness was not checked because workspace setup failed."
          : "Readiness will be checked after the creation request completes.",
        name: "check_agent_profile_readiness",
        status: "skipped",
      },
    };
  }
  try {
    const readiness = await rpcCenterAgentCheckAgentProfileReadiness(
      input.env,
      {
        agentProfileId: input.request.createdAgentProfileId ?? "",
        context: input.authorizationContext,
      }
    );
    return {
      readiness,
      step: {
        message: readiness.summary,
        name: "check_agent_profile_readiness",
        status: "completed",
      },
    };
  } catch (error) {
    return {
      step: {
        message: error instanceof Error ? error.message : String(error),
        name: "check_agent_profile_readiness",
        nextAction: "Check this Agent Profile's status, then retry.",
        status: "failed",
      },
    };
  }
}
const CONFIGURED_PROFILE_STATUS_STEP_COPY: Partial<
  Record<AgentProfileCreationRequestStatusReason, string>
> = {
  approval_required:
    "Waiting for the represented member to approve this creation request.",
  target_declined: "The requested member declined this creation request.",
  requester_cancelled: "This Agent Profile creation request was cancelled.",
  target_policy_denied:
    "The represented member's approval policy denied this request.",
};
function resolveUnifiedCreationRequestConfiguration(
  input: CenterAgentCreateConfiguredAgentProfileInput
): AgentProfileCreationConfiguration {
  const selection = input.configuration ?? null;
  return {
    ...DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
    agentControllerCollaborationMode:
      input.agentControllerCollaborationMode ??
      selection?.agentControllerCollaborationMode ??
      null,
    agentControllerPermissionMode:
      input.agentControllerPermissionMode ??
      selection?.agentControllerPermissionMode ??
      null,
    defaultProjectId: selection?.defaultProjectId ?? null,
    modelId: input.modelId ?? selection?.modelId ?? null,
    openCodePermission:
      input.openCodePermission ?? selection?.openCodePermission ?? null,
    reasoningLevel: input.reasoningLevel ?? selection?.reasoningLevel ?? null,
  };
}
async function buildConfiguredShimIdempotencyKey(input: {
  configuration: AgentProfileCreationConfiguration | undefined;
  organizationId: string;
  profileName: string;
  representedUserId: string;
  spaceId: string;
  workspaceMode: string | null;
  workspacePath: string | null;
}): Promise<string> {
  const payload = JSON.stringify({
    ...input,
    shim: "center-agent-configured-profile",
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload)
  );
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `center-agent:configured-profile:${fingerprint}`;
}
