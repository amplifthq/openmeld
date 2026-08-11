import { describe, expect, it } from "vitest";
import { defaultToolingCommandRunner } from "../src/tooling/command-runner.ts";

describe("defaultToolingCommandRunner", () => {
  it("passes an explicit environment to the child command", () => {
    const result = defaultToolingCommandRunner({
      args: [
        "exec",
        "node",
        "-e",
        "process.stdout.write(process.env.OPENMELD_TEST_EXECUTION_MODE ?? '')",
      ],
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENMELD_TEST_EXECUTION_MODE: "dev",
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("dev");
  });

  it("preserves Wrangler output larger than the Node spawnSync default buffer", () => {
    const outputSize = 2 * 1024 * 1024;
    const result = defaultToolingCommandRunner({
      args: [
        "exec",
        "node",
        "-e",
        `process.stdout.write("x".repeat(${String(outputSize)}))`,
      ],
      cwd: process.cwd(),
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toHaveLength(outputSize);
  });
});
