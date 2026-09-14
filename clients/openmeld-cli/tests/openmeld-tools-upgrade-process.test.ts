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

    const captured = await withCapturedStdio(
      async () =>
        await runOpenMeldToolsUpgradeProcess({
          operationId: "update-1",
          requestedAt: "2026-09-14T00:00:00.000Z",
          requestSource: "web",
        })
    );

    expect(captured.result).toEqual({
      exitCode: 1,
      processFailure: {
        detail: "binary download stopped at /private/local/path",
        failureCode: "cli.update.download_stalled",
      },
    });
    expect(captured.stdout).toContain("presenter output");
    expect(captured.stdout).toContain(frame);
    expect(captured.stderr).toContain("worker diagnostic");
    expect(spawnMock).toHaveBeenCalledWith(
      "/opt/openmeld/versions/99.0.0/openmeld",
      ["maintenance-upgrade"],
      expect.objectContaining({
        env: expect.objectContaining({
          OPENMELD_INTERNAL_MAINTENANCE_WORKER: "1",
          OPENMELD_INTERNAL_TOOLS_UPDATE_OPERATION_ID: "update-1",
          OPENMELD_INTERNAL_TOOLS_UPDATE_REQUEST_SOURCE: "web",
        }),
        stdio: ["ignore", "pipe", "pipe"],
      })
    );
  });

  it("leaves an older unframed child failure available for generic fallback", async () => {
    spawnMock.mockImplementationOnce(() =>
      createChildProcess({ exitCode: 1, stderr: "legacy failure\n" })
    );

    const captured = await withCapturedStdio(
      async () =>
        await runOpenMeldToolsUpgradeProcess({
          operationId: "update-2",
          requestedAt: "2026-09-14T00:00:00.000Z",
          requestSource: "automatic",
        })
    );

    expect(captured.result).toEqual({ exitCode: 1 });
    expect(captured.stderr).toContain("legacy failure");
  });
});

function createChildProcess(input: {
  exitCode: number;
  stderr?: string;
  stdout?: string;
}): EventEmitter & { stderr: EventEmitter; stdout: EventEmitter } {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    stdout: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (input.stdout) {
      child.stdout.emit("data", Buffer.from(input.stdout));
    }
    if (input.stderr) {
      child.stderr.emit("data", Buffer.from(input.stderr));
    }
    child.emit("close", input.exitCode);
  });
  return child;
}
