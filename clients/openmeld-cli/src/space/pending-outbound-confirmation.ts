import type { SignalEnvelope } from "@openmeld/protocol";
import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";
import type { ComposerDispatchRowState } from "./view/space-session-view-state";

export function normalizePendingOutboundSourceText(
  value: string | null | undefined
): string | null {
  const normalized = sanitizeTerminalDisplayText(
    String(value ?? ""),
    "single-line"
  )
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

export function confirmPendingOutboundRows(input: {
  rowsById: Map<string, ComposerDispatchRowState>;
  clientMessageId: string | null;
}): boolean {
  if (!input.clientMessageId) {
    return false;
  }
  let changed = false;
  for (const [rowId, row] of input.rowsById) {
    if (row.sourceClientMessageId !== input.clientMessageId) {
      continue;
    }
    input.rowsById.delete(rowId);
    changed = true;
  }
  return changed;
}

export function confirmPendingOutboundRowsForSignal(input: {
  rowsById: Map<string, ComposerDispatchRowState>;
  event: SignalEnvelope;
  selfProfileId: string;
}): boolean {
  if (input.event.type !== "signal.text") {
    return false;
  }
  const profileId = normalizeOptionalText(input.event.profile?.profileId);
  if (!profileId || profileId !== input.selfProfileId) {
    return false;
  }
  const sourceEventId = normalizeOptionalText(input.event.id);
  if (!sourceEventId) {
    return false;
  }

  const clientMessageId = resolveSignalClientMessageId(input.event);
  if (
    confirmPendingOutboundRows({
      rowsById: input.rowsById,
      clientMessageId,
    })
  ) {
    return true;
  }

  const fallbackClientMessageId = resolveOldestPendingClientMessageIdByText({
    rowsById: input.rowsById,
    normalizedText: normalizePendingOutboundSourceText(input.event.data.text),
  });
  if (!fallbackClientMessageId) {
    return false;
  }

  return confirmPendingOutboundRows({
    rowsById: input.rowsById,
    clientMessageId: fallbackClientMessageId,
  });
}

function resolveOldestPendingClientMessageIdByText(input: {
  rowsById: Map<string, ComposerDispatchRowState>;
  normalizedText: string | null;
}): string | null {
  if (!input.normalizedText) {
    return null;
  }

  const oldestCreatedAtByClientMessageId = new Map<string, number>();
  for (const row of input.rowsById.values()) {
    if (
      row.stage !== "sending" ||
      row.sourceEventId !== null ||
      row.sourceTextSnapshot !== input.normalizedText
    ) {
      continue;
    }
    const clientMessageId = normalizeOptionalText(row.sourceClientMessageId);
    if (!clientMessageId) {
      continue;
    }
    const previousCreatedAtMs =
      oldestCreatedAtByClientMessageId.get(clientMessageId);
    if (
      previousCreatedAtMs === undefined ||
      row.createdAtMs < previousCreatedAtMs
    ) {
      oldestCreatedAtByClientMessageId.set(clientMessageId, row.createdAtMs);
    }
  }

  let matchedClientMessageId: string | null = null;
  let matchedCreatedAtMs = Number.POSITIVE_INFINITY;
  for (const [
    clientMessageId,
    createdAtMs,
  ] of oldestCreatedAtByClientMessageId) {
    if (createdAtMs >= matchedCreatedAtMs) {
      continue;
    }
    matchedClientMessageId = clientMessageId;
    matchedCreatedAtMs = createdAtMs;
  }
  return matchedClientMessageId;
}

function resolveSignalClientMessageId(event: SignalEnvelope): string | null {
  const meta =
    event.data && typeof event.data === "object" && !Array.isArray(event.data)
      ? (event.data as { meta?: unknown }).meta
      : null;
  if (!(meta && typeof meta === "object") || Array.isArray(meta)) {
    return null;
  }
  return normalizeOptionalText(
    (meta as { clientMessageId?: unknown }).clientMessageId
  );
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
