import {
  type BackendHandle,
  getWorkspace,
  Workspace,
  type WorkspaceRuntimeEvent,
} from "@cloudflare/computer";
import type { AgentComputerWorkspaceAccess } from "../../flue-adapter/agent-computer-workspace-access";
import type { ComputerCommandRecord } from "../../flue-adapter/computer-command";
import {
  collectComputerCommands,
  createComputerCommandTool,
  stopStoredComputerCommands,
} from "../../flue-adapter/computer-command";
import {
  COMPUTER_COMMAND_PREFIX,
  ComputerCommandSqlStorage,
} from "../../flue-adapter/computer-command-storage";

/** Existing native-result checks need due receipts, rather than a 15-second
 * wall-clock sleep. Scheduling and failure budgets have their own clock tests. */
export async function collectDueComputerCommands(input: {
  storage: ComputerCommandSqlStorage;
  workspaceAccess: AgentComputerWorkspaceAccess;
}) {
  for (const [key, command] of await input.storage.list<ComputerCommandRecord>({
    prefix: COMPUTER_COMMAND_PREFIX,
  })) {
    if (
      command.collection?.nextAttemptAtMs !== null &&
      command.collection?.nextAttemptAtMs !== undefined &&
      command.collection.nextAttemptAtMs > Date.now()
    ) {
      const due = {
        ...command,
        collection: { ...command.collection, nextAttemptAtMs: Date.now() },
      };
      if (command.recordExpiresAtMs === undefined) {
        await input.storage.compareAndSet(key, command, due);
      } else {
        await input.storage.compareAndSetExpiring(
          key,
          command,
          due,
          command.recordExpiresAtMs
        );
      }
    }
  }
  return await collectComputerCommands(input);
}

/** Exercise the real SDK sync bracket and the real SQLite receipt owner. Only
 * the external computerd RPC is controlled, using its shipped event contract. */
export async function verifyDurableCommandResults(
  storage: ConstructorParameters<typeof Workspace>[0]["storage"],
  sql: ConstructorParameters<typeof ComputerCommandSqlStorage>[0],
  syncOutcome: "complete" | "ENOENT" | "EEXEC_LOST" = "complete"
) {
  let exited = false;
  let pullFails = true;
  let expired = false;
  let starts = 0;
  const retention: Pick<
    NonNullable<BackendHandle["rpc"]["sync"]>,
    "retentionHead" | "beginRetention"
  > = {
    retentionHead: async () => ({
      epoch: "durable-result-peer",
      generation: null,
    }),
    beginRetention: async () => undefined,
  };
  const attach = (id: string, after: number | "tail" = 0) => {
    if (expired) {
      throw Object.assign(new Error("no exec record"), {
        code: syncOutcome === "complete" ? "ENOENT" : syncOutcome,
      });
    }
    return {
      id,
      events: new ReadableStream<WorkspaceRuntimeEvent>({
        start(controller) {
          const events: WorkspaceRuntimeEvent[] = [
            {
              id,
              seq: 1,
              name: "stdout",
              value: new TextEncoder().encode("BEGIN\n"),
            },
            ...(exited
              ? [
                  {
                    id,
                    seq: 2,
                    name: "stdout" as const,
                    value: new TextEncoder().encode("DONE\n"),
                  },
                  { id, seq: 3, name: "exit" as const, code: 0 },
                ]
              : []),
          ];
          for (const event of events) {
            if (after !== "tail" && event.seq > after) {
              controller.enqueue(event);
            }
          }
          if (exited) {
            controller.close();
          }
        },
      }),
    };
  };
  const owner = new Workspace({
    storage,
    backends: [
      {
        id: "container",
        type: "retained-test-container",
        connect: () =>
          Promise.resolve({
            get sync(): "remote" | "none" {
              return exited ? "remote" : "none";
            },
            rpc: {
              shell: {
                exec: (input: { id?: string }) => {
                  if (!input.id) {
                    throw new Error("Expected command identity");
                  }
                  starts++;
                  return Promise.resolve(attach(input.id));
                },
                getExec: (input: { id: string; after?: number | "tail" }) =>
                  Promise.resolve(attach(input.id, input.after)),
                killExec: () =>
                  Promise.reject(
                    new Error("Completed work must not be killed")
                  ),
                disposeExec: () =>
                  Promise.reject(
                    new Error("Reader disposal must not remove native receipts")
                  ),
              },
              sync: {
                ...retention,
                watermarks: () =>
                  exited && pullFails
                    ? Promise.reject(
                        new Error("injected settled source failure")
                      )
                    : Promise.resolve({
                        currentRev: 0,
                        pushRev: 0,
                        fetchCursor: { rev: 0, path: null },
                      }),
                prepareChanges: () => {
                  if (pullFails) {
                    return Promise.reject(new Error("injected pull failure"));
                  }
                  return Promise.resolve({ ready: true, reads: 0 });
                },
                discardChanges: async () => true,
                fetchChanges: async () => {
                  await Promise.resolve();
                  if (pullFails) {
                    throw new Error("injected pull failure");
                  }
                  return Promise.resolve({
                    currentCursor: { rev: 0, path: null },
                    blockCursor: { rev: 0, path: null },
                    drained: true,
                    appliedPushCursor: { rev: 0, path: null },
                    stream: new ReadableStream({
                      start(controller) {
                        controller.close();
                      },
                    }),
                  });
                },
              } as never,
            },
            close: () => Promise.resolve(),
          }),
      },
    ],
  });
  const workspaceAccess = {
    withWorkspace: async <T>(
      operation: (
        workspace: Awaited<ReturnType<typeof getWorkspace>>
      ) => Promise<T>
    ) => {
      using workspace = await getWorkspace({
        __getWorkspaceStub: () => Promise.resolve(owner.stub()),
      });
      return await operation(workspace);
    },
  };
  const tool = () =>
    createComputerCommandTool({
      context: { submissionId: "durable-result" },
      storage: new ComputerCommandSqlStorage(sql),
      workspaceAccess,
      workingDirectory: "/computer",
    });
  try {
    const started = await tool().execute({
      action: "start",
      key: "work",
      command: "printf DONE",
    });
    exited = true;
    const pending = await tool().execute({
      action: "poll",
      key: "work",
      waitSeconds: 1,
    });
    // An exited process is never signalled while synchronization is pending.
    const pendingCleanup = await stopStoredComputerCommands({
      context: { submissionId: "durable-result" },
      storage: new ComputerCommandSqlStorage(sql),
      access: () => workspaceAccess,
    });
    pullFails = syncOutcome !== "complete";
    expired = syncOutcome !== "complete";
    // No model poll: collection must retain the terminal result itself.
    // Each collection resumes one bounded page, including the cleanup page.
    for (let step = 0; step < 4; step++) {
      await collectDueComputerCommands({
        storage: new ComputerCommandSqlStorage(sql),
        workspaceAccess,
      });
    }
    expired = true;
    const recovered = await tool().execute({
      action: "poll",
      key: "work",
      after: 1,
    });
    const cleanup = await stopStoredComputerCommands({
      context: { submissionId: "durable-result" },
      storage: new ComputerCommandSqlStorage(sql),
      access: () => workspaceAccess,
    });
    return { started, pending, pendingCleanup, recovered, cleanup, starts };
  } finally {
    await owner.close();
  }
}
