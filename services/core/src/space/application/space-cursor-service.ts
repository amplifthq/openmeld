import type { SpaceCursor } from "@openmeld/protocol";
import { normalizeSpaceCursorPatch } from "@openmeld/schemas";
import type { SpaceCursorRecord } from "../rules/parsers/space-cursor";

type NormalizedSpaceCursorPatch = Extract<
  ReturnType<typeof normalizeSpaceCursorPatch>,
  { ok: true }
>["value"];
type CursorStringField = "role" | "mentionAlias";

export function handlePatchCursorUseCase(input: {
  body: unknown;
  profileId: string;
  spaceId: string;
  readSpaceCursorRecord: (profileId: string) => SpaceCursorRecord | null;
  readCursorProfileIdByMentionAlias: (mentionAlias: string) => string | null;
  upsertSpaceCursorRecord: (cursor: SpaceCursorRecord) => void;
  toPublicSpaceCursor: (cursor: SpaceCursorRecord) => SpaceCursor;
}): Response {
  const cursorPatch = normalizeSpaceCursorPatch(input.body);
  if (!cursorPatch.ok) {
    return new Response(cursorPatch.message, { status: 400 });
  }

  const existing = input.readSpaceCursorRecord(input.profileId);
  const nextLastSeenTs = resolveNextCursorLastSeenTs({
    existingLastSeenTs: existing?.lastSeenTs,
    hasInputLastSeenTs: hasCursorPatchField(cursorPatch.value, "lastSeenTs"),
    inputLastSeenTs: cursorPatch.value.lastSeenTs,
  });
  const nextRole = resolveNextCursorStringField({
    existingValue: existing?.role,
    field: "role",
    patch: cursorPatch.value,
  });
  const nextMentionAlias = resolveNextCursorStringField({
    existingValue: existing?.mentionAlias,
    field: "mentionAlias",
    patch: cursorPatch.value,
  });

  if (nextMentionAlias) {
    const mentionAliasOwnerProfileId =
      input.readCursorProfileIdByMentionAlias(nextMentionAlias);
    if (
      mentionAliasOwnerProfileId &&
      mentionAliasOwnerProfileId !== input.profileId
    ) {
      return Response.json(
        {
          ok: false,
          code: "space.mention_alias_conflict",
          message: "mentionAlias already exists in this space",
        },
        { status: 409 }
      );
    }
  }

  const hasChanges =
    nextLastSeenTs !== existing?.lastSeenTs ||
    nextRole !== existing?.role ||
    nextMentionAlias !== existing?.mentionAlias;
  if (!hasChanges && existing) {
    return Response.json(input.toPublicSpaceCursor(existing));
  }

  const now = new Date().toISOString();
  const next: SpaceCursorRecord = {
    v: 1,
    spaceId: input.spaceId,
    profileId: input.profileId,
    ...(typeof nextLastSeenTs === "number"
      ? { lastSeenTs: nextLastSeenTs }
      : {}),
    ...(nextRole ? { role: nextRole } : {}),
    ...(nextMentionAlias ? { mentionAlias: nextMentionAlias } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  input.upsertSpaceCursorRecord(next);

  return Response.json(input.toPublicSpaceCursor(next));
}

function hasCursorPatchField(
  patch: NormalizedSpaceCursorPatch,
  field: keyof NormalizedSpaceCursorPatch
): boolean {
  return Object.hasOwn(patch, field);
}

function resolveNextCursorStringField(input: {
  existingValue?: string;
  field: CursorStringField;
  patch: NormalizedSpaceCursorPatch;
}): string | undefined {
  if (!hasCursorPatchField(input.patch, input.field)) {
    return input.existingValue;
  }

  const nextValue = input.patch[input.field];
  return nextValue && nextValue.length > 0 ? nextValue : undefined;
}

function resolveNextCursorLastSeenTs(input: {
  existingLastSeenTs?: number;
  hasInputLastSeenTs: boolean;
  inputLastSeenTs?: number;
}): number | undefined {
  if (!input.hasInputLastSeenTs) {
    return input.existingLastSeenTs;
  }

  if (typeof input.inputLastSeenTs !== "number") {
    return input.existingLastSeenTs;
  }

  if (typeof input.existingLastSeenTs !== "number") {
    return input.inputLastSeenTs;
  }

  return Math.max(input.existingLastSeenTs, input.inputLastSeenTs);
}
