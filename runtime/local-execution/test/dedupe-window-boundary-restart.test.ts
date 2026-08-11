import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildIdempotencyKey,
  shouldDedupeWithinWindow,
} from "../src/data-plane-contract";
import {
  createEmptyLedgerState,
  loadLedgerState,
  persistLedgerState,
  recordDedupeFirstSeenAt,
  resolveDedupeFirstSeenAt,
} from "../src/ledger-store";
import {
  createNodeLedgerFileIo,
  createTempLedgerPaths,
} from "./ledger-test-io";

const HOURS_24_MS = 24 * 60 * 60 * 1000;
const createdDirs = new Set<string>();

afterEach(async () => {
  for (const dirPath of createdDirs) {
    await rm(dirPath, { force: true, recursive: true });
  }
  createdDirs.clear();
});

describe("ledger-recovery dedupe window boundary + restart regression", () => {
  it("keeps dedupe decision stable across restart with persisted firstSeen timestamp", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-ledger-recovery-dedupe-"
    );
    createdDirs.add(paths.rootDirPath);
    const io = createNodeLedgerFileIo();

    const firstSeenAtMs = Date.UTC(2026, 1, 25, 0, 0, 0);
    const idempotencyKey = buildIdempotencyKey({
      sourceEventId: "evt-1",
      targetProfileId: "agt-1",
    });

    const initialState = recordDedupeFirstSeenAt({
      firstSeenAtMs,
      idempotencyKey,
      state: createEmptyLedgerState(firstSeenAtMs),
    });
    await persistLedgerState({
      io,
      paths,
      state: initialState,
    });

    const reloadedState = await loadLedgerState({
      io,
      paths,
    });
    const persistedFirstSeenAtMs = resolveDedupeFirstSeenAt({
      idempotencyKey,
      state: reloadedState,
    });

    expect(persistedFirstSeenAtMs).toBe(firstSeenAtMs);
    expect(
      shouldDedupeWithinWindow({
        firstSeenAtMs,
        nowMs: firstSeenAtMs + HOURS_24_MS - 60_000,
      })
    ).toBe(true);
    expect(
      shouldDedupeWithinWindow({
        firstSeenAtMs,
        nowMs: firstSeenAtMs + HOURS_24_MS + 1,
      })
    ).toBe(false);
  });
});
