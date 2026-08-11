import { createAgentProfileBindingApi } from "@openmeld/api-client";
import type { GetAgentProfilePrimaryBindingResponse } from "@openmeld/schemas/types";
import { resolveBaseUrl } from "../config/base-url";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { createCliApiClientFoundation } from "../space/api-client-foundation";

// One Core primary-binding read per profile per logical operation. A status
// snapshot, a daemon catalog sync, or a setup pass may consult the same
// profile's binding from several derivations (device projection, route
// catalog, agent readiness); without sharing, each derivation pays its own
// account-wide fan-out. The session memoizes the in-flight read per profile
// and bounds HTTP concurrency. It is process-internal and operation-scoped
// by construction - never persist it and never reuse it across operations,
// so binding truth stays a per-operation Core read, not a local cache.
export type PrimaryBindingReadSession = {
  readPrimaryBinding: (
    profile: OpenMeldProfile
  ) => Promise<GetAgentProfilePrimaryBindingResponse>;
};

const DEFAULT_MAX_CONCURRENT_PRIMARY_BINDING_READS = 8;

export function createPrimaryBindingReadSession(input?: {
  baseUrl?: string;
  maxConcurrentReads?: number;
}): PrimaryBindingReadSession {
  const readByProfileId = new Map<
    string,
    Promise<GetAgentProfilePrimaryBindingResponse>
  >();
  const limit = createConcurrencyLimit(
    input?.maxConcurrentReads ?? DEFAULT_MAX_CONCURRENT_PRIMARY_BINDING_READS
  );
  let bindingApiPromise: Promise<
    ReturnType<typeof createAgentProfileBindingApi>
  > | null = null;

  const resolveBindingApi = (): Promise<
    ReturnType<typeof createAgentProfileBindingApi>
  > => {
    bindingApiPromise ??= (async () =>
      createAgentProfileBindingApi(
        createCliApiClientFoundation(input?.baseUrl ?? (await resolveBaseUrl()))
      ))();
    return bindingApiPromise;
  };

  return {
    readPrimaryBinding: (profile) => {
      const profileId = profile.openMeldProfileId;
      const existing = readByProfileId.get(profileId);
      if (existing) {
        return existing;
      }
      const read = limit(async () => {
        const bindingApi = await resolveBindingApi();
        return await bindingApi.getPrimaryBinding({
          agentProfileId: profileId,
          requestContext: buildOpenMeldRequestContextFromProfile({
            openMeldProfile: profile,
          }),
        });
      });
      readByProfileId.set(profileId, read);
      return read;
    },
  };
}

function createConcurrencyLimit(
  maxConcurrent: number
): <T>(task: () => Promise<T>) => Promise<T> {
  const normalizedMax = Math.max(1, Math.trunc(maxConcurrent));
  let active = 0;
  const queue: Array<() => void> = [];

  const releaseSlot = (): void => {
    active -= 1;
    const next = queue.shift();
    if (next) {
      next();
    }
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= normalizedMax) {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    }
    active += 1;
    try {
      return await task();
    } finally {
      releaseSlot();
    }
  };
}
