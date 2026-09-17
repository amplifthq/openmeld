import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runOpenMeldToolsUpgradeProcess } from "../src/local-service/maintenance/openmeld-tools-upgrade-process";
import { withCapturedStdio } from "./helpers/fs";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock("../src/runtime/distribution", () => ({
  isBinaryDistribution: () => true,
}));

vi.mock("../src/local-components/managed-install", () => ({
  readManagedCliInstallation: () =>
    Promise.resolve({
      binaryPath: "/opt/openmeld/versions/99.0.0/openmeld",
      version: "99.0.0",
    }),
}));

describe("OpenMeld Tools upgrade process", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("tees worker logs and returns the final typed failure frame", async () => {
    const frame = JSON.stringify({
      detail: "binary download stopped at /private/local/path",
      failureCode: "cli.update.download_stalled",
      schema: "openmeld-tools-update-process-failure-v1",
      v: 1,
    });
    spawnMock.mockImplementationOnce(() =>
      createChildProcess({
        exitCode: 1,
        stderr: "worker diagnostic\n",
        stdout: `presenter output\n${frame}\n`,
      })
    );

    const forwarded = { stderr: "", stdout: "" };
    const captured = await withCapturedStdio(
      async () =>
        await runOpenMeldToolsUpgradeProcess(
          {
            operationId: "update-1",
            requestedAt: "2026-09-14T00:00:00.000Z",
            requestSource: "web",
            targetCliVersion: "0.3.105",
            targetServiceVersion: "0.3.104",
          },
          createCapturedOutputDependencies(forwarded)
        )
    );

    expect(captured.result).toEqual({
      exitCode: 1,
      processFailure: {
        detail: "binary download stopped at /private/local/path",
        failureCode: "cli.update.download_stalled",
      },
    });
    expect(captured.stdout).toBe("");
    expect(captured.stderr).toBe("");
    expect(forwarded.stdout).toContain("presenter output");
    expect(forwarded.stdout).toContain(frame);
    expect(forwarded.stderr).toContain("worker diagnostic");
    expect(spawnMock).toHaveBeenCalledWith(
      "/opt/openmeld/versions/99.0.0/openmeld",
      ["maintenance-upgrade"],
      expect.objectContaining({
        env: expect.objectContaining({
          OPENMELD_INTERNAL_MAINTENANCE_WORKER: "1",
          OPENMELD_INTERNAL_TOOLS_UPDATE_OPERATION_ID: "update-1",
          OPENMELD_INTERNAL_TOOLS_UPDATE_REQUEST_SOURCE: "web",
          OPENMELD_INTERNAL_TOOLS_UPDATE_TARGET_CLI_VERSION: "0.3.105",
          OPENMELD_INTERNAL_TOOLS_UPDATE_TARGET_SERVICE_VERSION: "0.3.104",
        }),
        stdio: ["ignore", "pipe", "pipe"],
      })
    );
  });

  it("leaves an older unframed child failure available for generic fallback", async () => {
    spawnMock.mockImplementationOnce(() =>
      createChildProcess({ exitCode: 1, stderr: "legacy failure\n" })
    );

    const forwarded = { stderr: "", stdout: "" };
    const captured = await withCapturedStdio(
      async () =>
        await runOpenMeldToolsUpgradeProcess(
          {
            operationId: "update-2",
            requestedAt: "2026-09-14T00:00:00.000Z",
            requestSource: "automatic",
          },
          createCapturedOutputDependencies(forwarded)
        )
    );

    expect(captured.result).toEqual({ exitCode: 1 });
    expect(forwarded.stderr).toContain("legacy failure");
  });

  it("keeps reading the terminal frame when log output is slow", async () => {
    const frame = JSON.stringify({
      detail: "download stopped",
      failureCode: "cli.update.download_stalled",
      schema: "openmeld-tools-update-process-failure-v1",
      v: 1,
    });
    spawnMock.mockImplementationOnce(() =>
      createChildProcess({
        exitCode: 1,
        stdout: ["first log line\n", "dropped log line\n", `${frame}\n`],
      })
    );
    const writeOutput = vi.fn(() => {
      // Intentionally never completes. The forwarder must not queue behind it.
    });

    await expect(
      runOpenMeldToolsUpgradeProcess(
        {
          operationId: "update-3",
          requestedAt: "2026-09-14T00:00:00.000Z",
          requestSource: "automatic",
        },
        {
          stderrFileDescriptor: 2,
          stdoutFileDescriptor: 1,
          writeOutput,
        }
      )
    ).resolves.toEqual({
      exitCode: 1,
      processFailure: {
        detail: "download stopped",
        failureCode: "cli.update.download_stalled",
      },
    });
    expect(writeOutput).toHaveBeenCalledOnce();
  });
});

function createCapturedOutputDependencies(output: {
  stderr: string;
  stdout: string;
}) {
  return {
    stderrFileDescriptor: 2,
    stdoutFileDescriptor: 1,
    writeOutput(
      fileDescriptor: number,
      chunk: Buffer,
      callback: (error: NodeJS.ErrnoException | null) => void
    ) {
      if (fileDescriptor === 1) {
        output.stdout += chunk.toString();
      } else {
        output.stderr += chunk.toString();
      }
      callback(null);
    },
  };
}

function createChildProcess(input: {
  exitCode: number;
  stderr?: string;
  stdout?: string | string[];
}): EventEmitter & { stderr: EventEmitter; stdout: EventEmitter } {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    stdout: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (input.stdout) {
      for (const stdout of Array.isArray(input.stdout)
        ? input.stdout
        : [input.stdout]) {
        child.stdout.emit("data", Buffer.from(stdout));
      }
    }
    if (input.stderr) {
      child.stderr.emit("data", Buffer.from(input.stderr));
    }
    child.emit("close", input.exitCode);
  });
  return child;
}
