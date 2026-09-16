import { mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEmptyLedgerState,
  recordDedupeFirstSeenAt,
  withLedgerStateTransaction,
} from "@openmeld/local-execution";
import { expect, it, vi } from "vitest";
import { createLedgerIo } from "../src/local-service/state/ledger-io";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

it.each([
  "native",
  "simulated-windows",
])("the Service IO preserves a verified v1 checkpoint on %s before a migrated transaction commits", async (platform) => {
  const rootDirPath = await mkdtemp(join(tmpdir(), "openmeld-service-ledger-"));
  const stateFilePath = join(rootDirPath, "state.v1.json");
  const paths = {
    rootDirPath,
    stateFilePath,
    stateTempFilePath: `${stateFilePath}.tmp`,
    historyFilePath: join(rootDirPath, "history.ndjson"),
    historyTempFilePath: join(rootDirPath, "history.ndjson.tmp"),
  };
  const nowMs = Date.now();
  const original = `${JSON.stringify({ ...createEmptyLedgerState(nowMs), v: 1 }, null, 4)}\n`;
  const platformDescriptor = Object.getOwnPropertyDescriptor(
    process,
    "platform"
  );
  const nativeFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
  try {
    if (platform === "simulated-windows") {
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
      });
      vi.mocked(open).mockImplementation(async (filePath, flags, mode) => {
        // Model the documented Windows boundary: directory flush is unsupported
        // here, and a file handle must have write access for FlushFileBuffers.
        if ((await stat(filePath)).isDirectory() || flags === "r") {
          throw Object.assign(new Error("unsupported flush handle"), {
            code: "EPERM",
          });
        }
        return nativeFs.open(filePath, flags, mode);
      });
    }
    await writeFile(stateFilePath, original, "utf8");
    await withLedgerStateTransaction({
      io: createLedgerIo(),
      paths,
      mutate: async (state) => {
        expect(await readFile(`${stateFilePath}.v1.bak`, "utf8")).toBe(
          original
        );
        expect(await readFile(stateFilePath, "utf8")).toBe(original);
        return {
          nextState: recordDedupeFirstSeenAt({
            firstSeenAtMs: nowMs,
            idempotencyKey: "dispatch-after-migration",
            state,
          }),
          value: undefined,
        };
      },
    });
    const persisted = JSON.parse(await readFile(stateFilePath, "utf8"));
    expect(persisted.v).toBe(2);
    expect(persisted.dedupeFirstSeenByKey).toEqual({
      "dispatch-after-migration": nowMs,
    });
    expect(await readFile(`${stateFilePath}.v1.bak`, "utf8")).toBe(original);
  } finally {
    if (platformDescriptor) {
      Object.defineProperty(process, "platform", platformDescriptor);
    }
    vi.mocked(open).mockImplementation(nativeFs.open);
    await rm(rootDirPath, { force: true, recursive: true });
  }
});
