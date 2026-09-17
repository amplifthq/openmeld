import { readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertLegacyAgentContextAssociation,
  buildAgentContextLookupKey,
  resolveAgentContextForDispatch,
} from "../src/agent-context-policy";
import {
  createEmptyLedgerState,
  LEDGER_STATE_BACKUP_ERROR,
  LEDGER_STATE_INVALID_JSON_ERROR,
  LEDGER_STATE_SCHEMA_ERROR,
  loadLedgerState,
  persistLedgerState,
  seedLegacyAgentContext,
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
    const original = `${JSON.stringify({ ...state, v: 1 }, null, 4)}\n`;
    await writeFile(paths.stateFilePath, original, "utf8");
    const loaded = await loadLedgerState({
      io: createNodeLedgerFileIo(),
      paths,
    });
    expect(loaded.v).toBe(2);
    expect(loaded.agentContextByLookupKey).toEqual(
      state.agentContextByLookupKey
    );
    const backupPath = `${paths.stateFilePath}.v1.bak`;
    expect(await readFile(backupPath, "utf8")).toBe(original);
    expect(await readFile(paths.stateFilePath, "utf8")).toBe(original);
    await persistLedgerState({
      io: createNodeLedgerFileIo(),
      paths,
      state: loaded,
    });
    expect(
      JSON.parse(await readFile(paths.stateFilePath, "utf8"))
        .agentContextByLookupKey
    ).toEqual(state.agentContextByLookupKey);
    expect(await readFile(backupPath, "utf8")).toBe(original);
    await writeFile(paths.stateFilePath, "invalid-json", "utf8");
    await expect(
      loadLedgerState({ io: createNodeLedgerFileIo(), paths })
    ).rejects.toThrow(LEDGER_STATE_INVALID_JSON_ERROR);
    expect(await readFile(backupPath, "utf8")).toBe(original);
  });

  it.each([
    "copy",
    "verify",
    "sync",
    "publish",
    "directory-sync",
  ])("preserves v1 and rejects replacement when migration backup %s fails", async (failure) => {
    const paths = await createTempLedgerPaths(
      "openmeld-ledger-backup-failure-"
    );
    createdDirs.add(paths.rootDirPath);
    const original = `${JSON.stringify({ ...createEmptyLedgerState(), v: 1 })}\n`;
    await writeFile(paths.stateFilePath, original, "utf8");
    const baseIo = createNodeLedgerFileIo();
    const backupPath = `${paths.stateFilePath}.v1.bak`;
    const io = {
      ...baseIo,
      copyFile: async (fromPath: string, toPath: string) => {
        if (failure === "copy") {
          throw new Error("copy failed");
        }
        await baseIo.copyFile(fromPath, toPath);
        if (failure === "verify") {
          await writeFile(toPath, "truncated", "utf8");
        }
      },
      rename: async (fromPath: string, toPath: string) => {
        if (failure === "publish" && toPath === backupPath) {
          throw new Error("backup rename failed");
        }
        await baseIo.rename(fromPath, toPath);
      },
      syncPath: async (filePath: string) => {
        if (
          failure === "sync" ||
          (failure === "directory-sync" && filePath === paths.rootDirPath)
        ) {
          throw new Error("sync failed");
        }
        await baseIo.syncPath(filePath);
      },
    };

    await expect(
      persistLedgerState({ io, paths, state: createEmptyLedgerState() })
    ).rejects.toThrow(LEDGER_STATE_BACKUP_ERROR);
    expect(await readFile(paths.stateFilePath, "utf8")).toBe(original);

    await persistLedgerState({
      io: baseIo,
      paths,
      state: createEmptyLedgerState(),
    });
    expect(JSON.parse(await readFile(paths.stateFilePath, "utf8")).v).toBe(2);
    expect(await readFile(backupPath, "utf8")).toBe(original);
  });

  it("does not overwrite a conflicting prior-version backup", async () => {
    const paths = await createTempLedgerPaths(
      "openmeld-ledger-backup-conflict-"
    );
    createdDirs.add(paths.rootDirPath);
    const original = JSON.stringify({ ...createEmptyLedgerState(), v: 1 });
    const previousBackup = `${original}\n`;
    const backupPath = `${paths.stateFilePath}.v1.bak`;
    await writeFile(paths.stateFilePath, original, "utf8");
    await writeFile(backupPath, previousBackup, "utf8");

    await expect(
      loadLedgerState({ io: createNodeLedgerFileIo(), paths })
    ).rejects.toThrow(LEDGER_STATE_BACKUP_ERROR);
    expect(await readFile(paths.stateFilePath, "utf8")).toBe(original);
    expect(await readFile(backupPath, "utf8")).toBe(previousBackup);
  });
  it.each([
    {
      name: "matching current mapping",
      coreId: "native-current",
      localId: "native-current",
      legacySpaceKey: false,
      mismatch: false,
    },
    {
      name: "contradicting current mapping",
      coreId: "native-other",
      localId: "native-current",
      legacySpaceKey: false,
      mismatch: true,
    },
    {
      name: "absent Core evidence",
      coreId: null,
      localId: "native-current",
      legacySpaceKey: false,
      mismatch: false,
    },
    {
      name: "only a historical workspace",
      coreId: "native-current",
      localId: null,
      legacySpaceKey: false,
      mismatch: false,
    },
    {
      name: "matching legacy Space key",
      coreId: "native-current",
      localId: "native-current",
      legacySpaceKey: true,
      mismatch: false,
    },
    {
      name: "contradicting legacy Space key",
      coreId: "native-other",
      localId: "native-current",
      legacySpaceKey: true,
      mismatch: true,
    },
  ])("checks $name without changing retained native identities", async ({
    coreId,
    localId,
    legacySpaceKey,
    mismatch,
  }) => {
    const paths = await createTempLedgerPaths("openmeld-legacy-association-");
    createdDirs.add(paths.rootDirPath);
    const nowMs = Date.now();
    const key = {
      spaceId: "space-current",
      targetProfileId: "agent-current",
      agentControllerRef: "builtin:codex",
      transportMode: "codex-app-server" as const,
      runtimeWorkspaceFingerprint: "sha256:source-workspace",
    };
    const historyKey = {
      ...key,
      runtimeWorkspaceFingerprint: "sha256:historical-workspace",
    };
    let state = seedLegacyAgentContext({
      ...historyKey,
      agentContextLookupKey: buildAgentContextLookupKey(historyKey),
      legacyAgentControllerConversationId: "native-historical",
      nowMs,
      taskId: "task-historical",
      state: createEmptyLedgerState(nowMs),
    });
    if (localId) {
      const lookupKey = buildAgentContextLookupKey(key);
      state = seedLegacyAgentContext({
        ...key,
        agentContextLookupKey: legacySpaceKey
          ? `${key.spaceId}|${lookupKey}`
          : lookupKey,
        legacyAgentControllerConversationId: localId,
        nowMs,
        taskId: "task-current",
        state,
      });
    }
    const original = `${JSON.stringify({ ...state, v: 1 })}\n`;
    await writeFile(paths.stateFilePath, original, "utf8");
    const check = withLedgerStateTransaction({
      io: createNodeLedgerFileIo(),
      paths,
      mutate: (loaded) => {
        assertLegacyAgentContextAssociation({
          key,
          legacyNativeConversationId: coreId,
          state: loaded,
        });
        return { nextState: loaded, value: loaded.agentContextByLookupKey };
      },
    });
    if (mismatch) {
      await expect(check).rejects.toThrow(
        "execution_context.legacy_native_identity_mismatch"
      );
    } else {
      await expect(check).resolves.toEqual(state.agentContextByLookupKey);
    }
    expect(await readFile(paths.stateFilePath, "utf8")).toBe(original);
    expect(await readFile(`${paths.stateFilePath}.v1.bak`, "utf8")).toBe(
      original
    );
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
        ...createEmptyLedgerState(),
        v: 999,
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
    expect(parsedBackup.v).toBe(999);
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
