import type {
  CenterAgentWorkTargetRequest,
  SignalEnvelope,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../../rpc/errors";
import {
  readSpaceWorkTarget,
  selectSpaceWorkTarget,
} from "../infrastructure/sql/space-work-target-repo";

type SourceTextSignal = Extract<SignalEnvelope, { type: "signal.text" }>;

export type SpaceWorkTargetInput = {
  scopeKey: string;
  sourceSignalId: string;
  admittedAtMs: number;
  requesterProfileId: string | null;
  selection?: NonNullable<CenterAgentWorkTargetRequest["selection"]>;
};

/** Called synchronously after live Space authorization. Signal revisions,
 * rather than retained model context, decide whether provenance is current. */
export function accessSpaceWorkTarget(
  sql: SqlStorage,
  input: SpaceWorkTargetInput,
  read: (id: string) => SourceTextSignal | null
) {
  const current = readSpaceWorkTarget(sql, input.scopeKey);
  if (
    current &&
    !(
      matchesSource(
        read(current.sourceSignalId),
        current.sourceProfileId,
        current.sourceRevision
      ) &&
      matchesSource(
        read(current.selectionSignalId),
        current.selectedByProfileId,
        current.selectionRevision
      )
    )
  ) {
    sql.exec(
      "DELETE FROM space_work_targets WHERE scope_key = ?",
      input.scopeKey
    );
  }
  if (!input.selection) {
    return readSpaceWorkTarget(sql, input.scopeKey);
  }
  const source = read(input.sourceSignalId);
  const editedAtMs = source?.data.meta?.editedAt ?? 0;
  if (
    !source ||
    source.profile.kind !== "human" ||
    source.profile.profileId !== input.requesterProfileId ||
    source.data.meta?.recalledAt ||
    !Number.isFinite(editedAtMs) ||
    editedAtMs > input.admittedAtMs
  ) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "center_agent.work_target.source_changed",
      reason: "Send a new request with the current goal and target.",
    });
  }
  return selectSpaceWorkTarget(sql, {
    ...input,
    sourceRevision: source.data.meta?.messageRevision ?? 0,
    requesterProfileId: source.profile.profileId,
    selection: input.selection,
  });
}

function matchesSource(
  source: SourceTextSignal | null,
  profileId: string,
  revision: number
) {
  return (
    source?.profile.kind === "human" &&
    source.profile.profileId === profileId &&
    !source.data.meta?.recalledAt &&
    (source.data.meta?.messageRevision ?? 0) === revision
  );
}
