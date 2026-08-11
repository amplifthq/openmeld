import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { rerunCurrentCommandWithEnv } from "../src/command-entry-checks/rerun-current-command";

describe("rerun current command env continuity", () => {
  afterEach(() => {
    spawnMock.mockReset();
    Reflect.deleteProperty(process.env, "OPENMELD_CLI_CONTEXT_ID");
    Reflect.deleteProperty(process.env, "OPENMELD_AGENT_SESSION_ID");
  });

  it("rewrites OpenMeld-owned session continuity to OPENMELD_CLI_CONTEXT_ID only", async () => {
    process.env.OPENMELD_CLI_CONTEXT_ID = "runtime-session";
    process.env.OPENMELD_AGENT_SESSION_ID = "legacy-session";

    spawnMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: {
          env?: NodeJS.ProcessEnv;
        }
      ) => {
        const child = new EventEmitter() as EventEmitter & {
          once: EventEmitter["once"];
        };
        queueMicrotask(() => {
          child.emit("exit", 0, null);
        });
        return child;
      }
    );

    const exitCode = await rerunCurrentCommandWithEnv({
      argv: [process.execPath, "/tmp/openmeld-cli.js", "whoami"],
      env: {
        OPENMELD_AGENT_SESSION_ID: "legacy-from-input",
      },
    });

    expect(exitCode).toBe(0);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const spawnOptions = spawnMock.mock.calls[0]?.[2] as
      | {
          env?: NodeJS.ProcessEnv;
        }
      | undefined;

    expect(spawnOptions?.env?.OPENMELD_CLI_CONTEXT_ID).toBe("runtime-session");
    expect(spawnOptions?.env?.OPENMELD_AGENT_SESSION_ID).toBeUndefined();
  });
});
