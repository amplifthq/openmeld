import { describe, expect, it } from "vitest";
import { withCapturedStdio } from "./helpers/fs";

describe("withCapturedStdio", () => {
  it("captures write overloads and invokes callbacks", async () => {
    let stdoutCallbackCalled = false;
    let stderrCallbackCalled = false;

    const { stdout, stderr } = await withCapturedStdio(() => {
      process.stdout.write("hello", () => {
        stdoutCallbackCalled = true;
      });
      process.stderr.write(Buffer.from("world"), "utf8", () => {
        stderrCallbackCalled = true;
      });
      return Promise.resolve();
    });

    expect(stdout).toBe("hello");
    expect(stderr).toBe("world");
    expect(stdoutCallbackCalled).toBe(true);
    expect(stderrCallbackCalled).toBe(true);
  });
});
