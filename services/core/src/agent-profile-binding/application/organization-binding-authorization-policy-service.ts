import {
  type AgentProfileOrganizationContext,
  isAgentProfileEligibleForOrganization,
  readAgentProfileOrganizationContext,
} from "../../center-agent/center-agent-organization-scope";
import { insertCenterAgentAuditJournalEntry } from "../../center-agent/center-agent-repository";
import {
  ensureOrganizationBindingAuthorizationRecord,
  listOrganizationBindingAuthorizationCandidates,
  listOrganizationBindingAuthorizationRecordsForBinding,
  readOrganizationBindingAuthorizationPreferenceRecord,
  readPersonalOrganizationIdForUser,
} from "../infrastructure/d1/organization-binding-authorization-repo";

export type ApplyAcceptedBindingAuthorizationPoliciesInput = {
  activeOrganizationId?: string | null;
  actorProfileId?: string | null;
  agentProfileId: string;
  bindingId: string;
  db: D1Database;
  nowMs: number;
  ownerUserId: string;
  previousBindingId?: string | null;
};

export type AppliedBindingAuthorizationPolicy = {
  organizationId: string;
  source: "personal" | "preference" | "rebind_carry_over";
  status: "authorized" | "already_authorized";
};

export async function applyAcceptedBindingAuthorizationPolicies(
  input: ApplyAcceptedBindingAuthorizationPoliciesInput
): Promise<AppliedBindingAuthorizationPolicy[]> {
  const applied: AppliedBindingAuthorizationPolicy[] = [];
  const profileOrganization = await readAgentProfileOrganizationContext({
    agentProfileId: input.agentProfileId,
    db: input.db,
  });
  if (!profileOrganization || profileOrganization.profileKind !== "agent") {
    throw new Error(
      `Agent Profile organization context is required before Binding authorization policies can apply for ${input.agentProfileId}`
    );
  }

  if (input.previousBindingId && input.previousBindingId !== input.bindingId) {
    applied.push(
      ...(await carryOverPreviousBindingAuthorizations({
        ...input,
        profileOrganization,
      }))
    );
  }

  const personalOrganizationId = await readPersonalOrganizationIdForUser({
    db: input.db,
    userId: input.ownerUserId,
  });
  if (!personalOrganizationId) {
    throw new Error(
      `Personal organization is required before Binding authorization policies can apply for user ${input.ownerUserId}`
    );
  }

  if (
    isAgentProfileEligibleForOrganization({
      managedRole: profileOrganization.managedRole,
      profileOrganizationId: profileOrganization.organizationId,
      targetOrganizationId: personalOrganizationId,
    })
  ) {
    const personalAuthorization =
      await ensureOrganizationBindingAuthorizationRecord({
        authorizedBy: input.ownerUserId,
        bindingId: input.bindingId,
        db: input.db,
        nowMs: input.nowMs,
        organizationId: personalOrganizationId,
      });
    applied.push({
      organizationId: personalOrganizationId,
      source: "personal",
      status: personalAuthorization.status,
    });
  }

  if (
    input.activeOrganizationId &&
    isAgentProfileEligibleForOrganization({
      managedRole: profileOrganization.managedRole,
      profileOrganizationId: profileOrganization.organizationId,
      targetOrganizationId: input.activeOrganizationId,
    })
  ) {
    const preference =
      await readOrganizationBindingAuthorizationPreferenceRecord({
        db: input.db,
        organizationId: input.activeOrganizationId,
        userId: input.ownerUserId,
      });
    if (preference?.autoAuthorizeAgentProfileBindings) {
      const [candidate] = await listOrganizationBindingAuthorizationCandidates({
        agentProfileIds: [input.agentProfileId],
        db: input.db,
        organizationId: input.activeOrganizationId,
        userId: input.ownerUserId,
      });
      if (candidate?.bindingId === input.bindingId) {
        const preferenceAuthorization =
          await ensureOrganizationBindingAuthorizationRecord({
            authorizedBy: input.ownerUserId,
            bindingId: input.bindingId,
            db: input.db,
            nowMs: input.nowMs,
            organizationId: input.activeOrganizationId,
          });
        applied.push({
          organizationId: input.activeOrganizationId,
          source: "preference",
          status: preferenceAuthorization.status,
        });
      }
    }
  }

  return applied;
}

async function carryOverPreviousBindingAuthorizations(
  input: ApplyAcceptedBindingAuthorizationPoliciesInput & {
    profileOrganization: AgentProfileOrganizationContext;
  }
): Promise<AppliedBindingAuthorizationPolicy[]> {
  if (!input.previousBindingId) {
    return [];
  }

  const previousAuthorizations =
    await listOrganizationBindingAuthorizationRecordsForBinding({
      bindingId: input.previousBindingId,
      db: input.db,
    });
  if (previousAuthorizations.length === 0) {
    return [];
  }

  if (!input.actorProfileId) {
    throw new Error(
      "Actor profile id is required to audit carried-over Binding authorizations"
    );
  }

  const applied: AppliedBindingAuthorizationPolicy[] = [];
  for (const previousAuthorization of previousAuthorizations) {
    if (
      !isAgentProfileEligibleForOrganization({
        managedRole: input.profileOrganization.managedRole,
        profileOrganizationId: input.profileOrganization.organizationId,
        targetOrganizationId: previousAuthorization.organizationId,
      })
    ) {
      continue;
    }
    const authorization = await ensureOrganizationBindingAuthorizationRecord({
      authorizedBy: previousAuthorization.authorizedBy,
      bindingId: input.bindingId,
      db: input.db,
      nowMs: input.nowMs,
      organizationId: previousAuthorization.organizationId,
    });
    applied.push({
      organizationId: previousAuthorization.organizationId,
      source: "rebind_carry_over",
      status: authorization.status,
    });

    await insertCenterAgentAuditJournalEntry({
      action: "carry_over_binding_authorization",
      actorProfileId: input.actorProfileId,
      attribution: { actorProfileId: input.actorProfileId, onBehalfOf: null },
      db: input.db,
      id: crypto.randomUUID(),
      nowMs: input.nowMs,
      organizationId: previousAuthorization.organizationId,
      resource: {
        id: authorization.record.id,
        type: "organization_binding_authorization",
      },
    });
  }

  return applied;
}
