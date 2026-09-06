import type { WorkspaceRuntimeExecHandle } from "@cloudflare/computer";
import { getWorkspace, Workspace } from "@cloudflare/computer";
import { expect, it } from "vitest";

it.each([
  "unread",
  "connecting",
  "reading",
])("awaits native subscription cancellation before reattaching a %s command", async (state) => {
  let subscribed = false;
  const attach = (id: string) => {
    if (subscribed) {
      throw new Error("EEXEC_BUSY: already has a live subscriber");
    }
    subscribed = true;
    const stream = new ReadableStream({
      async cancel() {
        // The container detaches asynchronously across RPC. Disposal alone
        // cannot establish this acknowledgement boundary.
        await new Promise((resolve) => setTimeout(resolve, 10));
        subscribed = false;
      },
    });
    return Object.assign(stream, {
      id,
      backend: "container",
      result: () => Promise.reject(new Error("Not consumed as a result")),
      kill: () =>
        Promise.reject(new Error("Detaching must not kill the process")),
      [Symbol.dispose]() {
        stream.cancel().catch(() => undefined);
      },
    }) as WorkspaceRuntimeExecHandle;
  };
  // Exercise the installed SDK's real Workspace RPC target and client. Only
  // the native process boundary is fake, following its single-subscriber API.
  const runtimeOwner = {
    ready: () => Promise.resolve(),
    useThink: false,
    runtime: {
      exec: async (_command: string, options: { id: string }) =>
        attach(options.id),
      getExec: async (id: string) => attach(id),
    },
  } as unknown as Workspace;
  using workspace = await getWorkspace({
    __getWorkspaceStub: async () => Workspace.prototype.stub.call(runtimeOwner),
  });
  using started = await workspace.runtime.exec("sleep 300", {
    backend: "container",
  });
  if (state === "unread") {
    await started.cancel();
  } else {
    const reader = started.getReader();
    const pending = reader.read();
    if (state === "reading") {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await reader.cancel();
    await pending;
    reader.releaseLock();
  }
  expect(subscribed).toBe(false);
  using resumed = await workspace.runtime.getExec(started.id, {
    backend: "container",
  });
  await resumed.cancel();
  expect(subscribed).toBe(false);
});
