import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import type {
  ComposerActivityRowViewState,
  ComposerActivityViewState,
  ComposerDispatchRowState,
  DispatchActivityActorViewState,
} from "./space-session-view-state";

export type ComposerActivitySource = {
  nowMs: number;
  rows: readonly ComposerDispatchRowState[];
};

type ComposerActivityRowCandidate = ComposerActivityRowViewState & {
  previewUpdatedAtMs: number;
  startedAtMs: number;
  updatedAtMs: number;
};

const MAX_COMPOSER_ACTIVITY_ROWS = 2;

export function buildComposerActivityViewState(
  source: ComposerActivitySource,
  spaceMembersSnapshot?: SpaceMembersSnapshot | null
): ComposerActivityViewState {
  const rowCandidates = buildComposerActivityRowCandidates({
    nowMs: source.nowMs,
    rows: source.rows,
  });
  const visibleRows = selectVisibleRows(rowCandidates);
  const leadRow = visibleRows.at(-1) ?? null;
  const actors = visibleRows.flatMap((row) => row.actors);
  const overflowCount = Math.max(0, rowCandidates.length - visibleRows.length);

  if (!leadRow) {
    return {
      visible: false,
      mode: "idle",
      rows: [],
      overflowCount: 0,
      actors: [],
      leadActor: null,
      elapsedSeconds: null,
      previewText: "",
      hint: null,
      spaceMembersSnapshot: spaceMembersSnapshot ?? null,
    };
  }

  return {
    visible: true,
    mode: leadRow.mode,
    rows: visibleRows,
    overflowCount,
    actors,
    leadActor: leadRow.leadActor,
    elapsedSeconds: leadRow.elapsedSeconds,
    previewText: leadRow.previewText,
    hint: leadRow.hint,
    spaceMembersSnapshot: spaceMembersSnapshot ?? null,
  };
}

function buildComposerActivityRowCandidates(input: {
  nowMs: number;
  rows: readonly ComposerDispatchRowState[];
}): ComposerActivityRowCandidate[] {
  return input.rows.map((row) =>
    toComposerActivityRowCandidate({
      nowMs: input.nowMs,
      row,
    })
  );
}

function toComposerActivityRowCandidate(input: {
  nowMs: number;
  row: ComposerDispatchRowState;
}): ComposerActivityRowCandidate {
  const actor = toDispatchActivityActor(input.row);
  if (input.row.stage === "replying") {
    const previewText = input.row.latestPreviewText.trim();
    return {
      key: input.row.rowId,
      mode: previewText ? "streaming" : "replying",
      targetLabel: input.row.targetLabel,
      actors: actor ? [actor] : [],
      leadActor: actor,
      elapsedSeconds: Math.max(
        0,
        Math.floor((input.nowMs - input.row.createdAtMs) / 1000)
      ),
      previewText,
      hint: null,
      previewUpdatedAtMs:
        input.row.latestPreviewUpdatedAtMs ?? Number.NEGATIVE_INFINITY,
      startedAtMs: input.row.createdAtMs,
      updatedAtMs: input.row.updatedAtMs,
    };
  }

  if (input.row.stage === "sending") {
    return {
      key: input.row.rowId,
      mode: "sending",
      targetLabel: input.row.targetLabel,
      actors: [],
      leadActor: null,
      elapsedSeconds: Math.max(
        0,
        Math.floor((input.nowMs - input.row.createdAtMs) / 1000)
      ),
      previewText: "",
      hint: input.row.statusText || "sending...",
      previewUpdatedAtMs: Number.NEGATIVE_INFINITY,
      startedAtMs: input.row.createdAtMs,
      updatedAtMs: input.row.updatedAtMs,
    };
  }

  let mode: ComposerActivityRowViewState["mode"] = "warning";
  if (input.row.stage === "dispatching") {
    mode = "dispatching";
  } else if (input.row.stage === "retrying") {
    mode = "retrying";
  }
  return {
    key: input.row.rowId,
    mode,
    targetLabel: input.row.targetLabel,
    actors: actor ? [actor] : [],
    leadActor: actor,
    elapsedSeconds: Math.max(
      0,
      Math.floor((input.nowMs - input.row.createdAtMs) / 1000)
    ),
    previewText: "",
    hint:
      input.row.warningText ||
      input.row.statusText ||
      resolveDispatchActivityHintFallback(input.row),
    previewUpdatedAtMs: Number.NEGATIVE_INFINITY,
    startedAtMs: input.row.createdAtMs,
    updatedAtMs: input.row.updatedAtMs,
  };
}

function selectVisibleRows(
  rowCandidates: readonly ComposerActivityRowCandidate[]
): ComposerActivityRowViewState[] {
  const latestRows = [...rowCandidates]
    .sort(compareComposerActivityRowsByRecencyDesc)
    .slice(0, MAX_COMPOSER_ACTIVITY_ROWS)
    .sort(compareComposerActivityRowsByRenderOrderAsc);
  return latestRows.map(
    ({ previewUpdatedAtMs, startedAtMs, updatedAtMs, ...row }) => row
  );
}

function compareComposerActivityRowsByRecencyDesc(
  left: ComposerActivityRowCandidate,
  right: ComposerActivityRowCandidate
): number {
  if (right.updatedAtMs !== left.updatedAtMs) {
    return right.updatedAtMs - left.updatedAtMs;
  }
  if (right.previewUpdatedAtMs !== left.previewUpdatedAtMs) {
    return right.previewUpdatedAtMs - left.previewUpdatedAtMs;
  }
  if (right.startedAtMs !== left.startedAtMs) {
    return right.startedAtMs - left.startedAtMs;
  }
  return left.key.localeCompare(right.key);
}

function compareComposerActivityRowsByRenderOrderAsc(
  left: ComposerActivityRowCandidate,
  right: ComposerActivityRowCandidate
): number {
  if (left.updatedAtMs !== right.updatedAtMs) {
    return left.updatedAtMs - right.updatedAtMs;
  }
  if (left.previewUpdatedAtMs !== right.previewUpdatedAtMs) {
    return left.previewUpdatedAtMs - right.previewUpdatedAtMs;
  }
  if (left.startedAtMs !== right.startedAtMs) {
    return left.startedAtMs - right.startedAtMs;
  }
  return left.key.localeCompare(right.key);
}

function toDispatchActivityActor(
  row: ComposerDispatchRowState
): DispatchActivityActorViewState | null {
  if (!row.targetProfileId) {
    return null;
  }
  return {
    profileId: row.targetProfileId,
    label: row.targetLabel,
    startedAtMs: row.createdAtMs,
    updatedAtMs: row.updatedAtMs,
    latestPreviewText: row.latestPreviewText,
    latestPreviewUpdatedAtMs: row.latestPreviewUpdatedAtMs,
  };
}

function resolveDispatchActivityHintFallback(
  row: ComposerDispatchRowState
): string {
  if (row.stage === "dispatching") {
    return `${row.targetLabel} is dispatching...`;
  }
  if (row.stage === "retrying") {
    return `${row.targetLabel} is retrying...`;
  }
  return `${row.targetLabel} couldn't reply right now`;
}
