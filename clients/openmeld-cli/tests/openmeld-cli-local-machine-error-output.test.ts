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

    const humanOutput = stderr.join("");
    expect(humanOutput).toContain("OpenMeld couldn't finish");
    expect(humanOutput).toContain(
      "What happened: Your computer is out of storage space."
    );
    expect(humanOutput).toContain("Next: Free up storage, then try again.");
    expect(humanOutput).not.toContain("error:");
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

    const humanOutput = stderr.join("");
    expect(humanOutput).toContain("OpenMeld couldn't finish");
    expect(humanOutput).toContain(
      "What happened: OpenMeld found a local command lock left by an older version."
    );
    expect(humanOutput).toContain(
      "Next: Close any other OpenMeld commands, then run `openmeld repair local-state` and try again."
    );
    expect(humanOutput).not.toContain("/tmp/space-join.lock");
  });

  it("keeps technical detail out of Human View and preserves it in Agent View", async () => {
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
    const message =
      "OpenMeld couldn't update the background service. Run `openmeld setup` again. Detail: auth.unauthenticated; compatibilityFallback=false. For diagnostics, run `openmeld service status --view agent`.";

    await emitCliError({
      argv: ["setup"],
      effectiveView: "human",
      code: "prepare.refresh_service.failed",
      message,
      error: { requestId: "req-technical-detail" },
    });

    const humanOutput = stderr.join("");
    expect(humanOutput).toContain(
      "What happened: OpenMeld couldn't update the background service."
    );
    expect(humanOutput).toContain("Next: Run `openmeld setup` again.");
    expect(humanOutput).not.toContain("auth.unauthenticated");
    expect(humanOutput).not.toContain("compatibilityFallback");
    expect(humanOutput).not.toContain("For diagnostics");
    expect(humanOutput).not.toContain("req-technical-detail");

    stdout.length = 0;
    stderr.length = 0;
    await emitCliError({
      argv: ["setup", "--view", "agent"],
      effectiveView: "agent",
      code: "prepare.refresh_service.failed",
      message,
      error: { requestId: "req-technical-detail" },
    });

    expect(stdout.join("")).toContain("auth.unauthenticated");
    expect(stdout.join("")).toContain("compatibilityFallback=false");
    expect(stdout.join("")).toContain("req-technical-detail");
  });

  it("hides fallback network diagnostics from Human View", async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    await emitCliError({
      argv: ["setup"],
      effectiveView: "human",
      code: "prepare.verify_setup.failed",
      message:
        "OpenMeld couldn't check your setup. Try again. Last network error: fetch failed. Support code: verify_setup.readiness_unreachable.",
    });

    const humanOutput = stderr.join("");
    expect(humanOutput).toContain(
      "What happened: OpenMeld couldn't check your setup."
    );
    expect(humanOutput).toContain("Next: Try again.");
    expect(humanOutput).not.toContain("fetch failed");
    expect(humanOutput).not.toContain("verify_setup.readiness_unreachable");
  });
});
