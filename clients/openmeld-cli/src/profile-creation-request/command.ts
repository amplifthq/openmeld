import { randomUUID } from "node:crypto";
import {
  type ProfileCreationRequestCommonCommandInput,
  resolveProfileCreationRequestCommandContext,
} from "./context";
import {
  normalizeOptionalText,
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
    idempotencyKey?: string;
    nativeSessionId?: string;
    profileName?: string;
    requestedSpaceId?: string;
    sessionStrategy?: string;
    source?: string;
    targetOwner?: string;
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
    const response = await context.api.createAgentProfileCreationRequest({
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
