import {
  getAgentControllerModelCatalogId,
  parseAgentControllerRef,
} from "@openmeld/agent-runtime";
import {
  listEnabledPrimaryAgentProfileBindingRecordsForRuntimeAgentController,
  readPrimaryAgentProfileBindingRecord,
} from "../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import { readAgentProfileOrganizationContext } from "../center-agent/center-agent-organization-scope";
import {
  type AgentModelInboxSnapshot,
  reconcileAgentModelInboxProjection,
} from "../inbox/application/agent-model-inbox";
import {
  type CoreBindings,
  identityDb,
  inboxDb,
  localStateDb,
} from "../lib/bindings";
import { readCurrentRuntimeAgentControllerReport } from "../runtime-registry/infrastructure/d1/runtime-agent-controller-report-repo";
import {
  readCurrentAgentModelAuthType,
  resolveCurrentAgentModelAvailability,
} from "./agent-model-availability";
import { readAuthoredModelCatalog } from "./model-catalog";

export async function reconcileRuntimeAgentModelInboxes(input: {
  env: CoreBindings;
  ownerUserId: string;
  agentControllerRef: string;
  openMeldServiceRuntimeId: { value: string };
  nowMs: number;
}): Promise<void> {
  const db = localStateDb(input.env);
  if (!db) {
    return;
  }
  const bindings =
    await listEnabledPrimaryAgentProfileBindingRecordsForRuntimeAgentController(
      {
        db,
        owner: { id: input.ownerUserId, kind: "owner_account" },
        agentControllerRef: input.agentControllerRef,
        openMeldServiceRuntimeId: input.openMeldServiceRuntimeId.value,
      }
    );
  for (const binding of bindings) {
    await reconcileAgentModelInbox({
      ...input,
      agentProfileId: binding.agentProfileId,
    });
  }
}

/** Called by normal controller reports and a user's successful model edit. */
export async function reconcileAgentModelInbox(input: {
  env: CoreBindings;
  ownerUserId: string;
  agentProfileId: string;
  nowMs: number;
}): Promise<void> {
  const db = inboxDb(input.env);
  if (!db) {
    return;
  }
  await reconcileAgentModelInboxProjection({
    db,
    nowMs: input.nowMs,
    readCurrent: () => readCurrentSnapshot(input),
  });
}

async function readCurrentSnapshot(input: {
  env: CoreBindings;
  ownerUserId: string;
  agentProfileId: string;
  nowMs: number;
}): Promise<AgentModelInboxSnapshot | null> {
  const db = localStateDb(input.env);
  const profilesDb = identityDb(input.env);
  if (!(db && profilesDb)) {
    return null;
  }
  const profile = await readAgentProfileOrganizationContext({
    db: profilesDb,
    agentProfileId: input.agentProfileId,
  });
  // Never manufacture an Organization for an unscoped legacy Profile.
  if (
    !profile?.organizationId ||
    profile.ownerUserId !== input.ownerUserId ||
    profile.profileKind !== "agent"
  ) {
    return null;
  }
  const binding = await readPrimaryAgentProfileBindingRecord({
    db,
    agentProfileId: input.agentProfileId,
    owner: { id: input.ownerUserId, kind: "owner_account" },
  });
  if (!binding) {
    return null;
  }
  const currentReport = await readCurrentRuntimeAgentControllerReport({
    db,
    agentControllerRef: binding.agentControllerRef,
    openMeldServiceRuntimeId: { value: binding.openMeldServiceRuntimeId },
  });
  const catalog = readAuthoredModelCatalog();
  const context = {
    agentControllerRef: binding.agentControllerRef,
    modelId: binding.modelId,
    openMeldServiceRuntimeId: binding.openMeldServiceRuntimeId,
    currentReport,
    catalog,
    nowMs: input.nowMs,
  };
  const ref = parseAgentControllerRef(binding.agentControllerRef);
  const model = ref
    ? catalog.agentControllers[
        getAgentControllerModelCatalogId(ref)
      ]?.models.find((item) => item.id === binding.modelId)
    : null;
  const availability = resolveCurrentAgentModelAvailability(context);
  const unknownScope =
    model?.retirement?.status === "withdrawn" &&
    model.retirement.scope.authType &&
    !readCurrentAgentModelAuthType(context);
  const availableVerdict = unknownScope ? "unknown" : "clear";
  return {
    organizationId: profile.organizationId,
    ownerUserId: input.ownerUserId,
    profileId: input.agentProfileId,
    profileName: profile.profileName,
    identity: JSON.stringify([
      profile.organizationId,
      input.ownerUserId,
      input.agentProfileId,
      binding.bindingId,
      binding.agentControllerRef,
      binding.openMeldServiceRuntimeId,
      binding.modelId,
      // Re-verifying the same policy must not create another unread episode.
      model?.retirement?.status ?? null,
      model?.retirement?.scope ?? null,
      model?.unavailable ?? null,
    ]),
    verdict: availability.available ? availableVerdict : "blocked",
    occurredAtMs: model?.retirement
      ? Date.parse(model.retirement.verifiedAt)
      : binding.createdAtMs,
    message: availability.available ? "" : availability.message,
  };
}
