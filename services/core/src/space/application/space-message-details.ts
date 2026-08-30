import type { Profile, SignalEnvelope } from "@openmeld/protocol";
import {
  AGENT_REPLY_FINAL_PURPOSE,
  sanitizeSignalTextPreview,
} from "@openmeld/schemas";
import type {
  GetSpaceMessageDetailsResponse,
  SpaceMessageDetailsAgentContext,
  SpaceMessageDetailsFactSource,
  SpaceMessageDetailsReplyContext,
  SpaceMessageDetailsStringFact,
  SpaceMessageDetailsTraceSelector,
  SpaceMessageDetailsWakeContext,
  SpaceMessageDetailsWakeTarget,
  SpaceMessageDetailsWorkingDetails,
  WakeTraceWaterfallItem,
} from "@openmeld/schemas/types";

type VisibleMessageSignal = Extract<
  SignalEnvelope,
  { type: "signal.text" | "signal.status" | "signal.system_notice" }
>;
type WakeSourceSignal = Extract<SignalEnvelope, { type: "signal.text" }>;

const LEADING_AT_PATTERN = /^@/;

export type ProjectSpaceMessageDetailsInput = {
  originalErrorByTargetProfileId?: ReadonlyMap<string, string>;
  replySignal: VisibleMessageSignal | null;
  signal: VisibleMessageSignal;
  spaceId: string;
  visibleReplySignal: VisibleMessageSignal | null;
  visibleSignal: VisibleMessageSignal;
  wakeSourceSignal: WakeSourceSignal | null;
  wakeTraceItems?: readonly WakeTraceWaterfallItem[];
  workingDetails?: SpaceMessageDetailsWorkingDetails | null;
  targetOwnerUserIdByProfileId?: ReadonlyMap<string, string | null>;
  viewerOwnerUserId?: string | null;
};

export function projectSpaceMessageDetails(
  input: ProjectSpaceMessageDetailsInput
): GetSpaceMessageDetailsResponse {
  const replyToSignalId = readReplyToSignalId(input.signal);
  const wakeContext = projectWakeContext({
    originalErrorByTargetProfileId:
      input.originalErrorByTargetProfileId ?? new Map(),
    targetOwnerUserIdByProfileId:
      input.targetOwnerUserIdByProfileId ?? new Map(),
    viewerOwnerUserId: normalizeOptionalText(input.viewerOwnerUserId),
    wakeSourceSignal: input.wakeSourceSignal,
    wakeTraceItems: input.wakeTraceItems ?? [],
  });

  return {
    query: {
      spaceId: input.spaceId,
      signalId: input.signal.id,
    },
    message: {
      signalId: input.signal.id,
      signalType: input.signal.type,
      sentAtMs: input.signal.ts,
      actor: {
        profileId: input.visibleSignal.profile.profileId,
        profileKind: input.visibleSignal.profile.kind,
        displayName: resolveProfileDisplayName(input.visibleSignal.profile),
        profileName: normalizeOptionalText(
          input.visibleSignal.profile.profileName
        ),
        profileHandle: normalizeOptionalText(
          input.visibleSignal.profile.profileHandle
        ),
      },
    },
    agentContext: projectSignalAgentContext({
      rawProfile: input.signal.profile,
      visibleProfile: input.visibleSignal.profile,
    }),
    wakeContext,
    replyContext: projectReplyContext({
      replySignal: input.replySignal,
      replyToSignalId,
      signal: input.visibleSignal,
      visibleReplySignal: input.visibleReplySignal,
    }),
    workingDetails: projectWorkingDetails({
      recorded: input.workingDetails ?? null,
      signal: input.signal,
    }),
    diagnostics: {
      signalId: input.signal.id,
      traceSelectors: buildTraceSelectors({
        signalId: input.signal.id,
        wakeContext,
      }),
    },
  };
}

function projectWorkingDetails(input: {
  recorded: SpaceMessageDetailsWorkingDetails | null;
  signal: VisibleMessageSignal;
}): SpaceMessageDetailsWorkingDetails {
  if (input.recorded) {
    return input.recorded;
  }
  if (
    input.signal.profile.kind === "agent" &&
    readSignalPurpose(input.signal) === AGENT_REPLY_FINAL_PURPOSE
  ) {
    return {
      state: "not_recorded",
      tools: [],
      truncated: false,
    };
  }
  return {
    state: "not_applicable",
    tools: [],
    truncated: false,
  };
}

function readSignalPurpose(signal: VisibleMessageSignal): string | null {
  if (signal.type !== "signal.text") {
    return null;
  }
  return normalizeOptionalText(signal.data.meta?.purpose);
}

function projectSignalAgentContext(input: {
  rawProfile: Profile;
  visibleProfile: Profile;
}): SpaceMessageDetailsAgentContext {
  if (input.rawProfile.kind !== "agent") {
    return buildNotApplicableAgentContext();
  }

  return {
    state: "recorded",
    profileId: recordedFact(input.rawProfile.profileId, "space_signal_profile"),
    profileName: optionalRecordedFact(
      input.visibleProfile.profileName,
      "space_signal_profile"
    ),
    agentControllerRef: factFromVisibleProfile({
      rawValue: input.rawProfile.agentControllerRef,
      source: "space_signal_profile",
      visibleValue: input.visibleProfile.agentControllerRef,
    }),
    agentControllerConversationId: factFromVisibleProfile({
      rawValue: input.rawProfile.agentControllerConversationId,
      source: "space_signal_profile",
      visibleValue: input.visibleProfile.agentControllerConversationId,
    }),
    workspacePath: factFromVisibleProfile({
      rawValue: input.rawProfile.workingDirectory,
      source: "space_signal_profile",
      visibleValue: input.visibleProfile.workingDirectory,
    }),
    openMeldServiceRuntimeId: notRecordedFact("space_signal_profile"),
    bindingId: notRecordedFact("space_signal_profile"),
    workspaceFingerprint: notRecordedFact("space_signal_profile"),
  };
}

function buildNotApplicableAgentContext(): SpaceMessageDetailsAgentContext {
  return {
    state: "not_applicable",
    profileId: notApplicableFact(),
    profileName: notApplicableFact(),
    agentControllerRef: notApplicableFact(),
    agentControllerConversationId: notApplicableFact(),
    workspacePath: notApplicableFact(),
    openMeldServiceRuntimeId: notApplicableFact(),
    bindingId: notApplicableFact(),
    workspaceFingerprint: notApplicableFact(),
  };
}

function projectWakeContext(input: {
  originalErrorByTargetProfileId: ReadonlyMap<string, string>;
  targetOwnerUserIdByProfileId: ReadonlyMap<string, string | null>;
  viewerOwnerUserId: string | null;
  wakeSourceSignal: WakeSourceSignal | null;
  wakeTraceItems: readonly WakeTraceWaterfallItem[];
}): SpaceMessageDetailsWakeContext {
  if (!input.wakeSourceSignal) {
    return {
      state: "not_applicable",
      sourceSignalId: notApplicableFact(),
      clientMessageId: notApplicableFact(),
      targets: [],
    };
  }

  const clientMessageId = readWakeClientMessageId(input.wakeSourceSignal);
  const wakeTraceItemByTargetProfileId = new Map(
    input.wakeTraceItems.map((item) => [item.targetProfileId, item] as const)
  );
  return {
    state: "recorded",
    sourceSignalId: recordedFact(input.wakeSourceSignal.id, "space_signal"),
    clientMessageId: clientMessageId
      ? recordedFact(clientMessageId, "space_signal")
      : notRecordedFact("space_signal"),
    targets: readWakeTargetProfileIds(input.wakeSourceSignal).map(
      (targetProfileId) =>
        projectWakeTarget({
          originalError:
            input.viewerOwnerUserId &&
            input.viewerOwnerUserId ===
              input.targetOwnerUserIdByProfileId.get(targetProfileId)
              ? input.originalErrorByTargetProfileId.get(targetProfileId)
              : undefined,
          targetProfileId,
          wakeTraceItem:
            wakeTraceItemByTargetProfileId.get(targetProfileId) ?? null,
        })
    ),
  };
}

function projectWakeTarget(input: {
  originalError?: string;
  targetProfileId: string;
  wakeTraceItem: WakeTraceWaterfallItem | null;
}): SpaceMessageDetailsWakeTarget {
  if (!input.wakeTraceItem) {
    return {
      targetProfileId: input.targetProfileId,
      targetLabel: null,
    };
  }

  return {
    targetProfileId: input.targetProfileId,
    targetLabel: input.wakeTraceItem.targetLabel,
    status: input.wakeTraceItem.summary.status,
    terminalStep: input.wakeTraceItem.summary.terminalStep,
    reasonCode: input.wakeTraceItem.summary.reasonCode,
    ...(input.originalError ? { originalError: input.originalError } : {}),
    agentContext: projectWakeTargetAgentContext(input.wakeTraceItem),
    steps: input.wakeTraceItem.steps,
  };
}

function projectWakeTargetAgentContext(
  wakeTraceItem: WakeTraceWaterfallItem
): SpaceMessageDetailsAgentContext {
  const executionContext = wakeTraceItem.executionContext;
  return {
    state: "recorded",
    profileId: recordedFact(wakeTraceItem.targetProfileId, "wake_trace"),
    profileName: optionalRecordedFact(
      normalizeWakeTargetProfileName(wakeTraceItem.targetLabel),
      "wake_trace"
    ),
    agentControllerRef: optionalRecordedFact(
      executionContext.agentControllerRef,
      "wake_trace_execution_context"
    ),
    agentControllerConversationId: executionContextFact({
      redacted: executionContext.resolutionStatus === "redacted",
      value: executionContext.agentControllerConversationId,
    }),
    workspacePath: executionContextFact({
      redacted: executionContext.resolutionStatus === "redacted",
      value: executionContext.runtimeWorkspacePath,
    }),
    openMeldServiceRuntimeId: executionContextFact({
      redacted: executionContext.resolutionStatus === "redacted",
      value: executionContext.openMeldServiceRuntimeId,
    }),
    bindingId: executionContextFact({
      redacted: executionContext.resolutionStatus === "redacted",
      value: executionContext.bindingId,
    }),
    workspaceFingerprint: executionContextFact({
      redacted: executionContext.resolutionStatus === "redacted",
      value: executionContext.runtimeWorkspaceFingerprint,
    }),
  };
}

function normalizeWakeTargetProfileName(value: string): string {
  return value.trim().replace(LEADING_AT_PATTERN, "");
}

function executionContextFact(input: {
  redacted: boolean;
  value: unknown;
}): SpaceMessageDetailsStringFact {
  const value = normalizeOptionalText(input.value);
  if (value) {
    return recordedFact(value, "wake_trace_execution_context");
  }
  return input.redacted
    ? redactedFact("wake_trace_execution_context")
    : notRecordedFact("wake_trace_execution_context");
}

function projectReplyContext(input: {
  replySignal: VisibleMessageSignal | null;
  replyToSignalId: string | null;
  signal: VisibleMessageSignal;
  visibleReplySignal: VisibleMessageSignal | null;
}): SpaceMessageDetailsReplyContext {
  if (!input.replyToSignalId) {
    return {
      state: "not_applicable",
      replyingToSignalId: notApplicableFact(),
      replyingToAuthor: notApplicableFact(),
      previewText: notApplicableFact(),
      resolved: false,
    };
  }

  const fallback = readReplyToSnapshot(input.signal);
  const author =
    (input.visibleReplySignal
      ? resolveProfileDisplayName(input.visibleReplySignal.profile)
      : null) ?? normalizeOptionalText(fallback?.profileName);
  const preview =
    sanitizeSignalTextPreview(readSignalText(input.visibleReplySignal)) ??
    normalizeOptionalText(fallback?.previewText);

  return {
    state: "recorded",
    replyingToSignalId: recordedFact(input.replyToSignalId, "reply_signal"),
    replyingToAuthor: author
      ? recordedFact(author, "reply_signal")
      : notRecordedFact("reply_signal"),
    previewText: preview
      ? recordedFact(preview, "reply_signal")
      : notRecordedFact("reply_signal"),
    resolved: input.replySignal !== null,
  };
}

function buildTraceSelectors(input: {
  signalId: string;
  wakeContext: SpaceMessageDetailsWakeContext;
}): SpaceMessageDetailsTraceSelector[] {
  const selectors: SpaceMessageDetailsTraceSelector[] = [
    {
      kind: "signal",
      label: "Message ID",
      value: input.signalId,
      targetProfileId: null,
    },
  ];

  addFactTraceSelector({
    fact: input.wakeContext.sourceSignalId,
    kind: "wake_source_signal",
    label: "Wake source signal ID",
    selectors,
  });
  addFactTraceSelector({
    fact: input.wakeContext.clientMessageId,
    kind: "client_message",
    label: "Client message ID",
    selectors,
  });
  for (const target of input.wakeContext.targets) {
    addTargetFactTraceSelector({
      fact: input.wakeContext.clientMessageId,
      fallbackFact: input.wakeContext.sourceSignalId,
      selectors,
      target,
    });
  }

  return selectors;
}

function addFactTraceSelector(input: {
  fact: SpaceMessageDetailsStringFact;
  kind: "client_message" | "wake_source_signal";
  label: string;
  selectors: SpaceMessageDetailsTraceSelector[];
}): void {
  if (input.fact.state !== "recorded" || !input.fact.value) {
    return;
  }
  if (
    input.selectors.some(
      (selector) =>
        selector.kind === input.kind && selector.value === input.fact.value
    )
  ) {
    return;
  }
  input.selectors.push({
    kind: input.kind,
    label: input.label,
    value: input.fact.value,
    targetProfileId: null,
  });
}

function addTargetFactTraceSelector(input: {
  fact: SpaceMessageDetailsStringFact;
  fallbackFact: SpaceMessageDetailsStringFact;
  selectors: SpaceMessageDetailsTraceSelector[];
  target: SpaceMessageDetailsWakeTarget;
}): void {
  if (input.fact.state === "recorded" && input.fact.value) {
    input.selectors.push({
      kind: "client_message",
      label: `Client message ID (${formatWakeTargetSelectorLabel(input.target)})`,
      value: input.fact.value,
      targetProfileId: input.target.targetProfileId,
    });
    return;
  }

  if (input.fallbackFact.state !== "recorded" || !input.fallbackFact.value) {
    return;
  }

  input.selectors.push({
    kind: "wake_source_signal",
    label: `Wake source signal ID (${formatWakeTargetSelectorLabel(
      input.target
    )})`,
    value: input.fallbackFact.value,
    targetProfileId: input.target.targetProfileId,
  });
}

function formatWakeTargetSelectorLabel(
  target: SpaceMessageDetailsWakeTarget
): string {
  return target.targetLabel ?? target.targetProfileId;
}

function factFromVisibleProfile(input: {
  rawValue: unknown;
  source: SpaceMessageDetailsFactSource;
  visibleValue: unknown;
}): SpaceMessageDetailsStringFact {
  const visibleValue = normalizeOptionalText(input.visibleValue);
  if (visibleValue) {
    return recordedFact(visibleValue, input.source);
  }
  const rawValue = normalizeOptionalText(input.rawValue);
  return rawValue ? redactedFact(input.source) : notRecordedFact(input.source);
}

function optionalRecordedFact(
  value: unknown,
  source: SpaceMessageDetailsFactSource
): SpaceMessageDetailsStringFact {
  const normalized = normalizeOptionalText(value);
  return normalized
    ? recordedFact(normalized, source)
    : notRecordedFact(source);
}

function recordedFact(
  value: string,
  source: SpaceMessageDetailsFactSource
): SpaceMessageDetailsStringFact {
  return {
    state: "recorded",
    value,
    source,
  };
}

function notRecordedFact(
  source: SpaceMessageDetailsFactSource
): SpaceMessageDetailsStringFact {
  return {
    state: "not_recorded",
    value: null,
    source,
  };
}

function redactedFact(
  source: SpaceMessageDetailsFactSource
): SpaceMessageDetailsStringFact {
  return {
    state: "redacted",
    value: null,
    source,
  };
}

function notApplicableFact(): SpaceMessageDetailsStringFact {
  return {
    state: "not_applicable",
    value: null,
    source: "none",
  };
}

function resolveProfileDisplayName(profile: Profile): string {
  return (
    normalizeOptionalText(profile.profileName) ??
    normalizeOptionalText(profile.profileHandle) ??
    profile.profileId
  );
}

function readReplyToSignalId(signal: VisibleMessageSignal): string | null {
  return normalizeOptionalText(signal.data.replyTo?.signalId);
}

function readReplyToSnapshot(
  signal: VisibleMessageSignal
): VisibleMessageSignal["data"]["replyTo"] | null {
  return signal.data.replyTo ?? null;
}

function readWakeClientMessageId(signal: WakeSourceSignal): string | null {
  return normalizeOptionalText(signal.data.meta?.clientMessageId);
}

function readWakeTargetProfileIds(signal: WakeSourceSignal): string[] {
  const targetProfileIds = signal.data.messageEnvelope?.activationTargets ?? [];
  const seen = new Set<string>();
  return targetProfileIds.flatMap((targetProfileId) => {
    const normalized = normalizeOptionalText(targetProfileId);
    if (!normalized || seen.has(normalized)) {
      return [];
    }
    seen.add(normalized);
    return [normalized];
  });
}

function readSignalText(signal: VisibleMessageSignal | null): string | null {
  if (!signal) {
    return null;
  }
  return normalizeOptionalText(signal.data.text);
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
