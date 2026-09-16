import { readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  compactLedgerState,
  createEmptyLedgerState,
  type OpenMeldDaemonLedgerState,
  persistLedgerState,
} from "../src/ledger-store";
import {
  createNodeLedgerFileIo,
  createTempLedgerPaths,
} from "./ledger-test-io";

const createdDirs = new Set<string>();

afterEach(async () => {
  for (const dirPath of createdDirs) {
    await rm(dirPath, { force: true, recursive: true });
  }
  createdDirs.clear();
});

const buildStateForCompaction = (nowMs: number): OpenMeldDaemonLedgerState => ({
  ...createEmptyLedgerState(nowMs),
  dedupeFirstSeenByKey: {
    old: nowMs - 49 * 60 * 60 * 1000,
    recent: nowMs - 2 * 60 * 60 * 1000,
  },
  inflightByTaskId: {
    "task-inflight": {
      bindingKey: "space|agent",
      firstSeenAtMs: nowMs - 1000,
      idempotencyKey: "idem-1",
      sequence: 1,
      taskId: "task-inflight",
    },
    "task-old-inflight": {
      bindingKey: "space|agent",
      firstSeenAtMs: nowMs - 49 * 60 * 60 * 1000,
      idempotencyKey: "idem-old-inflight",
      sequence: 2,
      taskId: "task-old-inflight",
    },
  },
  replayedTaskIds: {
    "task-inflight": true,
    "task-stale": true,
  },
  agentContextByLookupKey: {
    recentA: {
      agentControllerConversationId: "ctx-a",
      agentContextLookupKey: "recentA",
      agentControllerRef: "builtin:codex",
      createdAtMs: nowMs - 1000,
      lastTaskId: "task-a",
      spaceId: "space",
      targetProfileId: "agent",
      transportMode: "local-cli",
      updatedAtMs: nowMs - 1000,
    },
    recentB: {
      agentControllerConversationId: "ctx-b",
      agentContextLookupKey: "recentB",
      agentControllerRef: "builtin:codex",
      createdAtMs: nowMs - 2000,
      lastTaskId: "task-b",
      spaceId: "space",
      targetProfileId: "agent",
      transportMode: "local-cli",
      updatedAtMs: nowMs - 2000,
    },
    oldC: {
      agentControllerConversationId: "ctx-c",
      agentContextLookupKey: "oldC",
      agentControllerRef: "builtin:codex",
      createdAtMs: nowMs - 31 * 24 * 60 * 60 * 1000,
      lastTaskId: "task-c",
      spaceId: "space",
      targetProfileId: "agent",
      transportMode: "local-cli",
      updatedAtMs: nowMs - 31 * 24 * 60 * 60 * 1000,
    },
  },
});

describe("ledger state compaction", () => {
  it("compacts dedupe/replayed/context fields by ttl and max entries", () => {
    const nowMs = Date.parse("2026-03-03T00:00:00.000Z");
    const compacted = compactLedgerState({
      maxAgentContexts: 1,
      nowMs,
      state: buildStateForCompaction(nowMs),
    });

    expect(compacted.dedupeFirstSeenByKey).toEqual({
      recent: nowMs - 2 * 60 * 60 * 1000,
    });
    expect(compacted.replayedTaskIds).toEqual({
      "task-inflight": true,
    });
    expect(Object.keys(compacted.inflightByTaskId)).toEqual(["task-inflight"]);
    expect(Object.keys(compacted.agentContextByLookupKey)).toEqual(["recentA"]);
    expect(compacted.updatedAtMs).toBe(nowMs);
  });

  it("applies compaction during persist", async () => {
    const nowMs = Date.parse("2026-03-03T00:00:00.000Z");
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-ledger-state-compact-"
    );
    createdDirs.add(paths.rootDirPath);

    await persistLedgerState({
      io: createNodeLedgerFileIo(),
      paths,
      state: buildStateForCompaction(nowMs),
    });

    const raw = await readFile(paths.stateFilePath, "utf8");
    const persisted = JSON.parse(raw) as OpenMeldDaemonLedgerState;

    expect(persisted.dedupeFirstSeenByKey.old).toBeUndefined();
    expect(persisted.inflightByTaskId["task-old-inflight"]).toBeUndefined();
    expect(persisted.agentContextByLookupKey.oldC).toBeUndefined();
  });
});
