import {
  getSpaceStatusResponseSchema,
  openMeldRuntimeProfileIdSchema,
} from "@openmeld/schemas";
import type { GetSpaceStatusResponse } from "@openmeld/schemas/types";
import { timestampMsToIso } from "../infrastructure/sql/space-schema-repo";
import {
  type LatestFormalSignalCandidateCursor,
  listLatestFormalSignalCandidateEntriesPage,
} from "../infrastructure/sql/space-signal-repo";
import {
  isFormalSpaceUpdateSignal,
  resolveFormalSpaceUpdateActorName,
  resolveFormalSpaceUpdateActorProfileId,
  resolveSpaceStatusPreviewText,
} from "../rules/formal-space-update";
import { parseStoredSignal } from "../rules/parsers/stored-signal";

export function readLatestVisibleFormalUpdate(input: {
  sql: SqlStorage;
}): GetSpaceStatusResponse["latestVisibleUpdate"] | undefined {
  let before: LatestFormalSignalCandidateCursor | undefined;
  while (true) {
    const page = listLatestFormalSignalCandidateEntriesPage(input.sql, {
      ...(before ? { before } : {}),
      limit: 100,
    });
    for (const [, rawSignal] of page.entries) {
      const candidate = projectLatestVisibleFormalUpdateCandidate(rawSignal);
      if (!candidate) {
        continue;
      }
      const parsed =
        getSpaceStatusResponseSchema.shape.latestVisibleUpdate.safeParse(
          candidate
        );
      if (!parsed.success) {
        throw new Error("latest visible update is invalid");
      }
      return parsed.data;
    }
    if (!page.nextCursor) {
      return undefined;
    }
    before = page.nextCursor;
  }
}

function projectLatestVisibleFormalUpdateCandidate(
  rawSignal: string
): GetSpaceStatusResponse["latestVisibleUpdate"] | undefined {
  const signal = parseStoredSignal(rawSignal);
  if (!(signal && isFormalSpaceUpdateSignal(signal))) {
    return undefined;
  }
  // This authorized Space summary never includes local-origin fields. Project
  // only its explicit summary fields; resolving Agent ancestry cannot change it.
  const actorProfileId = resolveFormalSpaceUpdateActorProfileId(signal);
  const previewText = resolveSpaceStatusPreviewText(signal);
  const parsedActorProfileId =
    openMeldRuntimeProfileIdSchema.safeParse(actorProfileId);
  if (!(parsedActorProfileId.success && previewText)) {
    return undefined;
  }
  const actorName = resolveFormalSpaceUpdateActorName(signal);
  return {
    signalId: signal.id,
    signalType: signal.type,
    createdAt: timestampMsToIso(signal.ts),
    actorProfileId: parsedActorProfileId.data,
    ...(actorName ? { actorName } : {}),
    previewText,
  };
}
