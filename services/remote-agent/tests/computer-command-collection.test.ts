import { DatabaseSync } from "node:sqlite";
import type { WorkspaceClient } from "@cloudflare/computer";
import { cloudComputerOperationResultSchema } from "@openmeld/schemas";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentComputerWorkspaceAccess } from "../flue-adapter/agent-computer-workspace-access";
import {
  collectComputerCommands,
  createComputerCommandTool,
} from "../flue-adapter/computer-command";
import { ComputerCommandSqlStorage } from "../flue-adapter/computer-command-storage";

const prefix = "openmeld:remote-agent:computer-command:collection-test:";
const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const database of databases) {
    database.close();
  }
  databases.length = 0;
});

function fixture() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  const returnedRows: number[] = [];
  const storage = new ComputerCommandSqlStorage({
    exec(query, ...bindings) {
      const statement = database.prepare(query);
      const rows = statement.all(...(bindings as never[]));
      returnedRows.push(rows.length);
      const changed = database.prepare("SELECT changes() AS count").get();
      return { toArray: () => rows, rowsWritten: Number(changed?.count ?? 0) };
    },
  });
  const getExec = vi.fn((_id: string) =>
    Promise.reject(
      Object.assign(new Error("native execution already has an observer"), {
        code: "EEXEC_BUSY",
      })
    )
  );
  const killExec = vi.fn(async (_id: string) => undefined);
  const workspace = {
    runtime: { getExec, killExec },
  } as unknown as WorkspaceClient;
  const withWorkspace = vi.fn(
    async <T>(operation: (value: WorkspaceClient) => Promise<T>) =>
      await operation(workspace)
  );
  const workspaceAccess: AgentComputerWorkspaceAccess = {
    withWorkspace: <T>(operation: (value: WorkspaceClient) => Promise<T>) =>
      withWorkspace(operation) as Promise<T>,
  };
  const tool = createComputerCommandTool({
    context: { submissionId: "collection-test" },
    storage,
    workspaceAccess,
    workingDirectory: "/computer",
  });
  return {
    storage,
    returnedRows,
    getExec,
    killExec,
    workspace,
    withWorkspace,
    workspaceAccess,
    tool,
  };
}

async function seed(
  f: ReturnType<typeof fixture>,
  key: string,
  extra: Record<string, unknown> = {}
) {
  await f.storage.put(`${prefix}${key}`, {
    id: `native-${key}`,
    key,
    fingerprint: key,
    createdAt: 0,
    launchRequestedAt: 0,
    collectable: false,
    backend: "container",
    ...extra,
  });
}

it("bounds each collection batch and leaves older completed receipts out of materialization", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const f = fixture();
  for (let index = 0; index < 5000; index++) {
    await seed(f, `completed-${index}`, { completed: true });
  }
  for (let index = 0; index < 17; index++) {
    await seed(f, `due-${String(index).padStart(2, "0")}`);
  }
  for (const [index, excluded] of [
    { observation: { status: "completed" } },
    { loss: "EEXEC_LOST" },
    { lostDuringCleanup: true },
    { backend: "worker-shell" },
    { observation: { status: "running", syncError: "ENOENT" } },
    { collection: { consecutiveFailures: 8, nextAttemptAtMs: null } },
    { collectable: undefined },
  ].entries()) {
    await seed(f, `excluded-${index}`, excluded);
  }
  f.returnedRows.length = 0;
  f.withWorkspace.mockRejectedValue(
    Object.assign(new Error("transport unavailable"), { code: "ECONNRESET" })
  );
  await collectComputerCommands({
    storage: f.storage,
    workspaceAccess: f.workspaceAccess,
  });
  expect(f.withWorkspace).toHaveBeenCalledTimes(16);
  expect(Math.max(...f.returnedRows)).toBeLessThanOrEqual(16);
  // A failed first batch backs off its own records and cannot starve the tail.
  await collectComputerCommands({
    storage: f.storage,
    workspaceAccess: f.workspaceAccess,
  });
  expect(f.withWorkspace).toHaveBeenCalledTimes(17);
});

it.each([
  "poll",
  "stop",
] as const)("pauses only automatic observation after errors and resumes the same receipt after manual %s", async (recovery) => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const f = fixture();
  await seed(f, "one");
  f.withWorkspace.mockRejectedValue(
    Object.assign(new Error("transport unavailable"), { code: "ECONNRESET" })
  );
  for (const delay of [
    0, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000, 300_000,
  ]) {
    await vi.advanceTimersByTimeAsync(delay);
    await collectComputerCommands({
      storage: f.storage,
      workspaceAccess: f.workspaceAccess,
    });
  }
  expect(f.withWorkspace).toHaveBeenCalledTimes(8);
  const paused = await f.tool.execute({
    action: "list",
    includeReceiptDetails: true,
  });
  expect(paused).toMatchObject([
    {
      id: "native-one",
      phase: "launch_unknown",
      collection: { consecutiveFailures: 8, nextAttemptAtMs: null },
    },
  ]);
  expect(cloudComputerOperationResultSchema.safeParse(paused).success).toBe(
    true
  );
  await expect(
    f.tool.execute({ action: "poll", key: "one", waitSeconds: 0 })
  ).rejects.toMatchObject({ code: "ECONNRESET" });
  expect(await f.storage.get(`${prefix}one`)).toMatchObject({
    collection: { consecutiveFailures: 8, nextAttemptAtMs: null },
  });
  f.withWorkspace.mockImplementation(
    async (operation) => await operation(f.workspace)
  );
  const result = await f.tool.execute(
    recovery === "poll"
      ? {
          action: "poll",
          key: "one",
          waitSeconds: 0,
        }
      : { action: "stop", key: "one" }
  );
  expect(result).toMatchObject({
    id: "native-one",
    status: recovery === "poll" ? "running" : "stop_requested",
    collection: { consecutiveFailures: 0, nextAttemptAtMs: expect.any(Number) },
  });
  // Fresh native running evidence keeps observation active even for an old,
  // silent command. The collector neither kills nor starts another identity.
  await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
  const collecting = collectComputerCommands({
    storage: f.storage,
    workspaceAccess: f.workspaceAccess,
  });
  await vi.advanceTimersByTimeAsync(1000);
  await collecting;
  const current = await f.storage.get(`${prefix}one`);
  expect(current).toMatchObject({
    id: "native-one",
    collection: { consecutiveFailures: 0, nextAttemptAtMs: expect.any(Number) },
  });
  expect(f.getExec.mock.calls.every(([id]) => id === "native-one")).toBe(true);
  expect(f.killExec).toHaveBeenCalledTimes(recovery === "stop" ? 1 : 0);
  if (recovery === "stop") {
    expect(f.killExec).toHaveBeenCalledWith("native-one", {
      backend: "container",
      signal: "SIGTERM",
    });
  }
});

it("does not apply a late failed collection over a fresh manual observation on the same receipt", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const f = fixture();
  await seed(f, "one", {
    observedAt: 0,
    collection: { consecutiveFailures: 7, nextAttemptAtMs: 0 },
  });
  const pending = Promise.withResolvers<never>();
  f.withWorkspace.mockImplementationOnce(() => pending.promise);
  const collecting = collectComputerCommands({
    storage: f.storage,
    workspaceAccess: f.workspaceAccess,
  });
  await vi.advanceTimersByTimeAsync(0);
  await f.tool.execute({ action: "poll", key: "one", waitSeconds: 0 });
  pending.reject(
    Object.assign(new Error("older request failed"), { code: "ECONNRESET" })
  );
  await collecting;
  expect(await f.storage.get(`${prefix}one`)).toMatchObject({
    observedAt: 0,
    collection: { consecutiveFailures: 0, nextAttemptAtMs: 15_000 },
  });
});
