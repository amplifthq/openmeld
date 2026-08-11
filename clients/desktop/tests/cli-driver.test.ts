import { describe, expect, it } from "vitest";
import { type ExecFileFn, runCliJson } from "../src/main/cli/driver";

function fakeExec(opts: {
  stdout?: string;
  stderr?: string;
  error?:
    | (Error & {
        code?: string | number;
        killed?: boolean;
        signal?: string | null;
      })
    | null;
  capture?: (file: string, args: readonly string[]) => void;
}): ExecFileFn {
  return (file, args, _options, callback) => {
    opts.capture?.(file, args);
    callback(opts.error ?? null, opts.stdout ?? "", opts.stderr ?? "");
    return {};
  };
}

describe("runCliJson", () => {
  it("appends --json to the args and uses the resolved bin", async () => {
    let seenFile = "";
    let seenArgs: readonly string[] = [];
    await runCliJson({
      openMeldBin: "openmeld",
      args: ["service", "status"],
      exec: fakeExec({
        stdout: '{"schemaVersion":1,"type":"daemon.status"}',
        capture: (file, args) => {
          seenFile = file;
          seenArgs = args;
        },
      }),
    });
    expect(seenFile).toBe("openmeld");
    expect(seenArgs).toEqual(["service", "status", "--json"]);
  });

  it("resolves a success envelope", async () => {
    const result = await runCliJson({
      openMeldBin: "openmeld",
      args: ["service", "status"],
      exec: fakeExec({
        stdout: '{"schemaVersion":1,"type":"daemon.status","status":"running"}',
      }),
    });
    expect(result.ok).toBe(true);
  });

  it("maps a non-numeric error code (ENOENT) to spawn_failed", async () => {
    const error = Object.assign(new Error("spawn openmeld ENOENT"), {
      code: "ENOENT",
    });
    const result = await runCliJson({
      openMeldBin: "openmeld",
      args: ["service", "status"],
      exec: fakeExec({ error, stderr: "" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("spawn_failed");
    }
  });

  it("maps a killed process (timeout/maxBuffer) to timed_out, not spawn_failed", async () => {
    // node kills the child on timeout/maxBuffer: killed=true, code is null/string.
    const error = Object.assign(new Error("Command failed: timeout"), {
      killed: true,
      signal: "SIGTERM",
    });
    const result = await runCliJson({
      openMeldBin: "openmeld",
      args: ["service", "status"],
      exec: fakeExec({ error, stdout: "partial output without envelope" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("timed_out");
    }
  });

  it("maps a numeric non-zero exit carrying an error envelope to cli_error", async () => {
    const error = Object.assign(new Error("exited 1"), { code: 1 });
    const result = await runCliJson({
      openMeldBin: "openmeld",
      args: ["service", "start"],
      exec: fakeExec({
        error,
        stdout:
          '{"schemaVersion":1,"type":"error","error":{"code":"x","message":"y"}}',
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("cli_error");
      expect(result.exitCode).toBe(1);
    }
  });
});
