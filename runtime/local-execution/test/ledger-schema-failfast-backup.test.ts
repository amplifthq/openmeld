import { readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyLedgerState,
  LEDGER_STATE_INVALID_JSON_ERROR,
  LEDGER_STATE_SCHEMA_ERROR,
  loadLedgerState,
  persistLedgerState,
  withLedgerStateTransaction,
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

describe("ledger-recovery schema fail-fast + backup behavior", () => {
  it("migrates a valid v1 ledger without forgetting its native conversation", async () => {
    const paths = await createTempLedgerPaths(
      "openmeld-context-ledger-migration-"
    );
    createdDirs.add(paths.rootDirPath);
    const nowMs = Date.now();
    const state = createEmptyLedgerState(nowMs);
    const resolved = resolveAgentContextForDispatch({
      key: {
        spaceId: "space",
        targetProfileId: "agent",
        agentControllerRef: "builtin:codex",
        transportMode: "codex-app-server",
        runtimeWorkspaceFingerprint: "sha256:workspace",
      },
      nowMs,
      taskId: "task",
      state,
      providerContextId: "existing-native-thread",
    });
    if (!resolved.agentContext) {
      throw new Error("Expected the native conversation fixture");
    }
    state.agentContextByLookupKey[resolved.agentContextLookupKey] =
      resolved.agentContext;
    await writeFile(
      paths.stateFilePath,
      JSON.stringify({ ...state, v: 1 }),
      "utf8"
    );
    const loaded = await loadLedgerState({
      io: createNodeLedgerFileIo(),
      paths,
    });
    expect(loaded.v).toBe(2);
    expect(loaded.agentContextByLookupKey).toEqual(
      state.agentContextByLookupKey
    );
    await persistLedgerState({
      io: createNodeLedgerFileIo(),
      paths,
      state: loaded,
    });
    expect(
      JSON.parse(await readFile(paths.stateFilePath, "utf8"))
        .agentContextByLookupKey
    ).toEqual(state.agentContextByLookupKey);
  });
  it("backs up invalid json and fails fast", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-ledger-recovery-invalid-json-"
    );
    createdDirs.add(paths.rootDirPath);
    const io = createNodeLedgerFileIo();

    const invalidJson = '{"v":1,"updatedAtMs":1234';
    await writeFile(paths.stateFilePath, invalidJson, "utf8");

    await expect(
      loadLedgerState({
        io,
        paths,
      })
    ).rejects.toThrow(LEDGER_STATE_INVALID_JSON_ERROR);

    const backup = await readFile(paths.backupStateFilePath ?? "", "utf8");
    expect(backup).toBe(invalidJson);
  });

  it("backs up unknown schema version and fails fast", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-ledger-recovery-invalid-schema-"
    );
    createdDirs.add(paths.rootDirPath);
    const io = createNodeLedgerFileIo();

    await writeFile(
      paths.stateFilePath,
      `${JSON.stringify({
        dedupeFirstSeenByKey: {},
        inflightByTaskId: {},
        replayedTaskIds: {},
        updatedAtMs: Date.now(),
        v: 2,
      })}\n`,
      "utf8"
    );

    await expect(
      loadLedgerState({
        io,
        paths,
      })
    ).rejects.toThrow(LEDGER_STATE_SCHEMA_ERROR);

    const backup = await readFile(paths.backupStateFilePath ?? "", "utf8");
    const parsedBackup = JSON.parse(backup) as { v: number };
    expect(parsedBackup.v).toBe(2);
  });

  it("fails fast when ledger uses legacy context field names", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-ledger-recovery-legacy-"
    );
    createdDirs.add(paths.rootDirPath);
    const io = createNodeLedgerFileIo();

    const legacyState = {
      dedupeFirstSeenByKey: {},
      inflightByTaskId: {},
      replayedTaskIds: {},
      sessionContextByKey: {},
      sessionLifecycleCounters: {
        created: 0,
        guardBlocked: 0,
        recreated: 0,
        reused: 0,
      },
      updatedAtMs: Date.now(),
      v: 1,
    };
    await writeFile(
      paths.stateFilePath,
      `${JSON.stringify(legacyState)}\n`,
      "utf8"
    );

    await expect(
      loadLedgerState({
        io,
        paths,
      })
    ).rejects.toThrow(LEDGER_STATE_SCHEMA_ERROR);

    const backup = await readFile(paths.backupStateFilePath ?? "", "utf8");
    const parsedBackup = JSON.parse(backup) as {
      sessionContextByKey?: Record<string, unknown>;
    };
    expect(parsedBackup.sessionContextByKey).toEqual({});
  });

  it("backs up invalid schema and resets to an empty ledger when recovery is requested", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-ledger-recovery-invalid-schema-reset-"
    );
    createdDirs.add(paths.rootDirPath);
    const io = createNodeLedgerFileIo();
    const nowValues = [1_776_249_218_445, 1_776_249_218_446, 1_776_249_218_447];
    const dateNowSpy = vi
      .spyOn(Date, "now")
      .mockImplementation(() => nowValues.shift() ?? 1_776_249_218_447);

    try {
      await writeFile(
        paths.stateFilePath,
        `${JSON.stringify({
          dedupeFirstSeenByKey: {},
          inflightByTaskId: {},
          replayedTaskIds: {},
          updatedAtMs: Date.now(),
          v: 2,
        })}\n`,
        "utf8"
      );

      const loaded = await loadLedgerState({
        invalidStateStrategy: "backup_and_reset",
        io,
        paths,
      });

      expect(loaded).toEqual(createEmptyLedgerState(loaded.updatedAtMs));

      const backup = await readFile(paths.backupStateFilePath ?? "", "utf8");
      const parsedBackup = JSON.parse(backup) as { v: number };
      expect(parsedBackup.v).toBe(2);

      const reloaded = await loadLedgerState({
        io,
        paths,
      });
      expect(reloaded).toEqual(loaded);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("recovers invalid schema before running a ledger transaction when recovery is requested", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-ledger-recovery-transaction-reset-"
    );
    createdDirs.add(paths.rootDirPath);
    const io = createNodeLedgerFileIo();

    await writeFile(
      paths.stateFilePath,
      `${JSON.stringify({
        dedupeFirstSeenByKey: {},
        inflightByTaskId: {},
        replayedTaskIds: {},
        updatedAtMs: Date.now(),
        v: 2,
      })}\n`,
      "utf8"
    );

    const value = await withLedgerStateTransaction({
      invalidStateStrategy: "backup_and_reset",
      io,
      mutate: (state) => ({
        nextState: state,
        value: Object.keys(state.agentContextByLookupKey).length,
      }),
      paths,
    });

    expect(value).toBe(0);

    const reloaded = await loadLedgerState({
      io,
      paths,
    });
    expect(reloaded).toEqual(createEmptyLedgerState(reloaded.updatedAtMs));
  });

  it("returns empty state when state file does not exist", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-ledger-recovery-missing-state-"
    );
    createdDirs.add(paths.rootDirPath);
    const io = createNodeLedgerFileIo();
    const loaded = await loadLedgerState({
      io,
      paths,
    });

    expect(loaded).toEqual(createEmptyLedgerState(loaded.updatedAtMs));

    await persistLedgerState({
      io,
      paths,
      state: loaded,
    });

    const reloaded = await loadLedgerState({
      io,
      paths,
    });
    expect(reloaded.v).toBe(2);
  });
});

import { resolveAgentContextForDispatch } from "../src/agent-context-policy";
