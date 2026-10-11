import { DatabaseSync } from "node:sqlite";
import { Workspace } from "@cloudflare/computer";
import { cloudComputerOperationResultSchema } from "@openmeld/schemas";
import { expect, it } from "vitest";
import {
  createComputerFileTools,
  describeComputer,
} from "../flue-adapter/computer-native";
import {
  describeComputerStorage,
  withComputerCapacityErrors,
} from "../flue-adapter/computer-storage";

it.each([
  [3_000_000_000, "available"],
  [4_000_000_000, "near_limit"],
  [4_227_858_432, "at_limit"],
  [4_294_967_296, "at_limit"],
] as const)("reports provider capacity at %i bytes without inventing free file space", (bytes, status) => {
  const result = describeComputerStorage(bytes, 123);
  expect(result).toMatchObject({
    databaseBytes: bytes,
    status,
    observedAtMs: 123,
    limitBytes: 4_227_858_432,
  });
  expect(result.growthHeadroomBytes).toBe(Math.max(0, 4_227_858_432 - bytes));
});

it("preserves command outcomes and only annotates actual capacity failures", async () => {
  const failed = {
    id: "one",
    key: "build",
    status: "completed",
    exitCode: 1,
    stderr: "ENOSPC: no space left on device",
  };
  expect(await withComputerCapacityErrors(async () => failed)).toMatchObject({
    ...failed,
    nextAction: expect.stringContaining("computer.disk_full"),
  });
  const successful = { ...failed, exitCode: 0 };
  expect(await withComputerCapacityErrors(async () => successful)).toBe(
    successful
  );
  const unrelated = new Error("access denied");
  await expect(
    withComputerCapacityErrors(() => Promise.reject(unrelated))
  ).rejects.toBe(unrelated);
});

it("keeps official file reads and inspection usable after real SQLite saturation", async () => {
  using database = new DatabaseSync(":memory:");
  const storage = {
    sql: {
      exec<Row extends object>(query: string, ...bindings: unknown[]) {
        const statement = database.prepare(query);
        const parameters = bindings as Parameters<typeof statement.all>;
        let rows: Row[] = [];
        if (statement.columns().length) {
          rows = statement.all(...parameters) as Row[];
        } else {
          statement.run(...parameters);
        }
        return { toArray: () => rows };
      },
    },
    transactionSync<T>(operation: () => T): T {
      database.exec("SAVEPOINT workspace_test");
      try {
        const result = operation();
        database.exec("RELEASE workspace_test");
        return result;
      } catch (error) {
        // SQLITE_FULL can roll back the enclosing transaction itself.
        if (database.isTransaction) {
          database.exec("ROLLBACK TO workspace_test; RELEASE workspace_test");
        }
        throw error;
      }
    },
  };
  const workspace = new Workspace({
    storage,
    sessionId: "capacity",
    backends: [],
  });
  await workspace.ready();
  await workspace.fs.mkdir("/computer/home", { recursive: true });
  await workspace.fs.writeFile("/computer/home/keep.txt", "valuable work");
  await workspace.fs.writeFile("/computer/home/disposable.txt", "temporary");
  let tools = createComputerFileTools(workspace);
  const call = async (name: string, arguments_: unknown) =>
    await withComputerCapacityErrors(async () => ({
      kind: "files",
      result: await tools.execute({
        id: "capacity",
        name,
        arguments: arguments_,
      }),
    }));
  const pages = Number(database.prepare("PRAGMA page_count").get()?.page_count);
  database.exec(`PRAGMA max_page_count = ${pages}`);
  await expect(
    withComputerCapacityErrors(() =>
      workspace.fs.writeFile(
        "/computer/home/too-large.bin",
        new Uint8Array(1_000_000)
      )
    )
  ).rejects.toThrow("computer.storage_full");
  // Cold SDK initialization must not turn a write failure into lost reads.
  const reopened = new Workspace({
    storage,
    sessionId: "capacity",
    backends: [],
  });
  await reopened.ready();
  tools = createComputerFileTools(reopened);
  const failedTool = await call("write", {
    path: "/computer/home/too-large.txt",
    content: "x".repeat(1_000_000),
  });
  expect(failedTool.result.isError).toBe(true);
  expect(JSON.stringify(failedTool)).toContain("computer.storage_full");
  const read = await call("read", { path: "/computer/home/keep.txt" });
  expect(read.result.isError).toBe(false);
  expect(JSON.stringify(read)).toContain("valuable work");
  expect((await call("ls", { path: "/computer/home" })).result.isError).toBe(
    false
  );
  const description = describeComputer(
    tools,
    undefined,
    describeComputerStorage(pages * 4096)
  );
  expect(
    cloudComputerOperationResultSchema.safeParse(description).success
  ).toBe(true);
  expect(description.capabilities.storage?.databaseBytes).toBe(pages * 4096);
  // A file delete is not a guarantee that the SDK reclaims retained blobs.
  // Verify selected cleanup and preserve the unrelated user's file.
  expect(
    (await call("delete", { path: "/computer/home/disposable.txt" })).result
      .isError
  ).toBe(false);
  expect(await workspace.fs.readFile("/computer/home/keep.txt", "utf8")).toBe(
    "valuable work"
  );
});
