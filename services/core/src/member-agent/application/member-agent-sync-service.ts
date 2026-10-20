import type {
  AssignAgentProfileMemberAgentOutcome,
  DetectedHarnessKind,
  EnsureDetectedMemberAgentRpcResult,
  ListMemberAgentsResponse,
  MemberAgent,
  MemberAgentSyncResult,
} from "@openmeld/schemas";
import {
  harnessKindFromAgentControllerRef,
  MEMBER_AGENT_SYNC_HARNESS_NOT_DETECTED_REASON,
  resolveBuiltinAgentControllerConversationCapability,
} from "@openmeld/schemas";
import {
  isRuntimeHarnessCreatable,
  type RuntimeHarness,
} from "./runtime-harness-catalog";

export type MemberAgentBindingTarget = Pick<
  RuntimeHarness,
  "agentControllerRef" | "deviceId" | "lane" | "openMeldServiceRuntimeId"
>;

export type MemberAgentSyncDeps = {
  // Puts a bound Profile under the MemberAgent of its Binding's Harness. It
  // re-reads the Binding under the Profile's assignment lock, so a controller switch
  // that commits after readGroupingControllerRef cannot be grouped under the
  // old Harness.
  assignBoundProfile: (
    agentProfileId: string
  ) => Promise<AssignAgentProfileMemberAgentOutcome | null>;
  ensureDetectedMemberAgent: (
    harnessKind: DetectedHarnessKind
  ) => Promise<EnsureDetectedMemberAgentRpcResult>;
  // Any Binding row, enabled or disabled: an owner who disabled the default
  // Profile's Binding keeps that choice.
  hasAnyBinding: (agentProfileId: string) => Promise<boolean>;
  listOwnerMemberAgents: () => Promise<ListMemberAgentsResponse>;
  listRuntimeHarnesses: () => Promise<readonly RuntimeHarness[]>;
  openDirectMessage: (agentProfileId: string) => Promise<{ spaceId: string }>;
  // The enabled primary Binding's controller ref, else the most recent
  // Binding's; null when the Profile never bound.
  readGroupingControllerRef: (agentProfileId: string) => Promise<string | null>;
  // Writes the default Profile's first Binding with the Harness defaults.
  writeDefaultBinding: (input: {
    agentProfileId: string;
    target: MemberAgentBindingTarget;
  }) => Promise<{ status: "accepted" | "rejected"; reasonCodes: string[] }>;
};

// A shared-account Harness needs an existing provider conversation before
// it can bind, so it is never set up without the owner choosing one.
export const MEMBER_AGENT_SYNC_CONVERSATION_REQUIRED_REASON =
  "member_agent.harness_requires_conversation";

/**
 * Reconcile the signed-in member's MemberAgents in one Organization with the
 * Harnesses their computers report (design-plans/member-agent-program.md
 * §4.5). Only the Harnesses the member chose (`createHarnessKinds`, from
 * setup or "add") get a new MemberAgent: Auth ensures it with its keyed
 * default Profile, Core binds that Profile to one of the reporting computers
 * and assigns it under the Profile's assignment lock, Auth then sets the
 * default, and Core opens the owner's Direct Message with it. Every call
 * also finishes existing detected MemberAgents and assigns bound Profiles.
 * Other detected Harnesses are reported as addable. A second computer with
 * the same Harness adds nothing. Hosted and custom controllers never appear
 * in the catalog.
 */
export type MemberAgentSyncReport = {
  // Detected Harnesses with no MemberAgent that the member can add.
  addableHarnessKinds: DetectedHarnessKind[];
  // Unassigned Profiles this call put under their Harness's MemberAgent.
  assignedProfileIds: string[];
  results: MemberAgentSyncResult[];
};

export async function syncMemberAgents(
  deps: MemberAgentSyncDeps,
  input: { createHarnessKinds?: readonly DetectedHarnessKind[] } = {}
): Promise<MemberAgentSyncReport> {
  const harnesses = (await deps.listRuntimeHarnesses()).filter(
    isRuntimeHarnessCreatable
  );
  const byHarnessKind = new Map<DetectedHarnessKind, RuntimeHarness[]>();
  for (const harness of harnesses) {
    const list = byHarnessKind.get(harness.harnessKind) ?? [];
    list.push(harness);
    byHarnessKind.set(harness.harnessKind, list);
  }
  const requested = new Set(input.createHarnessKinds ?? []);
  // The listing is read even with no Harness detected: assigning bound
  // Profiles needs only their Bindings and the existing MemberAgents.
  const listing = await deps.listOwnerMemberAgents();
  const results: MemberAgentSyncResult[] = [];
  const addableHarnessKinds: DetectedHarnessKind[] = [];
  for (const [harnessKind, candidates] of [...byHarnessKind].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const existing =
      listing.memberAgents.find(
        (memberAgent) => memberAgent.harnessKind === harnessKind
      ) ?? null;
    if (!(existing || requested.has(harnessKind))) {
      if (!requiresChosenConversation(harnessKind)) {
        addableHarnessKinds.push(harnessKind);
      }
      continue;
    }
    results.push(
      await syncHarness({ candidates, deps, existing, harnessKind })
    );
  }
  for (const harnessKind of [...requested].sort()) {
    if (!byHarnessKind.has(harnessKind)) {
      results.push({
        binding: "not_attempted",
        defaultProfileId: null,
        directMessage: "not_attempted",
        directMessageSpaceId: null,
        harnessKind,
        memberAgentId: null,
        outcome: "skipped",
        reasonCodes: [MEMBER_AGENT_SYNC_HARNESS_NOT_DETECTED_REASON],
      });
    }
  }
  return {
    addableHarnessKinds,
    assignedProfileIds: await assignUnassignedBoundProfiles(
      deps,
      // A MemberAgent created now can take Profiles already bound to it.
      results.some((result) => result.outcome === "created")
        ? await deps.listOwnerMemberAgents()
        : listing
    ),
    results,
  };
}

// A Profile bound to a Harness belongs to that Harness's MemberAgent. The
// Binding write assigns it; this repairs Profiles bound before that or whose
// assignment failed. Profiles without a Binding, with a `custom` controller,
// or whose Harness has no MemberAgent stay unassigned: nothing is guessed.
async function assignUnassignedBoundProfiles(
  deps: MemberAgentSyncDeps,
  listing: ListMemberAgentsResponse
): Promise<string[]> {
  const assigned: string[] = [];
  const harnessKinds = new Set(
    listing.memberAgents.map((memberAgent) => memberAgent.harnessKind)
  );
  for (const profile of listing.unassignedProfiles) {
    const agentControllerRef = await deps.readGroupingControllerRef(
      profile.openMeldProfileId
    );
    const harnessKind = harnessKindFromAgentControllerRef(agentControllerRef);
    if (
      agentControllerRef &&
      harnessKind &&
      harnessKinds.has(harnessKind) &&
      (await deps.assignBoundProfile(profile.openMeldProfileId)) === "assigned"
    ) {
      assigned.push(profile.openMeldProfileId);
    }
  }
  return assigned;
}

async function syncHarness(input: {
  candidates: readonly RuntimeHarness[];
  deps: MemberAgentSyncDeps;
  existing: MemberAgent | null;
  harnessKind: DetectedHarnessKind;
}): Promise<MemberAgentSyncResult> {
  const base = {
    binding: "not_attempted",
    defaultProfileId: input.existing?.defaultProfileId ?? null,
    directMessage: "not_attempted",
    directMessageSpaceId: null,
    harnessKind: input.harnessKind,
    memberAgentId: input.existing?.id ?? null,
    reasonCodes: [],
  } satisfies Omit<MemberAgentSyncResult, "outcome">;
  if (requiresChosenConversation(input.harnessKind)) {
    return {
      ...base,
      outcome: "skipped",
      reasonCodes: [MEMBER_AGENT_SYNC_CONVERSATION_REQUIRED_REASON],
    };
  }

  const reasonCodes: string[] = [];
  const bindDefaultProfile = async (
    agentProfileId: string
  ): Promise<MemberAgentSyncResult["binding"]> => {
    try {
      const written = await input.deps.writeDefaultBinding({
        agentProfileId,
        target: selectBindingTarget(input.candidates),
      });
      reasonCodes.push(...written.reasonCodes);
      return written.status === "accepted" ? "succeeded" : "rejected";
    } catch (error) {
      reasonCodes.push(readErrorCode(error, "member_agent.binding_failed"));
      return "failed";
    }
  };

  const ensured = await ensureMemberAgent({
    bindDefaultProfile,
    deps: input.deps,
    existing: input.existing,
    harnessKind: input.harnessKind,
    reasonCodes,
  });
  if (!ensured.ok) {
    return { ...base, outcome: "skipped", reasonCodes: [ensured.code] };
  }
  const { created, memberAgent } = ensured;
  let { binding } = ensured;
  const defaultProfileId = memberAgent.defaultProfileId;
  const identified = {
    ...base,
    defaultProfileId,
    memberAgentId: memberAgent.id,
  };
  // Only a detected MemberAgent's default Profile is set up here. A
  // migrated or manual one keeps whatever Binding its owner chose.
  if (binding === "not_attempted") {
    const unchanged = {
      ...identified,
      outcome: created ? "created" : "unchanged",
      reasonCodes: [...new Set(reasonCodes)],
    } satisfies MemberAgentSyncResult;
    if (
      memberAgent.source !== "detected" ||
      memberAgent.archivedAt !== null ||
      !defaultProfileId
    ) {
      return unchanged;
    }
    if (!(await input.deps.hasAnyBinding(defaultProfileId))) {
      binding = await bindDefaultProfile(defaultProfileId);
    } else if (!ensured.finishedCreation) {
      // A creation this call finished still opens the Direct Message, even
      // when an interrupted earlier call already wrote the Binding.
      return unchanged;
    }
  }

  const directMessage = defaultProfileId
    ? await openDirectMessage(input.deps, defaultProfileId, reasonCodes)
    : // The Direct Message waits for a default Profile; the next sync opens it.
      { directMessage: "not_attempted" as const, directMessageSpaceId: null };
  return {
    ...identified,
    ...directMessage,
    binding,
    outcome: created ? "created" : "completed",
    reasonCodes: [...new Set(reasonCodes)],
  };
}

// Ensures the MemberAgent through Auth when it is missing or its creation
// was interrupted. Auth never assigns the keyed default Profile itself: Core
// binds it, and the Binding write assigns it under the Profile's assignment
// lock. A Profile that already has a Binding is assigned through the same
// lock, which re-reads that Binding's Harness. Auth then sets the default
// only if the Profile landed under this MemberAgent.
async function ensureMemberAgent(input: {
  bindDefaultProfile: (
    agentProfileId: string
  ) => Promise<MemberAgentSyncResult["binding"]>;
  deps: MemberAgentSyncDeps;
  existing: MemberAgent | null;
  harnessKind: DetectedHarnessKind;
  reasonCodes: string[];
}): Promise<
  | {
      ok: true;
      binding: MemberAgentSyncResult["binding"];
      created: boolean;
      finishedCreation: boolean;
      memberAgent: MemberAgent;
    }
  | { ok: false; code: string }
> {
  if (input.existing && !isInterruptedDetectedCreation(input.existing)) {
    return {
      ok: true,
      binding: "not_attempted",
      created: false,
      finishedCreation: false,
      memberAgent: input.existing,
    };
  }
  const ensured = await input.deps.ensureDetectedMemberAgent(input.harnessKind);
  if (!ensured.ok) {
    return ensured;
  }
  let memberAgent = ensured.memberAgent;
  let binding: MemberAgentSyncResult["binding"] = "not_attempted";
  const candidateId = ensured.defaultProfileCandidateId;
  if (candidateId && isInterruptedDetectedCreation(memberAgent)) {
    if (await input.deps.hasAnyBinding(candidateId)) {
      await input.deps.assignBoundProfile(candidateId);
    } else {
      binding = await input.bindDefaultProfile(candidateId);
    }
    const finished = await input.deps.ensureDetectedMemberAgent(
      input.harnessKind
    );
    if (finished.ok) {
      memberAgent = finished.memberAgent;
    } else {
      input.reasonCodes.push(finished.code);
    }
  }
  return {
    ok: true,
    binding,
    created: ensured.created,
    finishedCreation: memberAgent.defaultProfileId !== null,
    memberAgent,
  };
}

async function openDirectMessage(
  deps: MemberAgentSyncDeps,
  agentProfileId: string,
  reasonCodes: string[]
): Promise<
  Pick<MemberAgentSyncResult, "directMessage" | "directMessageSpaceId">
> {
  try {
    const { spaceId } = await deps.openDirectMessage(agentProfileId);
    return { directMessage: "succeeded", directMessageSpaceId: spaceId };
  } catch (error) {
    reasonCodes.push(
      readErrorCode(error, "member_agent.direct_message_failed")
    );
    return { directMessage: "failed", directMessageSpaceId: null };
  }
}

// A shared-account Harness needs a provider conversation the owner chooses.
function requiresChosenConversation(harnessKind: DetectedHarnessKind) {
  return (
    resolveBuiltinAgentControllerConversationCapability(harnessKind)
      ?.conversationScope === "account_shared"
  );
}

// Prefer a computer whose report is ready now, then one whose report has
// not expired, then the newest report, so the Binding lands where the
// Harness can run.
function selectBindingTarget(
  candidates: readonly RuntimeHarness[]
): MemberAgentBindingTarget {
  const [target] = [...candidates].sort(
    (left, right) =>
      Number(right.reportReady) - Number(left.reportReady) ||
      Number(right.reportCurrent) - Number(left.reportCurrent) ||
      right.reportObservedAtMs - left.reportObservedAtMs ||
      left.openMeldServiceRuntimeId.localeCompare(
        right.openMeldServiceRuntimeId
      )
  );
  if (!target) {
    throw new Error("a detected Harness has no reporting computer");
  }
  return target;
}

function isInterruptedDetectedCreation(memberAgent: MemberAgent): boolean {
  return (
    memberAgent.source === "detected" &&
    memberAgent.defaultProfileId === null &&
    memberAgent.archivedAt === null
  );
}

function readErrorCode(error: unknown, fallback: string): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : null;
  return typeof code === "string" && code.trim() ? code : fallback;
}
