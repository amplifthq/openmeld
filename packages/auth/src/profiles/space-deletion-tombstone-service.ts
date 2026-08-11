import type { OpenMeldProfileSpaceCreatorKind } from "../db/profile-space-history.schema";
import { ProfileValidationError } from "./profile-errors";
import type {
  SpaceDeletionTombstoneRecord,
  SpaceDeletionTombstoneRepository,
} from "./space-deletion-tombstone-repository";

const SPACE_DELETION_TOMBSTONE_QUERY_MAX_SPACE_IDS = 500;
const GATEWAY_HOST_MAX_LENGTH = 255;
const GATEWAY_HOST_PATH_CHARS_RE = /[/?#]/;

export type QuerySpaceDeletionTombstonesServiceInput = {
  gatewayHost: string;
  spaceIds: string[];
};

export type UpsertSpaceDeletionTombstoneServiceInput = {
  gatewayHost: string;
  spaceId: string;
  spaceName?: string | null;
  creatorProfileId?: string | null;
  creatorKind?: OpenMeldProfileSpaceCreatorKind | null;
  deletedByProfileId?: string | null;
  deletedByProfileName?: string | null;
  deletedByOwnerUserId?: string | null;
  deletedAt?: string | Date;
};

export type SpaceDeletionTombstoneService = ReturnType<
  typeof createSpaceDeletionTombstoneService
>;

export function createSpaceDeletionTombstoneService(
  repository: SpaceDeletionTombstoneRepository
) {
  return {
    queryTombstones: async (
      input: QuerySpaceDeletionTombstonesServiceInput
    ): Promise<SpaceDeletionTombstoneRecord[]> => {
      const gatewayHost = normalizeGatewayHost(input.gatewayHost);
      const spaceIds = normalizeSpaceIds(input.spaceIds);
      const items = await repository.queryByGatewayAndSpaceIds({
        gatewayHost,
        spaceIds,
      });
      const itemsBySpaceId = new Map(items.map((item) => [item.spaceId, item]));
      return spaceIds
        .map((spaceId) => itemsBySpaceId.get(spaceId))
        .filter((item): item is SpaceDeletionTombstoneRecord => Boolean(item));
    },
    upsertTombstone: (
      input: UpsertSpaceDeletionTombstoneServiceInput
    ): Promise<SpaceDeletionTombstoneRecord> => {
      const gatewayHost = normalizeGatewayHost(input.gatewayHost);
      const spaceId = normalizeRequiredText(input.spaceId, "spaceId");

      return repository.upsert({
        gatewayHost,
        spaceId,
        spaceName: normalizeOptionalNullableText(input.spaceName, "spaceName"),
        creatorProfileId: normalizeOptionalNullableText(
          input.creatorProfileId,
          "creatorProfileId"
        ),
        creatorKind: normalizeOptionalCreatorKind(input.creatorKind),
        deletedByProfileId: normalizeOptionalNullableText(
          input.deletedByProfileId,
          "deletedByProfileId"
        ),
        deletedByProfileName: normalizeOptionalNullableText(
          input.deletedByProfileName,
          "deletedByProfileName"
        ),
        deletedByOwnerUserId: normalizeOptionalNullableText(
          input.deletedByOwnerUserId,
          "deletedByOwnerUserId"
        ),
        deletedAt: normalizeOptionalDate(input.deletedAt, "deletedAt"),
      });
    },
  };
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

function normalizeSpaceIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ProfileValidationError("spaceIds must be an array");
  }
  if (
    value.length < 1 ||
    value.length > SPACE_DELETION_TOMBSTONE_QUERY_MAX_SPACE_IDS
  ) {
    throw new ProfileValidationError(
      `spaceIds must contain between 1 and ${SPACE_DELETION_TOMBSTONE_QUERY_MAX_SPACE_IDS} items`
    );
  }

  return Array.from(
    new Set(
      value.map((item, index) =>
        normalizeRequiredText(item, `spaceIds[${index}]`)
      )
    )
  );
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

function normalizeOptionalCreatorKind(
  value: OpenMeldProfileSpaceCreatorKind | null | undefined
): OpenMeldProfileSpaceCreatorKind | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  if (value !== "human" && value !== "agent" && value !== "system") {
    throw new ProfileValidationError(
      "creatorKind must be one of 'human', 'agent', or 'system'"
    );
  }

  return value;
}

function normalizeOptionalDate(
  value: string | Date | undefined,
  field: string
): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ProfileValidationError(`${field} must be a valid ISO datetime`);
  }

  return date;
}
