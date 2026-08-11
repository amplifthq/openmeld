import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { daemonLifecycleJournalPath } from "../src/config/daemon-state";
import {
  emitDaemonLifecycleEvent,
  readLatestDaemonLifecycleOriginEvent,
  runDaemonServiceManagerAction,
} from "../src/local-service/lifecycle/daemon-lifecycle-journal";

async function createTemporaryOpenMeldPathInput() {
  const openMeldHome = await mkdtemp(join(tmpdir(), "openmeld-journal-test-"));
  return {
    argv: ["openmeld"],
    env: {
      ...process.env,
      OPENMELD_HOME: openMeldHome,
    },
    homeDir: openMeldHome,
  };
}

describe("route catalog initial load lifecycle events", () => {
  it("writes route_catalog.initial_load events with phase timings", async () => {
    const pathInput = await createTemporaryOpenMeldPathInput();

    await emitDaemonLifecycleEvent({
      type: "route_catalog.initial_load",
      result: "completed",
      command: "openmeld service run",
      intent: "run_foreground",
      metadata: {
        durationMs: 1234,
        phaseTimings: {
          candidateResolveMs: 400,
          profilesListMs: 300,
          projectionRepairMs: 500,
          workspaceRepairMs: 34,
        },
        profileCount: 3,
        skippedProfileCount: 1,
      },
      pathInput,
    });

    const journalContent = await readFile(
      daemonLifecycleJournalPath(pathInput),
      "utf8"
    );
    const lines = journalContent
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(event.type).toBe("route_catalog.initial_load");
    expect(event.result).toBe("completed");
    expect(event.metadata).toMatchObject({
      durationMs: 1234,
      profileCount: 3,
      skippedProfileCount: 1,
    });
  });

  it("does not surface catalog load events as the latest lifecycle origin", async () => {
    const pathInput = await createTemporaryOpenMeldPathInput();

    await emitDaemonLifecycleEvent({
      type: "route_catalog.initial_load",
      result: "started",
      command: "openmeld service run",
      intent: "run_foreground",
      pathInput,
    });

    // Status surfaces show the latest origin event; instrumentation events
    // must stay diagnostic-only and never replace command/contract origins.
    await expect(
      readLatestDaemonLifecycleOriginEvent({ pathInput })
    ).resolves.toBeNull();
  });

  it("writes service manager action events with duration timing", async () => {
    const pathInput = await createTemporaryOpenMeldPathInput();
    const dateNowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1175);

    try {
      await runDaemonServiceManagerAction({
        action: "wait_running",
        command: "openmeld service run",
        controller: "launchd",
        intent: "run_background",
        pathInput,
        run: async () => undefined,
      });
    } finally {
      dateNowSpy.mockRestore();
    }

    const journalContent = await readFile(
      daemonLifecycleJournalPath(pathInput),
      "utf8"
    );
    const lines = journalContent
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(event.type).toBe("service_manager.action");
    expect(event.result).toBe("completed");
    expect(event.metadata).toMatchObject({
      action: "wait_running",
      controller: "launchd",
      durationMs: 175,
    });
  });

  it("records error-derived job evidence on failed wait_running actions", async () => {
    const pathInput = await createTemporaryOpenMeldPathInput();
    const timeoutError = new Error("startup wait timed out");

    await expect(
      runDaemonServiceManagerAction({
        action: "wait_running",
        command: "openmeld service run",
        controller: "launchd",
        intent: "run_background",
        pathInput,
        resolveErrorMetadata: (error) =>
          error === timeoutError
            ? {
                jobDiagnostics: {
                  controller: "launchd",
                  loaded: true,
                  runs: 0,
                  state: "not running",
                  lastExitCodeText: "(never exited)",
                  lastExitCode: null,
                  pendedNondemandSpawn: "speculative",
                  keepaliveRunAtLoad: true,
                },
              }
            : null,
        run: () => Promise.reject(timeoutError),
      })
    ).rejects.toThrow("startup wait timed out");

    const journalContent = await readFile(
      daemonLifecycleJournalPath(pathInput),
      "utf8"
    );
    const lines = journalContent
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] ?? "") as {
      metadata?: Record<string, unknown>;
      result?: string;
      type?: string;
    };
    expect(event.type).toBe("service_manager.action");
    expect(event.result).toBe("failed");
    expect(event.metadata).toMatchObject({
      action: "wait_running",
      controller: "launchd",
      errorMessage: "startup wait timed out",
      jobDiagnostics: {
        loaded: true,
        runs: 0,
        pendedNondemandSpawn: "speculative",
      },
    });
  });

  it("keeps the failure journal entry when evidence extraction itself throws", async () => {
    const pathInput = await createTemporaryOpenMeldPathInput();

    await expect(
      runDaemonServiceManagerAction({
        action: "wait_running",
        command: "openmeld service run",
        controller: "launchd",
        intent: "run_background",
        pathInput,
        resolveErrorMetadata: () => {
          throw new Error("extractor exploded");
        },
        run: () => Promise.reject(new Error("startup wait timed out")),
      })
    ).rejects.toThrow("startup wait timed out");

    const journalContent = await readFile(
      daemonLifecycleJournalPath(pathInput),
      "utf8"
    );
    const lines = journalContent
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] ?? "") as {
      metadata?: Record<string, unknown>;
      result?: string;
    };
    expect(event.result).toBe("failed");
    expect(event.metadata).toMatchObject({
      action: "wait_running",
      errorMessage: "startup wait timed out",
    });
    expect(event.metadata).not.toHaveProperty("jobDiagnostics");
  });
});
