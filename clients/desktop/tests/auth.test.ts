import { describe, expect, it } from "vitest";
import { readAuthStatus, runSignOut } from "../src/main/cli/auth";
import type { ExecFileError, ExecFileFn } from "../src/main/cli/driver";

function fakeExec(
  stdout: string,
  error: ExecFileError | null = null,
  sink?: { args?: readonly string[] }
): ExecFileFn {
  return (_file, args, _options, callback) => {
    if (sink) {
      sink.args = args;
    }
    callback(error, stdout, "");
    return {};
  };
}

describe("readAuthStatus", () => {
  it("parses signedIn + email from the agent-view session line", async () => {
    const stdout =
      '{"type":"result","code":"auth.status.session","payload":{"signedIn":true,"user":{"email":"felix@openmeld.invalid"}}}\n';
    const view = await readAuthStatus({ exec: fakeExec(stdout) });
    expect(view.signedIn).toBe(true);
    expect(view.email).toBe("felix@openmeld.invalid");
    expect(view.problem).toBeNull();
  });

  it("returns signedIn:false when the session reports signed out", async () => {
    const stdout =
      'Some human noise\n{"code":"auth.status.session","payload":{"signedIn":false}}\n';
    const view = await readAuthStatus({ exec: fakeExec(stdout) });
    expect(view.signedIn).toBe(false);
    expect(view.email).toBeNull();
  });

  it("returns null + a problem when the auth read fails to spawn", async () => {
    const error = Object.assign(new Error("spawn openmeld ENOENT"), {
      code: "ENOENT",
    });
    const view = await readAuthStatus({ exec: fakeExec("", error) });
    expect(view.signedIn).toBeNull();
    expect(view.problem).not.toBeNull();
  });
});

describe("runSignOut", () => {
  it("runs `openmeld logout --view agent` and parses a cleared local session", async () => {
    const sink: { args?: readonly string[] } = {};
    const stdout = [
      '{"code":"auth.logout.cleanup","text":"Local sign-out cleanup finished for your local OpenMeld."}',
      '{"code":"auth.logout.cleared","text":"Signed out on this device."}',
    ].join("\n");

    const result = await runSignOut({ exec: fakeExec(stdout, null, sink) });

    expect(sink.args).toEqual(["logout", "--view", "agent"]);
    expect(result.localSession).toBe("cleared");
    expect(result.cleanup).toEqual({
      status: "finished",
      message: "Local sign-out cleanup finished for your local OpenMeld.",
    });
    expect(result.problem).toBeNull();
  });

  it("parses no-session logout as an explicit local signed-out result", async () => {
    const stdout =
      '{"code":"auth.logout.cleanup","text":"Local sign-out cleanup finished for your local OpenMeld."}\n{"code":"auth.logout.no_session","text":"No local sign-in session found."}\n';

    const result = await runSignOut({ exec: fakeExec(stdout) });

    expect(result.localSession).toBe("none");
    expect(result.cleanup.status).toBe("finished");
    expect(result.problem).toBeNull();
  });

  it("preserves cleanup warnings from the logout stream", async () => {
    const stdout =
      '{"code":"auth.logout.cleanup_warning","text":"Local sign-out cleanup needs attention: OpenMeld could not stop OpenMeld Service cleanly."}\n{"code":"auth.logout.cleared"}\n';

    const result = await runSignOut({ exec: fakeExec(stdout) });

    expect(result.localSession).toBe("cleared");
    expect(result.cleanup).toEqual({
      status: "warning",
      message:
        "Local sign-out cleanup needs attention: OpenMeld could not stop OpenMeld Service cleanly.",
    });
  });

  it("reports a problem when logout fails without any logout signal", async () => {
    const error = Object.assign(new Error("spawn openmeld ENOENT"), {
      code: "ENOENT",
    });

    const result = await runSignOut({ exec: fakeExec("", error) });

    expect(result.localSession).toBe("unknown");
    expect(result.problem).toMatchObject({
      code: "desktop.logout_unavailable",
      kind: "spawn_failed",
    });
  });
});
