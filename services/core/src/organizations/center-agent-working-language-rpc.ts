import { memberRoleHasOrganizationPermission } from "@openmeld/auth";
import {
  centerAgentSetOrganizationWorkingLanguageToolResponseSchema,
  centerAgentSetOrganizationWorkingLanguageToolRpcInputSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentSetOrganizationWorkingLanguageToolResponse,
  CenterAgentSetOrganizationWorkingLanguageToolRpcInput,
} from "@openmeld/schemas/types";
import { prepareCenterAgentRepresentedMemberRequest } from "../center-agent/application/represented-member-request";
import { resolveCenterAgentAuditAttribution } from "../center-agent/center-agent-audit";
import { prepareCenterAgentAuditJournalEntryStatement } from "../center-agent/center-agent-repository";
import { type CoreBindings, localStateDb } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { readOrganizationPersonalClassification } from "./organization-context";
import {
  setOrganizationWorkingLanguagePreference,
  toOrganizationWorkingLanguagePreferenceResponse,
} from "./organization-working-language-repository";

export async function rpcCenterAgentSetOrganizationWorkingLanguage(
  env: CoreBindings,
  input: CenterAgentSetOrganizationWorkingLanguageToolRpcInput
): Promise<CenterAgentSetOrganizationWorkingLanguageToolResponse> {
  const parsed =
    centerAgentSetOrganizationWorkingLanguageToolRpcInputSchema.safeParse(
      input
    );
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "Invalid Organization working-language preference.",
      status: 400,
    });
  }
  const request = parsed.data;
  const represented = await prepareCenterAgentRepresentedMemberRequest(
    env,
    request.context,
    request.speakerMember
  );
  requireOrganizationWorkingLanguageManager(represented.representedHuman.role);

  const organizationId =
    represented.authorization.activeOrganization.organizationId;
  const classification = await readOrganizationPersonalClassification({
    env,
    organizationId,
    requestId: request.context.actorContext.requestId,
  });
  if (!classification.ok) {
    throw createCoreRpcHttpError({
      code: "organization.context_unavailable",
      reason: "OpenMeld could not verify the current Organization.",
      status: 503,
    });
  }
  if (classification.personal) {
    throw createCoreRpcHttpError({
      code: "organization.shared_required",
      reason:
        "A preferred working language is available for Organizations, not Personal Workspaces. I’ll follow the language of your current request here.",
      status: 422,
    });
  }

  const db = localStateDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "organization.working_language_store_unavailable",
      reason: "The Organization working-language setting is unavailable.",
      status: 503,
    });
  }
  const nowMs = Date.now();
  const attribution = await resolveCenterAgentAuditAttribution({
    authorization: represented.authorization,
    onBehalfOfProfileId: represented.representedHuman.profileId,
  });
  const auditStatement = prepareCenterAgentAuditJournalEntryStatement({
    action: "set_working_language",
    actorProfileId: represented.authorization.actorProfileId,
    attribution,
    db,
    id: crypto.randomUUID(),
    nowMs,
    organizationId,
    resource: { id: organizationId, type: "organization_working_language" },
    sourceNativeDeliveryId: represented.sourceNativeDeliveryId,
  });
  const preference = await setOrganizationWorkingLanguagePreference({
    atomicStatements: [auditStatement],
    db,
    ...(request.mode === "selected"
      ? { languageTag: request.languageTag }
      : {}),
    mode: request.mode,
    nowMs,
    organizationId,
    updatedByUserId: represented.representedHuman.userId,
  });
  return centerAgentSetOrganizationWorkingLanguageToolResponseSchema.parse(
    toOrganizationWorkingLanguagePreferenceResponse(preference)
  );
}

export function requireOrganizationWorkingLanguageManager(
  role: "admin" | "member" | "owner"
): void {
  if (
    memberRoleHasOrganizationPermission(role, {
      workingLanguage: ["manage"],
    })
  ) {
    return;
  }
  throw createCoreRpcHttpError({
    code: "organization.role_required",
    reason:
      "Only an Organization owner or admin can change the preferred working language.",
    status: 403,
  });
}
