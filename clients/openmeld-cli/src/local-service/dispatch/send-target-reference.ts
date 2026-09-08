import { createHash } from "node:crypto";
import type { DispatchSendTargetProjectionEntry } from "@openmeld/local-service";
import type {
  OpenMeldRequestContext,
  SpaceMemberDirectory,
} from "@openmeld/schemas/types";
import {
  createDispatchContinuationSpaceAccessContext,
  getSpaceAccessPassword,
  getSpaceAccessRequestContext,
  listSpaceMemberDirectorySendTargets,
  type SpaceMemberDirectorySendTargetEntry,
} from "@openmeld/space";
import { resolveBaseUrl } from "../../config/base-url";
import { buildOpenMeldRequestContextFromProfileIdentity } from "../../config/openmeld-request-context";
import { createCliSpaceApi, type SpaceApi } from "../../space/cli-space-api";

const SEND_TARGET_REFERENCE_DIRECTORY_CACHE_TTL_MS = 20_000;

type CachedMemberDirectory = {
  directory: SpaceMemberDirectory;
  expiresAtMs: number;
};

const memberDirectoryCache = new Map<string, CachedMemberDirectory>();
const inFlightMemberDirectoryLoads = new Map<
  string,
  Promise<SpaceMemberDirectory>
>();

export type DispatchSendTargetReferenceLoadResult =
  | {
      status: "loaded";
      projection: SpaceMemberDirectorySendTargetEntry[];
      referenceLines: string[];
    }
  | {
      status: "failed";
      errorMessage: string;
      projection: null;
      referenceLines: [];
    };

export async function resolveDispatchSendTargetReference(input: {
  agentControllerRef: string;
  dispatchTask: {
    attemptId: string;
    dispatchId: string;
    sourceEventId: string;
    spaceId: string;
    spacePassword: string | null;
    targetProfileId: string;
  };
  profileOwnerName: string | null;
  profileOwnerUserId: string;
  targetProfileName: string | null;
}): Promise<DispatchSendTargetReferenceLoadResult> {
  try {
    const baseUrl = await resolveBaseUrl();
    const spaceApi = createCliSpaceApi(baseUrl);
    const requestContext = buildDispatchSendTargetRequestContext({
      profileOwnerName: input.profileOwnerName,
      profileOwnerUserId: input.profileOwnerUserId,
      targetProfileId: input.dispatchTask.targetProfileId,
      targetProfileName: input.targetProfileName,
    });
    const spaceAccess = createDispatchContinuationSpaceAccessContext({
      attemptId: input.dispatchTask.attemptId,
      dispatchId: input.dispatchTask.dispatchId,
      password: input.dispatchTask.spacePassword,
      requestContext,
      sourceSignalId: input.dispatchTask.sourceEventId,
      spaceId: input.dispatchTask.spaceId,
      targetProfileId: input.dispatchTask.targetProfileId,
    });
    const accessRequestContext = getSpaceAccessRequestContext(spaceAccess);
    const spacePassword = getSpaceAccessPassword(spaceAccess) ?? null;
    const directory = await loadDispatchSendTargetMemberDirectory({
      baseUrl,
      profileOwnerUserId: input.profileOwnerUserId,
      requestContext: accessRequestContext ?? requestContext,
      spaceApi,
      spaceId: spaceAccess.spaceId,
      spacePassword,
    });
    const projection = listSpaceMemberDirectorySendTargets(directory).sort(
      (left, right) =>
        left.primaryMentionLabel.localeCompare(
          right.primaryMentionLabel,
          "en",
          {
            sensitivity: "base",
          }
        )
    );

    return {
      status: "loaded",
      projection,
      referenceLines: projection
        .filter(
          (target) => target.profileId !== input.dispatchTask.targetProfileId
        )
        .map((target) => formatDispatchSendTargetReferenceLine(target)),
    };
  } catch (error) {
    return {
      status: "failed",
      errorMessage:
        error instanceof Error
          ? error.message
          : "Failed to load current Space member directory",
      projection: null,
      referenceLines: [],
    };
  }
}

function loadDispatchSendTargetMemberDirectory(input: {
  baseUrl: string;
  profileOwnerUserId: string;
  requestContext: OpenMeldRequestContext;
  spaceApi: SpaceApi;
  spaceId: string;
  spacePassword: string | null;
}): Promise<SpaceMemberDirectory> {
  const cacheKey = buildMemberDirectoryCacheKey(input);
  const nowMs = Date.now();
  const cached = memberDirectoryCache.get(cacheKey);
  if (cached && cached.expiresAtMs > nowMs) {
    return Promise.resolve(cached.directory);
  }
  if (cached) {
    memberDirectoryCache.delete(cacheKey);
  }

  const inFlight = inFlightMemberDirectoryLoads.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const loadPromise = input.spaceApi
    .getMemberDirectory({
      requestContext: input.requestContext,
      spaceId: input.spaceId,
      ...(input.spacePassword ? { spacePassword: input.spacePassword } : {}),
    })
    .then((directory) => {
      memberDirectoryCache.set(cacheKey, {
        directory,
        expiresAtMs: Date.now() + SEND_TARGET_REFERENCE_DIRECTORY_CACHE_TTL_MS,
      });
      return directory;
    })
    .finally(() => {
      inFlightMemberDirectoryLoads.delete(cacheKey);
    });

  inFlightMemberDirectoryLoads.set(cacheKey, loadPromise);
  return loadPromise;
}

function buildMemberDirectoryCacheKey(input: {
  baseUrl: string;
  profileOwnerUserId: string;
  spaceId: string;
  spacePassword: string | null;
}): string {
  return [
    `base:${input.baseUrl}`,
    `space:${input.spaceId}`,
    `owner:${input.profileOwnerUserId}`,
    `password:${hashCacheSecret(input.spacePassword)}`,
  ].join("|");
}

function hashCacheSecret(value: string | null): string {
  if (!value) {
    return "none";
  }
  return createHash("sha256").update(value).digest("base64url");
}

export function clearDispatchSendTargetReferenceCacheForTests(): void {
  memberDirectoryCache.clear();
  inFlightMemberDirectoryLoads.clear();
}

function buildDispatchSendTargetRequestContext(input: {
  profileOwnerName: string | null;
  profileOwnerUserId: string;
  targetProfileId: string;
  targetProfileName: string | null;
}): OpenMeldRequestContext {
  return buildOpenMeldRequestContextFromProfileIdentity({
    profileIdentity: {
      openMeldProfileId: input.targetProfileId,
      profileKind: "agent",
      ownerUserId: input.profileOwnerUserId,
      ...(input.profileOwnerName ? { ownerName: input.profileOwnerName } : {}),
      profileName: normalizeTargetProfileName(input.targetProfileName),
    },
  });
}

function formatDispatchSendTargetReferenceLine(
  target: DispatchSendTargetProjectionEntry
): string {
  return `${target.primaryMentionLabel} -> ${target.profileId} (${formatAllowedRelations(target)})`;
}

function formatAllowedRelations(
  target: DispatchSendTargetProjectionEntry
): string {
  const relations: string[] = [];
  if (target.allowedRelations.wake) {
    relations.push("wake");
  }
  if (target.allowedRelations.reference) {
    relations.push("reference");
  }
  if (target.allowedRelations.mention) {
    relations.push("mention");
  }
  return relations.join(" | ");
}

function normalizeTargetProfileName(value: string | null): string {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : "unknown";
}
