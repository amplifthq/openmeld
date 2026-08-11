import {
  getSpaceStatusResponseSchema,
  openMeldRuntimeProfileIdSchema,
} from "@openmeld/schemas";
import type { GetSpaceStatusResponse } from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { timestampMsToIso } from "../infrastructure/sql/space-schema-repo";
import {
  type LatestFormalSignalCandidateCursor,
  listLatestFormalSignalCandidateEntriesPage,
} from "../infrastructure/sql/space-signal-repo";
import {
  isFormalSpaceUpdateSignal,
  resolveFormalSpaceUpdateActorName,
  resolveFormalSpaceUpdateActorProfileId,
  resolveFormalSpaceUpdatePreviewText,
} from "../rules/formal-space-update";
import { parseStoredSignal } from "../rules/parsers/stored-signal";
import { redactSignalForViewer } from "../rules/privacy/agent-profile-visibility";
import { resolveViewerCreatorProfileIdsByProfileId } from "../rules/privacy/profile-lineage";

export async function readLatestVisibleFormalUpdate(input: {
  sql: SqlStorage;
  env: CoreBindings;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  // Optional per-request lineage loader shared across bootstrap branches.
  lineageLoader?: (
    ownerUserId: string
  ) => Promise<Record<string, string | null> | undefined>;
}): Promise<GetSpaceStatusResponse["latestVisibleUpdate"] | undefined> {
  const viewerCreatorProfileIdsByProfileId =
    input.lineageLoader && input.viewerOwnerUserId && input.viewerProfileId
      ? await input.lineageLoader(input.viewerOwnerUserId)
      : await resolveViewerCreatorProfileIdsByProfileId({
          authRpc: input.env.OPENMELD_AUTH_WORKER,
          viewerOwnerUserId: input.viewerOwnerUserId,
          viewerProfileId: input.viewerProfileId,
        });

  let before: LatestFormalSignalCandidateCursor | undefined;
  while (true) {
    const page = listLatestFormalSignalCandidateEntriesPage(input.sql, {
      ...(before ? { before } : {}),
      limit: 100,
    });
    for (const [, rawSignal] of page.entries) {
      const candidate = projectLatestVisibleFormalUpdateCandidate({
        rawSignal,
        viewerOwnerUserId: input.viewerOwnerUserId,
        viewerProfileId: input.viewerProfileId,
        creatorProfileIdByProfileId: viewerCreatorProfileIdsByProfileId,
      });
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

function projectLatestVisibleFormalUpdateCandidate(input: {
  rawSignal: string;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  creatorProfileIdByProfileId?: Record<string, string | null>;
}): GetSpaceStatusResponse["latestVisibleUpdate"] | undefined {
  const signal = parseStoredSignal(input.rawSignal);
  if (!(signal && isFormalSpaceUpdateSignal(signal))) {
    return undefined;
  }
  const visibleSignal = redactSignalForViewer({
    signal,
    viewerOwnerUserId: input.viewerOwnerUserId,
    viewerProfileId: input.viewerProfileId,
    creatorProfileIdByProfileId: input.creatorProfileIdByProfileId,
  });
  if (!isFormalSpaceUpdateSignal(visibleSignal)) {
    return undefined;
  }
  const actorProfileId = resolveFormalSpaceUpdateActorProfileId(visibleSignal);
  const previewText = resolveFormalSpaceUpdatePreviewText(visibleSignal);
  const parsedActorProfileId =
    openMeldRuntimeProfileIdSchema.safeParse(actorProfileId);
  if (!(parsedActorProfileId.success && previewText)) {
    return undefined;
  }
  const actorName = resolveFormalSpaceUpdateActorName(visibleSignal);
  return {
    signalId: visibleSignal.id,
    signalType: visibleSignal.type,
    createdAt: timestampMsToIso(visibleSignal.ts),
    actorProfileId: parsedActorProfileId.data,
    ...(actorName ? { actorName } : {}),
    previewText,
  };
}
