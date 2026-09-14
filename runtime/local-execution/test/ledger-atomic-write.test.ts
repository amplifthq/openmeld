import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendLedgerHistoryEntry,
  createEmptyLedgerState,
  type LedgerFileIo,
  type LedgerPaths,
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

  it("cleans temp file when rename fails", async () => {
    const rmCalls: string[] = [];
    const io: LedgerFileIo = {
      appendFile: async () => undefined,
      copyFile: async () => undefined,
      mkdir: async () => undefined,
      readFile: async () => "",
      rename: () => Promise.reject(new Error("rename failed")),
      rm: (filePath) => {
        rmCalls.push(filePath);
        return Promise.resolve();
      },
      writeFile: async () => undefined,
    };
    const paths: LedgerPaths = {
      backupStateFilePath: "/tmp/state.v1.json.bak",
      historyFilePath: "/tmp/history.ndjson",
      historyTempFilePath: "/tmp/history.ndjson.tmp",
      rootDirPath: "/tmp",
      stateFilePath: "/tmp/state.v1.json",
      stateTempFilePath: "/tmp/state.v1.json.tmp",
    };

    await expect(
      persistLedgerState({
        io,
        paths,
        state: createEmptyLedgerState(),
      })
    ).rejects.toThrow("rename failed");

    expect(rmCalls).toHaveLength(1);
    expect(rmCalls[0]?.startsWith(paths.stateTempFilePath)).toBe(true);
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

    await Promise.all([
      withLedgerStateTransaction({
        io,
        mutate: async (state) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
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
      }),
      withLedgerStateTransaction({
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
      }),
    ]);

    const raw = await readFile(paths.stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as {
      dedupeFirstSeenByKey: Record<string, number>;
    };

    expect(parsed.dedupeFirstSeenByKey).toEqual({
      "dispatch-a": 1,
      "dispatch-b": 2,
    });
  });
});
