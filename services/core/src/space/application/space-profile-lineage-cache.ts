import type { CoreBindings } from "../../lib/bindings";
import { listActiveSpaceMemberProfileIdsForOwnerUserId } from "../infrastructure/sql/space-member-repo";
import {
  readSpaceProfileLineage,
  writeSpaceProfileLineage,
} from "../infrastructure/sql/space-profile-lineage-repo";
import {
  type CreatorProfileIdsByProfileId,
  classifyCachedProfileLineage,
  loadCreatorProfileIdsByOwnerUserId,
  PROFILE_LINEAGE_CACHE_MAX_AGE_MS,
  PROFILE_LINEAGE_CACHE_REFRESH_AGE_MS,
} from "../rules/privacy/profile-lineage";

// Resolves Auth-owned Profile lineage for one Space object. A recent copy in
// Space storage survives object restarts within the bounded freshness rule;
// concurrent reads for one owner share one Auth call.
export class SpaceProfileLineageCache {
  // Live fan-out restores a missing copy at most this often per owner, so an
  // unavailable Auth read is not retried on every broadcast.
  private static readonly PEEK_RESTORE_INTERVAL_MS = 30_000;
  private readonly peekRestoreAtMsByOwnerUserId = new Map<string, number>();
  // Read time of each lineage in the synchronous mirror.
  private readonly fetchedAtMsByOwnerUserId = new Map<string, number>();
  private readonly loadsByOwnerUserId = new Map<
    string,
    Promise<CreatorProfileIdsByProfileId | undefined>
  >();
  private readonly input: {
    authRpc: () => CoreBindings["OPENMELD_AUTH_WORKER"];
    onLoadError: (error: unknown, ownerUserId: string) => void;
    // Last lineage resolved per owner, kept for synchronous readers.
    resolvedByOwnerUserId: Map<string, CreatorProfileIdsByProfileId>;
    sql: () => SqlStorage;
    waitUntil: (promise: Promise<unknown>) => void;
  };

  constructor(input: SpaceProfileLineageCache["input"]) {
    this.input = input;
  }

  async resolve(
    ownerUserId: string
  ): Promise<CreatorProfileIdsByProfileId | undefined> {
    const sql = this.input.sql();
    const cached = readSpaceProfileLineage(sql, ownerUserId);
    const use = classifyCachedProfileLineage({
      cached,
      nowMs: Date.now(),
      requiredProfileIds: listActiveSpaceMemberProfileIdsForOwnerUserId(
        sql,
        ownerUserId
      ),
    });
    if (cached && use !== "reload") {
      this.remember(
        ownerUserId,
        cached.creatorProfileIdByProfileId,
        cached.fetchedAtMs
      );
      if (use === "refresh") {
        this.input.waitUntil(this.load(ownerUserId));
      }
      return cached.creatorProfileIdByProfileId;
    }
    // An expired copy must not keep authorizing synchronous readers.
    this.forget(ownerUserId);
    return await this.load(ownerUserId);
  }

  // Synchronous read for live fan-out to open sessions, under the same
  // freshness bound: an aging copy is served while one background read
  // refreshes it; an expired or missing copy is not served (origin facts stay
  // hidden) and a background read restores it. A Profile the copy does not
  // cover is never treated as related.
  peek(ownerUserId: string): CreatorProfileIdsByProfileId | undefined {
    const lineage = this.input.resolvedByOwnerUserId.get(ownerUserId);
    const fetchedAtMs = this.fetchedAtMsByOwnerUserId.get(ownerUserId);
    const ageMs =
      fetchedAtMs === undefined ? Number.NaN : Date.now() - fetchedAtMs;
    if (!(lineage && ageMs >= 0 && ageMs < PROFILE_LINEAGE_CACHE_MAX_AGE_MS)) {
      this.forget(ownerUserId);
      this.schedulePeekRead(ownerUserId, () => this.resolve(ownerUserId));
      return undefined;
    }
    if (ageMs >= PROFILE_LINEAGE_CACHE_REFRESH_AGE_MS) {
      this.schedulePeekRead(ownerUserId, () => this.load(ownerUserId));
    }
    return lineage;
  }

  // Starts at most one background read per owner per interval, so repeated
  // fan-out over a failing Auth read does not retry on every broadcast.
  private schedulePeekRead(
    ownerUserId: string,
    read: () => Promise<unknown>
  ): void {
    const nowMs = Date.now();
    const lastReadAtMs =
      this.peekRestoreAtMsByOwnerUserId.get(ownerUserId) ??
      Number.NEGATIVE_INFINITY;
    if (
      nowMs - lastReadAtMs <
      SpaceProfileLineageCache.PEEK_RESTORE_INTERVAL_MS
    ) {
      return;
    }
    this.peekRestoreAtMsByOwnerUserId.set(ownerUserId, nowMs);
    this.input.waitUntil(
      read().catch((error: unknown) =>
        this.input.onLoadError(error, ownerUserId)
      )
    );
  }

  private remember(
    ownerUserId: string,
    lineage: CreatorProfileIdsByProfileId,
    fetchedAtMs: number
  ): void {
    if ((this.fetchedAtMsByOwnerUserId.get(ownerUserId) ?? -1) > fetchedAtMs) {
      return;
    }
    this.input.resolvedByOwnerUserId.set(ownerUserId, lineage);
    this.fetchedAtMsByOwnerUserId.set(ownerUserId, fetchedAtMs);
  }

  private forget(ownerUserId: string): void {
    this.input.resolvedByOwnerUserId.delete(ownerUserId);
    this.fetchedAtMsByOwnerUserId.delete(ownerUserId);
  }

  private load(
    ownerUserId: string
  ): Promise<CreatorProfileIdsByProfileId | undefined> {
    const inFlight = this.loadsByOwnerUserId.get(ownerUserId);
    if (inFlight) {
      return inFlight;
    }
    const sql = this.input.sql();
    // Coverage is captured before the read: a member who joins meanwhile
    // forces the next read to reload instead of trusting this result.
    const coveredProfileIds = listActiveSpaceMemberProfileIdsForOwnerUserId(
      sql,
      ownerUserId
    );
    const fetchedAtMs = Date.now();
    const load = loadCreatorProfileIdsByOwnerUserId({
      authRpc: this.input.authRpc(),
      ownerUserId,
      onError: this.input.onLoadError,
    })
      .then((loaded) => {
        if (loaded) {
          writeSpaceProfileLineage(sql, ownerUserId, {
            creatorProfileIdByProfileId: loaded,
            coveredProfileIds,
            fetchedAtMs,
          });
          this.remember(ownerUserId, loaded, fetchedAtMs);
        }
        return loaded;
      })
      .finally(() => {
        this.loadsByOwnerUserId.delete(ownerUserId);
      });
    this.loadsByOwnerUserId.set(ownerUserId, load);
    return load;
  }
}
