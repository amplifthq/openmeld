import type { SignalEnvelope } from "@openmeld/protocol";
import {
  getSpaceUpdatesResponseSchema,
  SPACE_UPDATES_MAX_LIMIT,
} from "@openmeld/schemas";
import type { GetSpaceUpdatesResponse } from "@openmeld/schemas/types";
import {
  listSignalEntriesAfterAnchor,
  readSignalEntryById,
} from "../infrastructure/sql/space-signal-repo";
import { readSpaceThreadSignalPlacementBySignalId } from "../infrastructure/sql/space-thread-repo";
import { isFormalSpaceUpdateSignal } from "../rules/formal-space-update";
import { parseStoredSignal } from "../rules/parsers/stored-signal";
import { redactSignalForViewer } from "../rules/privacy/agent-profile-visibility";

const SPACE_UPDATES_SCAN_MULTIPLIER = 5;
const SPACE_UPDATES_SCAN_FLOOR_LIMIT = 50;
const SPACE_UPDATES_SCAN_MAX_LIMIT = 500;

export class SpaceUpdatesAnchorNotFoundError extends Error {
  readonly code = "space.updates.anchor_not_found";

  constructor(signalId: string) {
    super(`space update anchor not found: ${signalId}`);
    this.name = "SpaceUpdatesAnchorNotFoundError";
  }
}

export function readSpaceUpdatesUseCase(input: {
  sql: SqlStorage;
  afterSignalId: string;
  limit: number;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  viewerCreatorProfileIdsByProfileId?: Record<string, string | null>;
}): GetSpaceUpdatesResponse {
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > SPACE_UPDATES_MAX_LIMIT
  ) {
    throw new Error("space updates limit is invalid");
  }

  const signals = collectSignalsAfterAnchor({
    sql: input.sql,
    afterSignalId: input.afterSignalId,
    limit: input.limit,
    viewerOwnerUserId: input.viewerOwnerUserId,
    viewerProfileId: input.viewerProfileId,
    viewerCreatorProfileIdsByProfileId:
      input.viewerCreatorProfileIdsByProfileId,
  });

  const parsed = getSpaceUpdatesResponseSchema.safeParse({
    signals,
  });
  if (!parsed.success) {
    throw new Error("space updates response is invalid");
  }
  return parsed.data;
}

function collectSignalsAfterAnchor(input: {
  sql: SqlStorage;
  afterSignalId: string;
  limit: number;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  viewerCreatorProfileIdsByProfileId?: Record<string, string | null>;
}): SignalEnvelope[] {
  const scanLimit = Math.min(
    SPACE_UPDATES_SCAN_MAX_LIMIT,
    Math.max(
      input.limit * SPACE_UPDATES_SCAN_MULTIPLIER,
      SPACE_UPDATES_SCAN_FLOOR_LIMIT
    )
  );
  const page = listSignalEntriesAfterAnchor(input.sql, {
    afterSignalId: input.afterSignalId,
    limit: scanLimit,
  });
  if (!page) {
    throw new SpaceUpdatesAnchorNotFoundError(input.afterSignalId);
  }

  const signals: SignalEnvelope[] = [];
  for (const [, rawSignal] of page.entries) {
    const signal = parseStoredSignal(rawSignal);
    const changedMessageId = readChangedMessageId(signal);
    if (!(signal && (isFormalSpaceUpdateSignal(signal) || changedMessageId))) {
      continue;
    }
    const placement = readSpaceThreadSignalPlacementBySignalId(
      input.sql,
      signal.id
    );
    if (placement?.placement === "thread") {
      continue;
    }
    if (changedMessageId) {
      const entry = readSignalEntryById(input.sql, changedMessageId);
      const current = entry ? parseStoredSignal(entry[1]) : null;
      if (current) {
        signals.push(
          redactSignalForViewer({
            signal: current,
            viewerOwnerUserId: input.viewerOwnerUserId,
            viewerProfileId: input.viewerProfileId,
            creatorProfileIdByProfileId:
              input.viewerCreatorProfileIdsByProfileId,
          })
        );
      }
    }
    signals.push(
      redactSignalForViewer({
        signal,
        viewerOwnerUserId: input.viewerOwnerUserId,
        viewerProfileId: input.viewerProfileId,
        creatorProfileIdByProfileId: input.viewerCreatorProfileIdsByProfileId,
      })
    );
    if (signals.length >= input.limit) {
      break;
    }
  }
  return signals;
}

function readChangedMessageId(signal: SignalEnvelope | null): string | null {
  return signal?.type === "signal.text" &&
    signal.profile.kind === "system" &&
    signal.data.meta?.purpose === "space_message_changed"
    ? (signal.data.meta.changedMessageId ?? null)
    : null;
}
