import type { SpaceCreator } from "@openmeld/protocol";
import { MAX_TEXT_LENGTH, parseSpaceCreator } from "@openmeld/protocol";
import {
  MAX_SPACE_NAME_LENGTH,
  spaceAccessModeSchema,
  spaceNameSchema,
  spaceOrganizationVisibilitySchema,
} from "@openmeld/schemas";
import type {
  SpaceAccessMode,
  SpaceOrganizationVisibility,
} from "@openmeld/schemas/types";

export type SpaceMetaUpdatePatch = {
  hasAccessMode: boolean;
  accessMode?: SpaceAccessMode;
  hasOrganizationId: boolean;
  organizationId?: string;
  hasVisibility: boolean;
  visibility?: SpaceOrganizationVisibility;
  hasName: boolean;
  name?: string;
  hasPurpose: boolean;
  purpose?: string;
  hasGuide: boolean;
  guide?: string;
  hasCreator: boolean;
  creator?: SpaceCreator;
};

type SpaceMetaUpdatePatchParseOptions = {
  allowAccessMode?: boolean;
  allowOrganizationFields?: boolean;
  guideMaxLength?: number;
  requireOrganizationFields?: boolean;
};

type SpaceMetaPatchFieldPresence = {
  allowAccessMode: boolean;
  allowOrganizationFields: boolean;
  hasAccessMode: boolean;
  hasCreator: boolean;
  hasGuide: boolean;
  hasName: boolean;
  hasOrganizationId: boolean;
  hasPurpose: boolean;
  hasVisibility: boolean;
};

export function parseSpaceMetaUpdatePatch(
  body: object,
  options?: SpaceMetaUpdatePatchParseOptions
): ({ ok: true } & SpaceMetaUpdatePatch) | { ok: false; message: string } {
  const allowOrganizationFields = options?.allowOrganizationFields === true;
  const allowAccessMode = options?.allowAccessMode === true;
  const fieldPresence = resolveSpaceMetaPatchFieldPresence({
    allowAccessMode,
    allowOrganizationFields,
    body,
    requireOrganizationFields: options?.requireOrganizationFields === true,
  });
  if (!fieldPresence.ok) {
    return fieldPresence;
  }

  const organizationIdResult = parseOrganizationIdField({
    body,
    hasField: fieldPresence.hasOrganizationId,
  });
  if (!organizationIdResult.ok) {
    return organizationIdResult;
  }

  const visibilityResult = parseVisibilityField({
    body,
    hasField: fieldPresence.hasVisibility,
  });
  if (!visibilityResult.ok) {
    return visibilityResult;
  }

  const accessModeResult = parseAccessModeField({
    body,
    hasField: fieldPresence.hasAccessMode,
  });
  if (!accessModeResult.ok) {
    return accessModeResult;
  }

  const nameResult = parseSpaceNameField(body, fieldPresence.hasName);
  if (!nameResult.ok) {
    return nameResult;
  }

  const guideResult = parseOptionalMetaStringField({
    body,
    key: "guide",
    hasField: fieldPresence.hasGuide,
    maxLength: options?.guideMaxLength ?? MAX_TEXT_LENGTH,
    invalidMessage: "Invalid guide",
    tooLongMessage: "Guide too long",
  });
  if (!guideResult.ok) {
    return guideResult;
  }

  const purposeResult = parseOptionalMetaStringField({
    body,
    key: "purpose",
    hasField: fieldPresence.hasPurpose,
    maxLength: MAX_TEXT_LENGTH,
    invalidMessage: "Invalid purpose",
    tooLongMessage: "Purpose too long",
  });
  if (!purposeResult.ok) {
    return purposeResult;
  }

  const creatorResult = parseOptionalMetaCreatorField(
    body,
    fieldPresence.hasCreator
  );
  if (!creatorResult.ok) {
    return creatorResult;
  }

  return {
    ok: true,
    hasAccessMode: fieldPresence.hasAccessMode,
    ...(accessModeResult.value ? { accessMode: accessModeResult.value } : {}),
    hasOrganizationId: fieldPresence.hasOrganizationId,
    ...(organizationIdResult.value
      ? { organizationId: organizationIdResult.value }
      : {}),
    hasVisibility: fieldPresence.hasVisibility,
    ...(visibilityResult.value ? { visibility: visibilityResult.value } : {}),
    hasName: fieldPresence.hasName,
    ...(nameResult.value ? { name: nameResult.value } : {}),
    hasPurpose: fieldPresence.hasPurpose,
    ...(purposeResult.value ? { purpose: purposeResult.value } : {}),
    hasGuide: fieldPresence.hasGuide,
    ...(guideResult.value ? { guide: guideResult.value } : {}),
    hasCreator: fieldPresence.hasCreator,
    ...(creatorResult.value ? { creator: creatorResult.value } : {}),
  };
}

function resolveSpaceMetaPatchFieldPresence(input: {
  allowAccessMode: boolean;
  allowOrganizationFields: boolean;
  body: object;
  requireOrganizationFields: boolean;
}):
  | ({ ok: true } & SpaceMetaPatchFieldPresence)
  | { ok: false; message: string } {
  const allowedFields = [
    "name",
    "purpose",
    "guide",
    "creator",
    ...(input.allowAccessMode ? ["accessMode"] : []),
    ...(input.allowOrganizationFields ? ["organizationId", "visibility"] : []),
  ];
  const unknownFields = listUnknownObjectFields(input.body, allowedFields);
  if (unknownFields.length > 0) {
    return {
      ok: false,
      message: `Unknown field: ${unknownFields[0]}`,
    };
  }

  const presence = {
    allowAccessMode: input.allowAccessMode,
    allowOrganizationFields: input.allowOrganizationFields,
    hasAccessMode:
      input.allowAccessMode && Object.hasOwn(input.body, "accessMode"),
    hasCreator: Object.hasOwn(input.body, "creator"),
    hasGuide: Object.hasOwn(input.body, "guide"),
    hasName: Object.hasOwn(input.body, "name"),
    hasOrganizationId:
      input.allowOrganizationFields &&
      Object.hasOwn(input.body, "organizationId"),
    hasPurpose: Object.hasOwn(input.body, "purpose"),
    hasVisibility:
      input.allowOrganizationFields && Object.hasOwn(input.body, "visibility"),
  };

  if (!hasAnySpaceMetaPatchField(presence)) {
    return {
      ok: false,
      message: input.allowOrganizationFields
        ? "Expected organizationId, visibility, accessMode, name, purpose, guide or creator"
        : "Expected name, purpose, guide or creator",
    };
  }

  if (input.requireOrganizationFields && !presence.hasOrganizationId) {
    return { ok: false, message: "Expected organizationId" };
  }
  if (input.requireOrganizationFields && !presence.hasVisibility) {
    return { ok: false, message: "Expected visibility" };
  }

  return { ok: true, ...presence };
}

function hasAnySpaceMetaPatchField(
  input: SpaceMetaPatchFieldPresence
): boolean {
  return (
    input.hasAccessMode ||
    input.hasName ||
    input.hasPurpose ||
    input.hasGuide ||
    input.hasCreator ||
    input.hasOrganizationId ||
    input.hasVisibility
  );
}

function parseAccessModeField(input: {
  body: object;
  hasField: boolean;
}): { ok: true; value?: SpaceAccessMode } | { ok: false; message: string } {
  if (!input.hasField) {
    return { ok: true };
  }
  const parsed = spaceAccessModeSchema.safeParse(
    (input.body as { accessMode?: unknown }).accessMode
  );
  if (!parsed.success) {
    return { ok: false, message: "Invalid accessMode" };
  }
  return { ok: true, value: parsed.data };
}

function parseOrganizationIdField(input: {
  body: object;
  hasField: boolean;
}): { ok: true; value?: string } | { ok: false; message: string } {
  if (!input.hasField) {
    return { ok: true };
  }

  const raw = (input.body as { organizationId?: unknown }).organizationId;
  if (typeof raw !== "string") {
    return { ok: false, message: "Invalid organizationId" };
  }
  const normalized = raw.trim();
  if (normalized.length === 0) {
    return { ok: false, message: "Invalid organizationId" };
  }
  return { ok: true, value: normalized };
}

function parseVisibilityField(input: {
  body: object;
  hasField: boolean;
}):
  | { ok: true; value?: SpaceOrganizationVisibility }
  | { ok: false; message: string } {
  if (!input.hasField) {
    return { ok: true };
  }

  const parsed = spaceOrganizationVisibilitySchema.safeParse(
    (input.body as { visibility?: unknown }).visibility
  );
  if (!parsed.success) {
    return { ok: false, message: "Invalid visibility" };
  }
  return { ok: true, value: parsed.data };
}

function parseOptionalMetaStringField(input: {
  body: object;
  key: "name" | "purpose" | "guide";
  hasField: boolean;
  maxLength: number;
  invalidMessage: string;
  tooLongMessage: string;
}): { ok: true; value?: string } | { ok: false; message: string } {
  if (!input.hasField) {
    return { ok: true };
  }

  const raw = (input.body as Record<string, unknown>)[input.key];
  if (typeof raw !== "string") {
    return { ok: false, message: input.invalidMessage };
  }

  const normalized = raw.trim();
  if (normalized.length > input.maxLength) {
    return { ok: false, message: input.tooLongMessage };
  }

  return { ok: true, value: normalized.length > 0 ? normalized : undefined };
}

function parseSpaceNameField(
  body: object,
  hasName: boolean
): { ok: true; value?: string } | { ok: false; message: string } {
  if (!hasName) {
    return { ok: true };
  }

  const raw = (body as { name?: unknown }).name;
  const parsed = spaceNameSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  if (typeof raw === "string" && raw.trim().length > MAX_SPACE_NAME_LENGTH) {
    return { ok: false, message: "Name too long" };
  }
  return { ok: false, message: "Invalid name" };
}

function parseOptionalMetaCreatorField(
  body: object,
  hasCreator: boolean
): { ok: true; value?: SpaceCreator } | { ok: false; message: string } {
  if (!hasCreator) {
    return { ok: true };
  }

  const parsedCreator = parseSpaceCreator(
    (body as { creator?: unknown }).creator
  );
  if (!parsedCreator) {
    return { ok: false, message: "Invalid creator" };
  }

  return { ok: true, value: parsedCreator };
}

function listUnknownObjectFields(
  body: object,
  allowedFields: readonly string[]
): string[] {
  const allowedSet = new Set(allowedFields);
  return Object.keys(body).filter((key) => !allowedSet.has(key));
}
