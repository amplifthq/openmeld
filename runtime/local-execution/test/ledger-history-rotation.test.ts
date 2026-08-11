import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { appendLedgerHistoryEntry } from "../src/ledger-store";
import {
  createNodeLedgerFileIo,
  createTempLedgerPaths,
} from "./ledger-test-io";

const createdDirs = new Set<string>();

const toArchivePath = (historyFilePath: string, index: number): string => {
  const suffix = ".ndjson";
  return historyFilePath.endsWith(suffix)
    ? `${historyFilePath.slice(0, -suffix.length)}.${String(index)}${suffix}`
    : `${historyFilePath}.${String(index)}`;
};

afterEach(async () => {
  for (const dirPath of createdDirs) {
    await rm(dirPath, { force: true, recursive: true });
  }
  createdDirs.clear();
});

describe("ledger history rotation", () => {
  it("rotates history when file exceeds max size before append", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-ledger-history-rotation-"
    );
    createdDirs.add(paths.rootDirPath);
    const io = createNodeLedgerFileIo();

    const oversizedContent = "x".repeat(4 * 1024 * 1024);
    await writeFile(paths.historyFilePath, oversizedContent, "utf8");

    await appendLedgerHistoryEntry({
      entry: {
        message: "next",
        reasonCode: "history.rotation",
        status: "success",
        taskId: "task-rotation-next",
        ts: "2026-03-03T10:00:00.000Z",
      },
      io,
      paths,
    });

    const archived = await readFile(
      toArchivePath(paths.historyFilePath, 1),
      "utf8"
    );
    expect(archived).toBe(oversizedContent);

    const latest = await readFile(paths.historyFilePath, "utf8");
    const latestLines = latest
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
    expect(latestLines).toHaveLength(1);
    expect(JSON.parse(latestLines[0] ?? "{}")?.taskId).toBe(
      "task-rotation-next"
    );
  });

  it("keeps only recent archive slots up to max archive count", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-ledger-history-archive-"
    );
    createdDirs.add(paths.rootDirPath);

    const historyFilePath = paths.historyFilePath;
    await writeFile(historyFilePath, "newest-before\n", "utf8");
    await writeFile(toArchivePath(historyFilePath, 1), "archive-1\n", "utf8");
    await writeFile(toArchivePath(historyFilePath, 2), "archive-2\n", "utf8");
    await writeFile(toArchivePath(historyFilePath, 3), "archive-3\n", "utf8");

    await appendLedgerHistoryEntry({
      entry: {
        message: "next",
        reasonCode: "history.rotation",
        status: "success",
        taskId: "task-archive-next",
        ts: "2026-03-03T10:00:00.000Z",
      },
      io: {
        ...createNodeLedgerFileIo(),
        readFile: async (filePath, encoding) => {
          if (filePath === historyFilePath) {
            return "x".repeat(4 * 1024 * 1024);
          }
          return await readFile(filePath, encoding);
        },
      },
      paths,
    });

    expect(
      (await readFile(toArchivePath(historyFilePath, 1), "utf8")).trim()
    ).toBe("newest-before");
    expect(
      (await readFile(toArchivePath(historyFilePath, 2), "utf8")).trim()
    ).toBe("archive-1");
    expect(
      (await readFile(toArchivePath(historyFilePath, 3), "utf8")).trim()
    ).toBe("archive-2");

    await expect(stat(toArchivePath(historyFilePath, 4))).rejects.toBeTruthy();
  });
});
