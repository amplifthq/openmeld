import { getWorkspace, Workspace } from "@cloudflare/computer";
import { readCommandSlice } from "../../flue-adapter/computer-command";

export async function verifyRetainedCommandPolling(
  storage: ConstructorParameters<typeof Workspace>[0]["storage"]
) {
  let subscribed = false;
  let completed = false;
  let pauseSync = false;
  const pullStarted = Promise.withResolvers<void>();
  const finishPull = Promise.withResolvers<void>();
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
            // A UTF-8 character split across chunks must survive decoding.
            controller.enqueue({
              id,
              seq: 2,
              name: "stdout",
              value: new Uint8Array([0xe2, 0x82]),
            });
            controller.enqueue({
              id,
              seq: 3,
              name: "stdout",
              value: new Uint8Array([0xac]),
            });
            // A truncated stderr character must flush before the exit receipt.
            controller.enqueue({
              id,
              seq: 4,
              name: "stderr",
              value: new Uint8Array([0xe2]),
            });
            controller.enqueue({ id, seq: 5, name: "exit", code: 0 });
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
    storage,
    backends: [
      {
        id: "container",
        type: "test-retained-container",
        connect: () =>
          Promise.resolve({
            get sync(): "remote" | "none" {
              return pauseSync ? "remote" : "none";
            },
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
              sync: {
                async fetchChanges() {
                  pullStarted.resolve();
                  await finishPull.promise;
                  return {
                    currentCursor: { rev: 0, path: null },
                    appliedPushCursor: { rev: 0, path: null },
                    stream: new ReadableStream({
                      start(controller) {
                        controller.close();
                      },
                    }),
                  };
                },
              } as never,
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
    const subscribedAfterStartCancel = subscribed;
    const polling = await workspace.runtime.getExec(started.id, {
      backend: "container",
      encoding: "utf8",
    });
    const slice = await readCommandSlice(polling, "long", 0, 5);
    const subscribedAfterPoll = subscribed;
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
    const finalReceipt = await readCommandSlice(finished, "long", 0, 50);
    // The native stream can close before asynchronous file synchronization.
    // Cancellation in that interval must not cancel an already released reader.
    // Delay the vendor's actual SyncRPC boundary, not an owner method that
    // the new SDK no longer calls for post-command synchronization.
    pauseSync = true;
    const syncing = await workspace.runtime.getExec(started.id, {
      backend: "container",
      encoding: "utf8",
    });
    const syncReader = syncing.getReader();
    for (;;) {
      const event = await syncReader.read();
      if (event.done || event.value.name === "exit") {
        break;
      }
    }
    const close = syncReader.read();
    await pullStarted.promise;
    try {
      await syncReader.cancel();
      await close;
    } finally {
      finishPull.resolve();
      syncReader.releaseLock();
      syncing[Symbol.dispose]();
    }
    return {
      subscribedAfterStartCancel,
      subscribedAfterPoll,
      slice,
      finished: finalReceipt,
      commandId: started.id,
    };
  } finally {
    await owner.close();
  }
}
