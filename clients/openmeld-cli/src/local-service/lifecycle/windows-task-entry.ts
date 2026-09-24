import { Console } from "node:console";
import { openSync, realpathSync, writeSync } from "node:fs";
import { Writable } from "node:stream";
import { windowsUserTaskActionSchema } from "@openmeld/schemas";
import { WINDOWS_TASK_ARGUMENT } from "./windows-task-command";

// Run before importing business modules: they must see the registered lane and
// log descriptors. Task Scheduler supervises this process directly; there is no
// child process or stream-copy thread between it and the Service exit status.
export function initializeWindowsTaskEntry(): void {
  const args = process.argv.slice(2);
  const index = args.indexOf(WINDOWS_TASK_ARGUMENT);
  if (index === -1) {
    return;
  }
  if (process.platform !== "win32" || index !== args.length - 2) {
    throw new Error("Invalid Windows task invocation.");
  }
  const action = windowsUserTaskActionSchema.parse(
    JSON.parse(Buffer.from(args[index + 1] ?? "", "base64").toString("utf8"))
  );
  if (
    realpathSync.native(action.executable).toLowerCase() !==
      realpathSync.native(process.execPath).toLowerCase() ||
    JSON.stringify(args.slice(0, index)) !== JSON.stringify(action.args)
  ) {
    throw new Error("The Windows task envelope does not match this process.");
  }
  for (const [key, value] of Object.entries(action.env)) {
    process.env[key] = value;
  }
  const fd = openSync(action.logPath, "a");
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        let offset = 0;
        while (offset < chunk.length) {
          const written = writeSync(fd, chunk, offset, chunk.length - offset);
          if (written === 0) {
            throw new Error("Windows task log write made no progress.");
          }
          offset += written;
        }
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
  // Explicit descriptors are also inherited by the private Execution Host and
  // maintenance subprocesses. Keep them open until the OS closes this process.
  Object.defineProperty(output, "fd", { value: fd });
  Object.defineProperty(output, "isTTY", { value: false });
  Object.defineProperty(process, "stdout", {
    value: output,
    configurable: true,
  });
  Object.defineProperty(process, "stderr", {
    value: output,
    configurable: true,
  });
  globalThis.console = new Console({
    stdout: output,
    stderr: output,
    ignoreErrors: false,
  });
  process.argv.splice(index + 2, 2);
}
