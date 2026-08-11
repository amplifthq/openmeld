import { localMachineIssueAgentEventSchema } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenMeldLockError } from "../src/config/lock";
import { emitCliError } from "../src/openmeld-cli-error-output";
import { toLocalMachineFailureError } from "../src/system/local-machine-recovery";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("local machine CLI error output", () => {
  it("emits the shared LocalMachineIssue payload in Agent View", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    const error = toLocalMachineFailureError({
      operation: "create_lock",
      error: Object.assign(new Error("no space left on device"), {
        code: "ENOSPC",
      }),
    });

    await emitCliError({
      argv: ["setup", "--view", "agent"],
      effectiveView: "agent",
      code: error.code,
      message: error.message,
      error,
    });

    const structuredEvent = stdout
      .flatMap((chunk) => chunk.split("\n"))
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .find((line) => line?.code === "local_machine.storage.exhausted");

    expect(localMachineIssueAgentEventSchema.parse(structuredEvent)).toEqual({
      type: "error",
      code: "local_machine.storage.exhausted",
      message:
        "Your computer is out of storage space. OpenMeld can't save the local files it needs. Free up storage, then try again.",
      payload: {
        localMachineIssue: error.issue,
      },
    });
    expect(stdout.join("")).not.toContain("openmeld view human");

    await emitCliError({
      argv: ["setup"],
      effectiveView: "human",
      code: error.code,
      message: error.message,
      error,
    });

    expect(stderr.join("")).toBe(
      "error: Your computer is out of storage space. OpenMeld can't save the local files it needs. Free up storage, then try again.\n"
    );
  });

  it("adapts an orphaned legacy lock to the shared LocalMachineIssue contract", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    const error = new OpenMeldLockError({
      path: "/tmp/space-join.lock",
      key: "space-join",
      metaRaw: '{"pid":20012}',
      contentionState: "orphaned",
    });

    await emitCliError({
      argv: ["space", "join", "space-id", "--view", "agent"],
      effectiveView: "agent",
      code: error.code,
      message: error.message,
      error,
    });

    const structuredEvent = stdout
      .flatMap((chunk) => chunk.split("\n"))
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .find((line) => line?.code === "local_machine.concurrency.orphaned");

    expect(
      localMachineIssueAgentEventSchema.parse(structuredEvent)
    ).toMatchObject({
      type: "error",
      code: "local_machine.concurrency.orphaned",
      message:
        "OpenMeld found a local command lock left by an older version. Close any other OpenMeld commands, then run `openmeld repair local-state` and try again.",
      payload: {
        localMachineIssue: {
          operation: "create_lock",
          recoveryPolicy: "user_action",
        },
      },
    });
    expect(structuredEvent.message).not.toContain("/tmp/space-join.lock");
    expect(
      structuredEvent.payload.localMachineIssue.diagnostics.detail
    ).toContain("/tmp/space-join.lock");

    await emitCliError({
      argv: ["space", "join", "space-id"],
      effectiveView: "human",
      code: error.code,
      message: error.message,
      error,
    });

    expect(stderr.join("")).toBe(
      "error: OpenMeld found a local command lock left by an older version. Close any other OpenMeld commands, then run `openmeld repair local-state` and try again.\n"
    );
  });
});
