import { describe, expect, it } from "vitest";
import type { ExecFileError, ExecFileFn } from "../src/main/cli/driver";
import { runSetup } from "../src/main/cli/setup";

function fakeExec(
  stdout: string,
  error: ExecFileError | null = null
): ExecFileFn {
  return (_file, _args, _options, callback) => {
    callback(error, stdout, "");
    return {};
  };
}

describe("runSetup", () => {
  it("reports completed when the stream ends with setup.complete", async () => {
    const stdout =
      '{"type":"result","code":"agents.enable.result","payload":{}}\n{"type":"result","code":"setup.complete","payload":{"lane":"prod"}}\n';
    const result = await runSetup({ exec: fakeExec(stdout) });
    expect(result.completed).toBe(true);
    expect(result.problem).toBeNull();
    expect(result.serviceGuidance).toBeNull();
  });

  it("reads service guidance from setup.complete", async () => {
    const stdout = [
      '{"type":"result","code":"setup.complete","payload":{"serviceGuidance":{"statusDescription":"OpenMeld Service is running in the background.","autoStartDescription":"OpenMeld Service is set to start automatically when you sign in.","disableAutoStartCommand":"openmeld service autostart disable","stopCommand":"openmeld service stop","stoppedLocalAgentsDescription":"Local agents cannot be activated until OpenMeld Service starts again."}}}',
      "",
    ].join("\n");

    const result = await runSetup({ exec: fakeExec(stdout) });

    expect(result.completed).toBe(true);
    expect(result.serviceGuidance).toEqual({
      autoStartDescription:
        "OpenMeld Service is set to start automatically when you sign in.",
      disableAutoStartCommand: "openmeld service autostart disable",
      statusDescription: "OpenMeld Service is running in the background.",
      stopCommand: "openmeld service stop",
      stoppedLocalAgentsDescription:
        "Local agents cannot be activated until OpenMeld Service starts again.",
    });
  });

  it("reports a problem when setup.complete never arrives", async () => {
    const result = await runSetup({
      exec: fakeExec('{"code":"command.entry.sign_in.blocked"}\n'),
    });
    expect(result.completed).toBe(false);
    expect(result.problem).not.toBeNull();
    expect(result.serviceGuidance).toBeNull();
  });

  it("reports a problem when setup fails to spawn", async () => {
    const error = Object.assign(new Error("spawn openmeld ENOENT"), {
      code: "ENOENT",
    });
    const result = await runSetup({ exec: fakeExec("", error) });
    expect(result.completed).toBe(false);
    expect(result.problem).not.toBeNull();
    expect(result.serviceGuidance).toBeNull();
  });

  it("surfaces the exact local computer issue instead of a generic setup error", async () => {
    const stdout = `${JSON.stringify({
      type: "error",
      code: "local_machine.storage.exhausted",
      message:
        "Your computer is out of storage space. OpenMeld can't save the local files it needs. Free up storage, then try again.",
      payload: {
        localMachineIssue: {
          schemaVersion: 1,
          code: "local_machine.storage.exhausted",
          operation: "create_lock",
          recoveryPolicy: "user_action",
          summary:
            "Your computer is out of storage space. OpenMeld can't save the local files it needs.",
          primaryAction: "Free up storage, then try again.",
          diagnostics: {
            systemCode: "ENOSPC",
            detail: "no space left on device",
          },
        },
      },
    })}\n`;
    const error = Object.assign(new Error("setup failed"), { code: 1 });

    const result = await runSetup({ exec: fakeExec(stdout, error) });

    expect(result).toEqual({
      completed: false,
      problem: {
        kind: "cli_error",
        code: "local_machine.storage.exhausted",
        message:
          "Your computer is out of storage space. OpenMeld can't save the local files it needs. Free up storage, then try again.",
        requestId: null,
      },
      serviceGuidance: null,
    });
  });
});
