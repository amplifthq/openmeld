import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "./helpers/fs";
import { expectSpaceConfigReadValue } from "./helpers/local-state";

const FALLBACK_ACCOUNT_PATH = [
  ".openmeld",
  "accounts",
  "unauthenticated",
  "local",
  "profiles",
  "mira--aaaaaaaa",
  "space-cache",
] as const;
const OPENMELD_PROFILE_ID = "mira--aaaaaaaa";

function createDeferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

async function loadLocalStateWithWriteBarrier(input: {
  shouldBlock: (payload: unknown) => boolean;
}) {
  vi.resetModules();
  const writeBlocked = createDeferred<void>();
  const writeReleased = createDeferred<void>();
  let matchedBarrier = false;

  vi.doMock("node:fs/promises", async () => {
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises"
      );

    return {
      ...actual,
      writeFile: vi.fn(async (...args: Parameters<typeof actual.writeFile>) => {
        const [path, data] = args;
        const payload = tryParseJsonString(data);
        if (
          !matchedBarrier &&
          typeof path === "string" &&
          path.includes(".json.tmp-") &&
          input.shouldBlock(payload)
        ) {
          matchedBarrier = true;
          writeBlocked.resolve();
          await writeReleased.promise;
        }

        return await actual.writeFile(...args);
      }),
    };
  });

  const localState = await import("../src/space/local-state");
  return {
    ...localState,
    waitUntilWriteBlocked: async () => {
      await writeBlocked.promise;
    },
    releaseBlockedWrite: () => {
      writeReleased.resolve();
    },
  };
}

function tryParseJsonString(value: unknown): unknown {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("space local-state concurrency", () => {
  it("keeps both lastSeenTs and recent mentions when the writes overlap", async () => {
    const {
      readSpaceConfig,
      updateSpaceLastSeenTs,
      upsertSpaceConfig,
      waitUntilWriteBlocked,
      writeSpaceRecentMentionProfileIds,
      releaseBlockedWrite,
    } = await loadLocalStateWithWriteBarrier({
      shouldBlock: (payload) =>
        Boolean(
          payload &&
            typeof payload === "object" &&
            (payload as { lastSeenTs?: number }).lastSeenTs === 321
        ),
    });

    await withTempHome(async (home) => {
      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Mira",
      });

      const updateLastSeenPromise = updateSpaceLastSeenTs({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        space: "demo",
        lastSeenTs: 321,
      });
      await waitUntilWriteBlocked();

      const updateRecentMentionsPromise = writeSpaceRecentMentionProfileIds({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        space: "demo",
        recentMentionProfileIds: ["agt_ops", "hum_felix"],
      });

      releaseBlockedWrite();
      await Promise.all([updateLastSeenPromise, updateRecentMentionsPromise]);

      const config = expectSpaceConfigReadValue(
        await readSpaceConfig({
          openMeldProfileId: OPENMELD_PROFILE_ID,
          space: "demo",
        })
      );
      expect(config).toMatchObject({
        lastSeenTs: 321,
        recentMentionProfileIds: ["agt_ops", "hum_felix"],
      });

      const raw = await readFile(
        join(home, ...FALLBACK_ACCOUNT_PATH, "demo.json"),
        "utf8"
      );
      expect(JSON.parse(raw)).toMatchObject({
        lastSeenTs: 321,
        recentMentionProfileIds: ["agt_ops", "hum_felix"],
      });
    });
  });

  it("keeps recent mentions when a queued upsert runs after them", async () => {
    const {
      readSpaceConfig,
      upsertSpaceConfig,
      waitUntilWriteBlocked,
      writeSpaceRecentMentionProfileIds,
      releaseBlockedWrite,
    } = await loadLocalStateWithWriteBarrier({
      shouldBlock: (payload) =>
        Boolean(
          payload &&
            typeof payload === "object" &&
            Array.isArray(
              (payload as { recentMentionProfileIds?: unknown })
                .recentMentionProfileIds
            )
        ),
    });

    await withTempHome(async (home) => {
      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Mira",
      });

      const updateRecentMentionsPromise = writeSpaceRecentMentionProfileIds({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        space: "demo",
        recentMentionProfileIds: ["agt_ops", "hum_felix"],
      });
      await waitUntilWriteBlocked();

      const upsertPromise = upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Mira",
        role: "triage",
        mentionAlias: "@ops",
      });

      releaseBlockedWrite();
      await Promise.all([updateRecentMentionsPromise, upsertPromise]);

      const config = expectSpaceConfigReadValue(
        await readSpaceConfig({
          openMeldProfileId: OPENMELD_PROFILE_ID,
          space: "demo",
        })
      );
      expect(config).toMatchObject({
        role: "triage",
        mentionAlias: "@ops",
        recentMentionProfileIds: ["agt_ops", "hum_felix"],
      });

      const raw = await readFile(
        join(home, ...FALLBACK_ACCOUNT_PATH, "demo.json"),
        "utf8"
      );
      expect(JSON.parse(raw)).toMatchObject({
        role: "triage",
        mentionAlias: "@ops",
        recentMentionProfileIds: ["agt_ops", "hum_felix"],
      });
    });
  });

  it("keeps a queued delete authoritative when it races with an in-flight upsert", async () => {
    const {
      readSpaceConfig,
      upsertSpaceConfig,
      removeSpaceConfig,
      waitUntilWriteBlocked,
      releaseBlockedWrite,
    } = await loadLocalStateWithWriteBarrier({
      shouldBlock: (payload) =>
        Boolean(
          payload &&
            typeof payload === "object" &&
            (payload as { role?: unknown }).role === "triage"
        ),
    });

    await withTempHome(async (home) => {
      await upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Mira",
      });

      const queuedUpsertPromise = upsertSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        baseUrl: "https://example.com",
        space: "demo",
        profileName: "Mira",
        role: "triage",
      });
      await waitUntilWriteBlocked();

      const removePromise = removeSpaceConfig({
        openMeldProfileId: OPENMELD_PROFILE_ID,
        space: "demo",
      });

      releaseBlockedWrite();
      await Promise.all([queuedUpsertPromise, removePromise]);

      await expect(
        readSpaceConfig({
          openMeldProfileId: OPENMELD_PROFILE_ID,
          space: "demo",
        })
      ).resolves.toMatchObject({
        kind: "missing",
        fileKind: "space_config",
      });

      await expect(
        readFile(join(home, ...FALLBACK_ACCOUNT_PATH, "demo.json"), "utf8")
      ).rejects.toThrow();
    });
  });
});
