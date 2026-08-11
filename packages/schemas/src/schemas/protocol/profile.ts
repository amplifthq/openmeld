import { z } from "zod/v4";
import { MAX_PROFILE_ID_LENGTH, MAX_PROFILE_NAME_LENGTH } from "./constants";
import { trimmedStringFromUnknown } from "./shared";

const PROFILE_KIND_VALUES = ["human", "agent", "system"] as const;
const PROFILE_HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID_PROFILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AGENT_PROFILE_ID_PATTERN =
  /^agt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const MAX_PROFILE_HANDLE_LENGTH = 128;

const normalizeOptionalProfileLabel = (value: unknown): string | undefined => {
  const normalized = trimmedStringFromUnknown(value);
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized.slice(0, MAX_PROFILE_NAME_LENGTH);
};

const normalizeOptionalProfileHandle = (value: unknown): string | undefined => {
  const normalized = trimmedStringFromUnknown(value);
  if (normalized.length === 0) {
    return undefined;
  }
  return profileHandleSchema.safeParse(normalized).success
    ? normalized
    : undefined;
};

export const MAX_PROFILE_WORKING_DIRECTORY_LENGTH = 4096;
export const profileWorkspaceModeSchema = z.enum([
  "openmeld_managed",
  "custom",
]);

export const profileWorkingDirectorySchema = z
  .string()
  .min(1)
  .max(MAX_PROFILE_WORKING_DIRECTORY_LENGTH)
  .refine((value) => !value.includes("\u0000"), {
    message: "workingDirectory must not contain NUL bytes",
  });

export const normalizeOptionalWorkingDirectory = (
  value: unknown
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = profileWorkingDirectorySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

export const MAX_AVATAR_URL_LENGTH = 2048;
const HTTPS_URL_PATTERN = /^https?:\/\//i;

/**
 * Avatar URLs are a public identity field that travels with the Profile across
 * domains. Only http(s) URLs are accepted so the value is safe to render as an
 * `<img src>` on web clients (rejects javascript:/data: injection vectors).
 */
const normalizeOptionalAvatarUrl = (value: unknown): string | undefined => {
  const normalized = trimmedStringFromUnknown(value);
  if (normalized.length === 0 || normalized.length > MAX_AVATAR_URL_LENGTH) {
    return undefined;
  }
  return HTTPS_URL_PATTERN.test(normalized) ? normalized : undefined;
};

/** Unknown or invalid kinds are normalized to "agent" for wire compatibility. */
const profileKindWithFallbackSchema = z.preprocess((value) => {
  const parsed = z.enum(PROFILE_KIND_VALUES).safeParse(value);
  return parsed.success ? parsed.data : "agent";
}, z.enum(PROFILE_KIND_VALUES));

export const profileKindSchema = z.enum(PROFILE_KIND_VALUES);

export const profileLabelSchema = z
  .string()
  .min(1)
  .max(MAX_PROFILE_NAME_LENGTH);

export const profileHandleSchema = z
  .string()
  .min(1)
  .max(MAX_PROFILE_HANDLE_LENGTH)
  .regex(PROFILE_HANDLE_PATTERN);

export const genericProfileIdSchema = z.preprocess(
  trimmedStringFromUnknown,
  z.string().min(1).max(MAX_PROFILE_ID_LENGTH)
);

export const uuidProfileIdSchema = z.preprocess(
  trimmedStringFromUnknown,
  z.string().min(1).max(MAX_PROFILE_ID_LENGTH).regex(UUID_PROFILE_ID_PATTERN)
);

export const agentProfileIdSchema = z.preprocess(
  trimmedStringFromUnknown,
  z.string().min(1).max(MAX_PROFILE_ID_LENGTH).regex(AGENT_PROFILE_ID_PATTERN)
);

/**
 * Runtime OpenMeld profile IDs are auth-backed and follow these rules:
 * - human/system profiles use a UUID
 * - agent profiles use agt_<UUID>
 *
 * Generic test fixtures or legacy intermediary strings should not reuse this
 * schema unless they represent a real runtime profile identity.
 */
export const openMeldRuntimeProfileIdSchema = z.preprocess(
  trimmedStringFromUnknown,
  z
    .string()
    .min(1)
    .max(MAX_PROFILE_ID_LENGTH)
    .refine(
      (value) =>
        UUID_PROFILE_ID_PATTERN.test(value) ||
        AGENT_PROFILE_ID_PATTERN.test(value),
      "Invalid OpenMeld runtime profile ID"
    )
);

/**
 * Generic wire/profile normalization rules:
 * - trims and validates profileId as a non-empty string
 * - defaults missing/invalid kind to "agent"
 * - truncates profileName/owner labels to max length
 * - preserves agent workingDirectory verbatim when it is a valid string
 * - keeps owner only for agent profiles
 *
 * This schema intentionally stays broader than auth-backed runtime IDs because
 * protocol/system messages may still use internal synthetic profile IDs such as
 * `openmeld-system`.
 */
export const profileSchema = z
  .object({
    kind: profileKindWithFallbackSchema.optional(),
    profileId: genericProfileIdSchema,
    profileHandle: z.unknown().optional(),
    profileName: z.unknown().optional(),
    owner: z.unknown().optional(),
    ownerName: z.unknown().optional(),
    agentControllerRef: z.unknown().optional(),
    agentControllerConversationId: z.unknown().optional(),
    workingDirectory: z.unknown().optional(),
    avatarUrl: z.unknown().optional(),
  })
  .transform((value) => {
    const kind = value.kind ?? "agent";
    const profileHandle = normalizeOptionalProfileHandle(value.profileHandle);
    const profileName = normalizeOptionalProfileLabel(value.profileName);
    const owner =
      kind === "agent" ? normalizeOptionalProfileLabel(value.owner) : undefined;
    const ownerName =
      kind === "agent"
        ? normalizeOptionalProfileLabel(value.ownerName)
        : undefined;
    const agentControllerRef =
      kind === "agent"
        ? normalizeOptionalProfileLabel(value.agentControllerRef)
        : undefined;
    const agentControllerConversationId =
      kind === "agent"
        ? normalizeOptionalProfileLabel(value.agentControllerConversationId)
        : undefined;
    const workingDirectory =
      kind === "agent"
        ? normalizeOptionalWorkingDirectory(value.workingDirectory)
        : undefined;
    const avatarUrl = normalizeOptionalAvatarUrl(value.avatarUrl);

    return {
      kind,
      profileId: value.profileId,
      ...(profileHandle ? { profileHandle } : {}),
      ...(profileName ? { profileName } : {}),
      ...(owner ? { owner } : {}),
      ...(ownerName ? { ownerName } : {}),
      ...(agentControllerRef ? { agentControllerRef } : {}),
      ...(agentControllerConversationId
        ? { agentControllerConversationId }
        : {}),
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    };
  });
