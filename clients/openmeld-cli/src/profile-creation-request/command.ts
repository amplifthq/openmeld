import { randomUUID } from "node:crypto";
import {
  agentProfileCreationConfigurationSchema,
  DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
} from "@openmeld/schemas";
import type { AgentProfileCreationConfiguration } from "@openmeld/schemas/types";
import { readCurrentLocalDeviceId } from "../local-service/state/current-device-identity";
import { resolveAgentControllerPermissionModeInput } from "../profile/controller-permission-mode-input";
import {
  type ProfileCreationRequestCommandContext,
  type ProfileCreationRequestCommonCommandInput,
  resolveProfileCreationRequestCommandContext,
} from "./context";
import {
  normalizeOptionalText,
  ProfileCreationRequestCliError,
  parseApprovalPolicy,
  parseRequestSource,
  parseSessionStrategy,
  requireText,
  resolveTargetOwnerUserId,
  validateNativeSessionInput,
} from "./input";
import {
  emitCommandError,
  emitPreference,
  emitRequest,
  emitRequestList,
} from "./presentation";

export type ProfileCreationRequestCreateInput =
  ProfileCreationRequestCommonCommandInput & {
    agentController?: string;
    agentControllerCollaborationMode?: string;
    agentControllerPermissionModeInput?: string;
    authorizeForOrganization?: boolean;
    confirmDangerousAgentControllerPermissionMode?: boolean;
    defaultProjectId?: string;
    idempotencyKey?: string;
    modelId?: string;
    openCodePermissionInput?: string;
    nativeSessionId?: string;
    profileName?: string;
    reasoningLevel?: string;
    reuseSavedDefaultProject?: boolean;
    requestedSpaceId?: string;
    sessionStrategy?: string;
    source?: string;
    targetOwner?: string;
    targetComputerId?: string;
  };

export async function runProfileCreationRequestCreate(
  input: ProfileCreationRequestCreateInput
): Promise<void> {
  const context = await resolveProfileCreationRequestCommandContext(input);
  if (!context) {
    return;
  }

  try {
    const profileName = requireText(input.profileName, "Agent Profile name");
    const sessionStrategy = parseSessionStrategy(input.sessionStrategy);
    const nativeSessionId = normalizeOptionalText(input.nativeSessionId);
    validateNativeSessionInput({ nativeSessionId, sessionStrategy });
    const targetOwnerUserId = resolveTargetOwnerUserId({
      callerUserId: context.callerUserId,
      value: input.targetOwner,
    });
    const configuration = await resolveRequestConfiguration({
      context,
      input,
      targetOwnerUserId,
    });
    const response = await context.api.createAgentProfileCreationRequest({
      configuration,
      idempotencyKey:
        normalizeOptionalText(input.idempotencyKey) ?? randomUUID(),
      nativeSessionId,
      organizationId: context.organization.id,
      profileName,
      requestedSpaceId: normalizeOptionalText(input.requestedSpaceId),
      sessionStrategy,
      source: parseRequestSource(input.source),
      targetOwnerUserId,
    });
    emitRequest({
      code: "profile.creation_request.created",
      context,
      replayed: response.replayed,
      request: response.request,
      title: response.replayed
        ? "Agent Profile Request Reused"
        : "Agent Profile Request Created",
    });
  } catch (error) {
    emitCommandError({ context, error, operation: "create" });
  }
}

async function resolveRequestConfiguration(options: {
  context: ProfileCreationRequestCommandContext;
  input: ProfileCreationRequestCreateInput;
  targetOwnerUserId: string;
}): Promise<AgentProfileCreationConfiguration> {
  const { context, input, targetOwnerUserId } = options;
  const agentControllerRef = normalizeOptionalText(input.agentController);
  const targetComputerId = await resolveRequestComputerId({
    agentControllerRef,
    context,
    requestedComputerId: normalizeOptionalText(input.targetComputerId),
    targetOwnerUserId,
  });
  const permissionMode = await resolveAgentControllerPermissionModeInput({
    agentControllerRef,
    agentControllerPermissionModeInput:
      input.agentControllerPermissionModeInput,
    allowPrompt: false,
    confirmDangerousAgentControllerPermissionMode:
      input.confirmDangerousAgentControllerPermissionMode,
    flagName: "--agent-controller-permission-mode",
  });
  return agentProfileCreationConfigurationSchema.parse({
    ...DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
    agentControllerCollaborationMode:
      normalizeOptionalText(input.agentControllerCollaborationMode) ?? null,
    agentControllerPermissionMode:
      permissionMode.agentControllerPermissionMode ?? null,
    agentControllerRef: agentControllerRef ?? null,
    authorizeForOrganization: input.authorizeForOrganization !== false,
    defaultProjectId: await resolveRequestDefaultProjectId({
      agentControllerRef,
      context,
      input,
      targetOwnerUserId,
    }),
    modelId: normalizeOptionalText(input.modelId) ?? null,
    openCodePermission: parseOpenCodePermissionInput(
      input.openCodePermissionInput
    ),
    reasoningLevel: normalizeOptionalText(input.reasoningLevel) ?? null,
    targetComputerId: targetComputerId ?? null,
  });
}

async function resolveRequestComputerId(options: {
  agentControllerRef: string | undefined;
  context: ProfileCreationRequestCommandContext;
  requestedComputerId: string | undefined;
  targetOwnerUserId: string;
}): Promise<string | null> {
  const {
    agentControllerRef,
    context,
    requestedComputerId,
    targetOwnerUserId,
  } = options;
  if (!(agentControllerRef || requestedComputerId)) {
    return null;
  }
  if (!agentControllerRef) {
    throw new ProfileCreationRequestCliError({
      code: "profile.creation_request.agent_controller_required",
      message: "A Computer selection also requires a Local Agent.",
      nextStep:
        "Pass `--agent-controller <ref>` with `--computer`, or remove `--computer`.",
      title: "Local Agent Needed",
    });
  }
  if (requestedComputerId) {
    return requestedComputerId;
  }
  if (targetOwnerUserId !== context.callerUserId) {
    throw new ProfileCreationRequestCliError({
      code: "profile.creation_request.computer_required",
      message: "Creating an Agent for a teammate requires their Computer.",
      nextStep:
        "Run `openmeld org computers --view agent`, then pass `--computer <computer-id>`.",
      title: "Computer Needed",
    });
  }

  const currentComputerId = await readCurrentLocalDeviceId();
  const computers = await context.api.getCurrentComputers();
  const currentComputer = computers.computers.find(
    (computer) =>
      computer.computerId === currentComputerId &&
      computer.ownerUserId === context.callerUserId
  );
  if (!currentComputer) {
    throw new ProfileCreationRequestCliError({
      code: "profile.creation_request.current_computer_unavailable",
      message:
        "This computer is not available for Agent Profile creation in the selected Organization.",
      nextStep:
        "Run `openmeld setup`, then retry; or pass `--computer <computer-id>` from `openmeld org computers --view agent`.",
      title: "Computer Not Available",
    });
  }
  const localAgent = currentComputer.localAgents.find(
    (agent) => agent.agentControllerRef === agentControllerRef
  );
  if (
    currentComputer.serviceState !== "connected" ||
    !localAgent?.enabled ||
    localAgent.status !== "ready"
  ) {
    throw new ProfileCreationRequestCliError({
      code: "profile.creation_request.local_agent_unavailable",
      message: `${agentControllerRef} is not ready on this computer.`,
      nextStep:
        "Run `openmeld computer current --view agent` and repair the Local Agent, then retry; or pass another ready `--computer <computer-id>`.",
      title: "Local Agent Not Ready",
    });
  }
  return currentComputer.computerId;
}

async function resolveRequestDefaultProjectId(options: {
  agentControllerRef: string | undefined;
  context: ProfileCreationRequestCommandContext;
  input: ProfileCreationRequestCreateInput;
  targetOwnerUserId: string;
}): Promise<string | null> {
  const { agentControllerRef, context, input, targetOwnerUserId } = options;
  const explicitProjectId = normalizeOptionalText(input.defaultProjectId);
  if (explicitProjectId) {
    return explicitProjectId;
  }
  if (
    input.reuseSavedDefaultProject === false ||
    !agentControllerRef ||
    targetOwnerUserId !== context.callerUserId
  ) {
    return null;
  }
  const defaults = await context.api.getAgentProfileCreationDefaults({
    agentControllerRef,
    organizationId: context.organization.id,
  });
  return defaults.defaultProjectId;
}

function parseOpenCodePermissionInput(value: string | undefined): unknown {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    throw new Error("--open-code-permission must be a valid JSON object.");
  }
}

export async function runProfileCreationRequestList(
  input: ProfileCreationRequestCommonCommandInput = {}
): Promise<void> {
  const context = await resolveProfileCreationRequestCommandContext(input);
  if (!context) {
    return;
  }

  try {
    const response = await context.api.listAgentProfileCreationRequests({
      organizationId: context.organization.id,
    });
    if (context.runtime.resolvedView === "agent") {
      context.presenter.data({
        code: "profile.creation_request.list",
        payload: response,
      });
      return;
    }
    emitRequestList({ context, requests: response.requests });
  } catch (error) {
    emitCommandError({ context, error, operation: "list" });
  }
}

export async function runProfileCreationRequestDecide(
  input: ProfileCreationRequestCommonCommandInput & {
    decision: "approve" | "decline";
    requestId?: string;
  }
): Promise<void> {
  const context = await resolveProfileCreationRequestCommandContext(input);
  if (!context) {
    return;
  }

  try {
    const response = await context.api.decideAgentProfileCreationRequest({
      decision: input.decision,
      organizationId: context.organization.id,
      requestId: requireText(input.requestId, "Request ID"),
    });
    emitRequest({
      code: `profile.creation_request.${input.decision}`,
      context,
      request: response.request,
      title:
        input.decision === "approve"
          ? "Agent Profile Request Approved"
          : "Agent Profile Request Declined",
    });
  } catch (error) {
    emitCommandError({ context, error, operation: input.decision });
  }
}

export async function runProfileCreationRequestCancel(
  input: ProfileCreationRequestCommonCommandInput & { requestId?: string }
): Promise<void> {
  await runRequestMutation({
    ...input,
    action: "cancel",
    title: "Agent Profile Request Cancelled",
  });
}

export async function runProfileCreationRequestRetry(
  input: ProfileCreationRequestCommonCommandInput & { requestId?: string }
): Promise<void> {
  await runRequestMutation({
    ...input,
    action: "retry",
    title: "Agent Profile Request Retried",
  });
}

export async function runProfileCreationRequestPreferenceGet(
  input: ProfileCreationRequestCommonCommandInput = {}
): Promise<void> {
  const context = await resolveProfileCreationRequestCommandContext(input);
  if (!context) {
    return;
  }

  try {
    const preference =
      await context.api.getAgentProfileCreationApprovalPreference({
        organizationId: context.organization.id,
      });
    emitPreference({ context, preference, title: "Agent Creation Approvals" });
  } catch (error) {
    emitCommandError({ context, error, operation: "read preferences" });
  }
}

export async function runProfileCreationRequestPreferenceSet(
  input: ProfileCreationRequestCommonCommandInput & {
    existingSessionPolicy?: string;
    newSessionPolicy?: string;
  }
): Promise<void> {
  const context = await resolveProfileCreationRequestCommandContext(input);
  if (!context) {
    return;
  }

  try {
    const preference =
      await context.api.setAgentProfileCreationApprovalPreference({
        existingSessionPolicy: parseApprovalPolicy(
          input.existingSessionPolicy,
          "Existing-session policy"
        ),
        newSessionPolicy: parseApprovalPolicy(
          input.newSessionPolicy,
          "New-session policy"
        ),
        organizationId: context.organization.id,
      });
    emitPreference({
      context,
      preference,
      title: "Agent Creation Approvals Updated",
    });
  } catch (error) {
    emitCommandError({ context, error, operation: "update preferences" });
  }
}

async function runRequestMutation(
  input: ProfileCreationRequestCommonCommandInput & {
    action: "cancel" | "retry";
    requestId?: string;
    title: string;
  }
): Promise<void> {
  const context = await resolveProfileCreationRequestCommandContext(input);
  if (!context) {
    return;
  }

  try {
    const requestId = requireText(input.requestId, "Request ID");
    const response =
      input.action === "cancel"
        ? await context.api.cancelAgentProfileCreationRequest({
            organizationId: context.organization.id,
            requestId,
          })
        : await context.api.retryAgentProfileCreationRequest({
            organizationId: context.organization.id,
            requestId,
          });
    emitRequest({
      code: `profile.creation_request.${input.action}`,
      context,
      request: response.request,
      title: input.title,
    });
  } catch (error) {
    emitCommandError({ context, error, operation: input.action });
  }
}
