import type { ChildProcess } from "node:child_process";
import type { ExecutionHostChannel } from "./channel";
import { ExecutionHostError } from "./channel";

// Use inherited Node-compatible IPC with JSON serialization. Provider stdout is
// not a protocol channel; ordinary logs cannot become control messages.
export function childExecutionHostChannel(
  child: ChildProcess
): ExecutionHostChannel {
  return {
    connected: () => child.connected,
    send: (message, completed) => {
      child.send(message, (error) => completed(error ?? null));
    },
    onMessage: (listener) => {
      child.on("message", listener);
      return () => {
        child.off("message", listener);
      };
    },
    onDisconnect: (listener) => {
      let observed = false;
      const finish = (error?: Error) => {
        if (!observed) {
          observed = true;
          listener(error);
        }
      };
      const exited = (code: number | null, signal: NodeJS.Signals | null) => {
        finish(
          new Error(`Host process exited (${signal ?? code ?? "unknown"})`)
        );
      };
      child.on("disconnect", finish);
      child.on("exit", exited);
      // Spawn/send failures must not become unhandled EventEmitter errors.
      child.on("error", finish);
      return () => {
        child.off("disconnect", finish);
        child.off("exit", exited);
        child.off("error", finish);
      };
    },
  };
}

export function parentExecutionHostChannel(): ExecutionHostChannel {
  const send = process.send?.bind(process);
  if (!(send && process.connected)) {
    throw new ExecutionHostError(
      "host.inherited_channel_required",
      "The execution host requires its supervisor's inherited IPC channel."
    );
  }
  return {
    connected: () => process.connected === true,
    send: (message, completed) => {
      send(message, undefined, undefined, (error) => completed(error ?? null));
    },
    onMessage: (listener) => {
      process.on("message", listener);
      return () => {
        process.off("message", listener);
      };
    },
    onDisconnect: (listener) => {
      process.on("disconnect", listener);
      return () => {
        process.off("disconnect", listener);
      };
    },
  };
}
