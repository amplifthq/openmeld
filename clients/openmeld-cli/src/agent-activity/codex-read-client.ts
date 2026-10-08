import { spawn } from "node:child_process";
import {
  buildCliLaunchInvocation,
  type RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";

const PROVIDER_DISCOVERY_TIMEOUT_MS = 30_000;
const MAX_JSON_RPC_LINE_BYTES = 8 * 1024 * 1024;
export function createCodexJsonRpcClient(
  launchContract: RuntimeAgentControllerLaunchContract
) {
  const invocation = buildCliLaunchInvocation({
    args: ["app-server", "--listen", "stdio://"],
    launchContract,
  });
  const child = spawn(invocation.bin, invocation.args, {
    env: process.env,
    shell: invocation.shell ?? false,
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  let nextId = 1;
  let buffer = "";
  let closed = false;
  const pending = new Map<
    number,
    {
      reject(error: unknown): void;
      resolve(value: unknown): void;
      timer: NodeJS.Timeout;
    }
  >();
  const rejectPending = (error: Error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer = consumeCodexJsonRpcChunk({
      buffer,
      chunk,
      kill: () => child.kill("SIGTERM"),
      pending,
      rejectPending,
    });
  });
  child.on("error", (error) => rejectPending(error));
  child.on("close", () => {
    closed = true;
    rejectPending(new Error("Codex app-server closed during discovery."));
  });
  return {
    close: async () => {
      if (closed) {
        return;
      }
      child.kill("SIGTERM");
      await new Promise<void>((resolveClose) => {
        const timer = setTimeout(resolveClose, 1000);
        child.once("close", () => {
          clearTimeout(timer);
          resolveClose();
        });
      });
    },
    notify: (method: string, params: unknown) => {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`
      );
    },
    request: (method: string, params: unknown): Promise<unknown> => {
      if (closed) {
        return Promise.reject(new Error("Codex app-server is closed."));
      }
      const id = nextId;
      nextId += 1;
      return new Promise((resolveRequest, rejectRequest) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectRequest(new Error(`Codex ${method} timed out.`));
        }, PROVIDER_DISCOVERY_TIMEOUT_MS);
        pending.set(id, {
          reject: rejectRequest,
          resolve: resolveRequest,
          timer,
        });
        child.stdin.write(
          `${JSON.stringify({ id, jsonrpc: "2.0", method, params })}\n`
        );
      });
    },
  };
}

function consumeCodexJsonRpcChunk(input: {
  buffer: string;
  chunk: string;
  kill(): void;
  pending: Map<
    number,
    {
      reject(error: unknown): void;
      resolve(value: unknown): void;
      timer: NodeJS.Timeout;
    }
  >;
  rejectPending(error: Error): void;
}): string {
  let buffer = input.buffer + input.chunk;
  if (Buffer.byteLength(buffer) > MAX_JSON_RPC_LINE_BYTES) {
    input.rejectPending(
      new Error("Codex app-server response exceeded its bound.")
    );
    input.kill();
    return "";
  }
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) {
      return buffer;
    }
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) {
      continue;
    }
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      input.rejectPending(new Error("Codex app-server returned invalid JSON."));
      input.kill();
      return "";
    }
    settleCodexJsonRpcResponse(message, input.pending);
  }
}

function settleCodexJsonRpcResponse(
  message: unknown,
  pending: Map<
    number,
    {
      reject(error: unknown): void;
      resolve(value: unknown): void;
      timer: NodeJS.Timeout;
    }
  >
): void {
  if (!isRecord(message) || typeof message.id !== "number") {
    return;
  }
  const request = pending.get(message.id);
  if (!request) {
    return;
  }
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (isRecord(message.error)) {
    request.reject(
      new Error(
        text(message.error.message) ?? "Codex app-server request failed."
      )
    );
    return;
  }
  request.resolve(message.result);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
