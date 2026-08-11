import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPENCLAW_CLI_MAX_BUFFER_BYTES,
  OPENCLAW_CLI_TIMEOUT_MS,
} from "../src/provider-hosts/openclaw/official-cli";

const execFileAsyncMock = vi.hoisted(() => vi.fn());
const resolveOpenClawBinCandidatesMock = vi.hoisted(() => vi.fn());
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
  process,
  "platform"
);

vi.mock("node:child_process", () => ({
  execFile: Object.assign(() => undefined, {
    [Symbol.for("nodejs.util.promisify.custom")]: (...args: unknown[]) =>
      execFileAsyncMock(...args),
  }),
}));

vi.mock("@openmeld/adapter-openclaw", () => ({
  resolveOpenClawBinCandidates: (...args: unknown[]) =>
    resolveOpenClawBinCandidatesMock(...args),
}));

async function withMockedPlatform<T>(
  platform: NodeJS.Platform,
  callback: () => Promise<T>
): Promise<T> {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });

  try {
    return await callback();
  } finally {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, "platform", originalPlatformDescriptor);
    }
  }
}

describe("openclaw official cli", () => {
  beforeEach(() => {
    vi.resetModules();
    execFileAsyncMock.mockReset();
    resolveOpenClawBinCandidatesMock.mockReset();
    resolveOpenClawBinCandidatesMock.mockReturnValue(["/mock/bin/openclaw"]);
  });

  it("passes a bounded timeout to execFile", async () => {
    execFileAsyncMock.mockResolvedValue({
      stderr: "",
      stdout: '{"status":"ok"}',
    });

    const { fetchOpenClawGatewayHealth } = await import(
      "../src/provider-hosts/openclaw/official-cli"
    );

    await expect(
      fetchOpenClawGatewayHealth({
        cwd: "/tmp/openclaw-workdir",
      })
    ).resolves.toEqual({
      status: "ok",
    });

    expect(execFileAsyncMock).toHaveBeenCalledOnce();
    expect(execFileAsyncMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        cwd: "/tmp/openclaw-workdir",
        encoding: "utf8",
        env: process.env,
        maxBuffer: OPENCLAW_CLI_MAX_BUFFER_BYTES,
        timeout: OPENCLAW_CLI_TIMEOUT_MS,
      })
    );
  });

  it("surfaces a timeout-specific error when the openclaw process is killed by the timeout", async () => {
    execFileAsyncMock.mockRejectedValue(
      Object.assign(
        new Error("Command failed: /mock/bin/openclaw health --json\n"),
        {
          killed: true,
          signal: "SIGTERM",
          stderr: "",
          stdout: "",
        }
      )
    );

    const { fetchOpenClawGatewayHealth } = await import(
      "../src/provider-hosts/openclaw/official-cli"
    );

    await expect(fetchOpenClawGatewayHealth()).rejects.toThrow(
      "openclaw command timed out after 30000ms"
    );
  });

  it("surfaces timeout output when the openclaw process timed out after writing CLI output", async () => {
    execFileAsyncMock.mockRejectedValue(
      Object.assign(
        new Error("Command failed: /mock/bin/openclaw health --json\n"),
        {
          killed: true,
          signal: "SIGTERM",
          stderr: "partial output before timeout",
          stdout: "",
        }
      )
    );

    const { fetchOpenClawGatewayHealth } = await import(
      "../src/provider-hosts/openclaw/official-cli"
    );

    await expect(fetchOpenClawGatewayHealth()).rejects.toThrow(
      "openclaw command timed out after 30000ms: partial output before timeout"
    );
  });

  it("falls back to the Node sibling openclaw binary when PATH resolution is unavailable", async () => {
    const nodeSiblingOpenClawBin = "/mock/node-bin/openclaw";
    resolveOpenClawBinCandidatesMock.mockReturnValue([
      nodeSiblingOpenClawBin,
      "openclaw",
    ]);
    execFileAsyncMock.mockResolvedValue({
      stderr: "",
      stdout: '{"status":"ok"}',
    });

    const { fetchOpenClawGatewayHealth } = await import(
      "../src/provider-hosts/openclaw/official-cli"
    );

    await expect(fetchOpenClawGatewayHealth()).resolves.toEqual({
      status: "ok",
    });

    expect(execFileAsyncMock).toHaveBeenCalledWith(
      nodeSiblingOpenClawBin,
      ["health", "--json"],
      expect.any(Object)
    );
  });

  it("uses shell execution for Windows batch openclaw wrappers", async () => {
    resolveOpenClawBinCandidatesMock.mockReturnValue([
      "C:\\mock\\node-bin\\openclaw.cmd",
    ]);
    execFileAsyncMock.mockResolvedValue({
      stderr: "",
      stdout: '{"status":"ok"}',
    });

    await withMockedPlatform("win32", async () => {
      const { fetchOpenClawGatewayHealth } = await import(
        "../src/provider-hosts/openclaw/official-cli"
      );

      await expect(fetchOpenClawGatewayHealth()).resolves.toEqual({
        status: "ok",
      });
    });

    expect(execFileAsyncMock).toHaveBeenCalledOnce();
    expect(execFileAsyncMock.mock.calls[0]?.[0]).toBe(
      "C:\\mock\\node-bin\\openclaw.cmd"
    );
    expect(execFileAsyncMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        shell: true,
      })
    );
  });
});
