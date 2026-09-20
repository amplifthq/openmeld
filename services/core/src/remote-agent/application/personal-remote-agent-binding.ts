import {
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
  HOSTED_REMOTE_AGENT_RUNTIME_IDENTITY,
  hostedRemoteAgentRuntimeIdentitySchema,
} from "@openmeld/schemas";
import {
  type AgentProfileBindingRecord,
  ensurePrimaryAgentProfileBindingRecord,
  readPrimaryAgentProfileBindingRecord,
} from "../../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import { resolveCenterAgentModelRouteForBinding } from "../../center-agent/application/center-agent-model-service";
import { readModelCatalog } from "../../config/model-catalog";

export function isPersonalRemoteAgentBinding(
  binding: AgentProfileBindingRecord
): boolean {
  if (
    binding.owner.kind !== "owner_account" ||
    binding.runtimeKind !== "hosted_remote_agent" ||
    binding.agentControllerRef !== HOSTED_REMOTE_AGENT_CONTROLLER_REF ||
    binding.openMeldServiceRuntimeId !== HOSTED_REMOTE_AGENT_CONTROLLER_REF ||
    binding.agentControllerConversationId != null ||
    !binding.hostedRuntimeIdentityJson
  ) {
    return false;
  }
  try {
    return hostedRemoteAgentRuntimeIdentitySchema.safeParse(
      JSON.parse(binding.hostedRuntimeIdentityJson)
    ).success;
  } catch {
    return false;
  }
}

export async function requirePersonalRemoteAgentBinding(input: {
  agentProfileId: string;
  bindingId?: string;
  db: D1Database;
  organizationId: string;
  ownerUserId: string | null;
}): Promise<AgentProfileBindingRecord> {
  const ownerUserId = input.ownerUserId;
  if (!ownerUserId) {
    throw new Error("remote_agent.personal_owner_unavailable");
  }
  await requirePersonalRemoteAgentOwner({ ...input, ownerUserId });
  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.agentProfileId,
    db: input.db,
    owner: { id: ownerUserId, kind: "owner_account" },
  });
  if (
    !binding ||
    binding.bindingState !== "enabled_primary" ||
    !isPersonalRemoteAgentBinding(binding)
  ) {
    throw new Error("remote_agent.personal_binding_unavailable");
  }
  if (input.bindingId && binding.bindingId !== input.bindingId) {
    throw new Error("remote_agent.personal_binding_changed");
  }
  return binding;
}

async function requirePersonalRemoteAgentOwner(input: {
  agentProfileId: string;
  db: D1Database;
  organizationId: string;
  ownerUserId: string;
}): Promise<void> {
  const profile = await input.db
    .prepare(`
    SELECT p.profile_id FROM openmeld_profiles p
    JOIN members m ON m.organization_id = p.organization_id AND m.user_id = p.owner_user_id
    WHERE p.profile_id = ? AND p.organization_id = ? AND p.owner_user_id = ?
      AND p.profile_kind = 'agent' AND p.managed_role IS NULL AND p.status = 'active'
    LIMIT 1
  `)
    .bind(input.agentProfileId, input.organizationId, input.ownerUserId)
    .first();
  if (!profile) {
    throw new Error("remote_agent.personal_profile_unavailable");
  }
}

export async function createPersonalRemoteAgentBinding(input: {
  agentProfileId: string;
  createdByProfileId: string;
  db: D1Database;
  modelId: string | null;
  organizationId: string;
  ownerUserId: string;
}): Promise<void> {
  await requirePersonalRemoteAgentOwner(input);
  resolveCenterAgentModelRouteForBinding({
    binding: { configurationRevision: 1, modelId: input.modelId },
    catalog: readModelCatalog(),
  });
  const nowMs = Date.now();
  const result = await ensurePrimaryAgentProfileBindingRecord({
    db: input.db,
    record: {
      agentProfileId: input.agentProfileId,
      bindingId: `binding_${crypto.randomUUID()}`,
      agentControllerRef: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
      createdAtMs: nowMs,
      createdByProfileId: input.createdByProfileId,
      hostedRuntimeIdentityJson: JSON.stringify(
        HOSTED_REMOTE_AGENT_RUNTIME_IDENTITY
      ),
      modelId: input.modelId,
      openMeldServiceRuntimeId: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
      owner: { id: input.ownerUserId, kind: "owner_account" },
      runtimeKind: "hosted_remote_agent",
      updatedAtMs: nowMs,
    },
  });
  if (result.status !== "accepted") {
    throw new Error("remote_agent.personal_binding_conflict");
  }
}
