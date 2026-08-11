import { mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emitDaemonLifecycleEvent,
  formatDaemonLifecycleOriginSummary,
  readRecentDaemonLifecycleEvents,
  resolveRecentDaemonSignalStopCause,
  runWithDaemonLifecycleCommandJournal,
} from "../src/local-service/lifecycle/daemon-lifecycle-journal";

describe("local service lifecycle journal presentation", () => {
  it("uses plain OpenMeld Service wording for unknown lifecycle intent", () => {
    const summary = formatDaemonLifecycleOriginSummary({
      schema: "openmeld-daemon-lifecycle-event-v1",
      v: 1,
      type: "lifecycle.command.end",
      timestamp: "2026-05-06T00:00:00.000Z",
      lane: "dev-local",
      intent: "unknown",
      command: "unknown",
      pid: 123,
      sessionId: null,
      result: "skipped",
    });

    expect(summary).toBe(
      "skipped OpenMeld Service task from unknown at 2026-05-06T00:00:00.000Z (pid 123)"
    );
    expect(summary).not.toContain("lifecycle action");
  });

  it("refuses to mutate the published production journal during tests", async () => {
    await expect(
      emitDaemonLifecycleEvent({
        type: "service_contract.write",
        result: "completed",
        pathInput: {
          env: {
            ...process.env,
            OPENMELD_HOME: "",
            OPENMELD_ENV_PRESET: "prod",
            NODE_ENV: "test",
          },
          homeDir: homedir(),
          argv: ["openmeld"],
        },
        metadata: {
          desiredState: "stopped",
          deviceId: "device-123",
          profileId: "agt_existing",
        },
      })
    ).rejects.toThrow(
      "Refusing to mutate OpenMeld Service lifecycle journal in the published production lane during tests."
    );
  });
});

async function createTemporaryOpenMeldPathInput() {
  const openMeldHome = await mkdtemp(
    join(tmpdir(), "openmeld-journal-uptime-test-")
  );
  return {
    argv: ["openmeld"],
    env: {
      ...process.env,
      OPENMELD_HOME: openMeldHome,
    },
    homeDir: openMeldHome,
  };
}

describe("daemon run begin uptime marker", () => {
  it("distinguishes user stop, controlled update, and service crash causes", async () => {
    const pathInput = await createTemporaryOpenMeldPathInput();

    await emitDaemonLifecycleEvent({
      command: "openmeld service stop",
      intent: "stop",
      pathInput,
      result: "started",
      type: "process_stop.action",
    });
    await emitDaemonLifecycleEvent({
      command: "openmeld service update",
      intent: "upgrade_reconcile",
      pathInput,
      result: "started",
      type: "process_stop.action",
    });
    await emitDaemonLifecycleEvent({
      pathInput,
      result: "failed",
      type: "daemon.crash",
    });

    const events = await readRecentDaemonLifecycleEvents({
      maxEntries: 10,
      pathInput,
    });
    expect(events.map((event) => event.stopCause)).toEqual([
      "user_stop",
      "controlled_service_update",
      "service_crash",
    ]);
    await expect(
      resolveRecentDaemonSignalStopCause({ pathInput })
    ).resolves.toBe("controlled_service_update");
  });

  it("stamps the begin event with processUptimeMs when opted in", async () => {
    const pathInput = await createTemporaryOpenMeldPathInput();

    await runWithDaemonLifecycleCommandJournal({
      command: "openmeld service run",
      intent: "run_background",
      includeProcessUptime: true,
      metadata: { detached: true, mode: "background" },
      pathInput,
      run: () => Promise.resolve("done"),
    });

    const events = await readRecentDaemonLifecycleEvents({
      maxEntries: 10,
      pathInput,
    });
    const begin = events.find(
      (event) => event.type === "lifecycle.command.begin"
    );
    expect(begin).toBeDefined();
    const uptimeMs = begin?.metadata?.processUptimeMs;
    // The marker recovers the process spawn moment for launchd-latency analysis:
    // it must be a real non-negative integer millisecond count.
    expect(typeof uptimeMs).toBe("number");
    expect(Number.isInteger(uptimeMs)).toBe(true);
    expect(uptimeMs as number).toBeGreaterThanOrEqual(0);
    // The opt-in marker is additive: the caller's metadata is preserved.
    expect(begin?.metadata).toMatchObject({
      detached: true,
      mode: "background",
    });
  });

  it("omits processUptimeMs when not opted in", async () => {
    const pathInput = await createTemporaryOpenMeldPathInput();

    await runWithDaemonLifecycleCommandJournal({
      command: "openmeld service stop",
      intent: "stop",
      metadata: { mode: "interactive" },
      pathInput,
      run: () => Promise.resolve("done"),
    });

    const events = await readRecentDaemonLifecycleEvents({
      maxEntries: 10,
      pathInput,
    });
    const begin = events.find(
      (event) => event.type === "lifecycle.command.begin"
    );
    expect(begin).toBeDefined();
    expect(begin?.metadata).not.toHaveProperty("processUptimeMs");
  });
});
