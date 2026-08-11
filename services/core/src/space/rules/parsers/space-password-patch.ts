import {
  SPACE_PASSWORD_MIN_LENGTH,
  setSpaceAccessModeBodySchema,
  spaceAccessModeSchema,
  spaceAccessModeUsesPassword,
  upsertSpacePasswordBodySchema,
} from "@openmeld/schemas";
import type { SpaceAccessMode } from "@openmeld/schemas/types";
import {
  parseSpaceMetaUpdatePatch,
  type SpaceMetaUpdatePatch,
} from "./space-meta-patch";

type PasswordParserFailure = {
  ok: false;
  code: "invalid_password_payload" | "space.password_too_short";
  message: string;
};

type SpaceAccessModeParserFailure = {
  ok: false;
  code: "invalid_payload" | "space.password_too_short";
  message: string;
};

export function parseSpaceMetaAtomicCreatePatch(body: object):
  | {
      ok: true;
      accessMode: Extract<
        SpaceAccessMode,
        "protected" | "public_view_join_password"
      >;
      metaUpdate: SpaceMetaUpdatePatch;
      password: string;
    }
  | {
      ok: false;
      message: string;
      code?: "space.password_too_short";
    } {
  const unknownFields = listUnknownObjectFields(body, [
    "name",
    "purpose",
    "guide",
    "creator",
    "organizationId",
    "visibility",
    "accessMode",
    "password",
  ]);
  if (unknownFields.length > 0) {
    return {
      ok: false,
      message: `Unknown field: ${unknownFields[0]}`,
    };
  }

  const {
    accessMode: _ignoredAccessMode,
    password: _ignoredPassword,
    ...bodyWithoutPassword
  } = body as Record<string, unknown>;
  const metaUpdate = parseSpaceMetaUpdatePatch(bodyWithoutPassword, {
    allowOrganizationFields: true,
    requireOrganizationFields: true,
  });
  if (!metaUpdate.ok) {
    return metaUpdate;
  }

  if (!Object.hasOwn(body, "password")) {
    return {
      ok: false,
      message: "Expected password",
    };
  }

  const password = (body as { password?: unknown }).password;
  const parsedPassword = upsertSpacePasswordBodySchema.safeParse({
    password,
  });
  if (!parsedPassword.success) {
    return {
      ok: false,
      code: "space.password_too_short",
      message: "Invalid password",
    };
  }

  const parsedAccessMode = spaceAccessModeSchema.safeParse(
    Object.hasOwn(body, "accessMode")
      ? (body as { accessMode?: unknown }).accessMode
      : "protected"
  );
  if (
    !(
      parsedAccessMode.success &&
      spaceAccessModeUsesPassword(parsedAccessMode.data)
    )
  ) {
    return {
      ok: false,
      message: "Invalid accessMode",
    };
  }

  return {
    ok: true,
    accessMode: parsedAccessMode.data,
    metaUpdate: {
      hasAccessMode: false,
      hasOrganizationId: metaUpdate.hasOrganizationId,
      ...(metaUpdate.organizationId
        ? { organizationId: metaUpdate.organizationId }
        : {}),
      hasVisibility: metaUpdate.hasVisibility,
      ...(metaUpdate.visibility ? { visibility: metaUpdate.visibility } : {}),
      hasName: metaUpdate.hasName,
      ...(metaUpdate.name ? { name: metaUpdate.name } : {}),
      hasPurpose: metaUpdate.hasPurpose,
      ...(metaUpdate.purpose ? { purpose: metaUpdate.purpose } : {}),
      hasGuide: metaUpdate.hasGuide,
      ...(metaUpdate.guide ? { guide: metaUpdate.guide } : {}),
      hasCreator: metaUpdate.hasCreator,
      ...(metaUpdate.creator ? { creator: metaUpdate.creator } : {}),
    },
    password: parsedPassword.data.password,
  };
}

export function parseUpsertSpacePasswordBody(body: unknown):
  | { ok: true; password: string }
  | {
      ok: false;
      code: "invalid_password_payload" | "space.password_too_short";
      message: string;
    } {
  if (!(body && typeof body === "object") || Array.isArray(body)) {
    return {
      ok: false,
      code: "invalid_password_payload",
      message: "Invalid password payload: expected JSON object",
    };
  }

  const unknownFields = listUnknownObjectFields(body, ["password"]);
  if (unknownFields.length > 0) {
    return {
      ok: false,
      code: "invalid_password_payload",
      message: `Unknown field: ${unknownFields[0]}`,
    };
  }

  if (!Object.hasOwn(body, "password")) {
    return {
      ok: false,
      code: "invalid_password_payload",
      message: "Invalid password payload: expected password",
    };
  }

  const password = (body as { password?: unknown }).password;
  if (typeof password !== "string") {
    return {
      ok: false,
      code: "invalid_password_payload",
      message: "Invalid password payload: password must be a string",
    };
  }

  const parsedPassword = upsertSpacePasswordBodySchema.safeParse({
    password,
  });
  if (!parsedPassword.success) {
    return {
      ok: false,
      code: "space.password_too_short",
      message: `space password must be at least ${SPACE_PASSWORD_MIN_LENGTH} characters`,
    };
  }

  return {
    ok: true,
    password: parsedPassword.data.password,
  };
}

export function parseSetSpaceAccessModeBody(
  body: unknown
):
  | { ok: true; accessMode: SpaceAccessMode; password?: string }
  | SpaceAccessModeParserFailure {
  if (!(body && typeof body === "object") || Array.isArray(body)) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "Invalid access mode payload: expected JSON object",
    };
  }

  const unknownFields = listUnknownObjectFields(body, [
    "accessMode",
    "password",
  ]);
  if (unknownFields.length > 0) {
    return {
      ok: false,
      code: "invalid_payload",
      message: `Unknown field: ${unknownFields[0]}`,
    };
  }

  if (!Object.hasOwn(body, "accessMode")) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "Invalid access mode payload: expected accessMode",
    };
  }

  const accessMode = (body as { accessMode?: unknown }).accessMode;
  if (!spaceAccessModeSchema.safeParse(accessMode).success) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "Invalid access mode payload: accessMode is invalid",
    };
  }

  if (
    Object.hasOwn(body, "password") &&
    typeof (body as { password?: unknown }).password !== "string"
  ) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "Invalid access mode payload: password must be a string",
    };
  }

  const parsed = setSpaceAccessModeBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      code: "space.password_too_short",
      message: `space password must be at least ${SPACE_PASSWORD_MIN_LENGTH} characters`,
    };
  }

  return {
    ok: true,
    accessMode: parsed.data.accessMode,
    ...(parsed.data.password === undefined
      ? {}
      : { password: parsed.data.password }),
  };
}

function listUnknownObjectFields(
  body: object,
  allowedFields: readonly string[]
): string[] {
  const allowedSet = new Set(allowedFields);
  return Object.keys(body).filter((key) => !allowedSet.has(key));
}

export type { PasswordParserFailure, SpaceAccessModeParserFailure };
