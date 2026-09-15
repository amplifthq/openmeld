import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type {
  OpenMeldSpaceEgressAction,
  SpaceStatus,
} from "@openmeld/schemas/types";
import type { SpaceMemberDirectorySendTargetEntry } from "@openmeld/space";
import { resolveBaseUrl } from "../config/base-url";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { requireOpenMeldProfile } from "../config/resolve-openmeld-profile";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import {
  type DispatchSpaceActionContext,
  type DispatchSpaceActionRecord,
  type DispatchSpaceActionSendTargetReference,
  readDispatchSpaceActionContextForReceiptFromEnv,
  readDispatchSpaceActionContextFromEnv,
  writeDispatchSpaceActionRecord,
} from "../runtime/dispatch-space-action-context";
import { outLine } from "../ui/io";
import { createCliSpaceApi } from "./cli-space-api";
import {
  prepareRequestedSpaceSendFiles,
  uploadPreparedSpaceFiles,
} from "./send-files";

type Relation = "wake" | "reference" | "mention";

const FINAL_SAFE_STATUSES = new Set<SpaceStatus>([
  "blocked",
  "done",
  "handoff",
  "needs_input",
]);

const DISPATCH_ACTION_CLI_PLACEHOLDER = "<DISPATCH_ACTION_CLI>";
const SPACE_ACTION_REPLY_TIMING_EVENT = "openmeld.space_action.reply_timing";

export function runSpaceActionReply(input: {
  filePaths?: readonly string[];
  messageFilePath?: string;
  messageParts: readonly string[];
  mentionTargets?: readonly string[];
  referenceTargets?: readonly string[];
  wakeTargets?: readonly string[];
}): void | Promise<void> {
  const text = resolveReplyMessageText(input);
  const result = recordDispatchSpaceReply({
    filePaths: input.filePaths,
    messagePartCount: input.messageParts.length,
    mentionTargets: input.mentionTargets,
    referenceTargets: input.referenceTargets,
    text,
    wakeTargets: input.wakeTargets,
  });
  if (result instanceof Promise) {
    return result.then((record) => {
      emitActionRecorded(record);
    });
  }
  emitActionRecorded(result);
}

export function recordDispatchSpaceReply(input: {
  filePaths?: readonly string[];
  messagePartCount?: number;
  mentionTargets?: readonly string[];
  referenceTargets?: readonly string[];
  text: string;
  wakeTargets?: readonly string[];
}): DispatchSpaceActionRecord | Promise<DispatchSpaceActionRecord> {
  // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT dispatch-scoped-space-action
  // Every local-agent transport records the same dispatch-scoped Space Action;
  // no transport may invent an ad hoc publication payload.
  const timing = createSpaceActionReplyTiming();
  timing.emit("command_start", undefined, {
    messagePartCount: input.messagePartCount ?? 0,
    mentionTargetCount: input.mentionTargets?.length ?? 0,
    referenceTargetCount: input.referenceTargets?.length ?? 0,
    wakeTargetCount: input.wakeTargets?.length ?? 0,
  });
  const filePaths = input.filePaths ?? [];
  // Uploading a file is a new effect. Expired contexts may recover an exact
  // already-recorded action, but never perform an upload to reconstruct one.
  const context =
    filePaths.length > 0
      ? readDispatchSpaceActionContextFromEnv()
      : readDispatchSpaceActionContextForReceiptFromEnv();
  timing.emit("context_ready", context);
  assertAllowedAction(context, "post_message");
  const text = normalizeRequiredText(input.text, "Reply message is required.");
  const targetIds = resolveMessageEnvelopeTargetIds({
    context,
    mentionTargets: input.mentionTargets ?? [],
    wakeTargets: input.wakeTargets ?? [],
    referenceTargets: input.referenceTargets ?? [],
  });
  timing.emit("targets_resolved", context, {
    activationTargetCount: targetIds.activationTargets.length,
    messageLength: text.length,
    mentionTargetCount: targetIds.mentionTargets.length,
    referenceTargetCount: targetIds.referenceTargets.length,
  });
  if (filePaths.length === 0) {
    return writeSpaceActionReplyRecord({
      context,
      files: [],
      targetIds,
      text,
      timing,
    });
  }
  return uploadAndRecordSpaceActionReply({
    context,
    filePaths,
    targetIds,
    text,
    timing,
  });
}

function resolveReplyMessageText(input: {
  messageFilePath?: string;
  messageParts: readonly string[];
}): string {
  const hasInlineMessage = input.messageParts.length > 0;
  const messageFilePath = input.messageFilePath?.trim();
  if (hasInlineMessage && messageFilePath) {
    throw new Error(
      "Choose either a reply message or --message-file, not both."
    );
  }
  if (!messageFilePath) {
    return normalizeRequiredJoinedText(
      input.messageParts,
      "Reply message is required."
    );
  }
  const message = readFileSync(messageFilePath === "-" ? 0 : messageFilePath, {
    encoding: "utf8",
  });
  return normalizeRequiredText(message, "Reply message is required.");
}

async function uploadAndRecordSpaceActionReply(input: {
  context: DispatchSpaceActionContext;
  filePaths: readonly string[];
  targetIds: {
    activationTargets: string[];
    mentionTargets: string[];
    referenceTargets: string[];
  };
  text: string;
  timing: ReturnType<typeof createSpaceActionReplyTiming>;
}): Promise<DispatchSpaceActionRecord> {
  const files = await uploadSpaceActionReplyFiles({
    context: input.context,
    filePaths: input.filePaths,
  });
  return writeSpaceActionReplyRecord({ ...input, files });
}

function writeSpaceActionReplyRecord(input: {
  context: DispatchSpaceActionContext;
  files: Awaited<ReturnType<typeof uploadSpaceActionReplyFiles>>;
  targetIds: {
    activationTargets: string[];
    mentionTargets: string[];
    referenceTargets: string[];
  };
  text: string;
  timing: ReturnType<typeof createSpaceActionReplyTiming>;
}): DispatchSpaceActionRecord {
  const action: OpenMeldSpaceEgressAction = {
    type: "post_message",
    ...(input.files.length > 0 ? { files: [...input.files] } : {}),
    messageEnvelope: {
      activationTargets: input.targetIds.activationTargets,
      mentionTargets: input.targetIds.mentionTargets,
      referenceTargets: input.targetIds.referenceTargets,
      ...(input.context.replyToSignalId
        ? { replyToSignalId: input.context.replyToSignalId }
        : {}),
      text: input.text,
    },
  };
  const record = recordAction({
    action,
    command: "reply",
    context: input.context,
  });
  input.timing.emit("record_written", input.context, {
    actionType: record.action.type,
  });
  input.timing.emit("done", input.context, {
    actionType: record.action.type,
  });
  return record;
}

async function uploadSpaceActionReplyFiles(input: {
  context: DispatchSpaceActionContext;
  filePaths: readonly string[];
}) {
  const prepared = await prepareRequestedSpaceSendFiles({
    filePaths: input.filePaths,
  });
  if (prepared.length === 0) {
    return [];
  }
  const openMeldProfile = await requireOpenMeldProfile({
    openMeldProfileId: input.context.targetProfileId,
    persistSelection: false,
    authAction: "sharing files in a Space reply",
  });
  return await uploadPreparedSpaceFiles({
    files: prepared,
    requestContext: buildOpenMeldRequestContextFromProfile({ openMeldProfile }),
    spaceApi: createCliSpaceApi(await resolveBaseUrl()),
    spaceId: input.context.spaceId,
  });
}

export function runSpaceActionWake(input: {
  messageParts: readonly string[];
  target: string;
}): void {
  const context = readDispatchSpaceActionContextForReceiptFromEnv();
  assertAllowedAction(context, "post_message");
  const text = normalizeRequiredJoinedText(
    input.messageParts,
    "Wake handoff message is required."
  );
  const action: OpenMeldSpaceEgressAction = {
    type: "post_message",
    messageEnvelope: {
      activationTargets: resolveTargetProfileIds({
        context,
        relation: "wake",
        targets: [input.target],
      }),
      mentionTargets: [],
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
  const record = recordDispatchSpaceStatus({
    status: input.status,
    text: normalizeRequiredJoinedText(
      input.textParts,
      "Status text is required."
    ),
  });
  emitActionRecorded(record);
}

export function recordDispatchSpaceStatus(input: {
  status: string;
  text: string;
}): DispatchSpaceActionRecord {
  const context = readDispatchSpaceActionContextForReceiptFromEnv();
  assertAllowedAction(context, "post_status");
  const status = normalizeStatus(input.status);
  const text = normalizeRequiredText(input.text, "Status text is required.");
  const action: OpenMeldSpaceEgressAction = {
    type: "post_status",
    status,
    text,
  };
  return recordAction({ action, command: "status", context });
}

export function runSpaceActionSilent(input: { reason?: string | null }): void {
  const record = recordDispatchSpaceSilent(input);
  emitActionRecorded(record);
}

export function recordDispatchSpaceSilent(input: {
  reason?: string | null;
}): DispatchSpaceActionRecord {
  const context = readDispatchSpaceActionContextForReceiptFromEnv();
  assertAllowedAction(context, "stay_silent");
  const reason = normalizeRequiredText(
    input.reason,
    "A silent action requires --reason."
  );
  const action: OpenMeldSpaceEgressAction = {
    type: "stay_silent",
    reason,
  };
  return recordAction({ action, command: "silent", context });
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
  const mentionTargets = targetReference.projection.filter(
    (target) => target.allowedRelations.mention
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
  outLine("Mention targets:");
  if (mentionTargets.length === 0) {
    outLine("- none");
  } else {
    for (const target of mentionTargets) {
      outLine(`- ${formatTargetLine(target, "mention")}`);
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
      'wake <agent-profile-id> "summary and request"',
      context
    )
  );
  outLine(
    formatSpaceActionHelpExample(
      "Reply and also wake another agent",
      'reply --wake <agent-profile-id> "message"',
      context
    )
  );
  outLine(
    formatSpaceActionHelpExample(
      "Reply and reference another agent",
      'reply --reference <agent-profile-id> "message"',
      context
    )
  );
  outLine(
    formatSpaceActionHelpExample(
      "Reply and mention a person",
      'reply --mention <human-profile-id> "message"',
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
  return writeDispatchSpaceActionRecord(input);
}

function emitActionRecorded(record: DispatchSpaceActionRecord): void {
  outLine(
    `Action recorded: OpenMeld saved this unpublished Space action proposal (${record.action.type}) for the current Wake.`
  );
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
  mentionTargets: readonly string[];
  wakeTargets: readonly string[];
  referenceTargets: readonly string[];
}): {
  activationTargets: string[];
  mentionTargets: string[];
  referenceTargets: string[];
} {
  const targets = {
    activationTargets: resolveTargetProfileIds({
      context: input.context,
      relation: "wake",
      targets: input.wakeTargets,
    }),
    mentionTargets: resolveTargetProfileIds({
      context: input.context,
      relation: "mention",
      targets: input.mentionTargets,
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
  mentionTargets: readonly string[];
  referenceTargets: readonly string[];
}): void {
  const seen = new Map<string, Relation>();
  const relationTargets = [
    ["wake", input.activationTargets],
    ["reference", input.referenceTargets],
    ["mention", input.mentionTargets],
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
  return [...new Set(input.targets)].map((target) =>
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
  const selected = targetReference.projection.find(
    (target) => target.profileId === query
  );
  if (!selected) {
    throw new Error(
      `No current Space target has Profile ID "${query}". Run openmeld space action targets and use the full Profile ID.`
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
