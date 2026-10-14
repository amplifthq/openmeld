import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type BackendHandle,
  getWorkspace,
  Workspace,
} from "@cloudflare/computer";
import { createComputerCommandTool } from "../../flue-adapter/computer-command";
import {
  COMPUTER_COMMAND_PREFIX,
  ComputerCommandSqlStorage,
} from "../../flue-adapter/computer-command-storage";

export const transportFailure = () =>
  new Error("RPC was canceled because RPC session was shut down");

export function createCommandAdmissionFixture(
  registerCleanup: (cleanup: () => Promise<void>) => void,
  directory = mkdtempSync(join(tmpdir(), "computer-admission-"))
) {
  let database = new DatabaseSync(join(directory, "computer.sqlite"));
  let transactionId = 0;
  const sql = {
    exec<Row extends object>(query: string, ...bindings: unknown[]) {
      const rows = database
        .prepare(query)
        .all(...(bindings as never[])) as Row[];
      return {
        toArray: () => rows,
        rowsWritten: Number(
          database.prepare("SELECT changes() AS n").get()?.n ?? 0
        ),
      };
    },
  };
  const storage = new ComputerCommandSqlStorage(sql);
  const files = new Map<string, unknown>();
  const blobs = new Map<string, Uint8Array>();
  let cursor: { rev: number; path: string | null } = { rev: 0, path: null };
  let failPreparation = false;
  let loseLaunchAck = false;
  let refuseLaunch = false;
  let beforeWatermarks: (() => Promise<void>) | undefined;
  let allowed = true;
  let spawns = 0;
  let watermarks = 0;
  const executions = new Set<string>();
  const attach = (id: string, after: number | "tail" = 0) => {
    if (!executions.has(id)) {
      throw Object.assign(new Error("no native execution"), { code: "ENOENT" });
    }
    return {
      id,
      events: new ReadableStream({
        start(controller) {
          if (after !== "tail" && after < 1) {
            controller.enqueue({ id, seq: 1, name: "exit" as const, code: 17 });
          }
          controller.close();
        },
      }),
    };
  };
  // Model only the native transport boundary, from the installed SyncRPC and
  // ShellRPC types. Actual planning, file reads, retry policy and admission use
  // the installed SDK; command state uses real on-disk SQLite.
  const rpc: BackendHandle["rpc"] = {
    shell: {
      exec: (input) => {
        if (refuseLaunch) {
          throw new Error("ESYNC_PRE_DISPATCH: native epoch changed");
        }
        if (!input.id) {
          throw new Error("missing command ID");
        }
        spawns++;
        executions.add(input.id);
        if (loseLaunchAck) {
          throw transportFailure();
        }
        return Promise.resolve(attach(input.id));
      },
      getExec: async (input) => attach(input.id, input.after),
      killExec: async () => undefined,
      disposeExec: async () => undefined,
    },
    sync: {
      retentionHead: async () => ({ epoch: "native", generation: null }),
      beginRetention: async () => undefined,
      prepareChanges: async () => ({ ready: true, reads: 0 }),
      discardChanges: async () => true,
      watermarks: async () => {
        watermarks++;
        const before = beforeWatermarks;
        beforeWatermarks = undefined;
        await before?.();
        if (failPreparation) {
          throw transportFailure();
        }
        return {
          epoch: "native",
          currentRev: 0,
          pushRev: 0,
          fetchCursor: cursor,
        };
      },
      push: async ({ senderRev, senderCursor, changes }) => {
        const reader = changes.getReader();
        try {
          for (;;) {
            const entry = await reader.read();
            if (entry.done) {
              break;
            }
            files.set(entry.value.path, entry.value);
          }
        } finally {
          reader.releaseLock();
        }
        cursor = senderCursor ?? { rev: senderRev, path: null };
        return { rev: 0, appliedPushCursor: cursor };
      },
      hasObjects: async (hashes) =>
        hashes.filter((hash) => blobs.has(Buffer.from(hash).toString("hex"))),
      pushObjects: async (objects) => {
        const reader = objects.getReader();
        try {
          for (;;) {
            const object = await reader.read();
            if (object.done) {
              break;
            }
            blobs.set(
              Buffer.from(object.value.hash).toString("hex"),
              object.value.bytes
            );
          }
        } finally {
          reader.releaseLock();
        }
      },
      fetchChanges: async () => ({
        currentCursor: { rev: 0, path: null },
        appliedPushCursor: cursor,
        blockCursor: { rev: 0, path: null },
        drained: true,
        stream: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      }),
      readEntry: async () => null,
      fetchObjects: () =>
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
    },
  };
  const makeOwner = () =>
    new Workspace({
      storage: {
        sql,
        transactionSync: (operation) => {
          const savepoint = `admission_${transactionId++}`;
          database.exec(`SAVEPOINT ${savepoint}`);
          try {
            const result = operation();
            database.exec(`RELEASE ${savepoint}`);
            return result;
          } catch (error) {
            database.exec(`ROLLBACK TO ${savepoint}`);
            database.exec(`RELEASE ${savepoint}`);
            throw error;
          }
        },
      },
      backends: [
        {
          id: "container",
          type: "typed-native",
          connect: async () => ({
            rpc,
            runtimeId: "native-one",
            executionSupervision: { version: 0 as const },
            sync: "remote" as const,
            close: async () => undefined,
          }),
        },
      ],
    });
  let owner = makeOwner();
  const tool = () =>
    createComputerCommandTool({
      context: { submissionId: "admission" },
      storage,
      workingDirectory: "/computer",
      assertCanStart: () =>
        allowed
          ? Promise.resolve()
          : Promise.reject(new Error("invocation stopped")),
      workspaceAccess: {
        withWorkspace: async (operation) => {
          using client = await getWorkspace(owner);
          return operation(client);
        },
      },
    });
  const record = async () =>
    [
      ...(await storage.list({ prefix: COMPUTER_COMMAND_PREFIX })).values(),
    ][0] as Record<string, unknown>;
  const start = () =>
    tool().execute({ action: "start", key: "one", command: "exit 17" });
  const poll = () =>
    tool().execute({ action: "poll", key: "one", waitSeconds: 0 });
  registerCleanup(async () => {
    await owner.close();
    database.close();
    rmSync(directory, { recursive: true });
  });
  return {
    get owner() {
      return owner;
    },
    tool,
    storage,
    record,
    start,
    poll,
    files,
    beforePreparation: (callback: () => Promise<void>) => {
      beforeWatermarks = callback;
    },
    revoke: () => {
      allowed = false;
    },
    counts: () => ({ spawns, watermarks }),
    preparationFails: (value: boolean) => {
      failPreparation = value;
    },
    launchAckLost: () => {
      loseLaunchAck = true;
    },
    refuseLaunch: (value: boolean) => {
      refuseLaunch = value;
    },
    restart: async () => {
      await owner.close();
      database.close();
      database = new DatabaseSync(join(directory, "computer.sqlite"));
      owner = makeOwner();
    },
    runUntil: async (done: () => boolean) => {
      for (let i = 0; i < 40 && !done(); i++) {
        await poll();
      }
      return done();
    },
  };
}
