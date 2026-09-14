import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendLedgerHistoryEntry,
  createEmptyLedgerState,
  type LedgerFileIo,
  loadLedgerState,
  persistLedgerState,
  recordDedupeFirstSeenAt,
  withLedgerStateTransaction,
} from "../src/ledger-store";
import {
  createNodeLedgerFileIo,
  createTempLedgerPaths,
} from "./ledger-test-io";

const createdDirs = new Set<string>();

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

afterEach(async () => {
  for (const dirPath of createdDirs) {
    await rm(dirPath, { force: true, recursive: true });
  }
  createdDirs.clear();
});

describe("ledger-recovery ledger atomic write", () => {
  it("writes state by temp file rename and leaves no temp residue", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-ledger-recovery-atomic-"
    );
    createdDirs.add(paths.rootDirPath);

    await persistLedgerState({
      io: createNodeLedgerFileIo(),
      paths,
      state: createEmptyLedgerState(),
    });

    const raw = await readFile(paths.stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as { v: number };
    expect(parsed.v).toBe(2);
    expect(await exists(paths.stateTempFilePath)).toBe(false);
  });

  it.each([
    "write",
    "sync",
    "rename",
  ])("preserves the original and migration backup when state %s fails, then retries safely", async (failure) => {
    const paths = await createTempLedgerPaths(
      "openmeld-ledger-atomic-failure-"
    );
    createdDirs.add(paths.rootDirPath);
    const state = createEmptyLedgerState();
    const original = JSON.stringify({ ...state, v: 1 });
    await writeFile(paths.stateFilePath, original, "utf8");
    const baseIo = createNodeLedgerFileIo();
    const io: LedgerFileIo = {
      ...baseIo,
      writeFile: async (filePath, content, encoding) => {
        if (failure === "write") {
          throw new Error("state write failed");
        }
        await baseIo.writeFile(filePath, content, encoding);
      },
      syncPath: async (filePath) => {
        if (
          failure === "sync" &&
          filePath.startsWith(paths.stateTempFilePath)
        ) {
          throw new Error("state sync failed");
        }
        await baseIo.syncPath(filePath);
      },
      rename: async (fromPath, toPath) => {
        if (failure === "rename" && toPath === paths.stateFilePath) {
          throw new Error("state rename failed");
        }
        await baseIo.rename(fromPath, toPath);
      },
    };

    await expect(persistLedgerState({ io, paths, state })).rejects.toThrow(
      `state ${failure} failed`
    );
    expect(await readFile(paths.stateFilePath, "utf8")).toBe(original);
    const backupPath = `${paths.stateFilePath}.v1.bak`;
    expect(await readFile(backupPath, "utf8")).toBe(original);
    expect(
      (await readdir(paths.rootDirPath)).filter((name) => name.includes(".tmp"))
    ).toEqual([]);

    await persistLedgerState({ io: baseIo, paths, state });
    expect(JSON.parse(await readFile(paths.stateFilePath, "utf8")).v).toBe(2);
    expect(await readFile(backupPath, "utf8")).toBe(original);
  });

  it("does not corrupt existing history file when append fails", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-ledger-recovery-history-"
    );
    createdDirs.add(paths.rootDirPath);
    const initialLine = `${JSON.stringify({
      message: "existing",
      taskId: "task-existing",
    })}\n`;
    await writeFile(paths.historyFilePath, initialLine, "utf8");

    const baseIo = createNodeLedgerFileIo();
    const io: LedgerFileIo = {
      ...baseIo,
      appendFile: (filePath, content, encoding) => {
        if (filePath === paths.historyFilePath) {
          return Promise.reject(new Error("history append failed"));
        }
        return baseIo.appendFile(filePath, content, encoding);
      },
    };

    await expect(
      appendLedgerHistoryEntry({
        entry: {
          message: "new",
          reasonCode: "history.append",
          status: "failed",
          taskId: "task-next",
          ts: new Date().toISOString(),
        },
        io,
        paths,
      })
    ).rejects.toThrow("history append failed");

    const after = await readFile(paths.historyFilePath, "utf8");
    expect(after).toBe(initialLine);
  });

  it("keeps both records under concurrent history appends", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-ledger-recovery-history-concurrent-"
    );
    createdDirs.add(paths.rootDirPath);
    const io = createNodeLedgerFileIo();

    await Promise.all([
      appendLedgerHistoryEntry({
        entry: {
          message: "first",
          reasonCode: "history.concurrent",
          status: "success",
          taskId: "task-a",
          ts: "2026-02-25T00:00:00.000Z",
        },
        io,
        paths,
      }),
      appendLedgerHistoryEntry({
        entry: {
          message: "second",
          reasonCode: "history.concurrent",
          status: "success",
          taskId: "task-b",
          ts: "2026-02-25T00:00:01.000Z",
        },
        io,
        paths,
      }),
    ]);

    const lines = (await readFile(paths.historyFilePath, "utf8"))
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);

    expect(lines).toHaveLength(2);
    const taskIds = lines
      .map((line) => JSON.parse(line) as { taskId: string })
      .map((entry) => entry.taskId)
      .sort();
    expect(taskIds).toEqual(["task-a", "task-b"]);
  });

  it("serializes concurrent state transactions without dropping updates", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-ledger-recovery-state-transaction-"
    );
    createdDirs.add(paths.rootDirPath);
    const io = createNodeLedgerFileIo();
    const original = JSON.stringify({ ...createEmptyLedgerState(), v: 1 });
    await writeFile(paths.stateFilePath, original, "utf8");

    let releaseFirstTransaction = () => undefined;
    const firstTransactionPending = new Promise<void>((resolve) => {
      releaseFirstTransaction = resolve;
    });
    let firstTransactionEntered = () => undefined;
    const firstTransactionStarted = new Promise<void>((resolve) => {
      firstTransactionEntered = resolve;
    });

    const firstTransaction = withLedgerStateTransaction({
      io,
      mutate: async (state) => {
        firstTransactionEntered();
        await firstTransactionPending;
        return {
          nextState: recordDedupeFirstSeenAt({
            firstSeenAtMs: 1,
            idempotencyKey: "dispatch-a",
            state,
          }),
          value: undefined,
        };
      },
      paths,
    });
    await firstTransactionStarted;
    const pendingRead = loadLedgerState({ io, paths });
    const secondTransaction = withLedgerStateTransaction({
      io,
      mutate: async (state) => ({
        nextState: recordDedupeFirstSeenAt({
          firstSeenAtMs: 2,
          idempotencyKey: "dispatch-b",
          state,
        }),
        value: undefined,
      }),
      paths,
    });
    releaseFirstTransaction();
    const [, readState] = await Promise.all([
      firstTransaction,
      pendingRead,
      secondTransaction,
    ]);
    expect(readState.dedupeFirstSeenByKey).toEqual({ "dispatch-a": 1 });

    const raw = await readFile(paths.stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as {
      dedupeFirstSeenByKey: Record<string, number>;
    };

    expect(parsed.dedupeFirstSeenByKey).toEqual({
      "dispatch-a": 1,
      "dispatch-b": 2,
    });
    expect(await readFile(`${paths.stateFilePath}.v1.bak`, "utf8")).toBe(
      original
    );
  });
});
