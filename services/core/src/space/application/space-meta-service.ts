import type { SpaceMeta } from "@openmeld/protocol";
import {
  MAX_SPACE_GUIDE_LENGTH,
  resolveInitialSpaceAccessMode,
} from "@openmeld/schemas";
import {
  buildSpacePasswordProof,
  type SpacePasswordProof,
  SpacePasswordProofError,
} from "../../lib/space-password-proof";
import type { SpaceMetaRecord } from "../infrastructure/sql/space-meta-repo";
import {
  parseSpaceMetaUpdatePatch,
  type SpaceMetaUpdatePatch,
} from "../rules/parsers/space-meta-patch";
import { parseSpaceMetaAtomicCreatePatch } from "../rules/parsers/space-password-patch";

type PasswordTooShortResponseFactory = (requestId: string) => Response;

type SpaceMetaWriter = {
  initializeSpaceMetaRecordIfAbsent: (
    record: SpaceMetaRecord
  ) => SpaceMetaRecord;
  readSpaceMetaRecord: () => SpaceMetaRecord | null;
  upsertSpaceMetaRecord: (record: SpaceMetaRecord) => void;
};

export function handlePatchMetaUseCase(input: {
  body: unknown;
  initializeIfAbsent?: boolean;
  spaceId: string;
  toPublicSpaceMeta: (meta: SpaceMetaRecord) => SpaceMeta;
  writer: SpaceMetaWriter;
  nowIso?: string;
}): Response {
  if (!(input.body && typeof input.body === "object")) {
    return new Response("Invalid JSON", { status: 400 });
  }

  const metaUpdate = parseSpaceMetaUpdatePatch(input.body, {
    allowAccessMode: input.initializeIfAbsent === true,
    allowOrganizationFields: input.initializeIfAbsent === true,
    ...(input.initializeIfAbsent
      ? {}
      : { guideMaxLength: MAX_SPACE_GUIDE_LENGTH }),
    requireOrganizationFields: input.initializeIfAbsent === true,
  });
  if (!metaUpdate.ok) {
    return new Response(metaUpdate.message, { status: 400 });
  }

  const now = input.nowIso ?? new Date().toISOString();

  if (input.initializeIfAbsent) {
    const initialized = buildNextSpaceMetaRecord({
      existing: null,
      metaUpdate,
      spaceId: input.spaceId,
      now,
    });
    const current = input.writer.initializeSpaceMetaRecordIfAbsent(initialized);

    return Response.json(input.toPublicSpaceMeta(current));
  }

  const existing = input.writer.readSpaceMetaRecord();
  if (!existing) {
    return Response.json(
      {
        ok: false,
        code: "space.not_found",
        message: "space not found",
      },
      { status: 404 }
    );
  }

  const next = buildNextSpaceMetaRecord({
    existing,
    metaUpdate,
    spaceId: input.spaceId,
    now,
  });

  input.writer.upsertSpaceMetaRecord(next);
  return Response.json(input.toPublicSpaceMeta(next));
}

export async function handlePatchMetaWithPasswordAtomicUseCase(input: {
  body: unknown;
  requestId: string;
  spaceId: string;
  toPublicSpaceMeta: (meta: SpaceMetaRecord) => SpaceMeta;
  writer: Pick<SpaceMetaWriter, "initializeSpaceMetaRecordIfAbsent">;
  passwordTooShortResponse: PasswordTooShortResponseFactory;
  nowIso?: string;
}): Promise<Response> {
  if (!(input.body && typeof input.body === "object")) {
    return new Response("Invalid JSON", { status: 400 });
  }

  const parsed = parseSpaceMetaAtomicCreatePatch(input.body);
  if (!parsed.ok) {
    if (parsed.code === "space.password_too_short") {
      return input.passwordTooShortResponse(input.requestId);
    }
    return new Response(parsed.message, { status: 400 });
  }

  let proof: SpacePasswordProof;
  try {
    proof = await buildSpacePasswordProof(parsed.password);
  } catch (error) {
    if (
      error instanceof SpacePasswordProofError &&
      error.code === "space.password_too_short"
    ) {
      return input.passwordTooShortResponse(input.requestId);
    }
    throw error;
  }

  const now = input.nowIso ?? new Date().toISOString();
  const initialized = buildNextSpaceMetaRecord({
    existing: null,
    metaUpdate: parsed.metaUpdate,
    spaceId: input.spaceId,
    now,
  });
  const current = input.writer.initializeSpaceMetaRecordIfAbsent({
    ...initialized,
    accessMode: parsed.accessMode,
    passwordProof: proof,
  });

  return Response.json(input.toPublicSpaceMeta(current));
}

export function buildNextSpaceMetaRecord(input: {
  existing: SpaceMetaRecord | null;
  metaUpdate: SpaceMetaUpdatePatch;
  spaceId: string;
  now: string;
}): SpaceMetaRecord {
  const name = input.metaUpdate.hasName
    ? input.metaUpdate.name
    : input.existing?.name;
  const organizationId = resolveSpaceMetaOrganizationId(input);
  const visibility = resolveSpaceMetaVisibility(input);
  const purpose = input.metaUpdate.hasPurpose
    ? input.metaUpdate.purpose
    : input.existing?.purpose;
  const guide = input.metaUpdate.hasGuide
    ? input.metaUpdate.guide
    : input.existing?.guide;
  const creator = input.metaUpdate.hasCreator
    ? input.metaUpdate.creator
    : input.existing?.creator;

  if (!organizationId) {
    throw new Error("space_meta.organization_id required");
  }
  if (!visibility) {
    throw new Error("space_meta.organization_visibility required");
  }

  return {
    v: 1,
    spaceId: input.spaceId,
    organizationId,
    visibility,
    ...(name ? { name } : {}),
    ...(purpose ? { purpose } : {}),
    ...(creator ? { creator } : {}),
    ...(guide ? { guide } : {}),
    accessMode: resolveSpaceMetaAccessMode(input, visibility),
    ...(input.existing?.passwordProof
      ? { passwordProof: input.existing.passwordProof }
      : {}),
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

function resolveSpaceMetaAccessMode(
  input: {
    existing: SpaceMetaRecord | null;
    metaUpdate: SpaceMetaUpdatePatch;
  },
  visibility: SpaceMetaRecord["visibility"]
): SpaceMetaRecord["accessMode"] {
  if (input.existing) {
    return input.existing.accessMode;
  }
  if (input.metaUpdate.hasAccessMode) {
    if (!input.metaUpdate.accessMode) {
      throw new Error("space_meta.access_mode required");
    }
    return input.metaUpdate.accessMode;
  }
  return resolveInitialSpaceAccessMode(visibility);
}

function resolveSpaceMetaOrganizationId(input: {
  existing: SpaceMetaRecord | null;
  metaUpdate: SpaceMetaUpdatePatch;
}): string | undefined {
  if (input.existing?.organizationId) {
    return input.existing.organizationId;
  }
  if (input.metaUpdate.hasOrganizationId) {
    return input.metaUpdate.organizationId;
  }
  return undefined;
}

function resolveSpaceMetaVisibility(input: {
  existing: SpaceMetaRecord | null;
  metaUpdate: SpaceMetaUpdatePatch;
}): SpaceMetaRecord["visibility"] | undefined {
  if (input.existing?.visibility) {
    return input.existing.visibility;
  }
  if (input.metaUpdate.hasVisibility) {
    return input.metaUpdate.visibility;
  }
  return undefined;
}
