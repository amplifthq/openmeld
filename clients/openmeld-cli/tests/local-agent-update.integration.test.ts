import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createLocalExecutionSlots } from "@openmeld/local-service";
import { describe, expect, it } from "vitest";
import { manageAgentRegistrationInstallation } from "../src/agents/registry";
import { setConfiguredDeviceRuntimeState } from "../src/config/runtime-config";
import { createLocalAgentUpdater } from "../src/local-service/execution-host/local-agent-update";
import { withTempHome } from "./helpers/fs";

async function fixture(home: string) {
  const bin = join(home, ".local/bin");
  const versions = join(home, ".local/share/claude/versions");
  await mkdir(bin, { recursive: true });
  await mkdir(versions, { recursive: true });
  const launcher = join(bin, "claude");
  const gate = join(home, "update-gate");
  await promisify(execFile)("/usr/bin/mkfifo", [gate]);
  const source = join(home, "controller.c");
  await writeFile(
    source,
    `#include <stdio.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "--version") == 0) { puts(VERSION " (Claude Code)"); return 0; }
  if (argc != 2 || strcmp(argv[1], "update") != 0) return 3;
  FILE *count = fopen("${home}/invocations", "a"); if (!count) return 4;
  fputs("update\\n", count); fclose(count);
  FILE *gate = fopen("${gate}", "r"); if (!gate) return 5;
  while (fgetc(gate) != EOF) {} fclose(gate);
  unlink("${launcher}");
  return symlink("${versions}/1.0.1", "${launcher}");
}`
  );
  for (const version of ["1.0.0", "1.0.1"]) {
    await promisify(execFile)("/usr/bin/cc", [
      source,
      `-DVERSION="${version}"`,
      "-o",
      join(versions, version),
    ]);
  }
  await symlink(join(versions, "1.0.0"), launcher);
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  process.env.OPENMELD_DAEMON_RUNTIME_CLAUDE_CODE_BIN = launcher;
  await setConfiguredDeviceRuntimeState({
    controllers: [
      {
        agentId: "claude-code",
        displayName: "Claude Code",
        enabled: true,
        launchContract: { kind: "executable", commandPath: launcher },
        registeredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  });
  const listed = await manageAgentRegistrationInstallation({
    agentId: "claude-code",
    operation: "list",
  });
  if (!listed.selectedInstallationId) {
    throw new Error("The native fixture was not selected.");
  }
  return { installationId: listed.selectedInstallationId, gate };
}

describe("local agent updates", () => {
  it("deduplicates requests, holds admission until the real process exits, and verifies the selected launcher", async () => {
    await withTempHome(async (home) => {
      const setup = await fixture(home);
      const slots = createLocalExecutionSlots({
        limits: { globalConcurrency: 1, queueMax: 4 },
      });
      let refreshed!: () => void;
      const completed = new Promise<void>((resolve) => {
        refreshed = resolve;
      });
      const updater = createLocalAgentUpdater({
        rootDir: join(home, "receipts"),
        slots,
        refresh: async () => refreshed(),
        log: () => undefined,
      });
      const request = {
        installationId: setup.installationId,
        operationId: randomUUID(),
      };
      const started = await updater.start("claude-code", request);
      try {
        expect(started.operation?.status).toBe("running");
        expect(slots.getAdapterOperationStatus("claude-code")).toBe(
          "operation_in_progress"
        );
        expect((await updater.start("claude-code", request)).operation).toEqual(
          started.operation
        );
        await expect(
          updater.start("claude-code", {
            ...request,
            operationId: randomUUID(),
          })
        ).rejects.toThrow("earlier update");
      } finally {
        await writeFile(setup.gate, "continue\n");
        await completed;
      }
      const result = await updater.state("claude-code");
      expect(result.operation).toMatchObject({
        status: "succeeded",
        beforeVersion: "1.0.0",
        afterVersion: "1.0.1",
      });
      expect(await readFile(join(home, "invocations"), "utf8")).toBe(
        "update\n"
      );
      expect((await updater.start("claude-code", request)).operation).toEqual(
        result.operation
      );
    });
  });

  it("rejects busy work and a stale installation without starting the updater", async () => {
    await withTempHome(async (home) => {
      const setup = await fixture(home);
      const slots = createLocalExecutionSlots({
        limits: { globalConcurrency: 1, queueMax: 4 },
      });
      let release!: () => void;
      const work = new Promise<void>((resolve) => {
        release = resolve;
      });
      slots.request({
        adapterId: "claude-code",
        attemptId: "attempt",
        controllerKey: "controller",
        dispatchId: "dispatch",
        localExecutionLaneKey: "lane",
        profileId: "profile",
        spaceId: null,
        targetLabel: "Claude",
        taskId: "task",
        transportMode: null,
        run: async () => {
          await work;
          return undefined;
        },
      });
      const updater = createLocalAgentUpdater({
        rootDir: join(home, "receipts"),
        slots,
        refresh: async () => undefined,
        log: () => undefined,
      });
      try {
        await expect(
          updater.start("claude-code", {
            installationId: setup.installationId,
            operationId: randomUUID(),
          })
        ).rejects.toThrow("work in progress");
        await expect(
          updater.start("claude-code", {
            installationId: "another-installation",
            operationId: randomUUID(),
          })
        ).rejects.toThrow("original installer");
        await expect(readFile(join(home, "invocations"))).rejects.toMatchObject(
          { code: "ENOENT" }
        );
      } finally {
        release();
      }
    });
  });

  it("does not replay an unfinished receipt after a Host restart", async () => {
    await withTempHome(async (home) => {
      const setup = await fixture(home);
      const rootDir = join(home, "receipts");
      const directory = join(rootDir, "local-agent-updates");
      await mkdir(directory, { recursive: true });
      const request = {
        installationId: setup.installationId,
        operationId: randomUUID(),
      };
      await writeFile(
        join(directory, "operations.json"),
        JSON.stringify([
          {
            ...request,
            status: "running",
            beforeVersion: "1.0.0",
            afterVersion: null,
            message: "Updating",
          },
        ])
      );
      const updater = createLocalAgentUpdater({
        rootDir,
        slots: createLocalExecutionSlots({
          limits: { globalConcurrency: 1, queueMax: 4 },
        }),
        refresh: async () => undefined,
        log: () => undefined,
      });
      expect((await updater.state("claude-code")).operation?.status).toBe(
        "outcome_unknown"
      );
      expect(
        (await updater.start("claude-code", request)).operation?.status
      ).toBe("outcome_unknown");
      await expect(
        updater.start("claude-code", { ...request, operationId: randomUUID() })
      ).rejects.toThrow("earlier update");
      await expect(readFile(join(home, "invocations"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });
});
