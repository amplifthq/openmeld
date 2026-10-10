import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { SignalEnvelope } from "@openmeld/protocol";
import {
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  type SpaceCodeWorkHandoff,
  spaceWorkHandoffSchema,
} from "@openmeld/schemas";
import type { SpaceMessageFileReference } from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { createOrganizationSkillService } from "../../organization-skills/organization-skill-service";
import { createCoreRpcHttpError } from "../../rpc/errors";

/** The containing Space message owns origin and identity; authored JSON grants neither. */
export async function validateSpaceWorkHandoff(input: {
  env: CoreBindings;
  organizationId: string | null;
  signal: SignalEnvelope;
  resolveFiles(files: SpaceMessageFileReference[]): SpaceMessageFileReference[];
  threadId?: string | null;
  threadRootSignalId?: string | null;
  readSource?(
    signalId: string
  ): { signal: SignalEnvelope; threadId: string | null } | null;
}) {
  if (
    input.signal.type !== "signal.text" ||
    !input.signal.data.meta?.workHandoff
  ) {
    return;
  }
  const data = input.signal.data;
  const handoff = spaceWorkHandoffSchema.parse(data.meta?.workHandoff);
  if (handoff.schemaVersion === 2) {
    validateCodeWorkHandoff({ ...input, signal: input.signal }, handoff);
  } else if (
    data.contextSelection?.mode !== "new" ||
    data.contextSelection.access !== "space_context"
  ) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "space.handoff.context_required",
      reason: "Hand off selected files in a new Space-only context.",
    });
  }
  if (
    !data.meta?.clientMessageId ||
    data.messageEnvelope?.activationTargets.length !== 1
  ) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "space.handoff.invalid_target",
      reason:
        "Choose one Agent and a stable message identity for this handoff.",
    });
  }
  const references = input.resolveFiles(
    handoff.files.map((file) => ({
      fileId: file.fileId,
      revision: file.revision,
      name: "selected",
      mimeType: "application/octet-stream",
      sizeBytes: 0,
    }))
  );
  if (
    references.some((file) => file.sizeBytes > SPACE_FILE_RAW_UPLOAD_MAX_BYTES)
  ) {
    throw createCoreRpcHttpError({
      status: 413,
      code: "space.handoff.file_too_large",
      reason: "Handoff files must be 10 MiB or smaller.",
    });
  }
  for (const selected of handoff.files) {
    if (
      !data.files?.some(
        (file) =>
          file.fileId === selected.fileId && file.revision === selected.revision
      )
    ) {
      throw createCoreRpcHttpError({
        status: 400,
        code: "space.handoff.files_mismatch",
        reason:
          "Attach every exact selected file revision to the handoff message.",
      });
    }
  }
  if (!handoff.skills.length) {
    return;
  }
  const db = getPostgresDatabase(input.env);
  const bucket = input.env.OPENMELD_ORGANIZATION_SKILLS;
  if (!(input.organizationId && db && bucket)) {
    throw createCoreRpcHttpError({
      status: 503,
      code: "organization_skill.unavailable",
      reason: "Organization Skills are unavailable.",
    });
  }
  const service = createOrganizationSkillService({ db, bucket });
  for (const selected of handoff.skills) {
    const release = await service.getEnabledRelease(
      { organizationId: input.organizationId, role: "member", userId: null },
      selected.skillId,
      selected.releaseId
    );
    if (
      release.digest !== selected.digest ||
      release.bundle.portable.name !== selected.name
    ) {
      throw createCoreRpcHttpError({
        status: 409,
        code: "organization_skill.release_invalid",
        reason: "The selected Skill release does not match the handoff.",
      });
    }
  }
}

function validateCodeWorkHandoff(
  input: Parameters<typeof validateSpaceWorkHandoff>[0] & {
    signal: Extract<SignalEnvelope, { type: "signal.text" }>;
  },
  handoff: SpaceCodeWorkHandoff
) {
  const data = input.signal.data;
  const sourceContext = input.readSource?.(handoff.sourceSignalId);
  const source = sourceContext?.signal;
  if (
    !source ||
    source.type !== "signal.text" ||
    source.spaceId !== input.signal.spaceId ||
    source.data.meta?.recalledAt !== undefined
  ) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "space.handoff.source_unavailable",
      reason: "Open the original result in this Space before handing it off.",
    });
  }
  if ((source.data.meta?.messageRevision ?? 1) !== handoff.sourceRevision) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "space.handoff.source_changed",
      reason:
        "The original result changed. Reopen the handoff and review its current revision.",
    });
  }
  const sourceIsThreadRoot =
    sourceContext?.threadId === null && input.threadRootSignalId === source.id;
  if (
    sourceContext?.threadId !== (input.threadId ?? null) &&
    !sourceIsThreadRoot
  ) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "space.handoff.destination_mismatch",
      reason: "Hand off from the original result's conversation or thread.",
    });
  }
  const selected = data.contextSelection;
  if (
    selected?.mode !== "new" ||
    selected.projectWork?.projectId !== handoff.code.projectId ||
    selected.projectWork.repositoryFingerprint !==
      handoff.code.repositoryFingerprint ||
    selected.projectWork.commit !== handoff.code.commit ||
    selected.workspace !== handoff.execution.workspace ||
    selected.access !== handoff.execution.access ||
    data.messageEnvelope?.replyToSignalId !== handoff.sourceSignalId
  ) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "space.handoff.code_context_mismatch",
      reason:
        "Keep the exact source result, Project, commit, and execution choices in the new handoff.",
    });
  }
}
