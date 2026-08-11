import type { SignalEnvelope, SignalTextEnvelope } from "@openmeld/protocol";
import {
  AGENT_REPLY_PREVIEW_END_PURPOSE,
  AGENT_REPLY_PREVIEW_PURPOSE,
  AGENT_REPLYING_END_PURPOSE,
  AGENT_REPLYING_PURPOSE,
  CONVERSATION_CONTINUITY_WARNING_PURPOSE,
  DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
  DISPATCH_ACTIVITY_FAILED_PURPOSE,
  DISPATCH_ACTIVITY_RETRYING_PURPOSE,
} from "@openmeld/schemas";
import stringWidth from "string-width";
import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";
import type { ComposerDispatchRowState } from "./view/space-session-view-state";

const REPLYING_HINT_FALLBACK_CLEAR_MS = 180_000;
const REPLYING_STATUS_SYSTEM_LABEL = "📣 system";
const REPLYING_STATUS_AGENT_LABEL = "🤖";
const PREVIEW_MAX_VISIBLE_CHARS = 240;
const PREVIEW_MIN_VISIBLE_CHARS = 24;
const PREVIEW_ELLIPSIS = "...";
const REPLYING_TARGET_LABEL_REGEX = /^(@[^\s]+)\s+is replying\.\.\.$/u;

type DispatchActivityRowState = ComposerDispatchRowState;

type DispatchActivityEventIdentity = {
  dispatchId: string;
  sourceClientMessageId: string | null;
  sourceEventId: string | null;
  targetLabel: string;
  targetProfileId: string;
};

type DispatchActivityEvent =
  | {
      kind: "dispatching";
      dispatchId: string;
      sourceClientMessageId: string | null;
      sourceEventId: string | null;
      targetProfileId: string;
      targetLabel: string;
      text: string;
    }
  | {
      kind: "retrying";
      dispatchId: string;
      sourceClientMessageId: string | null;
      sourceEventId: string | null;
      targetProfileId: string;
      targetLabel: string;
      text: string;
    }
  | {
      kind: "replying_start";
      dispatchId: string;
      sourceClientMessageId: string | null;
      sourceEventId: string | null;
      targetProfileId: string;
      targetLabel: string;
    }
  | {
      kind: "preview";
      dispatchId: string;
      sourceClientMessageId: string | null;
      sourceEventId: string | null;
      targetProfileId: string;
      targetLabel: string;
      previewText: string;
    }
  | {
      kind: "preview_end";
      dispatchId: string;
      sourceClientMessageId: string | null;
      sourceEventId: string | null;
      targetProfileId: string;
    }
  | {
      kind: "warning";
      dispatchId: string;
      sourceClientMessageId: string | null;
      sourceEventId: string | null;
      targetProfileId: string;
      targetLabel: string;
      text: string;
      preserveActivityMode: boolean;
    }
  | {
      kind: "end";
      dispatchId: string;
      sourceClientMessageId: string | null;
      sourceEventId: string | null;
      targetProfileId: string;
    };

export function clearUnconfirmedPendingOutboundRows(
  rowsById: Map<string, DispatchActivityRowState>
): boolean {
  let changed = false;
  for (const [rowId, row] of rowsById) {
    if (
      row.stage === "sending" &&
      row.dispatchId === null &&
      row.sourceEventId === null
    ) {
      rowsById.delete(rowId);
      changed = true;
    }
  }
  return changed;
}

export function pruneExpiredDispatchRows(
  rowsById: Map<string, DispatchActivityRowState>,
  nowMs: number
): boolean {
  let changed = false;
  for (const [rowId, row] of rowsById) {
    if (typeof row.expiresAtMs !== "number" || row.expiresAtMs > nowMs) {
      continue;
    }
    rowsById.delete(rowId);
    changed = true;
  }
  return changed;
}

export function resolveNearestDispatchRowExpiryMs(
  rowsById: Map<string, DispatchActivityRowState>
): number | null {
  let nearestExpiryMs: number | null = null;
  for (const row of rowsById.values()) {
    if (typeof row.expiresAtMs !== "number") {
      continue;
    }
    if (nearestExpiryMs === null || row.expiresAtMs < nearestExpiryMs) {
      nearestExpiryMs = row.expiresAtMs;
    }
  }
  return nearestExpiryMs;
}

export function resolveDispatchRowStatusTexts(input: {
  rowsById: Map<string, DispatchActivityRowState>;
  terminalColumns: number | null;
}): string[] {
  if (input.rowsById.size === 0) {
    return [];
  }
  return [...input.rowsById.values()]
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .map((state) =>
      formatReplyingStatusText({
        state,
        terminalColumns: input.terminalColumns,
      })
    );
}

export function toComposerDispatchRows(
  rowsById: Map<string, DispatchActivityRowState>
): ComposerDispatchRowState[] {
  return [...rowsById.values()];
}

function toDispatchActivityEventIdentity(
  event: DispatchActivityEvent
): DispatchActivityEventIdentity {
  return {
    dispatchId: event.dispatchId,
    sourceClientMessageId: event.sourceClientMessageId,
    sourceEventId: event.sourceEventId,
    targetLabel:
      "targetLabel" in event ? event.targetLabel : event.targetProfileId,
    targetProfileId: event.targetProfileId,
  };
}

function buildDispatchActivityRowId(input: {
  identity: DispatchActivityEventIdentity;
}): string {
  return `dispatch:${input.identity.dispatchId}`;
}

function findMatchingDispatchActivityRowEntry(input: {
  identity: DispatchActivityEventIdentity;
  rowsById: Map<string, DispatchActivityRowState>;
}): [string, DispatchActivityRowState] | null {
  for (const entry of input.rowsById) {
    if (entry[1].dispatchId === input.identity.dispatchId) {
      return entry;
    }
  }
  if (input.identity.sourceEventId && input.identity.targetProfileId) {
    for (const entry of input.rowsById) {
      if (
        entry[1].sourceEventId === input.identity.sourceEventId &&
        entry[1].targetProfileId === input.identity.targetProfileId
      ) {
        return entry;
      }
    }
  }
  if (input.identity.sourceClientMessageId && input.identity.targetProfileId) {
    for (const entry of input.rowsById) {
      if (
        entry[1].sourceClientMessageId ===
          input.identity.sourceClientMessageId &&
        entry[1].targetProfileId === input.identity.targetProfileId
      ) {
        return entry;
      }
    }
  }
  return null;
}

function mergeDispatchActivityIdentity(input: {
  event: DispatchActivityEvent;
  existing: DispatchActivityRowState | null;
  nowMs: number;
  rowId: string;
}): DispatchActivityRowState {
  return {
    rowId: input.rowId,
    dispatchId: input.event.dispatchId,
    sourceEventId:
      input.event.sourceEventId ?? input.existing?.sourceEventId ?? null,
    sourceClientMessageId:
      input.event.sourceClientMessageId ??
      input.existing?.sourceClientMessageId ??
      null,
    sourceTextSnapshot: input.existing?.sourceTextSnapshot ?? null,
    targetProfileId:
      input.event.targetProfileId ?? input.existing?.targetProfileId ?? null,
    targetLabel:
      ("targetLabel" in input.event ? input.event.targetLabel : null) ??
      input.existing?.targetLabel ??
      input.event.targetProfileId,
    targetMentionLabel:
      ("targetLabel" in input.event ? input.event.targetLabel : null) ??
      input.existing?.targetMentionLabel ??
      null,
    stage: input.existing?.stage ?? "dispatching",
    createdAtMs: input.existing?.createdAtMs ?? input.nowMs,
    updatedAtMs: input.nowMs,
    expiresAtMs: input.existing?.expiresAtMs ?? null,
    latestPreviewText: input.existing?.latestPreviewText ?? "",
    latestPreviewUpdatedAtMs: input.existing?.latestPreviewUpdatedAtMs ?? null,
    statusText: input.existing?.statusText ?? "",
    warningText: input.existing?.warningText ?? "",
  };
}

export function clearDispatchActivitiesForSignal(input: {
  rowsById: Map<string, DispatchActivityRowState>;
  event: SignalEnvelope;
}): boolean {
  if (input.rowsById.size === 0) {
    return false;
  }
  const terminalSignal = resolveTerminalDispatchActivitySignal(input.event);
  if (!terminalSignal) {
    return false;
  }
  const { dispatchId, senderProfileId } = terminalSignal;
  if (dispatchId) {
    for (const [rowId, row] of input.rowsById) {
      if (row.dispatchId !== dispatchId) {
        continue;
      }
      input.rowsById.delete(rowId);
      return true;
    }
  }

  let latestRowId: string | null = null;
  let latestUpdatedAtMs = Number.NEGATIVE_INFINITY;
  for (const [rowId, row] of input.rowsById) {
    if (row.targetProfileId !== senderProfileId || row.stage === "sending") {
      continue;
    }
    if (row.updatedAtMs > latestUpdatedAtMs) {
      latestUpdatedAtMs = row.updatedAtMs;
      latestRowId = rowId;
    }
  }
  if (!latestRowId) {
    return false;
  }
  input.rowsById.delete(latestRowId);
  return true;
}

function resolveTerminalDispatchActivitySignal(event: SignalEnvelope): {
  dispatchId: string | null;
  senderProfileId: string | null;
} | null {
  if (event.type === "signal.text") {
    if (!resolveNonTransientSignalText(event)) {
      return null;
    }
    return {
      dispatchId: resolveReplyingSignalDispatchId(event),
      senderProfileId: normalizeOptionalMetaText(event.profile?.profileId),
    };
  }

  if (event.type === "signal.status") {
    return {
      dispatchId: normalizeOptionalMetaText(event.data.dispatchId),
      senderProfileId: normalizeOptionalMetaText(event.data.actorProfileId),
    };
  }

  if (event.type === "signal.system_notice") {
    return {
      dispatchId: normalizeOptionalMetaText(event.data.dispatchId),
      senderProfileId: normalizeOptionalMetaText(event.data.actorProfileId),
    };
  }

  return null;
}

function upsertDispatchActivityStatusState(input: {
  rowsById: Map<string, DispatchActivityRowState>;
  event: DispatchActivityEvent;
  nowMs: number;
}): boolean {
  const existingEntry = findMatchingDispatchActivityRowEntry({
    identity: toDispatchActivityEventIdentity(input.event),
    rowsById: input.rowsById,
  });
  const existing = existingEntry?.[1] ?? null;
  const rowId =
    existingEntry?.[0] ??
    buildDispatchActivityRowId({
      identity: toDispatchActivityEventIdentity(input.event),
    });

  switch (input.event.kind) {
    case "end":
      return existingEntry ? input.rowsById.delete(existingEntry[0]) : false;
    case "preview_end":
      return applyPreviewEndDispatchActivityState({
        existing,
        map: input.rowsById,
        rowId,
        nowMs: input.nowMs,
      });
    case "warning":
      return applyWarningDispatchActivityState({
        existing,
        event: input.event,
        map: input.rowsById,
        rowId,
        nowMs: input.nowMs,
      });
    case "dispatching":
    case "retrying":
      return applyStatusDispatchActivityState({
        existing,
        event: input.event,
        map: input.rowsById,
        rowId,
        nowMs: input.nowMs,
      });
    case "replying_start":
      return applyReplyingStartDispatchActivityState({
        existing,
        event: input.event,
        map: input.rowsById,
        rowId,
        nowMs: input.nowMs,
      });
    case "preview":
      return applyPreviewDispatchActivityState({
        existing,
        event: input.event,
        map: input.rowsById,
        rowId,
        nowMs: input.nowMs,
      });
    default:
      return false;
  }
}

function applyPreviewEndDispatchActivityState(input: {
  existing: DispatchActivityRowState | null;
  map: Map<string, DispatchActivityRowState>;
  rowId: string;
  nowMs: number;
}): boolean {
  if (!input.existing) {
    return false;
  }
  input.map.set(input.rowId, {
    ...input.existing,
    updatedAtMs: input.nowMs,
    latestPreviewText: "",
    latestPreviewUpdatedAtMs: null,
    expiresAtMs: input.nowMs + REPLYING_HINT_FALLBACK_CLEAR_MS,
    warningText: "",
  });
  return true;
}

function applyWarningDispatchActivityState(input: {
  existing: DispatchActivityRowState | null;
  event: Extract<DispatchActivityEvent, { kind: "warning" }>;
  map: Map<string, DispatchActivityRowState>;
  rowId: string;
  nowMs: number;
}): boolean {
  if (
    input.event.preserveActivityMode &&
    input.existing?.stage === "replying"
  ) {
    input.map.set(input.rowId, {
      ...input.existing,
      updatedAtMs: input.nowMs,
      expiresAtMs: input.nowMs + REPLYING_HINT_FALLBACK_CLEAR_MS,
      statusText: input.event.text,
      warningText: input.event.text,
    });
    return true;
  }

  input.map.set(input.rowId, {
    ...mergeDispatchActivityIdentity({
      event: input.event,
      existing: input.existing,
      nowMs: input.nowMs,
      rowId: input.rowId,
    }),
    stage: "warning",
    updatedAtMs: input.nowMs,
    latestPreviewText: "",
    latestPreviewUpdatedAtMs: null,
    expiresAtMs: input.nowMs + REPLYING_HINT_FALLBACK_CLEAR_MS,
    statusText: input.event.text,
    warningText: input.event.text,
  });
  return true;
}

function applyStatusDispatchActivityState(input: {
  existing: DispatchActivityRowState | null;
  event: Extract<DispatchActivityEvent, { kind: "dispatching" | "retrying" }>;
  map: Map<string, DispatchActivityRowState>;
  rowId: string;
  nowMs: number;
}): boolean {
  input.map.set(input.rowId, {
    ...mergeDispatchActivityIdentity({
      event: input.event,
      existing: input.existing,
      nowMs: input.nowMs,
      rowId: input.rowId,
    }),
    stage: input.event.kind === "dispatching" ? "dispatching" : "retrying",
    updatedAtMs: input.nowMs,
    latestPreviewText: "",
    latestPreviewUpdatedAtMs: null,
    expiresAtMs: input.nowMs + REPLYING_HINT_FALLBACK_CLEAR_MS,
    statusText: input.event.text,
    warningText: "",
  });
  return true;
}

function applyReplyingStartDispatchActivityState(input: {
  existing: DispatchActivityRowState | null;
  event: Extract<DispatchActivityEvent, { kind: "replying_start" }>;
  map: Map<string, DispatchActivityRowState>;
  rowId: string;
  nowMs: number;
}): boolean {
  input.map.set(input.rowId, {
    ...mergeDispatchActivityIdentity({
      event: input.event,
      existing: input.existing,
      nowMs: input.nowMs,
      rowId: input.rowId,
    }),
    stage: "replying",
    updatedAtMs: input.nowMs,
    latestPreviewText: input.existing?.latestPreviewText ?? "",
    latestPreviewUpdatedAtMs: input.existing?.latestPreviewUpdatedAtMs ?? null,
    expiresAtMs: input.nowMs + REPLYING_HINT_FALLBACK_CLEAR_MS,
    statusText: input.existing?.statusText ?? "",
    warningText: "",
  });
  return true;
}

function applyPreviewDispatchActivityState(input: {
  existing: DispatchActivityRowState | null;
  event: Extract<DispatchActivityEvent, { kind: "preview" }>;
  map: Map<string, DispatchActivityRowState>;
  rowId: string;
  nowMs: number;
}): boolean {
  input.map.set(input.rowId, {
    ...mergeDispatchActivityIdentity({
      event: input.event,
      existing: input.existing,
      nowMs: input.nowMs,
      rowId: input.rowId,
    }),
    stage: "replying",
    updatedAtMs: input.nowMs,
    latestPreviewText: input.event.previewText,
    latestPreviewUpdatedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + REPLYING_HINT_FALLBACK_CLEAR_MS,
    statusText: input.existing?.statusText ?? "",
    warningText: "",
  });
  return true;
}

export function applyDispatchActivityEventToStatusMap(input: {
  rowsById: Map<string, DispatchActivityRowState>;
  event: SignalEnvelope;
  nowMs: number;
}): boolean {
  const hintEvent = resolveDispatchActivityEvent(input.event);
  if (!hintEvent) {
    return false;
  }
  return upsertDispatchActivityStatusState({
    rowsById: input.rowsById,
    event: hintEvent,
    nowMs: input.nowMs,
  });
}

function formatReplyingStatusText(input: {
  state: DispatchActivityRowState;
  terminalColumns: number | null;
}): string {
  if (input.state.stage === "sending") {
    return input.state.statusText || "sending...";
  }
  if (input.state.stage === "warning") {
    return input.state.warningText || input.state.statusText;
  }
  if (input.state.stage === "dispatching" || input.state.stage === "retrying") {
    return (
      input.state.statusText ||
      `${input.state.targetLabel} ${
        input.state.stage === "dispatching"
          ? "is dispatching..."
          : "is retrying..."
      }`
    );
  }
  if (input.state.warningText) {
    return input.state.warningText;
  }
  const previewText = input.state.latestPreviewText.trim();
  if (!previewText) {
    return `${input.state.targetLabel} is replying...`;
  }
  const previewPrefix = `${input.state.targetLabel} preview: `;
  const maxPreviewWidth = resolvePreviewContentWidth({
    previewPrefix,
    terminalColumns: input.terminalColumns,
  });
  const previewHead = truncatePreviewHead(previewText, maxPreviewWidth);
  return `${previewPrefix}${previewHead}`;
}

function isDispatchActivityPurpose(purpose: string): boolean {
  return (
    purpose === AGENT_REPLYING_PURPOSE ||
    purpose === AGENT_REPLYING_END_PURPOSE ||
    purpose === CONVERSATION_CONTINUITY_WARNING_PURPOSE ||
    purpose === AGENT_REPLY_PREVIEW_PURPOSE ||
    purpose === AGENT_REPLY_PREVIEW_END_PURPOSE ||
    purpose === DISPATCH_ACTIVITY_DISPATCHING_PURPOSE ||
    purpose === DISPATCH_ACTIVITY_RETRYING_PURPOSE ||
    purpose === DISPATCH_ACTIVITY_FAILED_PURPOSE
  );
}

function resolveDispatchActivityBase(event: SignalEnvelope): {
  event: SignalTextEnvelope;
  meta: Record<string, unknown>;
  purpose: string;
  dispatchId: string;
  sourceClientMessageId: string | null;
  sourceEventId: string | null;
  targetProfileId: string;
} | null {
  if (event.type !== "signal.text") {
    return null;
  }

  const meta = resolveSignalTextMetaFromEnvelope(event);
  if (meta?.transient !== true) {
    return null;
  }

  const purpose = String(meta.purpose ?? "").trim();
  if (!isDispatchActivityPurpose(purpose)) {
    return null;
  }

  const dispatchId = String(meta.dispatchId ?? "").trim();
  if (!dispatchId) {
    return null;
  }

  const targetProfileId = String(meta.targetProfileId ?? "").trim();
  if (!targetProfileId) {
    return null;
  }

  return {
    event,
    meta,
    purpose,
    dispatchId,
    sourceClientMessageId: normalizeOptionalMetaText(
      meta.sourceClientMessageId
    ),
    sourceEventId: normalizeOptionalMetaText(meta.sourceEventId),
    targetProfileId,
  };
}

function resolveDispatchActivityTargetLabel(input: {
  event: SignalTextEnvelope;
  purpose: string;
  meta: Record<string, unknown>;
  targetProfileId: string;
}): string {
  return (
    normalizeOptionalMetaText(input.meta.targetLabel) ??
    (input.purpose === AGENT_REPLYING_PURPOSE
      ? extractReplyingTargetLabelFromText(String(input.event.data?.text ?? ""))
      : null) ??
    normalizeOptionalMetaText(input.meta.targetProfileName) ??
    normalizeOptionalMetaText(input.event.profile?.profileName) ??
    input.targetProfileId
  );
}

function resolveContinuityWarningText(
  event: SignalTextEnvelope
): string | null {
  const text = sanitizeTerminalDisplayText(
    event.data.text,
    "single-line"
  ).trim();
  return text || null;
}

export function resolveDispatchActivityEvent(
  event: SignalEnvelope
): DispatchActivityEvent | null {
  const base = resolveDispatchActivityBase(event);
  if (!base) {
    return null;
  }

  const {
    event: textEvent,
    dispatchId,
    meta,
    purpose,
    sourceClientMessageId,
    sourceEventId,
    targetProfileId,
  } = base;
  if (purpose === AGENT_REPLYING_END_PURPOSE) {
    return {
      kind: "end",
      dispatchId,
      sourceClientMessageId,
      sourceEventId,
      targetProfileId,
    };
  }

  const targetLabel = resolveDispatchActivityTargetLabel({
    event: textEvent,
    purpose,
    meta,
    targetProfileId,
  });

  if (purpose === DISPATCH_ACTIVITY_DISPATCHING_PURPOSE) {
    const text = resolveContinuityWarningText(textEvent);
    if (!text) {
      return null;
    }
    return {
      kind: "dispatching",
      dispatchId,
      sourceClientMessageId,
      sourceEventId,
      targetProfileId,
      targetLabel,
      text,
    };
  }

  if (purpose === DISPATCH_ACTIVITY_RETRYING_PURPOSE) {
    const text = resolveContinuityWarningText(textEvent);
    if (!text) {
      return null;
    }
    return {
      kind: "retrying",
      dispatchId,
      sourceClientMessageId,
      sourceEventId,
      targetProfileId,
      targetLabel,
      text,
    };
  }

  if (purpose === AGENT_REPLY_PREVIEW_PURPOSE) {
    const previewText = normalizePreviewDisplayText(textEvent.data.text);
    if (!previewText) {
      return null;
    }
    return {
      kind: "preview",
      dispatchId,
      sourceClientMessageId,
      sourceEventId,
      targetProfileId,
      targetLabel,
      previewText,
    };
  }

  if (purpose === AGENT_REPLY_PREVIEW_END_PURPOSE) {
    return {
      kind: "preview_end",
      dispatchId,
      sourceClientMessageId,
      sourceEventId,
      targetProfileId,
    };
  }

  if (purpose === CONVERSATION_CONTINUITY_WARNING_PURPOSE) {
    const text = resolveContinuityWarningText(textEvent);
    if (!text) {
      return null;
    }
    return {
      kind: "warning",
      dispatchId,
      sourceClientMessageId,
      sourceEventId,
      targetProfileId,
      targetLabel,
      text,
      preserveActivityMode: true,
    };
  }

  if (purpose === DISPATCH_ACTIVITY_FAILED_PURPOSE) {
    const text = resolveContinuityWarningText(textEvent);
    if (!text) {
      return null;
    }
    return {
      kind: "warning",
      dispatchId,
      sourceClientMessageId,
      sourceEventId,
      targetProfileId,
      targetLabel,
      text,
      preserveActivityMode: false,
    };
  }

  return {
    kind: "replying_start",
    dispatchId,
    sourceClientMessageId,
    sourceEventId,
    targetProfileId,
    targetLabel,
  };
}

export function resolveNonTransientSignalText(
  event: SignalEnvelope
): string | null {
  if (event.type !== "signal.text") {
    return null;
  }
  const meta = resolveSignalTextMetaFromEnvelope(event);
  if (meta?.transient === true) {
    return null;
  }
  const text = sanitizeTerminalDisplayText(
    event.data.text,
    "multi-line"
  ).trim();
  return text || null;
}

export function resolveSignalTextMetaFromEnvelope(
  event: SignalEnvelope
): Record<string, unknown> | null {
  if (event.type !== "signal.text") {
    return null;
  }
  if (
    !event.data ||
    typeof event.data !== "object" ||
    Array.isArray(event.data)
  ) {
    return null;
  }
  const meta = (event.data as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }
  return meta as Record<string, unknown>;
}

export function resolveSignalClientMessageId(
  event: SignalEnvelope
): string | null {
  return normalizeOptionalMetaText(
    resolveSignalTextMetaFromEnvelope(event)?.clientMessageId
  );
}

function normalizePreviewDisplayText(value: string): string {
  return sanitizeTerminalDisplayText(value, "single-line")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveReplyingStatusColumns(): number | null {
  if (!(process.stdout.isTTY && typeof process.stdout.columns === "number")) {
    return null;
  }
  const normalizedColumns = Math.trunc(process.stdout.columns);
  return normalizedColumns > 0 ? normalizedColumns : null;
}

function resolvePreviewContentWidth(input: {
  previewPrefix: string;
  terminalColumns: number | null;
}): number {
  const prefixWidth = stringWidth(
    `* ${REPLYING_STATUS_SYSTEM_LABEL} · ${REPLYING_STATUS_AGENT_LABEL} ${input.previewPrefix}`
  );
  if (input.terminalColumns === null) {
    return PREVIEW_MAX_VISIBLE_CHARS;
  }
  const availableWidth = input.terminalColumns - prefixWidth;
  return Math.max(
    PREVIEW_MIN_VISIBLE_CHARS,
    Math.min(PREVIEW_MAX_VISIBLE_CHARS, availableWidth)
  );
}

function truncatePreviewHead(value: string, maxWidth: number): string {
  if (stringWidth(value) <= maxWidth) {
    return value;
  }
  const truncatedWidth = Math.max(0, maxWidth - stringWidth(PREVIEW_ELLIPSIS));
  let head = "";
  for (const char of value) {
    if (stringWidth(head) + stringWidth(char) > truncatedWidth) {
      break;
    }
    head += char;
  }
  return `${head}${PREVIEW_ELLIPSIS}`;
}

export function countRenderedTerminalRows(text: string): number {
  const columns = resolveReplyingStatusColumns();
  const lines = text.split("\n");
  if (columns === null) {
    return Math.max(1, lines.length);
  }
  let totalRows = 0;
  for (const line of lines) {
    totalRows += Math.max(1, Math.ceil(stringWidth(line) / columns));
  }
  return Math.max(1, totalRows);
}

function normalizeOptionalMetaText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function extractReplyingTargetLabelFromText(text: string): string | null {
  const normalized = sanitizeTerminalDisplayText(text, "single-line").trim();
  const match = REPLYING_TARGET_LABEL_REGEX.exec(normalized);
  return match?.[1] ?? null;
}

function resolveReplyingSignalDispatchId(event: SignalEnvelope): string {
  const meta = resolveSignalTextMetaFromEnvelope(event);
  return String(meta?.dispatchId ?? "").trim();
}
