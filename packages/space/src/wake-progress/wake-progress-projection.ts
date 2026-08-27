import type { SignalEnvelope } from "@openmeld/protocol";
import {
  AGENT_REPLY_FINAL_PURPOSE,
  AGENT_REPLY_PREVIEW_END_PURPOSE,
  AGENT_REPLY_PREVIEW_PURPOSE,
  AGENT_REPLYING_END_PURPOSE,
  AGENT_REPLYING_PURPOSE,
  CONVERSATION_CONTINUITY_WARNING_PURPOSE,
  DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
  DISPATCH_ACTIVITY_FAILED_PURPOSE,
  DISPATCH_ACTIVITY_RETRYING_PURPOSE,
  REMOTE_AGENT_FAILURE_PURPOSE,
  resolveMappedPublicAgentFailureReason,
} from "@openmeld/schemas";
import type {
  WakeProgressItem,
  WakeProgressPhase,
} from "@openmeld/schemas/types";

const WAKE_PROGRESS_LOCAL_EXPIRY_MS = 180_000;
const WAKE_PROGRESS_TERMINAL_EXPIRY_MS = 180_000;
const ACTIVE_WAKE_PROGRESS_PHASES = new Set<WakeProgressPhase>([
  "sending",
  "request_sent",
  "queued",
  "connecting",
  "running",
  "writing",
  "publishing",
  "retrying",
]);

const WAKE_PROGRESS_PHASE_RANK: Record<WakeProgressPhase, number> = {
  sending: 0,
  request_sent: 1,
  queued: 2,
  connecting: 3,
  running: 4,
  writing: 5,
  publishing: 6,
  publication_unknown: 7,
  retrying: 8,
  failed: 9,
  stopped: 10,
  replied: 11,
};
const RUNTIME_LOCATION_PHASES = new Set<WakeProgressPhase>([
  "connecting",
  "running",
]);
const GENERIC_RUNTIME_LOCATION_PATTERN = /\bon this computer(?:\.{3}|\.)?$/iu;
const WAKE_CLOSING_SYSTEM_NOTICE_TYPES = new Set([
  "policy_blocked",
  "stay_silent",
  "terminal_failure",
  "wake_stopped",
]);

export type WakeProgressDraft = Omit<
  WakeProgressItem,
  "message" | "terminal"
> & {
  phase: WakeProgressPhase;
  message?: string;
  runtimeDeviceDisplayName?: string | null;
  terminal?: boolean;
};

export function buildWakeProgressMessage(input: {
  phase: WakeProgressPhase;
  targetLabel: string;
  errorCode?: string | null;
  runtimeDeviceDisplayName?: string | null;
}): string {
  const targetLabel = formatWakeTargetLabel(input.targetLabel);
  const runtimeLocation = formatWakeProgressRuntimeLocation(
    input.runtimeDeviceDisplayName
  );
  switch (input.phase) {
    case "sending":
      return "Sending message...";
    case "request_sent":
      return `Wake request sent to ${targetLabel}.`;
    case "queued":
      return `Starting Wake for ${targetLabel}...`;
    case "connecting":
      return `Connecting to ${targetLabel} ${runtimeLocation}...`;
    case "running":
      return `${targetLabel} is working ${runtimeLocation}...`;
    case "writing":
      return `${targetLabel} started writing...`;
    case "publishing":
      return `Posting final message for ${targetLabel}...`;
    case "publication_unknown":
      return `OpenMeld could not confirm whether the final reply was posted for ${targetLabel}. Check this Space before trying again.`;
    case "retrying":
      return `Still trying to reach ${targetLabel}...`;
    case "failed":
      return buildWakeProgressFailureMessage({
        errorCode: input.errorCode,
        runtimeDeviceDisplayName: input.runtimeDeviceDisplayName,
        targetLabel,
      });
    case "stopped":
      return `Wake was stopped for ${targetLabel}.`;
    case "replied":
      return `${targetLabel} replied.`;
    default:
      return assertNever(input.phase);
  }
}

export function createWakeProgressItem(
  draft: WakeProgressDraft
): WakeProgressItem {
  const {
    failureReasonCode,
    message,
    runtimeDeviceDisplayName,
    terminal: draftTerminal,
    ...itemDraft
  } = draft;
  const terminal =
    draftTerminal ??
    (draft.phase === "failed" ||
      draft.phase === "publication_unknown" ||
      draft.phase === "stopped" ||
      draft.phase === "replied");
  const normalizedFailureReasonCode =
    draft.phase === "failed" ||
    draft.phase === "publication_unknown" ||
    draft.phase === "publishing"
      ? normalizeOptionalText(failureReasonCode)
      : null;
  return {
    ...itemDraft,
    failureReasonCode: normalizedFailureReasonCode,
    targetLabel: formatWakeTargetLabel(draft.targetLabel),
    message:
      message ??
      buildWakeProgressMessage({
        phase: draft.phase,
        runtimeDeviceDisplayName,
        targetLabel: draft.targetLabel,
      }),
    terminal,
  };
}

export function buildWakeProgressItemFromTransientSignal(
  signal: SignalEnvelope
): WakeProgressItem | null {
  if (signal.type !== "signal.text") {
    return null;
  }

  const meta = signal.data.meta;
  if (meta?.transient !== true) {
    return null;
  }

  const purpose = normalizeOptionalText(meta.purpose);
  const dispatchId = normalizeOptionalText(meta.dispatchId);
  const targetProfileId = normalizeOptionalText(meta.targetProfileId);
  if (!(purpose && dispatchId && targetProfileId)) {
    return null;
  }
  if (isWakeProgressClearPurpose(purpose)) {
    return null;
  }

  const phase = resolveWakeProgressPhaseFromPurpose(purpose);
  if (!phase) {
    return null;
  }

  const targetLabel = resolveWakeProgressTargetLabel({
    signal,
    targetProfileId,
  });
  const runtimeDeviceDisplayName = normalizeOptionalText(
    meta.runtimeDeviceDisplayName
  );
  const failureReasonCode = normalizeOptionalText(meta.errorCode);
  let message: string | undefined;
  if (phase === "writing") {
    message = normalizeOptionalText(signal.data.text) ?? undefined;
  } else if (phase === "failed" || phase === "retrying") {
    message = buildWakeProgressMessage({
      phase,
      runtimeDeviceDisplayName,
      targetLabel,
      errorCode: failureReasonCode,
    });
  }

  return createWakeProgressItem({
    clientMessageId: normalizeOptionalText(meta.sourceClientMessageId),
    dispatchId,
    failureReasonCode: phase === "failed" ? failureReasonCode : null,
    phase,
    sourceSignalId: normalizeOptionalText(meta.sourceEventId),
    targetLabel,
    targetProfileId,
    updatedAtMs: signal.ts,
    runtimeDeviceDisplayName,
    ...(message ? { message } : {}),
  });
}

export function mergeWakeProgressItems(input: {
  currentItems: readonly WakeProgressItem[];
  incomingItems: readonly WakeProgressItem[];
}): WakeProgressItem[] {
  const itemsByKey = new Map<string, WakeProgressItem>();
  for (const item of input.currentItems) {
    itemsByKey.set(buildWakeProgressItemKey(item), item);
  }

  for (const incoming of input.incomingItems) {
    const existingEntry = findMatchingWakeProgressItemEntry({
      itemsByKey,
      incoming,
    });
    const key = existingEntry?.[0] ?? buildWakeProgressItemKey(incoming);
    const existing = existingEntry?.[1] ?? null;

    if (incoming.phase === "replied") {
      itemsByKey.delete(key);
      continue;
    }

    if (!existing || shouldReplaceWakeProgressItem({ existing, incoming })) {
      if (existingEntry && key !== buildWakeProgressItemKey(incoming)) {
        itemsByKey.delete(key);
        itemsByKey.set(buildWakeProgressItemKey(incoming), incoming);
      } else {
        itemsByKey.set(key, incoming);
      }
    }
  }

  return [...itemsByKey.values()].sort(
    (left, right) => left.updatedAtMs - right.updatedAtMs
  );
}

export function applyWakeProgressSignals(input: {
  currentItems: readonly WakeProgressItem[];
  signals: readonly SignalEnvelope[];
  nowMs?: number;
}): WakeProgressItem[] {
  const nowMs = input.nowMs ?? Date.now();
  let items = filterVisibleWakeProgressItems({
    items: input.currentItems,
    nowMs,
  });

  for (const signal of input.signals) {
    items = clearWakeProgressItemsForSignal({ items, signal });
    const nextItem = buildWakeProgressItemFromSignal(signal);
    if (!nextItem) {
      continue;
    }
    items = mergeWakeProgressItems({
      currentItems: items,
      incomingItems: [nextItem],
    });
  }

  return filterVisibleWakeProgressItems({ items, nowMs });
}

export function filterVisibleWakeProgressItems(input: {
  items: readonly WakeProgressItem[];
  nowMs?: number;
}): WakeProgressItem[] {
  const nowMs = input.nowMs ?? Date.now();
  return input.items.filter((item) =>
    shouldKeepWakeProgressItem({ item, nowMs })
  );
}

export function isActiveWakeProgressItem(item: WakeProgressItem): boolean {
  return !item.terminal && ACTIVE_WAKE_PROGRESS_PHASES.has(item.phase);
}

export function hasVisibleActiveWakeProgress(input: {
  items: readonly WakeProgressItem[];
  nowMs?: number;
}): boolean {
  return filterVisibleWakeProgressItems(input).some(isActiveWakeProgressItem);
}

export function isWakeProgressSourceSignalRecoverable(input: {
  nowMs?: number;
  sourceUpdatedAtMs: number;
}): boolean {
  return (
    Number.isFinite(input.sourceUpdatedAtMs) && input.sourceUpdatedAtMs >= 0
  );
}

export function isWakeClosingSystemNoticeType(value: unknown): boolean {
  return WAKE_CLOSING_SYSTEM_NOTICE_TYPES.has(
    normalizeOptionalText(value) ?? ""
  );
}

function buildWakeProgressItemFromSignal(
  signal: SignalEnvelope
): WakeProgressItem | null {
  return (
    buildWakeProgressItemFromTransientSignal(signal) ??
    buildWakeProgressItemFromFinalSystemNotice(signal)
  );
}

function buildWakeProgressItemFromFinalSystemNotice(
  signal: SignalEnvelope
): WakeProgressItem | null {
  if (signal.type !== "signal.system_notice") {
    return null;
  }
  const noticeType = normalizeOptionalText(signal.data.noticeType);
  if (noticeType !== "terminal_failure" && noticeType !== "wake_stopped") {
    return null;
  }

  const dispatchId = normalizeOptionalText(signal.data.dispatchId);
  const targetProfileId = normalizeOptionalText(signal.data.actorProfileId);
  if (!(dispatchId && targetProfileId)) {
    return null;
  }

  const targetLabel = formatWakeTargetLabel(
    normalizeOptionalText(signal.data.actorName) ?? targetProfileId
  );
  const errorCode = normalizeOptionalText(signal.data.reason);
  const phase = noticeType === "wake_stopped" ? "stopped" : "failed";
  return createWakeProgressItem({
    clientMessageId: null,
    dispatchId,
    failureReasonCode: phase === "failed" ? errorCode : null,
    message: buildWakeProgressMessage({
      phase,
      targetLabel,
      errorCode: phase === "failed" ? errorCode : null,
    }),
    phase,
    sourceSignalId: normalizeOptionalText(signal.data.replyTo?.signalId),
    targetLabel,
    targetProfileId,
    terminal: true,
    updatedAtMs: signal.ts,
  });
}

export function clearWakeProgressItemsForSignal(input: {
  items: readonly WakeProgressItem[];
  signal: SignalEnvelope;
}): WakeProgressItem[] {
  if (!isWakeProgressTerminalSignal(input.signal)) {
    return [...input.items];
  }
  return input.items.filter(
    (item) => !doesWakeProgressTerminalSignalMatchItem(input.signal, item)
  );
}

function resolveWakeProgressPhaseFromPurpose(
  purpose: string
): WakeProgressPhase | null {
  switch (purpose) {
    case DISPATCH_ACTIVITY_DISPATCHING_PURPOSE:
      return "queued";
    case DISPATCH_ACTIVITY_RETRYING_PURPOSE:
      return "retrying";
    case DISPATCH_ACTIVITY_FAILED_PURPOSE:
      return "failed";
    case AGENT_REPLYING_PURPOSE:
      return "running";
    case AGENT_REPLY_PREVIEW_PURPOSE:
      return "writing";
    case CONVERSATION_CONTINUITY_WARNING_PURPOSE:
      return null;
    default:
      return null;
  }
}

function isWakeProgressClearPurpose(purpose: string): boolean {
  return (
    purpose === AGENT_REPLYING_END_PURPOSE ||
    purpose === AGENT_REPLY_PREVIEW_END_PURPOSE
  );
}

function resolveWakeProgressTargetLabel(input: {
  signal: Extract<SignalEnvelope, { type: "signal.text" }>;
  targetProfileId: string;
}): string {
  return formatWakeTargetLabel(
    normalizeOptionalText(input.signal.data.meta?.targetMentionLabel) ??
      normalizeOptionalText(input.signal.data.meta?.targetProfileName) ??
      input.targetProfileId
  );
}

function buildWakeProgressFailureMessage(input: {
  errorCode?: string | null;
  runtimeDeviceDisplayName?: string | null;
  targetLabel: string;
}): string {
  const runtimeLocation = formatWakeProgressRuntimeLocation(
    input.runtimeDeviceDisplayName
  );
  const normalizedErrorCode = normalizeOptionalText(
    input.errorCode
  )?.toLowerCase();

  switch (normalizedErrorCode) {
    case "daemon.profile.offline":
    case "daemon.session.not_found":
      return `${input.targetLabel} is offline ${runtimeLocation}.`;
    case "auth.required":
    case "permission.denied.runtime":
    case "quota.exceeded":
    case "rate_limited":
      return `${input.targetLabel} needs access before it can reply.`;
    case "dispatch.storage_not_ready":
    case "dispatch.storage_unavailable":
      return "OpenMeld needs a storage update before Wake can run.";
    case "final_visible_outcome.publication_unresolved":
      return `OpenMeld could not post the final message for ${input.targetLabel}.`;
    default:
      break;
  }

  const publicFailureReason = resolveMappedPublicAgentFailureReason(
    input.errorCode
  );
  if (publicFailureReason) {
    return publicFailureReason;
  }

  switch (normalizedErrorCode) {
    case "auth.required":
    case "permission.denied.runtime":
    case "quota.exceeded":
    case "rate_limited":
      return `${input.targetLabel} needs access before it can reply.`;
    default:
      return `${input.targetLabel} couldn't reply.`;
  }
}

function shouldReplaceWakeProgressItem(input: {
  existing: WakeProgressItem;
  incoming: WakeProgressItem;
}): boolean {
  if (input.existing.terminal && !input.incoming.terminal) {
    return false;
  }

  if (
    input.incoming.phase === input.existing.phase &&
    RUNTIME_LOCATION_PHASES.has(input.incoming.phase)
  ) {
    const specificity = compareWakeProgressRuntimeSpecificity({
      existingMessage: input.existing.message,
      incomingMessage: input.incoming.message,
    });
    if (specificity === "incoming") {
      return true;
    }
    if (specificity === "existing") {
      return false;
    }
  }

  if (input.incoming.updatedAtMs >= input.existing.updatedAtMs) {
    return true;
  }
  return (
    WAKE_PROGRESS_PHASE_RANK[input.incoming.phase] >
    WAKE_PROGRESS_PHASE_RANK[input.existing.phase]
  );
}

function compareWakeProgressRuntimeSpecificity(input: {
  existingMessage: string;
  incomingMessage: string;
}): "existing" | "incoming" | "same" {
  const existingUsesGenericLocation = GENERIC_RUNTIME_LOCATION_PATTERN.test(
    input.existingMessage
  );
  const incomingUsesGenericLocation = GENERIC_RUNTIME_LOCATION_PATTERN.test(
    input.incomingMessage
  );
  if (existingUsesGenericLocation === incomingUsesGenericLocation) {
    return "same";
  }
  return incomingUsesGenericLocation ? "existing" : "incoming";
}

function shouldKeepWakeProgressItem(input: {
  item: WakeProgressItem;
  nowMs: number;
}): boolean {
  if (
    input.item.pendingInteraction &&
    input.item.pendingInteraction.expiresAtMs > input.nowMs
  ) {
    return true;
  }
  const ageMs = input.nowMs - input.item.updatedAtMs;
  if (input.item.terminal) {
    return (
      (input.item.phase === "failed" ||
        input.item.phase === "publication_unknown" ||
        input.item.phase === "stopped") &&
      ageMs <= WAKE_PROGRESS_TERMINAL_EXPIRY_MS
    );
  }
  if (input.item.phase === "sending") {
    return ageMs <= WAKE_PROGRESS_LOCAL_EXPIRY_MS;
  }
  return ACTIVE_WAKE_PROGRESS_PHASES.has(input.item.phase);
}

function findMatchingWakeProgressItemEntry(input: {
  itemsByKey: Map<string, WakeProgressItem>;
  incoming: WakeProgressItem;
}): [string, WakeProgressItem] | null {
  const incomingKeys = listWakeProgressMatchKeys(input.incoming);
  for (const [key, item] of input.itemsByKey) {
    const itemKeys = new Set(listWakeProgressMatchKeys(item));
    if (incomingKeys.some((incomingKey) => itemKeys.has(incomingKey))) {
      return [key, item];
    }
  }
  return null;
}

function listWakeProgressMatchKeys(item: WakeProgressItem): string[] {
  const keys: string[] = [];
  if (item.dispatchId) {
    keys.push(`dispatch:${item.dispatchId}`);
  }
  if (item.clientMessageId) {
    keys.push(`client:${item.clientMessageId}:target:${item.targetProfileId}`);
  }
  if (item.sourceSignalId) {
    keys.push(`source:${item.sourceSignalId}:target:${item.targetProfileId}`);
  }
  if (keys.length === 0) {
    keys.push(`target:${item.targetProfileId}`);
  }
  return keys;
}

function buildWakeProgressItemKey(item: WakeProgressItem): string {
  if (item.dispatchId) {
    return `dispatch:${item.dispatchId}`;
  }
  if (item.clientMessageId) {
    return `client:${item.clientMessageId}:target:${item.targetProfileId}`;
  }
  if (item.sourceSignalId) {
    return `source:${item.sourceSignalId}:target:${item.targetProfileId}`;
  }
  return `target:${item.targetProfileId}`;
}

function isWakeProgressTerminalSignal(signal: SignalEnvelope): boolean {
  switch (signal.type) {
    case "signal.status":
      return true;
    case "signal.system_notice":
      return isWakeClosingSystemNoticeType(signal.data.noticeType);
    case "signal.text": {
      const purpose = signal.data.meta?.purpose;
      return (
        purpose === AGENT_REPLY_FINAL_PURPOSE ||
        purpose === REMOTE_AGENT_FAILURE_PURPOSE
      );
    }
    default:
      return false;
  }
}

function doesWakeProgressTerminalSignalMatchItem(
  signal: SignalEnvelope,
  item: WakeProgressItem
): boolean {
  const targetProfileId = readWakeProgressTerminalSignalTargetProfileId(signal);
  if (targetProfileId && targetProfileId !== item.targetProfileId) {
    return false;
  }
  const dispatchId = readWakeProgressTerminalSignalDispatchId(signal);
  if (dispatchId && dispatchId === item.dispatchId) {
    return true;
  }
  const replyToSignalId = readWakeProgressTerminalSignalReplyToSignalId(signal);
  return Boolean(replyToSignalId && replyToSignalId === item.sourceSignalId);
}

function readWakeProgressTerminalSignalTargetProfileId(
  signal: SignalEnvelope
): string | null {
  switch (signal.type) {
    case "signal.status":
      return (
        normalizeOptionalText(signal.data.targetProfileId) ??
        normalizeOptionalText(signal.data.actorProfileId)
      );
    case "signal.system_notice":
      return normalizeOptionalText(signal.data.actorProfileId);
    case "signal.text":
      return (
        normalizeOptionalText(signal.data.meta?.targetProfileId) ??
        normalizeOptionalText(signal.profile?.profileId)
      );
    default:
      return null;
  }
}

function readWakeProgressTerminalSignalDispatchId(
  signal: SignalEnvelope
): string | null {
  switch (signal.type) {
    case "signal.status":
    case "signal.system_notice":
      return normalizeOptionalText(signal.data.dispatchId);
    case "signal.text":
      return normalizeOptionalText(signal.data.meta?.dispatchId);
    default:
      return null;
  }
}

function readWakeProgressTerminalSignalReplyToSignalId(
  signal: SignalEnvelope
): string | null {
  switch (signal.type) {
    case "signal.status":
    case "signal.system_notice":
      return normalizeOptionalText(signal.data.replyTo?.signalId);
    case "signal.text":
      return normalizeOptionalText(
        signal.data.messageEnvelope?.replyToSignalId ??
          signal.data.replyTo?.signalId
      );
    default:
      return null;
  }
}

function formatWakeTargetLabel(value: string): string {
  const normalized = normalizeOptionalText(value) ?? "agent";
  return normalized.startsWith("@") ? normalized : `@${normalized}`;
}

function formatWakeProgressRuntimeLocation(
  runtimeDeviceDisplayName: string | null | undefined
): string {
  const normalized = normalizeOptionalText(runtimeDeviceDisplayName);
  return normalized ? `on ${normalized}` : "on this computer";
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Wake progress phase: ${String(value)}`);
}
