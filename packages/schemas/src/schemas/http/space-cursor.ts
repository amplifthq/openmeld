import * as z from "zod/v4";
import { MAX_TEXT_LENGTH } from "../protocol/constants";

export const patchCursorLastSeenTsSchema = z.number().int().finite().min(0);

export const patchCursorStringSchema = z
  .string()
  .transform((value) => value.trim());
const patchCursorRoleSchema = patchCursorStringSchema.refine(
  (value) => value.length <= MAX_TEXT_LENGTH,
  {
    message: "Role too long",
  }
);
const MENTION_ALIAS_MAX_LENGTH = 128;
const MENTION_ALIAS_TOKEN_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const patchCursorMentionAliasSchema = patchCursorStringSchema
  .refine((value) => value.length <= MENTION_ALIAS_MAX_LENGTH, {
    message: "MentionAlias too long",
  })
  .refine(
    (value) => value.length === 0 || MENTION_ALIAS_TOKEN_REGEX.test(value),
    {
      message: "Invalid mentionAlias",
    }
  );

export const patchSpaceCursorBodySchema = z.strictObject({
  lastSeenTs: patchCursorLastSeenTsSchema.optional(),
  role: patchCursorRoleSchema.optional(),
  mentionAlias: patchCursorMentionAliasSchema.optional(),
});

type SpaceCursorPatchField = "role" | "mentionAlias";
type NormalizedSpaceCursorPatch = z.infer<typeof patchSpaceCursorBodySchema>;

type NormalizeSpaceCursorPatchResult =
  | {
      ok: true;
      value: NormalizedSpaceCursorPatch;
    }
  | {
      ok: false;
      message: string;
    };

const SPACE_CURSOR_PATCH_REQUIRED_MESSAGE =
  "Expected lastSeenTs, role or mentionAlias";

const SPACE_CURSOR_STRING_PATCH_FIELDS = [
  "role",
  "mentionAlias",
] as const satisfies readonly SpaceCursorPatchField[];
const SPACE_CURSOR_PATCH_FIELDS = new Set<string>([
  "lastSeenTs",
  ...SPACE_CURSOR_STRING_PATCH_FIELDS,
]);

function readNormalizedLastSeenTs(patch: Record<string, unknown>):
  | {
      ok: true;
      value?: number;
    }
  | {
      ok: false;
      message: string;
    } {
  if (!Object.hasOwn(patch, "lastSeenTs")) {
    return { ok: true };
  }

  const rawLastSeenTs = patch.lastSeenTs;
  if (rawLastSeenTs === undefined) {
    return { ok: true };
  }
  if (typeof rawLastSeenTs !== "number") {
    return {
      ok: false,
      message: "Invalid lastSeenTs",
    };
  }
  if (!Number.isFinite(rawLastSeenTs)) {
    return { ok: true };
  }

  return {
    ok: true,
    value: Math.max(0, Math.trunc(rawLastSeenTs)),
  };
}

function readNormalizedStringPatchField(
  patch: Record<string, unknown>,
  field: SpaceCursorPatchField
):
  | {
      ok: true;
      value?: string;
    }
  | {
      ok: false;
      message: string;
    } {
  if (!Object.hasOwn(patch, field)) {
    return { ok: true };
  }

  const rawValue = patch[field];
  if (rawValue === undefined) {
    return { ok: true };
  }
  if (typeof rawValue !== "string") {
    return {
      ok: false,
      message: `Invalid ${field}`,
    };
  }

  return {
    ok: true,
    value: rawValue,
  };
}

export function normalizeSpaceCursorPatch(
  input: unknown
): NormalizeSpaceCursorPatchResult {
  if (!input || typeof input !== "object") {
    return {
      ok: false,
      message: "Invalid JSON",
    };
  }

  const rawPatch = input as Record<string, unknown>;
  const unknownField = Object.keys(rawPatch).find(
    (field) => !SPACE_CURSOR_PATCH_FIELDS.has(field)
  );
  if (unknownField) {
    return {
      ok: false,
      message: `Unrecognized key: "${unknownField}"`,
    };
  }
  const patch: NormalizedSpaceCursorPatch = {};
  const lastSeenTs = readNormalizedLastSeenTs(rawPatch);

  if (!lastSeenTs.ok) {
    return lastSeenTs;
  }
  if (lastSeenTs.value !== undefined) {
    patch.lastSeenTs = lastSeenTs.value;
  }

  for (const field of SPACE_CURSOR_STRING_PATCH_FIELDS) {
    const fieldValue = readNormalizedStringPatchField(rawPatch, field);
    if (!fieldValue.ok) {
      return fieldValue;
    }
    if (fieldValue.value !== undefined) {
      patch[field] = fieldValue.value;
    }
  }

  if (Object.keys(patch).length === 0) {
    return {
      ok: false,
      message: SPACE_CURSOR_PATCH_REQUIRED_MESSAGE,
    };
  }

  const parsed = patchSpaceCursorBodySchema.safeParse(patch);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid cursor patch",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}
