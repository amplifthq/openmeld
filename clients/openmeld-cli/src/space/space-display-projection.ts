import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";

export type SpaceDisplayProjectionInput = {
  currentProfileId?: string | null;
  currentProfileName?: string | null;
  spaceId: string | null | undefined;
  spaceName?: string | null;
  creatorProfileName?: string | null;
  creatorProfileId?: string | null;
  availableViaProfileName?: string | null;
  availableViaProfileId?: string | null;
  spaceCreatedAt?: string | null;
  lastJoinedAt?: string | null;
  passwordProtected?: boolean | null;
};

export type SpaceMetadataFieldId =
  | "spaceId"
  | "spaceCreatedAt"
  | "spaceCreator"
  | "spaceCreatorProfileId"
  | "availableVia"
  | "availableViaProfileId"
  | "lastJoinedAt";

export type SpaceMetadataField = {
  id: SpaceMetadataFieldId;
  label: string;
  value: string;
};

export type SpaceDisplayProjection = {
  spaceId: string | null;
  spaceName: string | null;
  creatorProfileName: string | null;
  creatorProfileId: string | null;
  creatorDisplayName: string | null;
  availableViaProfileName: string | null;
  availableViaProfileId: string | null;
  availableViaDisplayName: string | null;
  spaceCreatedAt: string | null;
  lastJoinedAt: string | null;
  passwordProtected: boolean | null;
};

export function buildSpaceDisplayProjection(
  input: SpaceDisplayProjectionInput
): SpaceDisplayProjection {
  const currentProfileId = normalizeSpaceDisplayText(input.currentProfileId);
  const currentProfileName = normalizeSpaceDisplayText(
    input.currentProfileName
  );
  const creatorProfileName = normalizeSpaceDisplayText(
    input.creatorProfileName
  );
  const creatorProfileId = normalizeSpaceDisplayText(input.creatorProfileId);
  const availableViaProfileName = normalizeSpaceDisplayText(
    input.availableViaProfileName
  );
  const availableViaProfileId = normalizeSpaceDisplayText(
    input.availableViaProfileId
  );

  return {
    spaceId: normalizeSpaceDisplayText(input.spaceId),
    spaceName: normalizeSpaceDisplayText(input.spaceName),
    creatorProfileName,
    creatorProfileId,
    creatorDisplayName: resolveSpaceProfileDisplayName({
      currentProfileId,
      currentProfileName,
      profileId: creatorProfileId,
      profileName: creatorProfileName,
    }),
    availableViaProfileName,
    availableViaProfileId,
    availableViaDisplayName: resolveSpaceProfileDisplayName({
      currentProfileId,
      currentProfileName,
      profileId: availableViaProfileId,
      profileName: availableViaProfileName,
    }),
    spaceCreatedAt: normalizeSpaceDisplayText(input.spaceCreatedAt),
    lastJoinedAt: normalizeSpaceDisplayText(input.lastJoinedAt),
    passwordProtected:
      typeof input.passwordProtected === "boolean"
        ? input.passwordProtected
        : null,
  };
}

export function buildSpaceMetadataFields(input: {
  projection: SpaceDisplayProjection;
  includeAvailableVia?: boolean;
  includeCreatedAt?: boolean;
  includeLastJoinedAt?: boolean;
}): SpaceMetadataField[] {
  const fields: SpaceMetadataField[] = [
    {
      id: "spaceId",
      label: "Space ID",
      value: formatSpaceDisplayValue(input.projection.spaceId),
    },
    {
      id: "spaceCreator",
      label: "Space Creator",
      value: formatSpaceDisplayValue(
        input.projection.creatorDisplayName,
        "unknown-profile"
      ),
    },
    {
      id: "spaceCreatorProfileId",
      label: "Space Creator Profile ID",
      value: formatSpaceDisplayValue(
        input.projection.creatorProfileId,
        "unknown-profile"
      ),
    },
  ];

  if (input.includeAvailableVia === true) {
    fields.push(
      {
        id: "availableVia",
        label: "Available via",
        value: formatSpaceDisplayValue(
          input.projection.availableViaDisplayName
        ),
      },
      {
        id: "availableViaProfileId",
        label: "Available via Profile ID",
        value: formatSpaceDisplayValue(input.projection.availableViaProfileId),
      }
    );
  }

  if (input.includeCreatedAt === true) {
    fields.push({
      id: "spaceCreatedAt",
      label: "Space Created",
      value: formatSpaceDisplayValue(input.projection.spaceCreatedAt),
    });
  }

  if (input.includeLastJoinedAt === true) {
    fields.push({
      id: "lastJoinedAt",
      label: "Last joined",
      value: formatSpaceDisplayValue(input.projection.lastJoinedAt),
    });
  }

  return fields;
}

export function formatSpaceDisplayValue(
  value: string | null | undefined,
  fallback = "unknown"
): string {
  return value ?? fallback;
}

export function resolveSpaceDisplayName(
  value: string | null | undefined,
  fallback: string
): string {
  return value ?? fallback;
}

export function normalizeSpaceDisplayText(
  value: string | number | null | undefined
): string | null {
  const normalized = sanitizeTerminalDisplayText(value, "single-line").trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveSpaceProfileDisplayName(input: {
  currentProfileId: string | null;
  currentProfileName: string | null;
  profileId: string | null;
  profileName: string | null;
}): string | null {
  if (input.profileName) {
    return input.profileName;
  }
  if (
    input.profileId &&
    input.currentProfileId &&
    input.profileId === input.currentProfileId
  ) {
    return input.currentProfileName ?? input.profileId;
  }
  return input.profileId;
}
