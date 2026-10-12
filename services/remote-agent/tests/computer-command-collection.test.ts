import { DatabaseSync } from "node:sqlite";
import {
  type SyncProgress,
  type WorkspaceClient,
  WorkspaceSyncPendingError,
} from "@cloudflare/computer";
import {
  cloudComputerCommandPhaseSchema,
  cloudComputerCommandReferenceSchema,
  cloudComputerOperationResultSchema,
} from "@openmeld/schemas";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type { AgentComputerWorkspaceAccess } from "../flue-adapter/agent-computer-workspace-access";
import {
  collectComputerCommands,
  createComputerCommandTool,
  readStoredComputerInvocation,
} from "../flue-adapter/computer-command";
import { ComputerCommandSqlStorage } from "../flue-adapter/computer-command-storage";

const prefix = "openmeld:remote-agent:computer-command:collection-test:";
const databases: DatabaseSync[] = [];
// Captured from cloud-computer.ts at 2adfa809, before preparation/observation
// projection. Installed readers strictly validate collection and list rows.
const legacyCollectionSchema = z.strictObject({
  unconfirmedAttempts: z.number().int().nonnegative(),
  nextAttemptAtMs: z.number().int().nonnegative().nullable(),
});
const legacyListSchema = z.array(
  z.strictObject({
    id: z.string().min(1).max(256),
    key: z.string().min(1).max(256),
    createdAt: z.number(),
    reference: cloudComputerCommandReferenceSchema.optional(),
    phase: cloudComputerCommandPhaseSchema.optional(),
    recordExpiresAtMs: z.number().int().nonnegative().optional(),
    collection: legacyCollectionSchema.optional(),
  })
);
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
  const sql = {
    exec(query: string, ...bindings: unknown[]) {
      const statement = database.prepare(query);
      const rows = statement.all(...(bindings as never[]));
      returnedRows.push(rows.length);
      const changed = database.prepare("SELECT changes() AS count").get();
      return { toArray: () => rows, rowsWritten: Number(changed?.count ?? 0) };
    },
  };
  const storage = new ComputerCommandSqlStorage(sql);
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
    sql,
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

async function readInvocation(storage: ComputerCommandSqlStorage) {
  return await readStoredComputerInvocation({
    context: { submissionId: "collection-test" },
    storage,
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
    { collection: { unconfirmedAttempts: 8, nextAttemptAtMs: null } },
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
      collection: { unconfirmedAttempts: 8, nextAttemptAtMs: null },
    },
  ]);
  expect(cloudComputerOperationResultSchema.safeParse(paused).success).toBe(
    true
  );
  await expect(
    f.tool.execute({ action: "poll", key: "one", waitSeconds: 0 })
  ).rejects.toMatchObject({ code: "ECONNRESET" });
  expect(await f.storage.get(`${prefix}one`)).toMatchObject({
    collection: { unconfirmedAttempts: 8, nextAttemptAtMs: null },
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
    collection: { unconfirmedAttempts: 0, nextAttemptAtMs: expect.any(Number) },
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
    collection: { unconfirmedAttempts: 0, nextAttemptAtMs: expect.any(Number) },
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

it("keeps the automatic observation budget bounded while native admission is unknown", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const f = fixture();
  await seed(f, "one", {
    preparation: {
      request: { action: "start", key: "one", command: "run once" },
      workingDirectory: "/computer",
    },
  });
  f.getExec.mockRejectedValue(
    Object.assign(new Error("not admitted"), { code: "ENOENT" })
  );
  for (let attempt = 0; attempt < 9; attempt++) {
    await collectComputerCommands(f);
    await vi.advanceTimersByTimeAsync(300_000);
  }
  expect(f.getExec).toHaveBeenCalledTimes(8);
  await expect(
    f.tool.execute({ action: "poll", key: "one", waitSeconds: 0 })
  ).resolves.toMatchObject({
    phase: "launch_unknown",
    collection: { unconfirmedAttempts: 8, nextAttemptAtMs: null },
  });
  expect(f.killExec).not.toHaveBeenCalled();
});

it.each([
  "unchanged",
  "generation_only",
  "legacy",
  "synthetic",
] as const)("pauses preparation without confirmed progress (%s) and resumes only the original command", async (kind) => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const f = fixture();
  let progress: SyncProgress & { checkpoint?: string } = {
    operationId: "plan",
    generation: kind === "generation_only" ? "next-generation" : "plan",
    backend: "container",
    direction: "push",
    mode: "entries",
    phase: "preparing",
    cursor: { rev: 0, path: null },
    targetCursor: { rev: 100, path: null },
    entries: 0,
    bytes: 0,
    skipped: 0,
    complete: false,
    ...(kind === "legacy" || kind === "synthetic"
      ? {}
      : {
          checkpoint:
            kind === "generation_only"
              ? "new-generation-checkpoint"
              : "checkpoint-1",
        }),
  };
  if (kind === "synthetic") {
    progress = { ...progress, generation: "" };
  }
  const execWithAdmission = vi
    .fn<WorkspaceClient["runtime"]["execWithAdmission"]>()
    .mockImplementation(() =>
      Promise.reject(new WorkspaceSyncPendingError(progress))
    );
  f.workspace.runtime.execWithAdmission = execWithAdmission;
  await seed(f, "one", {
    launchRequestedAt: undefined,
    preparation: {
      request: { action: "start", key: "one", command: "run once" },
      workingDirectory: "/computer",
      progress: {
        phase: "preparing",
        generation: "plan",
        cursorRevision: 0,
        targetRevision: 100,
        entries: 0,
        bytes: 0,
        skipped: 0,
        ...(kind === "legacy" ? {} : { checkpoint: "checkpoint-1" }),
      },
    },
    collection: { unconfirmedAttempts: 0, nextAttemptAtMs: 0 },
  });
  const storage = new ComputerCommandSqlStorage(f.sql);
  for (let attempt = 0; attempt < 9; attempt++) {
    await collectComputerCommands({
      storage,
      workspaceAccess: f.workspaceAccess,
    });
    await vi.advanceTimersByTimeAsync(300_000);
  }
  expect(execWithAdmission).toHaveBeenCalledTimes(8);
  const tool = createComputerCommandTool({
    storage,
    context: { submissionId: "collection-test" },
    workspaceAccess: f.workspaceAccess,
    workingDirectory: "/computer",
  });
  const poll = () =>
    tool.execute({ action: "poll", key: "one", waitSeconds: 0 });
  expect(await poll()).toMatchObject({
    phase: "accepted",
    collection: { unconfirmedAttempts: 8, nextAttemptAtMs: null },
  });
  if (kind === "synthetic") {
    expect(await poll()).toMatchObject({
      preparation: { generation: "plan", checkpoint: "checkpoint-1" },
    });
    progress = {
      ...progress,
      generation: "next-generation",
      checkpoint: "new-generation-baseline",
    };
    expect(await poll()).toMatchObject({
      collection: { unconfirmedAttempts: 8, nextAttemptAtMs: null },
    });
  }
  progress = { ...progress, checkpoint: "checkpoint-2" };
  expect(await poll()).toMatchObject({
    phase: "accepted",
    preparation: { checkpoint: "checkpoint-2" },
    collection: { unconfirmedAttempts: 0, nextAttemptAtMs: Date.now() + 250 },
  });
  await vi.advanceTimersByTimeAsync(250);
  await collectComputerCommands({
    storage,
    workspaceAccess: f.workspaceAccess,
  });
  expect(await poll()).toMatchObject({
    collection: {
      unconfirmedAttempts: 1,
      nextAttemptAtMs: Date.now() + 30_000,
    },
  });
  expect(
    execWithAdmission.mock.calls.every(
      ([, options]) => options.id === "native-one"
    )
  ).toBe(true);
  expect(f.getExec).not.toHaveBeenCalled();
  expect(f.killExec).not.toHaveBeenCalled();
});

it.each([
  "preparation",
  "native",
] as const)("keeps the eighth %s observation visible only during its bounded check", async (kind) => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const f = fixture();
  await seed(f, "one", {
    collection: { unconfirmedAttempts: 7, nextAttemptAtMs: 0 },
    ...(kind === "preparation"
      ? {
          launchRequestedAt: undefined,
          preparation: {
            request: { action: "start", key: "one", command: "run once" },
            workingDirectory: "/computer",
            progress: {
              generation: "plan",
              checkpoint: "retained-checkpoint",
              cursorRevision: 0,
              targetRevision: 100,
              entries: 0,
              bytes: 0,
              skipped: 0,
            },
          },
        }
      : {}),
  });
  const entered = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<never>();
  f.withWorkspace.mockImplementationOnce(() => {
    entered.resolve();
    return pending.promise;
  });
  const collecting = collectComputerCommands(f);
  await entered.promise;
  const expiresAtMs = kind === "preparation" ? 5000 : 6000;
  expect((await readInvocation(f.storage)).commands[0]?.collection).toEqual({
    unconfirmedAttempts: 8,
    nextAttemptAtMs: null,
    observationExpiresAtMs: expiresAtMs,
  });
  const listed = await f.tool.execute({
    action: "list",
    includeReceiptDetails: true,
  });
  expect(legacyListSchema.safeParse(listed).success).toBe(true);
  expect(JSON.stringify(listed)).not.toContain("retained-checkpoint");
  expect(JSON.stringify(listed)).not.toContain("observationExpiresAtMs");
  // A replacement sees the active eighth check but cannot reserve a ninth.
  const restarted = new ComputerCommandSqlStorage(f.sql);
  expect((await readInvocation(restarted)).commands[0]?.collection).toEqual(
    (await readInvocation(f.storage)).commands[0]?.collection
  );
  expect(await collectComputerCommands({ ...f, storage: restarted })).toBe(
    false
  );
  expect(f.withWorkspace).toHaveBeenCalledTimes(1);
  pending.reject(Object.assign(new Error("offline"), { code: "ECONNRESET" }));
  await collecting;
  expect((await readInvocation(restarted)).commands[0]?.collection).toEqual({
    unconfirmedAttempts: 8,
    nextAttemptAtMs: null,
  });
  await collectComputerCommands({ ...f, storage: restarted });
  expect(f.withWorkspace).toHaveBeenCalledTimes(1);
});

it("does not turn an expired preparation observation into user Stop when its SDK result arrives late", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const f = fixture();
  const progress: SyncProgress = {
    operationId: "plan",
    generation: "plan",
    backend: "container",
    direction: "push",
    mode: "entries",
    phase: "preparing",
    cursor: { rev: 0, path: null },
    targetCursor: { rev: 100, path: null },
    entries: 0,
    bytes: 0,
    skipped: 0,
    complete: false,
    checkpoint: "checkpoint-1",
  };
  await seed(f, "one", {
    launchRequestedAt: undefined,
    preparation: {
      request: { action: "start", key: "one", command: "run once" },
      workingDirectory: "/computer",
      progress: {
        phase: "preparing",
        generation: "plan",
        cursorRevision: 0,
        targetRevision: 100,
        entries: 0,
        bytes: 0,
        skipped: 0,
        checkpoint: "checkpoint-1",
      },
    },
    collection: { unconfirmedAttempts: 7, nextAttemptAtMs: 0 },
  });
  const entered = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<never>();
  f.workspace.runtime.execWithAdmission = vi.fn(() => {
    entered.resolve();
    return pending.promise;
  });
  const collecting = collectComputerCommands(f);
  await entered.promise;
  await vi.advanceTimersByTimeAsync(5000);
  await collecting;
  pending.reject(new WorkspaceSyncPendingError(progress));
  await vi.advanceTimersByTimeAsync(0);
  const state = await readInvocation(f.storage);
  expect(state.commands[0]).toMatchObject({
    phase: "accepted",
    stopRequested: false,
    terminationConfirmed: false,
    preparation: { checkpoint: "checkpoint-1" },
    collection: { unconfirmedAttempts: 8, nextAttemptAtMs: null },
  });
  expect(state.commands[0]?.collection).not.toHaveProperty(
    "observationExpiresAtMs"
  );
  await collectComputerCommands({
    ...f,
    storage: new ComputerCommandSqlStorage(f.sql),
  });
  expect(f.workspace.runtime.execWithAdmission).toHaveBeenCalledTimes(1);
  expect(f.killExec).not.toHaveBeenCalled();
});

it("does not apply a late failed collection over a fresh manual observation on the same receipt", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const f = fixture();
  await seed(f, "one", {
    observedAt: 0,
    collection: { unconfirmedAttempts: 7, nextAttemptAtMs: 0 },
  });
  const pending = Promise.withResolvers<never>();
  f.withWorkspace.mockImplementationOnce(() => pending.promise);
  const collecting = collectComputerCommands({
    storage: f.storage,
    workspaceAccess: f.workspaceAccess,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect((await readInvocation(f.storage)).commands[0]?.collection).toEqual({
    unconfirmedAttempts: 8,
    nextAttemptAtMs: null,
    observationExpiresAtMs: 6000,
  });
  const recovered = await f.tool.execute({
    action: "poll",
    key: "one",
    waitSeconds: 0,
  });
  expect(recovered).toMatchObject({
    collection: { unconfirmedAttempts: 0, nextAttemptAtMs: 15_000 },
  });
  expect(JSON.stringify(recovered)).not.toContain("observationExpiresAtMs");
  const recoveredState = await readInvocation(f.storage);
  pending.reject(
    Object.assign(new Error("older request failed"), { code: "ECONNRESET" })
  );
  await collecting;
  expect(await readInvocation(f.storage)).toEqual(recoveredState);
  expect(await f.storage.get(`${prefix}one`)).toMatchObject({
    observedAt: 0,
    collection: { unconfirmedAttempts: 0, nextAttemptAtMs: 15_000 },
  });
});

it("persists a bounded observation budget before I/O when the old owner's continuation never runs", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const f = fixture();
  await seed(f, "one");
  const abandoned: Promise<boolean>[] = [];
  for (const delay of [
    0, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000, 300_000,
  ]) {
    await vi.advanceTimersByTimeAsync(delay);
    const entered = Promise.withResolvers<void>();
    f.withWorkspace.mockImplementation(() => {
      entered.resolve();
      return new Promise(() => {
        // This abandoned native acquisition never settles.
      });
    });
    const replacement = new ComputerCommandSqlStorage(f.sql);
    const collecting = collectComputerCommands({
      storage: replacement,
      workspaceAccess: f.workspaceAccess,
    });
    abandoned.push(collecting);
    await Promise.race([entered.promise, collecting]);
    // Simulate the Worker disappearing after external acquisition starts:
    // neither its JS timeout nor its catch/finally continuation can run.
    const wallTime = Date.now();
    vi.clearAllTimers();
    // Vitest resets its fake clock along with its timers. A Worker replacement
    // removes timers but does not reset the system's elapsed wall time.
    vi.setSystemTime(wallTime);
  }
  expect(f.withWorkspace).toHaveBeenCalledTimes(8);
  await expect(abandoned.at(-1)).resolves.toBe(false);
  expect((await readInvocation(f.storage)).commands[0]?.collection).toEqual({
    unconfirmedAttempts: 8,
    nextAttemptAtMs: null,
  });
  expect(await f.storage.get(`${prefix}one`)).toMatchObject({
    id: "native-one",
    collection: { unconfirmedAttempts: 8, nextAttemptAtMs: null },
  });
  const retained = await f.storage.get<{ completed?: boolean; loss?: unknown }>(
    `${prefix}one`
  );
  expect(retained?.completed).not.toBe(true);
  expect(retained?.loss).toBeUndefined();
  f.withWorkspace.mockImplementation(
    async (operation) => await operation(f.workspace)
  );
  const recovered = createComputerCommandTool({
    context: { submissionId: "collection-test" },
    storage: new ComputerCommandSqlStorage(f.sql),
    workspaceAccess: f.workspaceAccess,
    workingDirectory: "/computer",
  });
  await expect(
    recovered.execute({ action: "poll", key: "one", waitSeconds: 0 })
  ).resolves.toMatchObject({
    id: "native-one",
    status: "running",
    collection: { nextAttemptAtMs: expect.any(Number) },
  });
  expect(f.getExec).toHaveBeenCalledWith("native-one", expect.anything());
  expect(f.killExec).not.toHaveBeenCalled();
});
