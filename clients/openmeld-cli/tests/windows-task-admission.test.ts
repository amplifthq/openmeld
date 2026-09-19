import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";
import { runWindowsUserTask } from "../src/local-service/lifecycle/windows-user-task";

const native = vi.hoisted(() => ({
  exec: vi.fn(),
  attach: vi.fn(),
  release: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFile: native.exec }));
vi.mock("@openmeld/adapter-core/windows-system", () => ({
  resolveWindowsPowerShellPath: () =>
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  powerShellEncodedArguments: (script: string) => [
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ],
}));
vi.mock("../src/config/daemon-state", () => ({
  currentDaemonServiceLifecycleLock: native.lock,
}));
vi.mock("../src/config/lock", () => ({
  attachLockProcess: native.attach,
  releaseLock: native.release,
}));

const request = {
  name: "OpenMeld-Test-task",
  legacyScript: "C:\\isolated\\never.bat",
  operation: "status" as const,
};
const status = {
  installed: false,
  running: false,
  enabled: false,
  legacy: false,
  actionArguments: null,
};
const lock = { path: "isolated-test-lock", ownerId: "test-owner" };
let child: EventEmitter & {
  stdin: PassThrough;
  pid: number;
  exitCode: number | null;
  signalCode: string | null;
  kill: ReturnType<typeof vi.fn>;
};
let complete: (error: Error | null, stdout: string) => void;
let received: string;

beforeEach(() => {
  vi.resetAllMocks();
  received = "";
  child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    pid: 4123,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(),
  });
  child.stdin.on("data", (value) => {
    received += value.toString();
  });
  child.kill.mockImplementation(() => {
    child.signalCode = "SIGTERM";
    complete(new Error("test process ended"), "");
  });
  native.exec.mockImplementation((_command, _args, _options, callback) => {
    complete = callback;
    return child;
  });
  native.lock.mockReturnValue(lock);
  native.attach.mockResolvedValue({ path: lock.path, ownerId: "native-owner" });
});

it("does not grant the OS operation before exact lifecycle attachment completes", async () => {
  const attachment = Promise.withResolvers<{ path: string; ownerId: string }>();
  native.attach.mockReturnValue(attachment.promise);
  const pending = runWindowsUserTask(request);
  expect(received).toBe("");
  expect(native.attach).toHaveBeenCalledWith(lock, child.pid);
  expect(native.exec.mock.calls[0]?.[2].env.OPENMELD_TASK_GRANT_REQUIRED).toBe(
    "1"
  );
  attachment.resolve({ path: lock.path, ownerId: "native-owner" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(received).toBe("execute\n");
  expect(native.release).not.toHaveBeenCalled();
  child.exitCode = 0;
  complete(null, JSON.stringify(status));
  expect(await pending).toEqual(status);
  expect(native.release).toHaveBeenCalledWith({
    path: lock.path,
    ownerId: "native-owner",
  });
});

it("never grants after failed attachment and waits for the rejected process to finish", async () => {
  native.attach.mockRejectedValue(new Error("owner changed before grant"));
  await expect(runWindowsUserTask(request)).rejects.toThrow(
    "owner changed before grant"
  );
  expect(received).toBe("");
  expect(child.stdin.destroyed).toBe(true);
  expect(child.kill).toHaveBeenCalledOnce();
  expect(native.release).not.toHaveBeenCalled();
});

it("does not add a lifecycle participant to an ordinary read-only status query", async () => {
  native.lock.mockReturnValue(null);
  const pending = runWindowsUserTask(request);
  expect(native.exec.mock.calls[0]?.[2].env.OPENMELD_TASK_GRANT_REQUIRED).toBe(
    "0"
  );
  child.exitCode = 0;
  complete(null, JSON.stringify(status));
  expect(await pending).toEqual(status);
  expect(native.attach).not.toHaveBeenCalled();
  expect(native.release).not.toHaveBeenCalled();
});

it("retains a failed native result rather than turning it into an absent task", async () => {
  native.lock.mockReturnValue(null);
  const pending = runWindowsUserTask(request);
  child.exitCode = 1;
  complete(Object.assign(new Error("task access denied"), { code: 1 }), "");
  await expect(pending).rejects.toThrow("task access denied");
});
