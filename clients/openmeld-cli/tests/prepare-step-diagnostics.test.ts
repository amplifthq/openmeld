import { prepareStepDiagnosticsBundleSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  collectPrepareStepDiagnostics,
  OPENMELD_NO_DIAGNOSTICS_ENV,
  PREPARE_STEP_DIAGNOSTICS_PAYLOAD_MAX_CHARS,
  type PrepareStepDiagnosticsSources,
  serializeBoundedPrepareStepDiagnostics,
} from "../src/commands/prepare-step-diagnostics";
import type { DaemonLifecycleEvent } from "../src/local-service/lifecycle/daemon-lifecycle-journal";

const BUNDLE_WHITELIST_KEYS = new Set([
  "bundleVersion",
  "collectedAt",
  "supportCode",
  "stepId",
  "deviceId",
  "cliVersion",
  "os",
  "inventoryAnomalies",
  "serviceJob",
  "lifecycleJournalTail",
  "serviceLogTail",
  "serviceLogNote",
  "collectionErrors",
  "truncated",
]);

function buildJournalEvent(
  overrides: Partial<DaemonLifecycleEvent> = {}
): DaemonLifecycleEvent {
  return {
    schema: "openmeld-daemon-lifecycle-event-v1",
    v: 1,
    type: "service_manager.action",
    timestamp: "2026-07-02T10:42:00.000Z",
    lane: "prod",
    intent: "setup",
    command: "openmeld setup",
    pid: 4242,
    sessionId: null,
    result: "failed",
    ...overrides,
  };
}

function buildSources(
  overrides: PrepareStepDiagnosticsSources = {}
): PrepareStepDiagnosticsSources {
  return {
    readLifecycleJournalTail: () => Promise.resolve([buildJournalEvent()]),
    readServiceLogTail: () =>
      Promise.resolve({ lines: ["error: connection refused"], note: null }),
    readInventoryAnomalyCodes: () => Promise.resolve(["runtime_stale"]),
    readServiceJobDiagnostics: () =>
      Promise.resolve({
        controller: "launchd" as const,
        loaded: true,
        runs: 0,
        state: null,
        lastExitCodeText: "(never exited)",
        lastExitCode: null,
        pendedNondemandSpawn: "speculative",
        keepaliveRunAtLoad: true,
      }),
    readDeviceId: () => Promise.resolve("device-abc"),
    ...overrides,
  };
}

describe("collectPrepareStepDiagnostics", () => {
  it("collects a whitelist-only bundle from OpenMeld-owned sources", async () => {
    const serialized = await collectPrepareStepDiagnostics({
      stepId: "refresh_service",
      supportCode: "prepare.refresh_service.failed",
      env: {},
      sources: buildSources(),
    });

    expect(serialized).not.toBeNull();
    const bundle = JSON.parse(serialized ?? "") as Record<string, unknown>;
    for (const key of Object.keys(bundle)) {
      expect(BUNDLE_WHITELIST_KEYS.has(key)).toBe(true);
    }
    expect(bundle.bundleVersion).toBe(2);
    expect(bundle.supportCode).toBe("prepare.refresh_service.failed");
    expect(bundle.stepId).toBe("refresh_service");
    expect(bundle.deviceId).toBe("device-abc");
    expect(bundle.inventoryAnomalies).toEqual(["runtime_stale"]);
    expect(bundle.serviceLogTail).toEqual(["error: connection refused"]);
    expect(bundle.serviceLogNote).toBeUndefined();
    expect(bundle.collectionErrors).toEqual([]);
    expect(bundle.truncated).toBe(false);
    expect((bundle.serviceJob as { runs: number }).runs).toBe(0);
    expect(prepareStepDiagnosticsBundleSchema.safeParse(bundle).success).toBe(
      true
    );
  });

  it("keeps whitelisted lifecycle metadata keys and drops the rest", async () => {
    const serialized = await collectPrepareStepDiagnostics({
      stepId: "refresh_service",
      supportCode: "prepare.refresh_service.failed",
      env: {},
      sources: buildSources({
        readLifecycleJournalTail: () =>
          Promise.resolve([
            buildJournalEvent({
              metadata: {
                action: "wait_running",
                ok: false,
                errorMessage: "launchd timed out",
                jobDiagnostics: { controller: "launchd", runs: 0 },
                durationMs: 2000,
                reason: "startup_timeout",
                controller: "launchd",
                pendedNondemandSpawn: "speculative",
                index: 7,
              },
            }),
          ]),
      }),
    });

    expect(serialized).not.toBeNull();
    const bundle = JSON.parse(serialized ?? "") as {
      lifecycleJournalTail: { metadata?: Record<string, unknown> }[];
    };
    const metadata = bundle.lifecycleJournalTail[0]?.metadata ?? {};
    // The two highest-value fields survive verbatim...
    expect(metadata.errorMessage).toBe("launchd timed out");
    expect(metadata.jobDiagnostics).toEqual({ controller: "launchd", runs: 0 });
    // ...alongside the rest of the whitelist, and nothing else.
    expect(metadata).toEqual({
      action: "wait_running",
      ok: false,
      errorMessage: "launchd timed out",
      jobDiagnostics: { controller: "launchd", runs: 0 },
      durationMs: 2000,
      reason: "startup_timeout",
    });
    expect(metadata).not.toHaveProperty("controller");
    expect(metadata).not.toHaveProperty("pendedNondemandSpawn");
    expect(metadata).not.toHaveProperty("index");
  });

  it("preserves errorMessage while shedding heavy jobDiagnostics when an entry overflows", async () => {
    const heavyJobDiagnostics = {
      controller: "launchd",
      probe: Array.from({ length: 30 }, (_, index) => `check ${index} ok`),
    };
    const errorMessage =
      "OpenMeld Service failed to reach a running local service state in time. runtime=unknown, reason=unknown, managerRunning=false, anomalies=service_runtime_stale";
    const serialized = await collectPrepareStepDiagnostics({
      stepId: "refresh_service",
      supportCode: "prepare.refresh_service.failed",
      env: {},
      sources: buildSources({
        readLifecycleJournalTail: () =>
          Promise.resolve([
            buildJournalEvent({
              metadata: {
                action: "wait_running",
                durationMs: 15_000,
                errorMessage,
                jobDiagnostics: heavyJobDiagnostics,
                controller: "launchd",
              },
            }),
          ]),
      }),
    });

    expect(serialized).not.toBeNull();
    const bundle = JSON.parse(serialized ?? "") as {
      lifecycleJournalTail: { metadata?: Record<string, unknown> }[];
    };
    const metadata = bundle.lifecycleJournalTail[0]?.metadata ?? {};
    expect(metadata.errorMessage).toContain(
      "failed to reach a running local service state"
    );
    // The heaviest structured field is shed, with an explicit truncation mark.
    expect(metadata).not.toHaveProperty("jobDiagnostics");
    expect(metadata.truncated).toBe(true);
    // The bundle still validates (per-entry budget respected).
    expect(prepareStepDiagnosticsBundleSchema.safeParse(bundle).success).toBe(
      true
    );
  });

  it("marks a missing service log instead of an ambiguous empty tail", async () => {
    const serialized = await collectPrepareStepDiagnostics({
      stepId: "refresh_service",
      supportCode: "prepare.refresh_service.failed",
      env: {},
      sources: buildSources({
        readServiceLogTail: () =>
          Promise.resolve({ lines: [], note: "file_missing" as const }),
      }),
    });

    expect(serialized).not.toBeNull();
    const bundle = JSON.parse(serialized ?? "") as {
      serviceLogTail: unknown;
      serviceLogNote?: string;
      collectionErrors: string[];
    };
    expect(bundle.serviceLogTail).toBeNull();
    expect(bundle.serviceLogNote).toBe("file_missing");
    // A file that does not exist is not a collection failure.
    expect(bundle.collectionErrors).toEqual([]);
  });

  it("marks an empty service log distinctly from a missing one", async () => {
    const serialized = await collectPrepareStepDiagnostics({
      stepId: "refresh_service",
      supportCode: "prepare.refresh_service.failed",
      env: {},
      sources: buildSources({
        readServiceLogTail: () =>
          Promise.resolve({ lines: [], note: "file_empty" as const }),
      }),
    });

    expect(serialized).not.toBeNull();
    const bundle = JSON.parse(serialized ?? "") as {
      serviceLogTail: unknown;
      serviceLogNote?: string;
      collectionErrors: string[];
    };
    expect(bundle.serviceLogTail).toBeNull();
    expect(bundle.serviceLogNote).toBe("file_empty");
    expect(bundle.collectionErrors).toEqual([]);
  });

  it("includes the contract deviceId when available and omits it otherwise", async () => {
    const withDevice = await collectPrepareStepDiagnostics({
      stepId: "refresh_service",
      supportCode: "prepare.refresh_service.failed",
      env: {},
      sources: buildSources({
        readDeviceId: () => Promise.resolve("device-9f3c"),
      }),
    });
    const withDeviceBundle = JSON.parse(withDevice ?? "") as {
      deviceId?: string;
    };
    expect(withDeviceBundle.deviceId).toBe("device-9f3c");

    const withoutDevice = await collectPrepareStepDiagnostics({
      stepId: "refresh_service",
      supportCode: "prepare.refresh_service.failed",
      env: {},
      sources: buildSources({
        readDeviceId: () => Promise.resolve(null),
      }),
    });
    const withoutDeviceBundle = JSON.parse(withoutDevice ?? "") as Record<
      string,
      unknown
    >;
    expect(withoutDeviceBundle).not.toHaveProperty("deviceId");
    // A missing contract is a normal state, not a collection failure.
    expect(withoutDeviceBundle.collectionErrors).toEqual([]);
  });

  it("redacts service log credentials before returning diagnostics", async () => {
    const serialized = await collectPrepareStepDiagnostics({
      stepId: "refresh_service",
      supportCode: "prepare.refresh_service.failed",
      env: {},
      sources: buildSources({
        readServiceLogTail: () =>
          Promise.resolve({
            lines: ["Authorization: Bearer abc.def.ghi"],
            note: null,
          }),
      }),
    });

    expect(serialized).not.toBeNull();
    expect(serialized).not.toContain("abc.def.ghi");
    const bundle = JSON.parse(serialized ?? "") as { serviceLogTail: string[] };
    expect(bundle.serviceLogTail).toEqual(["Authorization: Bearer [redacted]"]);
  });

  it("returns null when OPENMELD_NO_DIAGNOSTICS=1 opts out", async () => {
    const serialized = await collectPrepareStepDiagnostics({
      stepId: "refresh_service",
      supportCode: "prepare.refresh_service.failed",
      env: { [OPENMELD_NO_DIAGNOSTICS_ENV]: "1" },
      sources: buildSources(),
    });

    expect(serialized).toBeNull();
  });

  it("keeps the bundle when individual sources fail", async () => {
    const serialized = await collectPrepareStepDiagnostics({
      stepId: "refresh_service",
      supportCode: "prepare.refresh_service.failed",
      env: {},
      sources: buildSources({
        readInventoryAnomalyCodes: () =>
          Promise.reject(new Error("inventory exploded /Users/felix/secret")),
        readServiceJobDiagnostics: () =>
          Promise.reject(new Error("launchctl failed")),
      }),
    });

    expect(serialized).not.toBeNull();
    const bundle = JSON.parse(serialized ?? "") as Record<string, unknown>;
    expect(bundle.inventoryAnomalies).toBeNull();
    expect(bundle.serviceJob).toBeNull();
    expect(bundle.collectionErrors).toEqual([
      "inventory_anomalies",
      "service_job",
    ]);
    // Failure text must not leak into the bundle.
    expect(serialized).not.toContain("secret");
  });

  it("caps the serialized payload and keeps the newest evidence", async () => {
    const longLine = "error: connection refused ".repeat(12);
    const serialized = await collectPrepareStepDiagnostics({
      stepId: "refresh_service",
      supportCode: "prepare.refresh_service.failed",
      env: {},
      sources: buildSources({
        readServiceLogTail: () =>
          Promise.resolve({
            lines: Array.from(
              { length: 200 },
              (_, index) => `${longLine} #${index}`
            ),
            note: null,
          }),
        readLifecycleJournalTail: () =>
          Promise.resolve(
            Array.from({ length: 50 }, (_, index) =>
              buildJournalEvent({
                metadata: { errorMessage: "x".repeat(900), index },
              })
            )
          ),
      }),
    });

    expect(serialized).not.toBeNull();
    expect((serialized ?? "").length).toBeLessThanOrEqual(
      PREPARE_STEP_DIAGNOSTICS_PAYLOAD_MAX_CHARS
    );
    const bundle = JSON.parse(serialized ?? "") as {
      serviceLogTail: string[];
      truncated: boolean;
    };
    expect(bundle.truncated).toBe(true);
    const lastLine = bundle.serviceLogTail.at(-1) ?? "";
    expect(lastLine).toContain("#199");
  });

  it("never throws even when every source rejects", async () => {
    const serialized = await collectPrepareStepDiagnostics({
      stepId: "verify_setup",
      supportCode: "prepare.verify_setup.failed",
      env: {},
      sources: buildSources({
        readLifecycleJournalTail: () => Promise.reject(new Error("nope")),
        readServiceLogTail: () => Promise.reject(new Error("nope")),
        readInventoryAnomalyCodes: () => Promise.reject(new Error("nope")),
        readServiceJobDiagnostics: () => Promise.reject(new Error("nope")),
        readDeviceId: () => Promise.reject(new Error("nope")),
      }),
    });

    expect(serialized).not.toBeNull();
    const bundle = JSON.parse(serialized ?? "") as {
      collectionErrors: string[];
    };
    expect(bundle.collectionErrors).toHaveLength(5);
  });

  it("keeps the daemon-run processUptimeMs begin marker through the whitelist", async () => {
    const serialized = await collectPrepareStepDiagnostics({
      stepId: "refresh_service",
      supportCode: "prepare.refresh_service.failed",
      env: {},
      sources: buildSources({
        readLifecycleJournalTail: () =>
          Promise.resolve([
            buildJournalEvent({
              type: "lifecycle.command.begin",
              intent: "run_background",
              command: "openmeld service run",
              result: "started",
              metadata: {
                processUptimeMs: 44_700,
                detached: true,
                mode: "background",
              },
            }),
          ]),
      }),
    });

    expect(serialized).not.toBeNull();
    const bundle = JSON.parse(serialized ?? "") as {
      lifecycleJournalTail: { metadata?: Record<string, unknown> }[];
    };
    const metadata = bundle.lifecycleJournalTail[0]?.metadata ?? {};
    // The launchd-latency marker is whitelisted, non-whitelisted keys are not.
    expect(metadata.processUptimeMs).toBe(44_700);
    expect(metadata).not.toHaveProperty("detached");
    expect(metadata).not.toHaveProperty("mode");
  });
});

describe("serializeBoundedPrepareStepDiagnostics", () => {
  it("drops both tails as a final size guarantee", () => {
    const serialized = serializeBoundedPrepareStepDiagnostics({
      bundleVersion: 2,
      collectedAt: "2026-07-02T10:42:00.000Z",
      supportCode: "prepare.refresh_service.failed",
      stepId: "refresh_service",
      cliVersion: "0.7.98",
      os: { platform: "darwin", release: "25.5.0" },
      inventoryAnomalies: [],
      serviceJob: null,
      lifecycleJournalTail: Array.from({ length: 400 }, () =>
        buildJournalEvent()
      ),
      serviceLogTail: Array.from({ length: 400 }, () => "x".repeat(300)),
      collectionErrors: [],
      truncated: false,
    });

    expect(serialized).not.toBeNull();
    expect((serialized ?? "").length).toBeLessThanOrEqual(
      PREPARE_STEP_DIAGNOSTICS_PAYLOAD_MAX_CHARS
    );
    const bundle = JSON.parse(serialized ?? "") as { truncated: boolean };
    expect(bundle.truncated).toBe(true);
  });
});
