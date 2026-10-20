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
  // Puts a bound Profile under the MemberAgent of its Binding's Harness.
  assignBoundProfile: (input: {
    agentControllerRef: string;
    agentProfileId: string;
  }) => Promise<AssignAgentProfileMemberAgentOutcome | null>;
  ensureDetectedMemberAgent: (
    harnessKind: DetectedHarnessKind
  ) => Promise<EnsureDetectedMemberAgentRpcResult>;
  // Any Binding row, enabled or disabled: an owner who disabled the default
  // Profile's Binding keeps that choice.
  hasAnyBinding: (agentProfileId: string) => Promise<boolean>;
  listOwnerMemberAgents: () => Promise<ListMemberAgentsResponse>;
  listRuntimeHarnesses: () => Promise<readonly RuntimeHarness[]>;
  openDirectMessage: (agentProfileId: string) => Promise<{ spaceId: string }>;
  readEnabledControllerRef: (agentProfileId: string) => Promise<string | null>;
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
 * §4.5). For each builtin Harness detected now with no MemberAgent, ask Auth
 * to ensure the MemberAgent and its default Profile, then write that
 * Profile's Binding to one of the reporting computers and open the owner's
 * Direct Message with it. A second computer with the same Harness adds
 * nothing. Hosted and custom controllers never appear in the catalog.
 */
export type MemberAgentSyncReport = {
  // Unassigned Profiles this call put under their Harness's MemberAgent.
  assignedProfileIds: string[];
  results: MemberAgentSyncResult[];
};

export async function syncMemberAgents(
  deps: MemberAgentSyncDeps
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
  if (byHarnessKind.size === 0) {
    return { assignedProfileIds: [], results: [] };
  }
  const listing = await deps.listOwnerMemberAgents();
  const results: MemberAgentSyncResult[] = [];
  for (const [harnessKind, candidates] of [...byHarnessKind].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    results.push(
      await syncHarness({
        candidates,
        deps,
        existing:
          listing.memberAgents.find(
            (memberAgent) => memberAgent.harnessKind === harnessKind
          ) ?? null,
        harnessKind,
      })
    );
  }
  return {
    assignedProfileIds: await assignUnassignedBoundProfiles(deps, listing),
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
    const agentControllerRef = await deps.readEnabledControllerRef(
      profile.openMeldProfileId
    );
    const harnessKind = harnessKindFromAgentControllerRef(agentControllerRef);
    if (
      agentControllerRef &&
      harnessKind &&
      harnessKinds.has(harnessKind) &&
      (await deps.assignBoundProfile({
        agentControllerRef,
        agentProfileId: profile.openMeldProfileId,
      })) === "assigned"
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
  if (
    resolveBuiltinAgentControllerConversationCapability(input.harnessKind)
      ?.conversationScope === "account_shared"
  ) {
    return {
      ...base,
      outcome: "skipped",
      reasonCodes: [MEMBER_AGENT_SYNC_CONVERSATION_REQUIRED_REASON],
    };
  }

  let memberAgent = input.existing;
  let created = false;
  if (!memberAgent || isInterruptedDetectedCreation(memberAgent)) {
    const ensured = await input.deps.ensureDetectedMemberAgent(
      input.harnessKind
    );
    if (!ensured.ok) {
      return { ...base, outcome: "skipped", reasonCodes: [ensured.code] };
    }
    memberAgent = ensured.memberAgent;
    created = ensured.created;
  }
  const defaultProfileId = memberAgent.defaultProfileId;
  const identified = {
    ...base,
    defaultProfileId,
    memberAgentId: memberAgent.id,
  };
  // Only a detected MemberAgent's default Profile is set up here. A
  // migrated or manual one keeps whatever Binding its owner chose.
  if (
    memberAgent.source !== "detected" ||
    memberAgent.archivedAt !== null ||
    !defaultProfileId ||
    (await input.deps.hasAnyBinding(defaultProfileId))
  ) {
    return { ...identified, outcome: created ? "created" : "unchanged" };
  }

  const target = selectBindingTarget(input.candidates);
  const reasonCodes: string[] = [];
  let binding: MemberAgentSyncResult["binding"] = "failed";
  try {
    const written = await input.deps.writeDefaultBinding({
      agentProfileId: defaultProfileId,
      target,
    });
    binding = written.status === "accepted" ? "succeeded" : "rejected";
    reasonCodes.push(...written.reasonCodes);
  } catch (error) {
    reasonCodes.push(readErrorCode(error, "member_agent.binding_failed"));
  }
  let directMessage: MemberAgentSyncResult["directMessage"] = "failed";
  let directMessageSpaceId: string | null = null;
  try {
    directMessageSpaceId = (
      await input.deps.openDirectMessage(defaultProfileId)
    ).spaceId;
    directMessage = "succeeded";
  } catch (error) {
    reasonCodes.push(
      readErrorCode(error, "member_agent.direct_message_failed")
    );
  }
  return {
    ...identified,
    binding,
    directMessage,
    directMessageSpaceId,
    outcome: created ? "created" : "completed",
    reasonCodes: [...new Set(reasonCodes)],
  };
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
