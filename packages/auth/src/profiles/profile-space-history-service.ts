import type {
  OpenMeldProfileSpaceCreatorKind,
  OpenMeldProfileSpaceHistoryStatus,
} from "../db/profile-space-history.schema";
import { ProfileValidationError } from "./profile-errors";
import type {
  ProfileSpaceHistoryRecord,
  ProfileSpaceHistoryRepository,
} from "./profile-space-history-repository";

const PROFILE_SPACE_HISTORY_DEFAULT_LIMIT = 100;
const PROFILE_SPACE_HISTORY_MAX_LIMIT = 500;
const PROFILE_SPACE_HISTORY_MAX_SPACE_IDS = 500;
const GATEWAY_HOST_MAX_LENGTH = 255;
const GATEWAY_HOST_PATH_CHARS_RE = /[/?#]/;

export type ListProfileSpaceHistoryInput = {
  profileId: string;
  gatewayHost: string;
  statuses?: OpenMeldProfileSpaceHistoryStatus[];
  pinned?: boolean;
  limit?: number;
};

export type ListProfileSpaceHistoryForProfilesInput = {
  profileIds: string[];
  gatewayHost: string;
  statuses?: OpenMeldProfileSpaceHistoryStatus[];
  limit?: number;
};

export type UpsertProfileSpaceHistoryServiceInput = {
  profileId: string;
  gatewayHost: string;
  spaceId: string;
  spaceName?: string | null;
  creatorProfileId?: string | null;
  creatorKind?: OpenMeldProfileSpaceCreatorKind | null;
  spaceCreatedAt?: string | Date | null;
  spaceUpdatedAt?: string | Date | null;
  lastJoinedAt?: string | Date;
  lastSeenTs?: number | null;
  pinnedAt?: string | Date | null;
  status?: OpenMeldProfileSpaceHistoryStatus;
};

export type UpdateProfileSpaceHistoryStatusInput = {
  profileId: string;
  gatewayHost: string;
  spaceId: string;
  status: OpenMeldProfileSpaceHistoryStatus;
  reason?: string;
};

export type ListAccessibleSpaceIdsInput = {
  profileIds: string[];
  gatewayHost: string;
  spaceIds: string[];
};

export type ProfileSpaceHistoryService = ReturnType<
  typeof createProfileSpaceHistoryService
>;

export type ProfileSpaceHistoryServiceHooks = {
  // Fired after a successful history write so the owning worker can announce
  // the change to projections (Space Index membership overlay,
  // physical-db-split.md P0.3). Must never throw into the write path.
  onHistoryWritten?: (record: ProfileSpaceHistoryRecord) => void;
};

export function createProfileSpaceHistoryService(
  repository: ProfileSpaceHistoryRepository,
  hooks?: ProfileSpaceHistoryServiceHooks
) {
  const announceHistoryWritten = (record: ProfileSpaceHistoryRecord): void => {
    try {
      hooks?.onHistoryWritten?.(record);
    } catch {
      // Projection announcements are fire-and-forget; the history write is
      // the Profile-domain truth and must not fail because of them.
    }
  };
  return {
    listHistory: (input: ListProfileSpaceHistoryInput) => {
      const profileId = normalizeRequiredText(input.profileId, "profileId");
      const gatewayHost = normalizeGatewayHost(input.gatewayHost);
      const statuses = normalizeStatuses(input.statuses);
      const pinned = normalizeOptionalBoolean(input.pinned, "pinned");
      const limit = normalizeLimit(input.limit);

      return repository.listByProfileAndGateway({
        profileId,
        gatewayHost,
        statuses,
        pinned,
        limit,
      });
    },
    listHistoryForProfiles: (
      input: ListProfileSpaceHistoryForProfilesInput
    ): Promise<ProfileSpaceHistoryRecord[]> => {
      const profileIds = normalizeProfileIds(input.profileIds);
      const gatewayHost = normalizeGatewayHost(input.gatewayHost);
      const statuses = normalizeStatuses(input.statuses);
      const limit = normalizeLimit(input.limit);
      if (profileIds.length === 0) {
        return Promise.resolve([]);
      }

      return repository.listByProfilesAndGateway({
        profileIds,
        gatewayHost,
        statuses,
        limit,
      });
    },
    listAccessibleSpaceIds: async (
      input: ListAccessibleSpaceIdsInput
    ): Promise<string[]> => {
      const { profileIds, gatewayHost, spaceIds } =
        normalizeSpaceAccessInput(input);
      if (profileIds.length === 0 || spaceIds.length === 0) {
        return [];
      }

      const matchedSpaceIds = await repository.listAccessibleSpaceIds({
        profileIds,
        gatewayHost,
        spaceIds,
      });
      const matchedSpaceIdSet = new Set(matchedSpaceIds);
      return spaceIds.filter((spaceId) => matchedSpaceIdSet.has(spaceId));
    },
    upsertHistory: async (
      input: UpsertProfileSpaceHistoryServiceInput
    ): Promise<ProfileSpaceHistoryRecord> => {
      const profileId = normalizeRequiredText(input.profileId, "profileId");
      const gatewayHost = normalizeGatewayHost(input.gatewayHost);
      const spaceId = normalizeRequiredText(input.spaceId, "spaceId");

      const record = await repository.upsert({
        profileId,
        gatewayHost,
        spaceId,
        spaceName: normalizeOptionalNullableText(input.spaceName, "spaceName"),
        creatorProfileId: normalizeOptionalNullableText(
          input.creatorProfileId,
          "creatorProfileId"
        ),
        creatorKind: normalizeOptionalCreatorKind(input.creatorKind),
        spaceCreatedAt: normalizeOptionalNullableDate(
          input.spaceCreatedAt,
          "spaceCreatedAt"
        ),
        spaceUpdatedAt: normalizeOptionalNullableDate(
          input.spaceUpdatedAt,
          "spaceUpdatedAt"
        ),
        lastJoinedAt: normalizeOptionalDate(input.lastJoinedAt, "lastJoinedAt"),
        lastSeenTs: normalizeOptionalNullableLastSeenTs(input.lastSeenTs),
        pinnedAt: normalizeOptionalNullableDate(input.pinnedAt, "pinnedAt"),
        status: normalizeOptionalStatus(input.status),
      });
      announceHistoryWritten(record);
      return record;
    },
    updateStatus: async (
      input: UpdateProfileSpaceHistoryStatusInput
    ): Promise<ProfileSpaceHistoryRecord> => {
      const profileId = normalizeRequiredText(input.profileId, "profileId");
      const gatewayHost = normalizeGatewayHost(input.gatewayHost);
      const spaceId = normalizeRequiredText(input.spaceId, "spaceId");
      const status = normalizeRequiredStatus(input.status, "status");
      normalizeOptionalReason(input.reason);

      const updated = await repository.updateStatus({
        profileId,
        gatewayHost,
        spaceId,
        status,
      });
      if (updated) {
        announceHistoryWritten(updated);
        return updated;
      }

      const fallback = await repository.upsert({
        profileId,
        gatewayHost,
        spaceId,
        status,
        lastJoinedAt: new Date(),
      });
      announceHistoryWritten(fallback);
      return fallback;
    },
  };
}

function normalizeSpaceAccessInput(input: ListAccessibleSpaceIdsInput): {
  profileIds: string[];
  gatewayHost: string;
  spaceIds: string[];
} {
  return {
    profileIds: normalizeProfileIds(input.profileIds),
    gatewayHost: normalizeGatewayHost(input.gatewayHost),
    spaceIds: normalizeSpaceIds(input.spaceIds),
  };
}

function normalizeProfileIds(values: string[]): string[] {
  if (!Array.isArray(values)) {
    throw new ProfileValidationError("profileIds must be an array");
  }

  return Array.from(
    new Set(
      values.map((value, index) =>
        normalizeRequiredText(value, `profileIds[${index}]`)
      )
    )
  );
}

function normalizeSpaceIds(values: string[]): string[] {
  if (!Array.isArray(values)) {
    throw new ProfileValidationError("spaceIds must be an array");
  }
  if (values.length > PROFILE_SPACE_HISTORY_MAX_SPACE_IDS) {
    throw new ProfileValidationError(
      `spaceIds must contain at most ${PROFILE_SPACE_HISTORY_MAX_SPACE_IDS} items`
    );
  }

  return Array.from(
    new Set(
      values.map((value, index) =>
        normalizeRequiredText(value, `spaceIds[${index}]`)
      )
    )
  );
}

function normalizeRequiredText(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length === 0) {
    throw new ProfileValidationError(`${field} is required`);
  }
  return normalized;
}

function normalizeGatewayHost(value: unknown): string {
  const normalized = normalizeRequiredText(value, "gatewayHost").toLowerCase();

  if (normalized.includes("://")) {
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      throw new ProfileValidationError("gatewayHost must be a valid host");
    }

    const hasPath = parsed.pathname !== "/";
    if (hasPath || parsed.search.length > 0 || parsed.hash.length > 0) {
      throw new ProfileValidationError(
        "gatewayHost must not include path/query/hash"
      );
    }
    if (parsed.host.length === 0) {
      throw new ProfileValidationError("gatewayHost is required");
    }

    const host = parsed.host.toLowerCase();
    if (host.length > GATEWAY_HOST_MAX_LENGTH) {
      throw new ProfileValidationError("gatewayHost is too long");
    }
    return host;
  }

  if (GATEWAY_HOST_PATH_CHARS_RE.test(normalized)) {
    throw new ProfileValidationError(
      "gatewayHost must not include path/query/hash"
    );
  }

  if (normalized.length > GATEWAY_HOST_MAX_LENGTH) {
    throw new ProfileValidationError("gatewayHost is too long");
  }

  return normalized;
}

function normalizeOptionalNullableText(
  value: unknown,
  field: string
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ProfileValidationError(`${field} must be a string or null`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ProfileValidationError(`${field} must be a non-empty string`);
  }
  return normalized;
}

function normalizeOptionalNullableDate(
  value: string | Date | null | undefined,
  field: string
): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const date = normalizeDate(value, field);
  return date;
}

function normalizeOptionalDate(
  value: string | Date | undefined,
  field: string
): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeDate(value, field);
}

function normalizeDate(value: string | Date, field: string): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ProfileValidationError(`${field} must be a valid ISO datetime`);
  }
  return date;
}

function normalizeStatuses(
  values: OpenMeldProfileSpaceHistoryStatus[] | undefined
): OpenMeldProfileSpaceHistoryStatus[] {
  if (!values || values.length === 0) {
    return ["active"];
  }
  return values.map((status) => normalizeRequiredStatus(status, "status"));
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return PROFILE_SPACE_HISTORY_DEFAULT_LIMIT;
  }
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > PROFILE_SPACE_HISTORY_MAX_LIMIT
  ) {
    throw new ProfileValidationError(
      `limit must be an integer between 1 and ${PROFILE_SPACE_HISTORY_MAX_LIMIT}`
    );
  }
  return value;
}

function normalizeOptionalNullableLastSeenTs(
  value: number | null | undefined
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new ProfileValidationError(
      "lastSeenTs must be a non-negative integer"
    );
  }
  return value;
}

function normalizeOptionalBoolean(
  value: boolean | undefined,
  field: string
): boolean | undefined {
  if (value === undefined || typeof value === "boolean") {
    return value;
  }
  throw new ProfileValidationError(`${field} must be a boolean`);
}

function normalizeRequiredStatus(
  value: OpenMeldProfileSpaceHistoryStatus,
  field: string
): OpenMeldProfileSpaceHistoryStatus {
  if (value === "active" || value === "removed" || value === "inaccessible") {
    return value;
  }
  throw new ProfileValidationError(
    `${field} must be one of active|removed|inaccessible`
  );
}

function normalizeOptionalStatus(
  value: OpenMeldProfileSpaceHistoryStatus | undefined
): OpenMeldProfileSpaceHistoryStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeRequiredStatus(value, "status");
}

function normalizeOptionalCreatorKind(
  value: OpenMeldProfileSpaceCreatorKind | null | undefined
): OpenMeldProfileSpaceCreatorKind | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (value === "human" || value === "agent" || value === "system") {
    return value;
  }
  throw new ProfileValidationError(
    "creatorKind must be one of human|agent|system"
  );
}

function normalizeOptionalReason(
  value: string | undefined
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ProfileValidationError("reason must be a non-empty string");
  }
  return normalized;
}
