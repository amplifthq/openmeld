import type {
  AuthProfileKind,
  OpenMeldProfileManagedRole,
} from "@openmeld/auth/server";
import { ProfileValidationError } from "@openmeld/auth/server";

export function toProfileView(
  profile: {
    profileId: string;
    profileName: string;
    profileHandle: string;
    profileKind: AuthProfileKind;
    isDefault: boolean;
    status: "active" | "disabled";
    ownerUserId: string;
    source: string;
    managedRole?: unknown;
    defaultProjectId?: string | null;
    createdByUserId: string | null;
    creatorProfileId: string | null;
    lastUsedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  options?: { ownerName?: string | null }
) {
  const ownerName = normalizeOptionalText(options?.ownerName);
  const managedRole = normalizeProfileManagedRole(profile.managedRole);
  return {
    openMeldProfileId: profile.profileId,
    profileName: profile.profileName,
    profileHandle: profile.profileHandle,
    profileKind: profile.profileKind,
    isDefault: profile.isDefault,
    status: profile.status,
    ownerUserId: profile.ownerUserId,
    ...(ownerName ? { ownerName } : {}),
    source: profile.source,
    managedRole,
    ...(profile.profileKind === "agent" && managedRole === null
      ? { defaultProjectId: normalizeOptionalText(profile.defaultProjectId) }
      : {}),
    createdByUserId: profile.createdByUserId,
    creatorProfileId: profile.creatorProfileId,
    lastUsedAt: toIsoString(profile.lastUsedAt),
    createdAt: toIsoString(profile.createdAt),
    updatedAt: toIsoString(profile.updatedAt),
  };
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toIsoString(value: Date | null): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizeProfileManagedRole(
  value: unknown
): OpenMeldProfileManagedRole | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value === "openmeld_assistant" || value === "center_agent") {
    return value;
  }
  throw new ProfileValidationError("managedRole is invalid");
}
