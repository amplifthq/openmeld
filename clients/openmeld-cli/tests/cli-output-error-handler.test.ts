import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

const outputHandlerUrl = new URL(
  "../src/runtime/cli-output-error-handler.ts",
  import.meta.url
).href;

describe("CLI output error handling", () => {
  it("ends quietly when a pipeline consumer closes stdout", async () => {
    const result = await runOutputHandlerChild({
      closeStdout: true,
      script: `
        setTimeout(() => process.stdout.write("result\\n"), 50);
      `,
    });

    expect(result).toEqual({
      exitCode: 0,
      signal: null,
      stderr: "",
    });
  });

  it("preserves a real command failure when stdout is closed", async () => {
    const result = await runOutputHandlerChild({
      closeStdout: true,
      script: `
        process.exitCode = 7;
        setTimeout(() => process.stdout.write("failed result\\n"), 50);
      `,
    });

    expect(result).toEqual({
      exitCode: 7,
      signal: null,
      stderr: "",
    });
  });

  it("does not hide output failures other than a broken pipe", async () => {
    const result = await runOutputHandlerChild({
      closeStdout: false,
      script: `
        const error = Object.assign(new Error("output failed"), { code: "EIO" });
        setTimeout(() => process.stdout.emit("error", error), 50);
      `,
    });

    expect(result.exitCode).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stderr).toContain("output failed");
    expect(result.stderr).toContain("EIO");
  });

  it("installs one handler when the module is loaded repeatedly", async () => {
    const result = await runOutputHandlerChild({
      closeStdout: false,
      script: `
        for (let index = 0; index < 3; index += 1) {
          const reloaded = await import(
            ${JSON.stringify(outputHandlerUrl)} + "?reload=" + index
          );
          reloaded.installCliOutputErrorHandlers();
        }
        const counts = {
          stderr: process.stderr.listenerCount("error"),
          stdout: process.stdout.listenerCount("error"),
        };
        if (counts.stderr !== 1 || counts.stdout !== 1) {
          throw new Error("duplicate output handlers: " + JSON.stringify(counts));
        }
      `,
    });

    expect(result).toEqual({
      exitCode: 0,
      signal: null,
      stderr: "",
    });
  });
});

async function runOutputHandlerChild(input: {
  closeStdout: boolean;
  script: string;
}): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}> {
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      `
        import { installCliOutputErrorHandlers } from ${JSON.stringify(outputHandlerUrl)};
        installCliOutputErrorHandlers();
        ${input.script}
      `,
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  if (input.closeStdout) {
    child.stdout.destroy();
  } else {
    child.stdout.resume();
  }

  const [exitCode, signal] = (await once(child, "exit")) as [
    number | null,
    NodeJS.Signals | null,
  ];
  return { exitCode, signal, stderr };
}
