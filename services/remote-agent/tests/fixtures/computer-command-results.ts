import {
  getWorkspace,
  Workspace,
  type WorkspaceRuntimeEvent,
} from "@cloudflare/computer";
import {
  collectComputerCommands,
  createComputerCommandTool,
  stopStoredComputerCommands,
} from "../../flue-adapter/computer-command";
import { RemoteAgentSqlStorage } from "../../flue-adapter/storage";

/** Exercise the real SDK sync bracket and the real SQLite receipt owner. Only
 * the external computerd RPC is controlled, using its shipped event contract. */
export async function verifyDurableCommandResults(
  storage: ConstructorParameters<typeof Workspace>[0]["storage"],
  sql: ConstructorParameters<typeof RemoteAgentSqlStorage>[0]
) {
  let exited = false;
  let pullFails = true;
  let expired = false;
  let starts = 0;
  const attach = (id: string, after: number | "tail" = 0) => {
    if (expired) {
      throw Object.assign(new Error("no exec record"), { code: "ENOENT" });
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
                fetchChanges: async () => {
                  await Promise.resolve();
                  if (pullFails) {
                    throw new Error("injected pull failure");
                  }
                  return Promise.resolve({
                    currentCursor: { rev: 0, path: null },
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
      storage: new RemoteAgentSqlStorage(sql),
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
    pullFails = false;
    // No model poll: collection must retain the terminal result itself.
    await collectComputerCommands({
      storage: new RemoteAgentSqlStorage(sql),
      workspaceAccess,
    });
    expired = true;
    const recovered = await tool().execute({
      action: "poll",
      key: "work",
      after: 1,
    });
    const cleanup = await stopStoredComputerCommands({
      context: { submissionId: "durable-result" },
      storage: new RemoteAgentSqlStorage(sql),
      access: () => workspaceAccess,
    });
    return { started, pending, recovered, cleanup, starts };
  } finally {
    await owner.close();
  }
}
