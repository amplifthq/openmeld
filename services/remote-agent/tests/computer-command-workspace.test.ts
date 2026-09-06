import { DatabaseSync } from "node:sqlite";
import { getWorkspace, Workspace } from "@cloudflare/computer";
import { expect, it } from "vitest";
import { readCommandSlice } from "../flue-adapter/computer-command";

it("detaches a live poll through the complete native Workspace stack", async () => {
  const database = new DatabaseSync(":memory:");
  let subscribed = false;
  let completed = false;
  const attach = (id: string) => {
    if (subscribed) {
      throw new Error("EEXEC_BUSY");
    }
    subscribed = true;
    return {
      id,
      events: new ReadableStream({
        start(controller) {
          controller.enqueue({
            id,
            seq: 1,
            name: "stdout",
            value: new TextEncoder().encode("START\n"),
          });
          if (completed) {
            controller.enqueue({ id, seq: 2, name: "exit", value: 0 });
            subscribed = false;
            controller.close();
          }
        },
        async cancel() {
          await new Promise((resolve) => setTimeout(resolve, 10));
          subscribed = false;
        },
      }),
    };
  };
  const owner = new Workspace({
    storage: {
      sql: {
        exec<Row extends object>(query: string, ...bindings: unknown[]) {
          const rows = database
            .prepare(query)
            .all(...(bindings as never[])) as Row[];
          return { toArray: () => rows };
        },
      },
      transactionSync: (operation) => operation(),
    },
    backends: [
      {
        id: "container",
        type: "test-retained-container",
        connect: () =>
          Promise.resolve({
            sync: "none" as const,
            rpc: {
              shell: {
                exec: (input: { id?: string }) => {
                  if (!input.id) {
                    return Promise.reject(
                      new Error("Expected an execution ID")
                    );
                  }
                  return Promise.resolve(attach(input.id));
                },
                getExec: (input: { id: string }) =>
                  Promise.resolve(attach(input.id)),
                killExec: () =>
                  Promise.reject(new Error("Polling must not kill")),
                disposeExec: () =>
                  Promise.reject(new Error("Polling must retain execution")),
              },
              sync: {} as never,
            },
            close: () => Promise.resolve(),
          }),
      },
    ],
  });
  try {
    using workspace = await getWorkspace({
      __getWorkspaceStub: () => Promise.resolve(owner.stub()),
    });
    using started = await workspace.runtime.exec("sleep 300", {
      backend: "container",
      encoding: "utf8",
    });
    await started.cancel();
    expect(subscribed).toBe(false);
    const polling = await workspace.runtime.getExec(started.id, {
      backend: "container",
      encoding: "utf8",
    });
    const slice = await readCommandSlice(polling, "long", 0, 5);
    expect(slice.status).toBe("running");
    expect(slice.stdout).toBe("START\n");
    expect(subscribed).toBe(false);
    using resumed = await workspace.runtime.getExec(started.id, {
      backend: "container",
      encoding: "utf8",
    });
    await resumed.cancel();
    completed = true;
    const finished = await workspace.runtime.getExec(started.id, {
      backend: "container",
      encoding: "utf8",
    });
    expect(await readCommandSlice(finished, "long", 0, 50)).toMatchObject({
      status: "completed",
      exitCode: 0,
    });
  } finally {
    await owner.close();
    database.close();
  }
});
