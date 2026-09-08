import {
  getWorkspace,
  Workspace,
  type WorkspaceRuntimeEvent,
} from "@cloudflare/computer";
import { readCommandSlice } from "../../flue-adapter/computer-command";

export async function verifyRetainedCommandPolling(
  storage: ConstructorParameters<typeof Workspace>[0]["storage"]
) {
  let subscribed = false;
  let completed = false;
  let pauseSync = false;
  const pullStarted = Promise.withResolvers<void>();
  const finishPull = Promise.withResolvers<void>();
  const attach = (id: string, after?: number | "tail") => {
    if (subscribed) {
      throw new Error("EEXEC_BUSY");
    }
    subscribed = true;
    return {
      id,
      events: new ReadableStream({
        start(controller) {
          // Native Shell.getExec filters retained events strictly after the
          // requested cursor; the Workspace client does not filter them again.
          const enqueue = (event: WorkspaceRuntimeEvent) => {
            if (after !== "tail" && event.seq > (after ?? 0)) {
              controller.enqueue(event);
            }
          };
          enqueue({
            id,
            seq: 1,
            name: "stdout",
            value: new TextEncoder().encode("START\n"),
          });
          if (completed) {
            // A UTF-8 character split across chunks must survive decoding.
            enqueue({
              id,
              seq: 2,
              name: "stdout",
              value: new Uint8Array([0xe2, 0x82]),
            });
            enqueue({
              id,
              seq: 3,
              name: "stdout",
              value: new Uint8Array([0xac]),
            });
            // A truncated stderr character must flush before the exit receipt.
            enqueue({
              id,
              seq: 4,
              name: "stderr",
              value: new Uint8Array([0xe2]),
            });
            enqueue({ id, seq: 5, name: "exit", code: 0 });
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
                getExec: (input: { id: string; after?: number | "tail" }) =>
                  Promise.resolve(attach(input.id, input.after)),
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
    const pendingSlice = readCommandSlice(syncing, "long", 0, 50);
    await pullStarted.promise;
    let syncPending: Awaited<ReturnType<typeof readCommandSlice>>;
    let stopError: string;
    try {
      syncPending = await pendingSlice;
      const stopping = await workspace.runtime.getExec(started.id, {
        backend: "container",
        encoding: "utf8",
        resume: syncPending.after,
      });
      const controller = new AbortController();
      const stopped = readCommandSlice(
        stopping,
        "long",
        syncPending.after,
        1000,
        controller.signal
      ).then(
        () => "unexpected completion",
        (error: Error) => error.message
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      controller.abort(new Error("User stopped execution"));
      stopError = await stopped;
    } finally {
      finishPull.resolve();
    }
    const synced = await workspace.runtime.getExec(started.id, {
      backend: "container",
      encoding: "utf8",
      resume: syncPending.after,
    });
    const resumedSync = await readCommandSlice(
      synced,
      "long",
      syncPending.after,
      100
    );
    return {
      syncPending,
      stopError,
      resumedSync,
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
