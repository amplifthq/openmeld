import { normalizePendingOutboundSourceText } from "./pending-outbound-confirmation";
import {
  buildPendingOutboundDispatchRowDrafts,
  formatPendingOutboundStatusText,
} from "./pending-outbound-status";
import type { ComposerDispatchRowState } from "./view/space-session-view-state";

export function buildPendingHumanSendRowId(clientMessageId: string): string {
  return `pending:${clientMessageId}`;
}

export function upsertPendingHumanSendRow(input: {
  enableLocalEcho: boolean;
  rowsById: Map<string, ComposerDispatchRowState>;
  text: string;
  clientMessageId: string;
  terminalColumns: number | null;
  nowMs: number;
  maxPendingRows: number;
}): boolean {
  if (!input.enableLocalEcho) {
    return false;
  }

  const draft =
    buildPendingOutboundDispatchRowDrafts({
      pendingText: input.text,
      terminalColumns: input.terminalColumns,
    })[0] ?? null;
  if (!draft) {
    return false;
  }

  const rowId = buildPendingHumanSendRowId(input.clientMessageId);
  input.rowsById.set(rowId, {
    rowId,
    dispatchId: null,
    sourceEventId: null,
    sourceClientMessageId: input.clientMessageId,
    sourceTextSnapshot: normalizePendingOutboundSourceText(input.text),
    targetProfileId: null,
    targetMentionLabel: null,
    targetLabel: "",
    stage: "sending",
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    expiresAtMs: null,
    latestPreviewText: "",
    latestPreviewUpdatedAtMs: null,
    statusText: draft.statusText,
    warningText: "",
  });
  trimPendingHumanSendRows(input.rowsById, input.maxPendingRows);
  return true;
}

export function clearPendingHumanSendRowsByClientMessageId(input: {
  rowsById: Map<string, ComposerDispatchRowState>;
  clientMessageId: string | null;
}): boolean {
  if (!input.clientMessageId) {
    return false;
  }

  const rowId = buildPendingHumanSendRowId(input.clientMessageId);
  if (!input.rowsById.has(rowId)) {
    return false;
  }
  input.rowsById.delete(rowId);
  return true;
}

export function buildPendingHumanSendStatusText(input: {
  text: string;
  terminalColumns: number | null;
}): string {
  return formatPendingOutboundStatusText({
    pendingText: input.text,
    terminalColumns: input.terminalColumns,
  });
}

function trimPendingHumanSendRows(
  rowsById: Map<string, ComposerDispatchRowState>,
  maxPendingRows: number
): void {
  if (rowsById.size <= maxPendingRows) {
    return;
  }

  const removableRows = [...rowsById.values()]
    .filter(
      (row) =>
        row.stage === "sending" &&
        row.dispatchId === null &&
        row.sourceEventId === null
    )
    .sort((left, right) => left.createdAtMs - right.createdAtMs);

  while (rowsById.size > maxPendingRows && removableRows.length > 0) {
    const oldestRow = removableRows.shift();
    if (!oldestRow) {
      break;
    }
    rowsById.delete(oldestRow.rowId);
  }
}
