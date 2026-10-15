import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installGrokBotTools } from "@openmeld/adapter-grok-bot";
import { createLocalExecutionSlots } from "@openmeld/local-service";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalAgentSetup } from "../src/local-service/execution-host/local-agent-setup";
import { withTempHome } from "./helpers/fs";

// Keep real receipts and execution admission. Downloads and account login are
// adapter boundaries; this suite must never install software or mint credentials.
vi.mock("@openmeld/adapter-grok-bot", () => ({
  installGrokBotTools: vi.fn(),
  loginManagedGrokBot: vi.fn(),
  readManagedGrokBotCandidate: vi.fn(async () => null),
  isManagedGrokBotSignedIn: vi.fn(async () => false),
  supportsGrokBotSetup: () => true,
}));
vi.mock("../src/agents/registry", () => ({
  listAgentTargetStates: async () => [],
  reconcileNewRunnableBuiltinAgentRegistrations: async () => undefined,
  manageAgentRegistrationInstallation: async () => undefined,
  setAgentRegistrationEnabled: async () => undefined,
}));

describe("local agent connection setup", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    false,
    true,
  ])("returns progress without waiting, deduplicates requests, and persists the outcome (failure=%s)", async (fail) => {
    await withTempHome(async (rootDir) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(installGrokBotTools).mockImplementation(async () => {
        await gate;
        if (fail) {
          throw new Error("Download unavailable");
        }
      });
      let refreshEntered!: () => void;
      const refreshing = new Promise<void>((resolve) => {
        refreshEntered = resolve;
      });
      let finishRefresh!: () => void;
      const refreshGate = new Promise<void>((resolve) => {
        finishRefresh = resolve;
      });
      const slots = createLocalExecutionSlots({
        limits: { globalConcurrency: 1, queueMax: 4 },
      });
      const setup = createLocalAgentSetup({
        rootDir,
        slots,
        refresh: async () => {
          refreshEntered();
          await refreshGate;
        },
        log: () => undefined,
      });
      const request = {
        operationId: randomUUID(),
        action: "install" as const,
        agentId: "grok-bot",
        operation: "setup",
      };
      try {
        const started = await setup.start(request);
        expect(started.operation?.status).toBe("running");
        expect(slots.getAdapterOperationStatus("grok-bot")).toBe(
          "operation_in_progress"
        );
        expect((await setup.start(request)).operation).toEqual(
          started.operation
        );
        await expect(
          setup.start({ ...request, operationId: randomUUID() })
        ).rejects.toThrow("Earlier setup");
        await expect(
          setup.start({ ...request, action: "login" })
        ).rejects.toThrow("different setup action");
        release();
        await refreshing;
        expect((await setup.state()).operation?.status).toBe(
          fail ? "failed" : "succeeded"
        );
        expect(slots.getAdapterOperationStatus("grok-bot")).toBe("available");
      } finally {
        release();
        finishRefresh();
        await expect
          .poll(() => slots.getAdapterOperationStatus("grok-bot"))
          .toBe("available");
      }
      expect((await setup.state()).operation?.status).toBe(
        fail ? "failed" : "succeeded"
      );
      expect(slots.getAdapterOperationStatus("grok-bot")).toBe("available");
      await setup.start(request);
      expect(installGrokBotTools).toHaveBeenCalledTimes(1);
    });
  });

  it("does not replay unfinished setup after a Host restart", async () => {
    await withTempHome(async (rootDir) => {
      const directory = join(rootDir, "connection-tools", "grok-bot");
      await mkdir(directory, { recursive: true });
      const request = { operationId: randomUUID(), action: "install" as const };
      await writeFile(
        join(directory, "setup.json"),
        JSON.stringify([
          { ...request, status: "running", message: "Installing" },
        ])
      );
      const setup = createLocalAgentSetup({
        rootDir,
        slots: createLocalExecutionSlots({
          limits: { globalConcurrency: 1, queueMax: 4 },
        }),
        refresh: async () => undefined,
        log: () => undefined,
      });
      expect((await setup.start(request)).operation?.status).toBe(
        "outcome_unknown"
      );
      await expect(
        setup.start({ ...request, operationId: randomUUID() })
      ).rejects.toThrow("Earlier setup");
      expect(installGrokBotTools).not.toHaveBeenCalled();
    });
  });
});
