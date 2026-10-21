import { resolvePermissionModeAdvisorSuggestion } from "@openmeld/agent-runtime";
import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { PermissionModeAdvisory } from "@openmeld/schemas";
import {
  buildAgentTaskKey,
  PERMISSION_MODE_ADVISOR_TOP_REQUESTER_LIMIT,
  permissionModeAdvisorySchema,
} from "@openmeld/schemas";
import { isRequestChainEnforced } from "../../member-agent/member-agents-feature";
import {
  claimPermissionModeAdvisory,
  listPermissionInteractionTaskKeys,
  listRecentPermissionAdvisorExecutions,
  type PermissionAdvisorExecution,
  readPermissionAdvisorRequesterProfiles,
  readPermissionModeAdvisoryRow,
} from "../infrastructure/postgresql/permission-mode-advisor-repo";

// Contract: developing/product/organizations-and-center-agent.md
// (Permission-mode advisor).
const DAY_MS = 24 * 60 * 60 * 1000;
export const PERMISSION_MODE_ADVISOR_WINDOW_MS = 7 * DAY_MS;
export const PERMISSION_MODE_ADVISOR_COOLDOWN_MS = 7 * DAY_MS;
export const PERMISSION_MODE_ADVISOR_THRESHOLD = 3;
// An execution created before the window can still raise a question inside
// it; the interaction time decides, this margin only bounds the scan.
const EXECUTION_SCAN_MARGIN_MS = DAY_MS;

/**
 * The requester whose ownership decides whether a waiting approval counts:
 * the request chain's root once the chain is enforced. Before that, and for
 * Wakes admitted before Core recorded chains, the one-hop requester (the
 * Wake message author recorded in the Dispatch Ledger).
 */
export function resolvePermissionAdvisorRequesterProfileId(
  execution: Pick<
    PermissionAdvisorExecution,
    "oneHopRequesterProfileId" | "rootRequesterProfileId"
  >
): string {
  return isRequestChainEnforced()
    ? (execution.rootRequesterProfileId ?? execution.oneHopRequesterProfileId)
    : execution.oneHopRequesterProfileId;
}

export type PermissionModeAdvisorSignal = {
  topRequesterNames: string[];
  waitingApprovalCount: number;
};

export type PermissionModeAdvisorRepo = {
  claim: typeof claimPermissionModeAdvisory;
  listExecutions: typeof listRecentPermissionAdvisorExecutions;
  listPermissionInteractions: typeof listPermissionInteractionTaskKeys;
  readAdvisory: typeof readPermissionModeAdvisoryRow;
  readRequesterProfiles: typeof readPermissionAdvisorRequesterProfiles;
};

const defaultRepo: PermissionModeAdvisorRepo = {
  claim: claimPermissionModeAdvisory,
  listExecutions: listRecentPermissionAdvisorExecutions,
  listPermissionInteractions: listPermissionInteractionTaskKeys,
  readAdvisory: readPermissionModeAdvisoryRow,
  readRequesterProfiles: readPermissionAdvisorRequesterProfiles,
};

/**
 * Counts permission questions raised in the window by this Profile's tasks
 * whose requester is not owned by the Binding owner. Requesters without a
 * known owner are not counted, so the advisor never over-reports.
 */
export async function readPermissionModeAdvisorSignal(input: {
  agentProfileId: string;
  db: PostgresDatabase;
  nowMs: number;
  ownerUserId: string;
  repo?: PermissionModeAdvisorRepo;
}): Promise<PermissionModeAdvisorSignal> {
  const repo = input.repo ?? defaultRepo;
  const windowStartMs = input.nowMs - PERMISSION_MODE_ADVISOR_WINDOW_MS;
  const executions = await repo.listExecutions({
    agentProfileId: input.agentProfileId,
    db: input.db,
    updatedSinceMs: windowStartMs - EXECUTION_SCAN_MARGIN_MS,
  });
  const profiles = await repo.readRequesterProfiles({
    db: input.db,
    profileIds: executions.map(resolvePermissionAdvisorRequesterProfileId),
  });
  const requesterByTaskKey = new Map<string, string>();
  const nonOwnerTasks: {
    sourceClientMessageId: string;
    spaceId: string;
    targetProfileId: string;
  }[] = [];
  for (const execution of executions) {
    const requesterProfileId =
      resolvePermissionAdvisorRequesterProfileId(execution);
    const owner = profiles.get(requesterProfileId)?.ownerUserId ?? null;
    if (owner === null || owner === input.ownerUserId) {
      continue;
    }
    const task = {
      sourceClientMessageId: execution.sourceClientMessageId,
      spaceId: execution.spaceId,
      targetProfileId: input.agentProfileId,
    };
    requesterByTaskKey.set(
      buildAgentTaskKey({ kind: "space_wake", v: 1, ...task }),
      requesterProfileId
    );
    nonOwnerTasks.push(task);
  }
  if (nonOwnerTasks.length === 0) {
    return { topRequesterNames: [], waitingApprovalCount: 0 };
  }
  const interactions = await repo.listPermissionInteractions({
    db: input.db,
    occurredSinceMs: windowStartMs,
    tasks: nonOwnerTasks,
  });
  const countByRequester = new Map<string, number>();
  const counted = new Set<string>();
  for (const interaction of interactions) {
    const requesterProfileId = requesterByTaskKey.get(interaction.taskKey);
    const identity = `${interaction.taskKey}\n${interaction.eventId}`;
    if (!requesterProfileId || counted.has(identity)) {
      continue;
    }
    counted.add(identity);
    countByRequester.set(
      requesterProfileId,
      (countByRequester.get(requesterProfileId) ?? 0) + 1
    );
  }
  const topRequesterNames = [...countByRequester.entries()]
    .sort(
      ([leftId, leftCount], [rightId, rightCount]) =>
        rightCount - leftCount || leftId.localeCompare(rightId)
    )
    .slice(0, PERMISSION_MODE_ADVISOR_TOP_REQUESTER_LIMIT)
    .map(([profileId]) => profiles.get(profileId)?.profileName.trim() ?? "")
    .filter((name) => name.length > 0);
  return { topRequesterNames, waitingApprovalCount: counted.size };
}

/**
 * Returns the advisory for an owner-requested Wake, or null. Any Wake whose
 * requester Core did not verify as the owner gets null before any read. A
 * returned advisory is already recorded as this week's one suggestion; a
 * redelivery of the same dispatch receives the same advisory again.
 */
export async function resolvePermissionModeAdvisoryForDispatch(input: {
  agentControllerRef: string | null;
  agentProfileId: string;
  db: PostgresDatabase;
  dispatchId: string;
  nowMs: number;
  organizationId: string;
  ownerUserId: string;
  repo?: PermissionModeAdvisorRepo;
  requesterIsAgentOwner: boolean | undefined;
  savedPermissionMode: string | null | undefined;
  suggestionId?: string;
}): Promise<PermissionModeAdvisory | null> {
  if (input.requesterIsAgentOwner !== true) {
    return null;
  }
  const suggestion = resolvePermissionModeAdvisorSuggestion({
    agentControllerRef: input.agentControllerRef,
    savedPermissionMode: input.savedPermissionMode,
  });
  if (!suggestion) {
    return null;
  }
  const repo = input.repo ?? defaultRepo;
  const existing = await repo.readAdvisory({
    agentProfileId: input.agentProfileId,
    db: input.db,
  });
  if (existing?.suggestedDispatchId === input.dispatchId) {
    const replay = permissionModeAdvisorySchema.safeParse(
      JSON.parse(existing.advisoryJson)
    );
    return replay.success ? replay.data : null;
  }
  const cooldownCutoffMs = input.nowMs - PERMISSION_MODE_ADVISOR_COOLDOWN_MS;
  if (existing && existing.lastSuggestedAtMs > cooldownCutoffMs) {
    return null;
  }
  const signal = await readPermissionModeAdvisorSignal({
    agentProfileId: input.agentProfileId,
    db: input.db,
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    repo,
  });
  if (signal.waitingApprovalCount < PERMISSION_MODE_ADVISOR_THRESHOLD) {
    return null;
  }
  const advisory = permissionModeAdvisorySchema.parse({
    currentPermissionMode: suggestion.currentPermissionMode,
    currentPermissionModeLabel: suggestion.currentPermissionModeLabel,
    suggestedPermissionMode: suggestion.suggestedPermissionMode,
    suggestedPermissionModeLabel: suggestion.suggestedPermissionModeLabel,
    topRequesterNames: signal.topRequesterNames,
    waitingApprovalCount: signal.waitingApprovalCount,
    windowDays: 7,
  });
  const claimed = await repo.claim({
    advisoryJson: JSON.stringify(advisory),
    agentProfileId: input.agentProfileId,
    cooldownCutoffMs,
    currentPermissionMode: advisory.currentPermissionMode,
    db: input.db,
    dispatchId: input.dispatchId,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
    suggestedPermissionMode: advisory.suggestedPermissionMode,
    suggestionId: input.suggestionId ?? crypto.randomUUID(),
    waitingApprovalCount: advisory.waitingApprovalCount,
  });
  return claimed ? advisory : null;
}
