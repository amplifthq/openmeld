import { performance } from "node:perf_hooks";
import type {
  OpenMeldSpaceEgressAction,
  SpaceStatus,
} from "@openmeld/schemas/types";
import {
  assertNoRemovedCcSpaceAddressingSyntax,
  type SpaceMemberDirectorySendTargetEntry,
} from "@openmeld/space";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import {
  type DispatchSpaceActionContext,
  type DispatchSpaceActionRecord,
  type DispatchSpaceActionSendTargetReference,
  readDispatchSpaceActionContextFromEnv,
  writeDispatchSpaceActionRecord,
} from "../runtime/dispatch-space-action-context";
import { outLine } from "../ui/io";

type Relation = "wake" | "reference";

const FINAL_SAFE_STATUSES = new Set<SpaceStatus>([
  "blocked",
  "done",
  "handoff",
  "needs_input",
]);

const LEADING_AT_PATTERN = /^@/u;
const TRAILING_RELATION_PATTERN = /\((wake|reference)\)$/iu;
const WHITESPACE_PATTERN = /\s+/g;
const DISPATCH_ACTION_CLI_PLACEHOLDER = "<DISPATCH_ACTION_CLI>";
const SPACE_ACTION_REPLY_TIMING_EVENT = "openmeld.space_action.reply_timing";

export function runSpaceActionReply(input: {
  messageParts: readonly string[];
  referenceTargets?: readonly string[];
  wakeTargets?: readonly string[];
}): void {
  // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT dispatch-scoped-space-action
  // Local agents speak to Spaces through the dispatch-scoped Space Action CLI,
  // never by inventing ad hoc publication payloads.
  const timing = createSpaceActionReplyTiming();
  timing.emit("command_start", undefined, {
    messagePartCount: input.messageParts.length,
    referenceTargetCount: input.referenceTargets?.length ?? 0,
    wakeTargetCount: input.wakeTargets?.length ?? 0,
  });
  const context = readDispatchSpaceActionContextFromEnv();
  timing.emit("context_ready", context);
  assertAllowedAction(context, "post_message");
  const text = normalizeRequiredJoinedText(
    input.messageParts,
    "Reply message is required."
  );
  assertNoRemovedCcSpaceAddressingSyntax(text);
  const targetIds = resolveMessageEnvelopeTargetIds({
    context,
    wakeTargets: input.wakeTargets ?? [],
    referenceTargets: input.referenceTargets ?? [],
  });
  timing.emit("targets_resolved", context, {
    activationTargetCount: targetIds.activationTargets.length,
    messageLength: text.length,
    referenceTargetCount: targetIds.referenceTargets.length,
  });
  const action: OpenMeldSpaceEgressAction = {
    type: "post_message",
    messageEnvelope: {
      activationTargets: targetIds.activationTargets,
      referenceTargets: targetIds.referenceTargets,
      ...(context.replyToSignalId
        ? { replyToSignalId: context.replyToSignalId }
        : {}),
      text,
    },
  };
  const record = recordAction({ action, command: "reply", context });
  timing.emit("record_written", context, {
    actionType: record.action.type,
  });
  timing.emit("done", context, {
    actionType: record.action.type,
  });
}

export function runSpaceActionWake(input: {
  messageParts: readonly string[];
  target: string;
}): void {
  const context = readDispatchSpaceActionContextFromEnv();
  assertAllowedAction(context, "post_message");
  const text = normalizeRequiredJoinedText(
    input.messageParts,
    "Wake handoff message is required."
  );
  assertNoRemovedCcSpaceAddressingSyntax(text);
  const action: OpenMeldSpaceEgressAction = {
    type: "post_message",
    messageEnvelope: {
      activationTargets: resolveTargetProfileIds({
        context,
        relation: "wake",
        targets: [input.target],
      }),
      referenceTargets: [],
      ...(context.replyToSignalId
        ? { replyToSignalId: context.replyToSignalId }
        : {}),
      text,
    },
  };
  recordAction({ action, command: "wake", context });
}

export function runSpaceActionStatus(input: {
  status: string;
  textParts: readonly string[];
}): void {
  const context = readDispatchSpaceActionContextFromEnv();
  assertAllowedAction(context, "post_status");
  const status = normalizeStatus(input.status);
  const text = normalizeRequiredJoinedText(
    input.textParts,
    "Status text is required."
  );
  const action: OpenMeldSpaceEgressAction = {
    type: "post_status",
    status,
    text,
  };
  recordAction({ action, command: "status", context });
}

export function runSpaceActionSilent(input: { reason?: string | null }): void {
  const context = readDispatchSpaceActionContextFromEnv();
  assertAllowedAction(context, "stay_silent");
  const reason = normalizeRequiredText(
    input.reason,
    "A silent action requires --reason."
  );
  const action: OpenMeldSpaceEgressAction = {
    type: "stay_silent",
    reason,
  };
  recordAction({ action, command: "silent", context });
}

export function runSpaceActionTargets(): void {
  const context = readDispatchSpaceActionContextFromEnv();
  const targetReference = requireLoadedTargets(context.sendTargetReference);
  const wakeTargets = targetReference.projection.filter(
    (target) => target.allowedRelations.wake
  );
  const referenceTargets = targetReference.projection.filter(
    (target) => target.allowedRelations.reference
  );

  outLine("Wake targets:");
  if (wakeTargets.length === 0) {
    outLine("- none");
  } else {
    for (const target of wakeTargets) {
      outLine(`- ${formatTargetLine(target, "wake")}`);
    }
  }

  outLine("");
  outLine("Reference targets:");
  if (referenceTargets.length === 0) {
    outLine("- none");
  } else {
    for (const target of referenceTargets) {
      outLine(`- ${formatTargetLine(target, "reference")}`);
    }
  }
}

export function runSpaceActionHelp(): void {
  let context: DispatchSpaceActionContext | null = null;
  try {
    context = readDispatchSpaceActionContextFromEnv();
  } catch {
    context = null;
  }

  outLine("OpenMeld Space Action commands:");
  outLine(formatSpaceActionHelpExample("Reply", 'reply "message"', context));
  outLine(
    formatSpaceActionHelpExample(
      "Handoff and wake another agent",
      'wake "@Agent Name" "summary and request"',
      context
    )
  );
  outLine(
    formatSpaceActionHelpExample(
      "Reply and also wake another agent",
      'reply --wake "@Agent Name" "message"',
      context
    )
  );
  outLine(
    formatSpaceActionHelpExample(
      "Reply and reference another profile",
      'reply --reference "@Agent Name" "message"',
      context
    )
  );
  outLine(
    formatSpaceActionHelpExample(
      "Final status",
      'status done "short completion update"',
      context
    )
  );
  outLine(
    formatSpaceActionHelpExample(
      "Stay silent",
      'silent --reason "No public reply is needed."',
      context
    )
  );
  outLine(formatSpaceActionHelpExample("Current targets", "targets", context));
  outLine(formatSpaceActionHelpExample("Help", "help", context));
  outLine("");
  outLine(
    "Run exactly one final action for the current Wake. OpenMeld posts the accepted action to the Space."
  );
  if (!context) {
    outLine("");
    outLine(
      `No active dispatch context was found. ${DISPATCH_ACTION_CLI_PLACEHOLDER} is a placeholder for the exact Space Action command prefix printed in an OpenMeld Space Wake dispatch prompt.`
    );
    outLine(
      "Write actions and targets require an active OpenMeld Space Wake dispatch. Do not guess the command prefix or rewrite it to npx."
    );
    return;
  }
  outLine("");
  outLine(`Active dispatch: ${context.dispatchId}`);
  outLine(`Current target profile: ${context.targetProfileId}`);
}

function formatSpaceActionHelpExample(
  label: string,
  action: string,
  context: DispatchSpaceActionContext | null
): string {
  return `- ${label}: ${formatSpaceActionHelpCommand(action, context)}`;
}

function formatSpaceActionHelpCommand(
  action: string,
  context: DispatchSpaceActionContext | null
): string {
  if (!context) {
    return `${DISPATCH_ACTION_CLI_PLACEHOLDER} space action ${action}`;
  }
  return formatOpenMeldCliCommand(`openmeld space action ${action}`);
}

function recordAction(input: {
  action: OpenMeldSpaceEgressAction;
  command: string;
  context: DispatchSpaceActionContext;
}): DispatchSpaceActionRecord {
  // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT action-record
  // The action record is local output for the active dispatch; final visibility
  // still belongs to RuntimeCoordinator finalization and Space publication.
  const record = writeDispatchSpaceActionRecord(input);
  outLine(
    `Action recorded: OpenMeld saved this unpublished Space action proposal (${record.action.type}) for the current Wake.`
  );
  return record;
}

type SpaceActionReplyTimingPhase =
  | "command_start"
  | "context_ready"
  | "targets_resolved"
  | "record_written"
  | "done";

function createSpaceActionReplyTiming(): {
  emit: (
    phase: SpaceActionReplyTimingPhase,
    context?: DispatchSpaceActionContext,
    fields?: Record<string, number | string>
  ) => void;
} {
  const startedAt = performance.now();
  let previousAt = startedAt;
  const commandStartProcessUptimeMs = Math.round(startedAt);
  return {
    emit: (phase, context, fields = {}) => {
      const now = performance.now();
      const elapsedMs = Math.max(0, Math.round(now - startedAt));
      const durationMs = Math.max(0, Math.round(now - previousAt));
      previousAt = now;
      process.stderr.write(
        `[${SPACE_ACTION_REPLY_TIMING_EVENT}] ${JSON.stringify({
          event: SPACE_ACTION_REPLY_TIMING_EVENT,
          phase,
          elapsedMs,
          durationMs,
          commandStartProcessUptimeMs,
          attemptId: context?.attemptId ?? null,
          dispatchId: context?.dispatchId ?? null,
          spaceId: context?.spaceId ?? null,
          targetProfileId: context?.targetProfileId ?? null,
          taskId: context?.taskId ?? null,
          ...fields,
        })}\n`
      );
    },
  };
}

function resolveMessageEnvelopeTargetIds(input: {
  context: DispatchSpaceActionContext;
  wakeTargets: readonly string[];
  referenceTargets: readonly string[];
}): {
  activationTargets: string[];
  referenceTargets: string[];
} {
  const targets = {
    activationTargets: resolveTargetProfileIds({
      context: input.context,
      relation: "wake",
      targets: input.wakeTargets,
    }),
    referenceTargets: resolveTargetProfileIds({
      context: input.context,
      relation: "reference",
      targets: input.referenceTargets,
    }),
  };
  assertDistinctMessageEnvelopeTargets(targets);
  return targets;
}

function assertDistinctMessageEnvelopeTargets(input: {
  activationTargets: readonly string[];
  referenceTargets: readonly string[];
}): void {
  const seen = new Map<string, Relation>();
  const relationTargets = [
    ["wake", input.activationTargets],
    ["reference", input.referenceTargets],
  ] as const;

  for (const [relation, profileIds] of relationTargets) {
    for (const profileId of profileIds) {
      const existingRelation = seen.get(profileId);
      if (!existingRelation) {
        seen.set(profileId, relation);
        continue;
      }
      if (existingRelation === relation) {
        throw new Error(
          `The same target (${profileId}) was listed more than once as ${formatRelation(
            relation
          )}. Choose it once, or send separate messages.`
        );
      }
      throw new Error(
        `The same target (${profileId}) cannot be both ${formatRelation(
          existingRelation
        )} and ${formatRelation(
          relation
        )} in one Space Action. Choose one relationship, or send separate messages.`
      );
    }
  }
}

function assertAllowedAction(
  context: DispatchSpaceActionContext,
  actionType: OpenMeldSpaceEgressAction["type"]
): void {
  const allowedActions = context.spaceContractSnapshot?.allowedActions ?? null;
  if (allowedActions && !allowedActions.includes(actionType)) {
    throw new Error(`This Space does not allow ${actionType}.`);
  }
}

function normalizeStatus(value: string): SpaceStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === "working") {
    throw new Error(
      "`working` would close the current Wake. Non-final progress updates are not supported by OpenMeld Space Action yet."
    );
  }
  if (
    normalized === "blocked" ||
    normalized === "done" ||
    normalized === "handoff" ||
    normalized === "needs_input"
  ) {
    return normalized;
  }
  if (!FINAL_SAFE_STATUSES.has(normalized as SpaceStatus)) {
    throw new Error(
      "Status must be one of: done, blocked, needs_input, handoff."
    );
  }
  return normalized as SpaceStatus;
}

function resolveTargetProfileIds(input: {
  context: DispatchSpaceActionContext;
  relation: Relation;
  targets: readonly string[];
}): string[] {
  return input.targets.map((target) =>
    resolveTargetProfileId({
      context: input.context,
      relation: input.relation,
      target,
    })
  );
}

function resolveTargetProfileId(input: {
  context: DispatchSpaceActionContext;
  relation: Relation;
  target: string;
}): string {
  const targetReference = requireLoadedTargets(
    input.context.sendTargetReference
  );
  const query = normalizeRequiredText(input.target, "Target is required.");
  const candidates = targetReference.projection.filter((target) =>
    targetMatchesQuery(target, query)
  );
  if (candidates.length === 0) {
    throw new Error(
      `No current Space target matches "${query}". Run \`${formatOpenMeldCliCommand(
        "openmeld space action targets"
      )}\` and choose a listed target.`
    );
  }
  const exactProfileId = candidates.find(
    (candidate) => candidate.profileId === query
  );
  const selected =
    exactProfileId ?? (candidates.length === 1 ? candidates[0] : null);
  if (!selected) {
    throw new Error(
      `Target "${query}" is ambiguous. Choose one of: ${candidates
        .map((candidate) => candidate.primaryMentionLabel)
        .join(", ")}.`
    );
  }
  if (!selected.allowedRelations[input.relation]) {
    throw new Error(
      `${formatRelation(input.relation)} is not allowed for ${selected.primaryMentionLabel}.`
    );
  }
  return selected.profileId;
}

function requireLoadedTargets(
  targetReference: DispatchSpaceActionSendTargetReference
): Extract<DispatchSpaceActionSendTargetReference, { status: "loaded" }> {
  if (targetReference.status === "loaded") {
    return targetReference;
  }
  throw new Error(
    `Current Space targets are not available for this dispatch: ${targetReference.errorMessage}`
  );
}

function targetMatchesQuery(
  target: SpaceMemberDirectorySendTargetEntry,
  query: string
): boolean {
  const normalizedQuery = normalizeTargetQuery(query);
  const candidates = [
    target.profileId,
    target.profileIdShort,
    target.primaryMentionLabel,
    `@${target.primaryMentionLabel}`,
    target.mentionAlias,
    ...(target.mentionLabels ?? []),
    ...(target.lookupTokens ?? []),
  ];
  return candidates.some(
    (candidate) =>
      candidate !== null &&
      candidate !== undefined &&
      normalizeTargetQuery(candidate) === normalizedQuery
  );
}

function normalizeTargetQuery(value: string): string {
  return value
    .trim()
    .replace(LEADING_AT_PATTERN, "")
    .replace(TRAILING_RELATION_PATTERN, "")
    .replace(WHITESPACE_PATTERN, " ")
    .toLowerCase();
}

function formatTargetLine(
  target: SpaceMemberDirectorySendTargetEntry,
  relation: Relation
): string {
  const relationLabel = formatRelation(relation);
  return `${target.primaryMentionLabel} · ${target.profileKind} · ${relationLabel} · ${target.profileId}`;
}

function formatRelation(relation: Relation): string {
  switch (relation) {
    case "wake":
      return "Wake";
    case "reference":
      return "Reference";
    default:
      return relation;
  }
}

function normalizeRequiredJoinedText(
  parts: readonly string[],
  errorMessage: string
): string {
  return normalizeRequiredText(parts.join(" "), errorMessage);
}

function normalizeRequiredText(
  value: string | null | undefined,
  errorMessage: string
): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length === 0) {
    throw new Error(errorMessage);
  }
  return normalized;
}
