import type {
  SignalEnvelope,
  SignalStatusEnvelope,
  SignalSystemNoticeEnvelope,
  SignalTextEnvelope,
} from "@openmeld/protocol";
import {
  isProjectLocalConnectionFailureReasonCode,
  MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH,
  normalizeMessageEnvelope,
} from "@openmeld/schemas";
import type {
  DispatchResult,
  MessageEnvelope,
  OpenMeldDaemonDispatchQueueMessage,
  OpenMeldDaemonTaskResultPayload,
  OpenMeldSpaceEgressAction,
  ResultArchiveMode,
  SpaceAllowedAction,
  SpaceMessageFileReference,
  SpaceStatus,
  SpaceThreadContext,
} from "@openmeld/schemas/types";
import {
  buildDefaultSpaceContract,
  buildSystemNoticeText,
  resolvePublicAgentFailureReason,
  resolveResultArchiveBehavior,
  resolveSpacePublicationRequirement,
} from "@openmeld/space-mesh";

export type DispatchPublicationPlan =
  | {
      archiveMode: ResultArchiveMode;
      blockedExplicitAction: boolean;
      kind: "message";
      messageEnvelope: MessageEnvelope;
      files?: SpaceMessageFileReference[];
      observedThroughSignalId?: string | null;
      publicOutcome: "post_message" | "raw_context_sharing";
      shouldArchive: boolean;
      text: string;
    }
  | {
      archiveMode: ResultArchiveMode;
      blockedExplicitAction: boolean;
      kind: "status";
      publicOutcome: "post_status";
      shouldArchive: boolean;
      status: SpaceStatus;
      targetProfileId: string | null;
      text: string;
    }
  | {
      archiveMode: ResultArchiveMode;
      blockedExplicitAction: boolean;
      kind: "system_notice";
      noticeType: "policy_blocked" | "stay_silent" | "terminal_failure";
      publicOutcome: "stay_silent" | "system_notice";
      reason: string | null;
      // Machine-readable public failure code for the signal's structured
      // `reasonCode` field. Present only when the failed payload carried an
      // errorCode; never raw provider text.
      reasonCode: string | null;
      shouldArchive: boolean;
      text: string;
    }
  | {
      archiveMode: ResultArchiveMode;
      blockedExplicitAction: boolean;
      kind: "none";
      publicOutcome: "internal_only";
      shouldArchive: boolean;
    };

type DispatchPublicationPayload = {
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
  partialReason?: string | undefined;
  spaceAction?: OpenMeldSpaceEgressAction | undefined;
  spaceActionFailureDiagnostics?:
    | OpenMeldDaemonTaskResultPayload["spaceActionFailureDiagnostics"]
    | undefined;
  spaceActionProvenance?: OpenMeldDaemonTaskResultPayload["spaceActionProvenance"];
  status: OpenMeldDaemonTaskResultPayload["status"];
  suppressPublicOutcome?: boolean | undefined;
};

export function buildDispatchResultRef(dispatchId: string): string {
  return `dispatch-result:${dispatchId}`;
}

export function resolveDispatchPublicationPlan(input: {
  actorName?: string | null;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  payload: DispatchPublicationPayload;
  replyText: string | null;
  targetProfileName?: string | null;
}): DispatchPublicationPlan {
  const spaceContract =
    input.dispatchMessage.spaceContractSnapshot ?? buildDefaultSpaceContract();
  const publicationRequirement =
    resolveSpacePublicationRequirement(spaceContract);
  const actorName = resolvePublicationActorName(input);
  const explicitAction = resolveExplicitActionDecision({
    action: input.payload.spaceAction,
    allowedActions: spaceContract.allowedActions,
  });
  const archiveBehavior = resolveResultArchiveBehavior({
    contractMode: spaceContract.resultArchivePolicy.mode,
    saveResult:
      explicitAction.kind === "allowed"
        ? explicitAction.action?.saveResult
        : undefined,
  });

  let plan: DispatchPublicationPlan;
  if (explicitAction.kind === "blocked") {
    plan = buildSystemNoticePlan({
      actorName,
      noticeType: "policy_blocked",
      publicOutcome: "system_notice",
      reason: `This room does not allow ${explicitAction.actionType}.`,
    });
  } else if (explicitAction.kind === "allowed" && explicitAction.action) {
    plan = resolveExplicitActionPlan({
      action: explicitAction.action,
      actorName,
      actionProvenance: input.payload.spaceActionProvenance,
    });
  } else {
    plan = resolveImplicitPlan({
      dispatchMessage: input.dispatchMessage,
      actorName,
      publicationRequirement,
      payload: input.payload,
      replyText: input.replyText,
    });
  }

  return {
    ...plan,
    archiveMode: archiveBehavior.mode,
    blockedExplicitAction: explicitAction.kind === "blocked",
    shouldArchive: resolveShouldArchive({
      archiveMode: archiveBehavior.mode,
      planKind: plan.kind,
    }),
  };
}

export function buildDispatchResultRecord(input: {
  archivedMessageEnvelope?: MessageEnvelope | null;
  dispatchId: string;
  dispatchReplyToSignalId?: string | null;
  emittedSignal?: SignalEnvelope | null;
  publishedSignalId?: string | null;
  runtimeOutput: string;
  targetProfileId: string;
  targetProfileName?: string | null;
  plan: DispatchPublicationPlan;
  spaceId: string;
  threadContext?: SpaceThreadContext | null;
  createdAt?: string;
}): DispatchResult | null {
  if (!input.plan.shouldArchive) {
    return null;
  }

  const archivedMessageEnvelope =
    input.archivedMessageEnvelope ??
    (input.plan.kind === "message" ? input.plan.messageEnvelope : null);
  const resultRef = buildDispatchResultRef(input.dispatchId);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const publishedSignalId = normalizeOptionalText(input.publishedSignalId);
  const replyToSignalId = resolveArchivedReplyToSignalId({
    dispatchReplyToSignalId: input.dispatchReplyToSignalId ?? null,
    emittedSignal: input.emittedSignal ?? null,
    plan:
      archivedMessageEnvelope && input.plan.kind === "message"
        ? { ...input.plan, messageEnvelope: archivedMessageEnvelope }
        : input.plan,
  });
  const baseRecord = buildDispatchResultRecordBase({
    actorProfileId: input.targetProfileId,
    actorName: normalizeOptionalText(input.targetProfileName),
    createdAt,
    dispatchId: input.dispatchId,
    messageEnvelope: archivedMessageEnvelope,
    publishedSignalId,
    replyToSignalId,
    resultRef,
    spaceId: input.spaceId,
    threadContext: input.threadContext ?? null,
  });

  if (input.plan.archiveMode === "all_final_results") {
    return buildArchivedFinalDispatchResultRecord({
      baseRecord,
      plan: input.plan,
      runtimeOutput: input.runtimeOutput,
    });
  }

  return buildPlannedDispatchResultRecord({
    baseRecord,
    plan: input.plan,
    runtimeOutput: input.runtimeOutput,
  });
}

export function resolveArchivedReplyToSignalId(input: {
  dispatchReplyToSignalId: string | null;
  emittedSignal: SignalEnvelope | null;
  plan: DispatchPublicationPlan;
}): string | null {
  const emittedSignalReplyToSignalId = resolveEmittedSignalReplyToSignalId(
    input.emittedSignal
  );
  if (emittedSignalReplyToSignalId) {
    return emittedSignalReplyToSignalId;
  }
  if (input.plan.kind === "message") {
    return normalizeOptionalText(input.plan.messageEnvelope.replyToSignalId);
  }
  return normalizeOptionalText(input.dispatchReplyToSignalId);
}

function resolveEmittedSignalReplyToSignalId(
  signal: SignalEnvelope | null
): string | null {
  if (!signal) {
    return null;
  }
  if (signal.type === "signal.text") {
    const data = (signal as SignalTextEnvelope).data;
    return (
      normalizeOptionalText(data.messageEnvelope?.replyToSignalId) ??
      normalizeOptionalText(data.replyTo?.signalId)
    );
  }
  if (
    signal.type === "signal.status" ||
    signal.type === "signal.system_notice"
  ) {
    const data = (signal as SignalStatusEnvelope | SignalSystemNoticeEnvelope)
      .data;
    return normalizeOptionalText(data.replyTo?.signalId);
  }
  return null;
}

type DispatchResultRecordBase = {
  actorProfileId: string;
  actorName?: string;
  createdAt: string;
  dispatchId: string;
  messageEnvelope: MessageEnvelope | null;
  publishedSignalId: string | null;
  replyToSignalId: string | null;
  resultRef: string;
  spaceId: string;
  threadContext: SpaceThreadContext | null;
};

function buildDispatchResultRecordBase(input: {
  actorProfileId: string;
  actorName?: string | null;
  createdAt: string;
  dispatchId: string;
  messageEnvelope: MessageEnvelope | null;
  publishedSignalId: string | null;
  replyToSignalId: string | null;
  resultRef: string;
  spaceId: string;
  threadContext: SpaceThreadContext | null;
}): DispatchResultRecordBase {
  return {
    actorProfileId: input.actorProfileId,
    ...(input.actorName ? { actorName: input.actorName } : {}),
    createdAt: input.createdAt,
    dispatchId: input.dispatchId,
    messageEnvelope: input.messageEnvelope,
    publishedSignalId: input.publishedSignalId,
    replyToSignalId: input.replyToSignalId,
    resultRef: input.resultRef,
    spaceId: input.spaceId,
    threadContext: input.threadContext,
  };
}

function buildPlannedDispatchResultRecord(input: {
  baseRecord: DispatchResultRecordBase;
  plan: DispatchPublicationPlan;
  runtimeOutput: string;
}): DispatchResult {
  switch (input.plan.kind) {
    case "message":
      return buildTextDispatchResultRecord({
        ...input.baseRecord,
        finalText: input.plan.text,
        publicOutcome: input.plan.publicOutcome,
      });
    case "status":
      return buildStatusDispatchResultRecord({
        ...input.baseRecord,
        publicOutcome: input.plan.publicOutcome,
        status: input.plan.status,
        text: input.plan.text,
      });
    case "system_notice":
      return buildTextDispatchResultRecord({
        ...input.baseRecord,
        finalText: input.plan.text,
        publicOutcome: input.plan.publicOutcome,
      });
    case "none":
      return buildTextDispatchResultRecord({
        ...input.baseRecord,
        finalText: input.runtimeOutput,
        publicOutcome: input.plan.publicOutcome,
      });
    default:
      return assertUnexpectedPlan(input.plan);
  }
}

function buildArchivedFinalDispatchResultRecord(input: {
  baseRecord: DispatchResultRecordBase;
  plan: DispatchPublicationPlan;
  runtimeOutput: string;
}): DispatchResult {
  if (input.plan.kind === "status") {
    return buildStatusDispatchResultRecord({
      ...input.baseRecord,
      finalText: input.runtimeOutput,
      publicOutcome: input.plan.publicOutcome,
      status: input.plan.status,
      text: input.plan.text,
    });
  }

  if (input.plan.kind === "message") {
    return buildTextDispatchResultRecord({
      ...input.baseRecord,
      finalText: input.plan.messageEnvelope.text,
      publicOutcome: input.plan.publicOutcome,
    });
  }

  return buildTextDispatchResultRecord({
    ...input.baseRecord,
    finalText: input.runtimeOutput,
    publicOutcome: input.plan.publicOutcome,
  });
}

function buildTextDispatchResultRecord(
  input: DispatchResultRecordBase & {
    finalText: string;
    publicOutcome: DispatchResult["publicOutcome"];
  }
): DispatchResult {
  return {
    resultRef: input.resultRef,
    dispatchId: input.dispatchId,
    spaceId: input.spaceId,
    actorProfileId: input.actorProfileId,
    ...(input.replyToSignalId
      ? { replyToSignalId: input.replyToSignalId }
      : {}),
    resultKind: "text",
    finalText: input.finalText,
    ...(input.messageEnvelope
      ? { messageEnvelope: input.messageEnvelope }
      : {}),
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
    previewText: buildPreviewText(input.finalText),
    publicOutcome: input.publicOutcome,
    ...(input.publishedSignalId
      ? { publishedSignalId: input.publishedSignalId }
      : {}),
    createdAt: input.createdAt,
  };
}

function buildStatusDispatchResultRecord(
  input: DispatchResultRecordBase & {
    finalText?: string;
    publicOutcome: Extract<DispatchResult["publicOutcome"], "post_status">;
    status: SpaceStatus;
    text: string;
  }
): DispatchResult {
  return {
    resultRef: input.resultRef,
    dispatchId: input.dispatchId,
    spaceId: input.spaceId,
    actorProfileId: input.actorProfileId,
    ...(input.replyToSignalId
      ? { replyToSignalId: input.replyToSignalId }
      : {}),
    resultKind: "status",
    ...(input.finalText ? { finalText: input.finalText } : {}),
    statusType: input.status,
    previewText: buildPreviewText(input.text),
    publicOutcome: input.publicOutcome,
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
    ...(input.publishedSignalId
      ? { publishedSignalId: input.publishedSignalId }
      : {}),
    createdAt: input.createdAt,
  };
}

function resolveExplicitActionDecision(input: {
  action: OpenMeldSpaceEgressAction | undefined;
  allowedActions: SpaceAllowedAction[];
}):
  | { kind: "allowed"; action: OpenMeldSpaceEgressAction | undefined }
  | { actionType: SpaceAllowedAction; kind: "blocked" } {
  if (!input.action) {
    return { kind: "allowed", action: undefined };
  }

  if (input.allowedActions.includes(input.action.type)) {
    return { kind: "allowed", action: input.action };
  }

  return { kind: "blocked", actionType: input.action.type };
}

function resolveExplicitActionPlan(input: {
  action: OpenMeldSpaceEgressAction;
  actorName?: string | null;
  actionProvenance?: OpenMeldDaemonTaskResultPayload["spaceActionProvenance"];
}): DispatchPublicationPlan {
  switch (input.action.type) {
    case "post_message":
      return {
        archiveMode: "none",
        blockedExplicitAction: false,
        kind: "message",
        messageEnvelope: input.action.messageEnvelope,
        ...(input.action.files ? { files: input.action.files } : {}),
        observedThroughSignalId: normalizeOptionalText(
          input.action.observedThroughSignalId
        ),
        publicOutcome: "post_message",
        shouldArchive: false,
        text: input.action.messageEnvelope.text,
      };
    case "post_status":
      return {
        archiveMode: "none",
        blockedExplicitAction: false,
        kind: "status",
        publicOutcome: "post_status",
        shouldArchive: false,
        status: input.action.status,
        targetProfileId: normalizeOptionalText(input.action.targetProfileId),
        text: buildStatusSignalText(input.action.text),
      };
    case "stay_silent":
      return buildSystemNoticePlan({
        actorName: input.actorName,
        noticeType: "stay_silent",
        publicOutcome: "stay_silent",
        reason: resolvePublicStaySilentReason({
          actionReason: input.action.reason,
          actionProvenance: input.actionProvenance,
        }),
      });
    default:
      return assertUnexpectedAction(input.action);
  }
}

function resolveImplicitPlan(input: {
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  actorName?: string | null;
  payload: DispatchPublicationPayload;
  publicationRequirement: ReturnType<typeof resolveSpacePublicationRequirement>;
  replyText: string | null;
}): DispatchPublicationPlan {
  if (input.payload.suppressPublicOutcome === true) {
    return {
      archiveMode: "none",
      blockedExplicitAction: false,
      kind: "none",
      publicOutcome: "internal_only",
      shouldArchive: false,
    };
  }

  if (
    input.publicationRequirement.allowsRawReplyWithoutAction &&
    canPublishRawContextSharingReply(input.payload)
  ) {
    const replyText = normalizeOptionalText(input.replyText);
    if (replyText) {
      return {
        archiveMode: "none",
        blockedExplicitAction: false,
        kind: "message",
        messageEnvelope: buildImplicitPublicMessageEnvelope({
          replyText,
          replyToSignalId:
            input.dispatchMessage.replyToSnapshot?.signalId ?? null,
        }),
        observedThroughSignalId: null,
        publicOutcome: "raw_context_sharing",
        shouldArchive: false,
        text: replyText,
      };
    }
  }

  return buildSystemNoticePlan({
    actorName: input.actorName,
    noticeType: "terminal_failure",
    publicOutcome: "system_notice",
    reason: resolveFailureReason(input.payload, input.actorName),
    reasonCode: input.payload.errorCode,
  });
}

function canPublishRawContextSharingReply(
  payload: DispatchPublicationPayload
): boolean {
  return payload.status === "success";
}

function resolvePublicStaySilentReason(input: {
  actionReason?: string | null;
  actionProvenance?: OpenMeldDaemonTaskResultPayload["spaceActionProvenance"];
}): string | null {
  const reason = normalizeOptionalText(input.actionReason);
  if (!reason) {
    return null;
  }
  if (
    input.actionProvenance === "controller_repair" ||
    input.actionProvenance === "local_repair"
  ) {
    return null;
  }
  return reason;
}

function buildSystemNoticePlan(input: {
  actorName?: string | null;
  noticeType: "policy_blocked" | "stay_silent" | "terminal_failure";
  publicOutcome: "stay_silent" | "system_notice";
  reason?: string | null;
  reasonCode?: string | null;
}): DispatchPublicationPlan {
  const reason = normalizeOptionalText(input.reason);
  const useServerOwnedFailureText =
    input.noticeType === "terminal_failure" &&
    isProjectLocalConnectionFailureReasonCode(input.reasonCode);
  return {
    archiveMode: "none",
    blockedExplicitAction: false,
    kind: "system_notice",
    noticeType: input.noticeType,
    publicOutcome: input.publicOutcome,
    reason,
    reasonCode: normalizeOptionalText(input.reasonCode),
    shouldArchive: false,
    text:
      useServerOwnedFailureText && reason
        ? reason
        : buildSystemNoticeText({
            actorName: input.actorName,
            noticeType: input.noticeType,
            reason,
          }),
  };
}

function resolveShouldArchive(input: {
  archiveMode: ResultArchiveMode;
  planKind: DispatchPublicationPlan["kind"];
}): boolean {
  if (input.archiveMode === "none") {
    return false;
  }
  if (input.archiveMode === "all_final_results") {
    return true;
  }
  return input.planKind !== "none";
}

function resolveFailureReason(
  payload: DispatchPublicationPayload,
  targetProfileName?: string | null
): string | null {
  if (payload.status === "partial_success") {
    return (
      normalizeOptionalText(payload.partialReason) ?? "The reply is incomplete."
    );
  }
  if (payload.status !== "failed") {
    return "OpenMeld did not receive a message it could post in this space.";
  }

  const reason = resolvePublicAgentFailureReason({
    defaultReason:
      "OpenMeld did not receive a message it could post in this space.",
    errorCode: payload.errorCode,
    errorMessage: payload.errorMessage,
    ...(isProjectLocalConnectionFailureReasonCode(payload.errorCode)
      ? { targetLabel: targetProfileName }
      : {}),
  });
  return reason;
}

function buildImplicitPublicMessageEnvelope(input: {
  replyText: string;
  replyToSignalId: string | null;
}): MessageEnvelope {
  return normalizeMessageEnvelope({
    activationTargets: [],
    referenceTargets: [],
    ...(input.replyToSignalId
      ? { replyToSignalId: input.replyToSignalId }
      : {}),
    text: input.replyText,
  });
}

function buildPreviewText(value: string): string {
  const normalized = normalizeOptionalText(value) ?? "";
  if (normalized.length <= 220) {
    return normalized;
  }
  return `${normalized.slice(0, 217).trimEnd()}...`;
}

function buildStatusSignalText(value: string): string {
  const normalized = normalizeOptionalText(value) ?? "";
  if (normalized.length <= MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH) {
    return normalized;
  }
  return `${normalized
    .slice(0, MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH - 1)
    .trimEnd()}…`;
}

function resolvePublicationActorName(input: {
  actorName?: string | null;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  targetProfileName?: string | null;
}): string | null {
  return (
    normalizeOptionalText(input.actorName) ??
    normalizeOptionalText(input.dispatchMessage.targetProfileMentionLabel) ??
    normalizeOptionalText(input.targetProfileName) ??
    normalizeOptionalText(input.dispatchMessage.targetProfileNameSnapshot) ??
    normalizeOptionalText(input.dispatchMessage.targetProfileId)
  );
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function assertUnexpectedAction(value: never): never {
  throw new Error(
    `unsupported OpenMeld Space action: ${JSON.stringify(value)}`
  );
}

function assertUnexpectedPlan(value: never): never {
  throw new Error(`unsupported publication plan: ${JSON.stringify(value)}`);
}
