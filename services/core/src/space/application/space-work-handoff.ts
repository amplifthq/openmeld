import type { SignalEnvelope } from "@openmeld/protocol";
import {
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  spaceEvidenceReferencesSchema,
  spaceWorkHandoffSchema,
} from "@openmeld/schemas";
import type { SpaceMessageFileReference } from "@openmeld/schemas/types";
import { type CoreBindings, organizationSkillsDb } from "../../lib/bindings";
import { createOrganizationSkillService } from "../../organization-skills/organization-skill-service";
import { createCoreRpcHttpError } from "../../rpc/errors";

export function assertSameSpaceWorkHandoff(input: {
  existing: SignalEnvelope;
  authorProfileId: string;
  handoff: unknown;
  evidenceRefs?: unknown;
  text: string;
  targetProfileIds: string[];
}) {
  if (input.existing.type !== "signal.text") {
    return;
  }
  const previous = input.existing.data.meta?.workHandoff;
  const previousRefs = input.existing.data.meta?.evidenceRefs;
  if (!(previous || input.handoff || previousRefs || input.evidenceRefs)) {
    return;
  }
  if (
    input.existing.profile.profileId !== input.authorProfileId ||
    input.existing.data.text !== input.text.trim() ||
    JSON.stringify(input.existing.data.messageEnvelope?.activationTargets) !==
      JSON.stringify(input.targetProfileIds) ||
    JSON.stringify(spaceWorkHandoffSchema.optional().parse(previous)) !==
      JSON.stringify(spaceWorkHandoffSchema.optional().parse(input.handoff)) ||
    JSON.stringify(
      spaceEvidenceReferencesSchema.optional().parse(previousRefs)
    ) !==
      JSON.stringify(
        spaceEvidenceReferencesSchema.optional().parse(input.evidenceRefs)
      )
  ) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "space.handoff.mutation_conflict",
      reason:
        "This handoff identity was already used for different work. Create a new handoff instead.",
    });
  }
}

/** The containing Space message owns origin and identity; authored JSON grants neither. */
export async function validateSpaceWorkHandoff(input: {
  env: CoreBindings;
  organizationId: string | null;
  signal: SignalEnvelope;
  resolveFiles(files: SpaceMessageFileReference[]): SpaceMessageFileReference[];
}) {
  if (
    input.signal.type !== "signal.text" ||
    !input.signal.data.meta?.workHandoff
  ) {
    return;
  }
  const data = input.signal.data;
  const handoff = spaceWorkHandoffSchema.parse(data.meta?.workHandoff);
  if (
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
  const db = organizationSkillsDb(input.env);
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
