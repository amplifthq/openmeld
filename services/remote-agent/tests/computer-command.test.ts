import type {
  WorkspaceClient,
  WorkspaceRuntimeEvent,
  WorkspaceRuntimeExecHandle,
} from "@cloudflare/computer";
import { describe, expect, it, vi } from "vitest";
import { createRemoteAgentCallbackContext } from "../agent-core/callback-context";
import {
  createComputerCommandTool,
  readCommandSlice,
} from "../flue-adapter/computer-command";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

function context(submissionId: string) {
  const request = createSubmitTurnRequest();
  return createRemoteAgentCallbackContext({
    request,
    nowMs: TEST_NOW_MS,
    ack: {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: submissionId,
      status: "pending",
      submissionId,
    },
  });
}

// The fake implements the installed vendor's retained event-stream contract.
// Disposing a reader detaches it; only killExec signals the underlying process.
function handle(
  id: string,
  events: WorkspaceRuntimeEvent<"utf8">[] = [],
  close = false
) {
  const stream = new ReadableStream<WorkspaceRuntimeEvent<"utf8">>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(event);
      }
      if (close) {
        controller.close();
      }
    },
  });
  return Object.assign(stream, {
    id,
    backend: "container",
    result: vi.fn(),
    kill: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  }) as WorkspaceRuntimeExecHandle<"utf8">;
}

function fixture() {
  const storage = new InMemoryDurableObjectStorage();
  const processes = new Set<string>();
  const exec = vi.fn((_source: string, options: { id: string }) => {
    processes.add(options.id);
    return Promise.resolve(handle(options.id));
  });
  const getExec = vi.fn((id: string) => {
    if (!processes.has(id)) {
      return Promise.reject(new Error("EEXEC_LOST"));
    }
    return Promise.resolve(handle(id));
  });
  const killExec = vi.fn((_id: string) => Promise.resolve());
  const workspace = {
    runtime: { exec, getExec, killExec },
  } as unknown as WorkspaceClient;
  const workspaceAccess = {
    withWorkspace: async <T>(
      operation: (value: WorkspaceClient) => Promise<T>
    ) => await operation(workspace),
  };
  const tool = (submissionId = "execution-a") =>
    createComputerCommandTool({
      context: context(submissionId),
      storage,
      workspaceAccess,
      workingDirectory: "/computer/spaces/a",
    });
  return { tool, exec, getExec, killExec, processes };
}

describe("retained Computer commands", () => {
  it("reattaches after adapter reconstruction without rerunning the command", async () => {
    const f = fixture();
    const request = {
      action: "start",
      key: "report",
      command: "python3 report.py",
    };
    await f.tool().execute(request);
    await f.tool().execute(request);
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(f.getExec).toHaveBeenCalledTimes(1);
    expect(f.killExec).not.toHaveBeenCalled();
    expect(await f.tool().execute({ action: "list" })).toMatchObject([
      { key: "report" },
    ]);
  });

  it("rejects another execution's control key and rejects changed commands", async () => {
    const f = fixture();
    await f.tool().execute({
      action: "start",
      key: "report",
      command: "python3 report.py",
    });
    await expect(
      f.tool("execution-b").execute({ action: "stop", key: "report" })
    ).rejects.toThrow("Unknown Computer command");
    await expect(
      f
        .tool()
        .execute({ action: "start", key: "report", command: "rm report.py" })
    ).rejects.toThrow("different command");
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(f.killExec).not.toHaveBeenCalled();
  });

  it("does not respawn when a previously launched process is lost", async () => {
    const f = fixture();
    const request = {
      action: "start",
      key: "report",
      command: "python3 report.py",
    };
    await f.tool().execute(request);
    f.processes.clear();
    await expect(f.tool().execute(request)).rejects.toThrow("EEXEC_LOST");
    expect(f.exec).toHaveBeenCalledTimes(1);
  });

  it("preserves an uncertain launch receipt instead of retrying its side effects", async () => {
    const f = fixture();
    f.exec.mockRejectedValueOnce(new Error("Transport lost after dispatch"));
    const request = {
      action: "start",
      key: "upload",
      command: "python3 upload.py",
    };
    await expect(f.tool().execute(request)).rejects.toThrow("Transport lost");
    await expect(f.tool().execute(request)).rejects.toThrow("EEXEC_LOST");
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(await f.tool().execute({ action: "list" })).toMatchObject([
      { key: "upload" },
    ]);
  });

  it("stops a launch that returns after its cancellation request", async () => {
    const f = fixture();
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.exec.mockImplementationOnce(async (_source, options) => {
      entered?.();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return handle(options.id);
    });
    const launch = f.tool().execute({
      action: "start",
      key: "report",
      command: "python3 report.py",
    });
    await started;
    await f.tool().execute({ action: "stop", key: "report" });
    release?.();
    await expect(launch).rejects.toThrow("stopped during launch");
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(f.killExec).toHaveBeenCalledTimes(2);
  });

  it("keeps cancellation distinct from completed execution", async () => {
    const f = fixture();
    await f.tool().execute({
      action: "start",
      key: "report",
      command: "python3 report.py",
    });
    expect(
      await f.tool().execute({ action: "stop", key: "report" })
    ).toMatchObject({ status: "stop_requested" });
    expect(f.killExec).toHaveBeenCalledTimes(1);
    await expect(
      f.tool().execute({
        action: "start",
        key: "report",
        command: "python3 report.py",
      })
    ).rejects.toThrow("already stopped");
  });

  it("yields partial output without terminating a running process", async () => {
    const run = handle("run", [
      { id: "run", seq: 1, name: "stdout", value: "START\n" },
    ]);
    expect(await readCommandSlice(run, "report", 0, 1)).toEqual({
      id: "run",
      key: "report",
      status: "running",
      exitCode: null,
      stdout: "START\n",
      stderr: "",
      after: 1,
    });
    expect(run.kill).not.toHaveBeenCalled();
  });

  it("requires an exit receipt and drains file sync before reporting completion", async () => {
    const run = handle(
      "run",
      [
        { id: "run", seq: 2, name: "stdout", value: "DONE\n" },
        { id: "run", seq: 3, name: "exit", value: 0 },
      ],
      true
    );
    expect(await readCommandSlice(run, "report", 1, 10)).toMatchObject({
      status: "completed",
      exitCode: 0,
      stdout: "DONE\n",
      after: 3,
    });
    await expect(
      readCommandSlice(handle("missing", [], true), "report", 0, 10)
    ).rejects.toThrow("without an exit receipt");
  });
});
