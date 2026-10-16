import { cliJsonOutputEnvelopeSchema } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/openmeld", () => {
  throw new Error("Native command graph must not load");
});

describe("unsupported Node startup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  it.each([
    "20.19.2",
    "26.0.0",
  ])("returns a valid error envelope before command loading on Node %s", async (node) => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const exit = vi.fn(() => {
      throw new Error("runtime rejected");
    });
    vi.stubGlobal("process", {
      ...process,
      versions: { ...process.versions, node },
      argv: ["node", "openmeld", "service", "status", "--json"],
      stdout: { write: stdout },
      stderr: { write: stderr },
      exit,
    });
    await expect(import("../src/openmeld-entry")).rejects.toThrow(
      "runtime rejected"
    );
    const envelope = cliJsonOutputEnvelopeSchema.parse(
      JSON.parse(String(stdout.mock.calls.at(0)?.at(0)))
    );
    expect(envelope).toMatchObject({
      type: "error",
      error: {
        code: "cli.node_unsupported",
        message: expect.stringContaining("Install Node.js 24"),
      },
    });
    expect(stderr).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
