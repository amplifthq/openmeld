import type {
  WorkspaceClient,
  WorkspaceRuntimeEvent,
  WorkspaceRuntimeExecHandle,
} from "@cloudflare/computer";
import { defineTool } from "@flue/runtime";
import { type GenericSchema, parse } from "valibot";
import { describe, expect, it, vi } from "vitest";
import { createRemoteAgentCallbackContext } from "../agent-core/callback-context";
import {
  createComputerCommandTool,
  readCommandSlice,
  stopRemoteAgentComputerCommands,
} from "../flue-adapter/computer-command";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const cleanupAccess = vi.hoisted(() => vi.fn());
vi.mock("../flue-adapter/agent-computer-workspace-access", () => ({
  createAgentComputerWorkspaceAccess: cleanupAccess,
}));

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
  return { tool, exec, getExec, killExec, processes, storage, workspaceAccess };
}

describe("retained Computer commands", () => {
  it("still signals every owned command when terminal output inspection fails", async () => {
    const f = fixture();
    const ids: string[] = [];
    for (const key of ["first", "second"]) {
      const result = (await f
        .tool()
        .execute({ action: "start", key, command: "sleep 300" })) as {
        id: string;
      };
      ids.push(result.id);
    }
    await f
      .tool("other-execution")
      .execute({ action: "start", key: "other", command: "sleep 300" });
    cleanupAccess.mockReturnValue(f.workspaceAccess);
    f.getExec.mockRejectedValue(
      new TypeError(
        "The readable side of this TransformStream is no longer readable."
      )
    );
    await expect(
      stopRemoteAgentComputerCommands({
        context: context("execution-a"),
        storage: f.storage,
        env: { AGENT_COMPUTER: { idFromName: vi.fn(() => "computer-id") } },
      })
    ).rejects.toThrow();
    expect(f.killExec.mock.calls.map(([id]) => id)).toEqual(ids);
  });
  it("keeps reported lost commands from failing recovered work during cleanup", async () => {
    const f = fixture();
    const started = await f
      .tool()
      .execute({ action: "start", key: "lost", command: "sleep 300" });
    // The installed SDK reports a runtime identity mismatch with this code.
    const lost = Object.assign(new Error("Computer runtime replaced"), {
      name: "WorkspaceExecutionLostError",
      code: "EEXEC_LOST",
    });
    f.getExec.mockRejectedValue(lost);
    await expect(
      f.tool().execute({ action: "poll", key: "lost" })
    ).rejects.toMatchObject({ code: "EEXEC_LOST" });
    cleanupAccess.mockReturnValue(f.workspaceAccess);
    await expect(
      stopRemoteAgentComputerCommands({
        context: context("execution-a"),
        storage: f.storage,
        env: { AGENT_COMPUTER: { idFromName: vi.fn(() => "computer-id") } },
      })
    ).resolves.toBe(0);
    expect(f.killExec).not.toHaveBeenCalled();
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(started).toMatchObject({ key: "lost", status: "running" });
  });

  it("reports a native live subscriber as running and later reads the retained exit", async () => {
    const f = fixture();
    const started = (await f
      .tool()
      .execute({ action: "start", key: "quiet", command: "sleep 300" })) as {
      id: string;
    };
    f.getExec.mockRejectedValueOnce(
      Object.assign(new Error("already has a live subscriber"), {
        code: "EEXEC_BUSY",
      })
    );
    expect(
      await f
        .tool()
        .execute({ action: "poll", key: "quiet", after: 1, waitSeconds: 0 })
    ).toMatchObject({
      id: started.id,
      status: "running",
      exitCode: null,
      outputPending: true,
      after: 1,
    });
    f.getExec.mockResolvedValueOnce(
      handle(
        started.id,
        [{ id: started.id, seq: 2, name: "exit", code: 0 }],
        true
      )
    );
    expect(
      await f
        .tool()
        .execute({ action: "poll", key: "quiet", after: 1, waitSeconds: 0 })
    ).toMatchObject({ status: "completed", exitCode: 0, after: 2 });
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(f.killExec).not.toHaveBeenCalled();
  });
  it("registers through the actual pinned Flue tool boundary", () => {
    const tool = fixture().tool();
    expect(() =>
      defineTool({
        name: tool.name,
        description: tool.description,
        input: tool.input as GenericSchema<Record<string, unknown>, unknown>,
        run: () => Promise.resolve({ output: "unused" }),
      })
    ).not.toThrow();
  });
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

  it("accepts the SDK's fractional output cursor through both tool validators", async () => {
    const f = fixture();
    const tool = f.tool();
    f.exec.mockImplementationOnce((_source, options) =>
      Promise.resolve(
        handle(options.id, [
          { id: options.id, seq: 4.5, name: "stderr", value: "�" },
          { id: options.id, seq: 5, name: "exit", code: 0 },
        ])
      )
    );
    const started = (await tool.execute({
      action: "start",
      key: "utf8",
      command: "example",
    })) as { id: string; after: number };
    expect(started.after).toBe(4.5);
    f.getExec.mockResolvedValueOnce(
      handle(
        started.id,
        [{ id: started.id, seq: 5, name: "exit", code: 0 }],
        true
      )
    );
    const input = parse(
      tool.input as GenericSchema<
        Record<string, unknown>,
        Record<string, unknown>
      >,
      {
        action: "poll",
        key: "utf8",
        after: started.after,
      }
    );
    await expect(tool.execute(input)).resolves.toMatchObject({
      status: "completed",
      after: 5,
    });
    expect(f.getExec).toHaveBeenCalledWith(
      started.id,
      expect.objectContaining({ resume: 4.5 })
    );
  });

  it("requires an exit receipt and drains file sync before reporting completion", async () => {
    const run = handle(
      "run",
      [
        { id: "run", seq: 2, name: "stdout", value: "DONE\n" },
        { id: "run", seq: 3, name: "exit", code: 0 },
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

  it("bounds pending file sync and leaves the exit receipt available to the next poll", async () => {
    const events: WorkspaceRuntimeEvent<"utf8">[] = [
      { id: "run", seq: 2, name: "stdout", value: "DONE\n" },
      { id: "run", seq: 3, name: "exit", code: 0 },
    ];
    const run = handle("run", events);
    const slice = await readCommandSlice(run, "report", 1, 10);
    expect(slice).toMatchObject({
      status: "running",
      after: 2,
      stdout: "DONE\n",
    });
    expect(run.locked).toBe(false);
    expect(run[Symbol.dispose]).toHaveBeenCalled();
    expect(run.kill).not.toHaveBeenCalled();
    // The vendor resumes strictly after the supplied sequence. Only the exit
    // should replay; output already delivered to the model must not repeat.
    const resumed = handle(
      "run",
      events.filter((event) => event.seq > slice.after),
      true
    );
    expect(
      await readCommandSlice(resumed, "report", slice.after, 10)
    ).toMatchObject({
      status: "completed",
      exitCode: 0,
      after: 3,
      stdout: "",
    });
  }, 500);

  it("honors Stop after exit while file sync is pending", async () => {
    const run = handle("run", [{ id: "run", seq: 1, name: "exit", code: 0 }]);
    const controller = new AbortController();
    const reading = readCommandSlice(run, "report", 0, 1000, controller.signal);
    const rejected = expect(reading).rejects.toThrow("User stopped execution");
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort(new Error("User stopped execution"));
    await rejected;
    expect(run.locked).toBe(false);
    expect(run[Symbol.dispose]).toHaveBeenCalled();
  }, 500);
});
