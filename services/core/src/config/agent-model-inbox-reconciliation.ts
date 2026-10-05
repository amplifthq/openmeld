import {
  getAgentControllerModelCatalogId,
  parseAgentControllerRef,
} from "@openmeld/agent-runtime";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  listEnabledPrimaryAgentProfileBindingRecordsForRuntimeAgentController,
  readPrimaryAgentProfileBindingRecord,
} from "../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import {
  readAgentProfileOrganizationContext,
  readAgentProfileOrganizationContexts,
} from "../center-agent/center-agent-organization-scope";
import {
  type AgentModelInboxSnapshot,
  reconcileAgentModelInboxProjection,
} from "../inbox/application/agent-model-inbox";
import type { CoreBindings } from "../lib/bindings";
import { readCurrentRuntimeAgentControllerReport } from "../runtime-registry/infrastructure/postgresql/runtime-agent-controller-report-repo";
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
  const db = getPostgresDatabase(input.env);
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
  if (bindings.length === 0) {
    return;
  }
  const [profiles, currentReport] = await Promise.all([
    readAgentProfileOrganizationContexts({
      db,
      agentProfileIds: bindings.map((binding) => binding.agentProfileId),
    }),
    readCurrentRuntimeAgentControllerReport({
      db,
      agentControllerRef: input.agentControllerRef,
      openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
    }),
  ]);
  // Independent profiles share the batch's initial owner reads. Any proposed
  // write still performs the projection owner's fresh read before publication.
  for (let offset = 0; offset < bindings.length; offset += 4) {
    await Promise.all(
      bindings.slice(offset, offset + 4).map(async (binding) => {
        let initial = true;
        await reconcileAgentModelInboxProjection({
          db,
          nowMs: input.nowMs,
          readCurrent: () => {
            const facts = initial
              ? {
                  profile: profiles.get(binding.agentProfileId) ?? null,
                  binding,
                  currentReport,
                }
              : undefined;
            initial = false;
            return readCurrentSnapshot(
              { ...input, agentProfileId: binding.agentProfileId },
              facts
            );
          },
        });
      })
    );
  }
}

/** Called by normal controller reports, model edits and authoritative unbinding. */
export async function reconcileAgentModelInbox(input: {
  env: CoreBindings;
  ownerUserId: string;
  agentProfileId: string;
  nowMs: number;
}): Promise<void> {
  const db = getPostgresDatabase(input.env);
  if (!db) {
    return;
  }
  await reconcileAgentModelInboxProjection({
    db,
    nowMs: input.nowMs,
    readCurrent: () => readCurrentSnapshot(input),
  });
}

async function readCurrentSnapshot(
  input: {
    env: CoreBindings;
    ownerUserId: string;
    agentProfileId: string;
    nowMs: number;
  },
  initial?: {
    profile: Awaited<ReturnType<typeof readAgentProfileOrganizationContext>>;
    binding: Awaited<ReturnType<typeof readPrimaryAgentProfileBindingRecord>>;
    currentReport: Awaited<
      ReturnType<typeof readCurrentRuntimeAgentControllerReport>
    >;
  }
): Promise<AgentModelInboxSnapshot | null> {
  const db = getPostgresDatabase(input.env);
  const profilesDb = getPostgresDatabase(input.env);
  if (!(db && profilesDb)) {
    return null;
  }
  const profile = initial
    ? initial.profile
    : await readAgentProfileOrganizationContext({
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
  const binding = initial
    ? initial.binding
    : await readPrimaryAgentProfileBindingRecord({
        db,
        agentProfileId: input.agentProfileId,
        owner: { id: input.ownerUserId, kind: "owner_account" },
      });
  if (!binding) {
    // A successful authoritative read proves there is no selected model left.
    // Missing ownership or a failed Binding read must never claim recovery.
    return {
      organizationId: profile.organizationId,
      ownerUserId: input.ownerUserId,
      profileId: input.agentProfileId,
      profileName: profile.profileName,
      identity: JSON.stringify([
        profile.organizationId,
        input.ownerUserId,
        input.agentProfileId,
        "unbound",
      ]),
      verdict: "clear",
      occurredAtMs: input.nowMs,
      message: "",
    };
  }
  const currentReport = initial
    ? initial.currentReport
    : await readCurrentRuntimeAgentControllerReport({
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
