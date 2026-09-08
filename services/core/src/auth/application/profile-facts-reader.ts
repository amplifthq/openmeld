import {
  AUTH_PROFILE_FACT_BATCH_SIZE,
  authRpcResolveProfilesByIdsResultSchema,
} from "@openmeld/schemas";
import type { AuthRpcProfileFact } from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";

export type AuthProfileFacts = ReadonlyMap<string, AuthRpcProfileFact | null>;

// Request-scoped facts only. A missing response entry is not a missing Profile.
// In particular, catalog callers must preserve their current routes on null.
export async function readAuthProfileFacts(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"] | undefined;
  profileIds: string[];
  deadlineAtMs?: number;
}): Promise<AuthProfileFacts | null> {
  const ids = [...new Set(input.profileIds)];
  const profiles = new Map<string, AuthRpcProfileFact | null>();
  if (ids.length === 0) {
    return profiles;
  }
  if (!input.authWorker?.resolveProfilesByIds) {
    return null;
  }
  try {
    for (
      let offset = 0;
      offset < ids.length;
      offset += AUTH_PROFILE_FACT_BATCH_SIZE
    ) {
      if (
        input.deadlineAtMs !== undefined &&
        Date.now() >= input.deadlineAtMs
      ) {
        return null;
      }
      const batch = ids.slice(offset, offset + AUTH_PROFILE_FACT_BATCH_SIZE);
      const parsed = authRpcResolveProfilesByIdsResultSchema.safeParse(
        await input.authWorker.resolveProfilesByIds({ profileIds: batch })
      );
      if (!(parsed.success && parsed.data.ok)) {
        return null;
      }
      const result = parsed.data.profiles;
      if (!isCompleteProfileBatch(result, batch)) {
        return null;
      }
      for (const id of batch) {
        profiles.set(id, result[id] ?? null);
      }
    }
    return profiles;
  } catch {
    return null;
  }
}

function isCompleteProfileBatch(
  profiles: Record<string, AuthRpcProfileFact | null>,
  ids: string[]
): boolean {
  return (
    Object.keys(profiles).length === ids.length &&
    ids.every(
      (id) =>
        Object.hasOwn(profiles, id) &&
        (profiles[id] === null || profiles[id]?.profileId === id)
    )
  );
}
