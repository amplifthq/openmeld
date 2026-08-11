import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveDaemonServiceRuntimeMetadataMock = vi.fn();
const resolveDaemonServiceManagerMock = vi.fn();
const withRegistrationMutationLockMock = vi.fn(
  async <T>(callback: () => Promise<T>) => await callback()
);
const readRegistrationRepairStateMock = vi.fn();
const markRegistrationRepairPendingMock = vi.fn(async () => undefined);
const clearRegistrationRepairPendingMock = vi.fn(async () => undefined);
const emitDaemonLifecycleEventMock = vi.fn(
  async (_event: {
    type: string;
    result: string;
    metadata?: Record<string, unknown>;
  }) => undefined
);
const ensureDaemonSystemServiceCommandFilesMock = vi.fn(async () => undefined);
const buildDaemonSystemServiceCommandSpecMock = vi.fn(() => ({
  executable: "/bin/sh",
  args: ["service", "run", "--mode", "foreground"],
  env: {},
}));

vi.mock("../src/config/daemon-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config/daemon-state")>()),
  resolveDaemonServiceRuntimeMetadata: (
    ...args: Parameters<typeof resolveDaemonServiceRuntimeMetadataMock>
  ) => resolveDaemonServiceRuntimeMetadataMock(...args),
  withDaemonServiceRegistrationMutationLock: (
    ...args: Parameters<typeof withRegistrationMutationLockMock>
  ) => withRegistrationMutationLockMock(...args),
}));

vi.mock(
  "../src/local-service/lifecycle/daemon-service-registration-repair-state",
  () => ({
    clearDaemonServiceRegistrationRepairPending: (
      ...args: Parameters<typeof clearRegistrationRepairPendingMock>
    ) => clearRegistrationRepairPendingMock(...args),
    markDaemonServiceRegistrationRepairPending: (
      ...args: Parameters<typeof markRegistrationRepairPendingMock>
    ) => markRegistrationRepairPendingMock(...args),
    readDaemonServiceRegistrationRepairState: (
      ...args: Parameters<typeof readRegistrationRepairStateMock>
    ) => readRegistrationRepairStateMock(...args),
  })
);

vi.mock(
  "../src/local-service/lifecycle/daemon-service-manager",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/local-service/lifecycle/daemon-service-manager")
    >()),
    resolveDaemonServiceManager: (
      ...args: Parameters<typeof resolveDaemonServiceManagerMock>
    ) => resolveDaemonServiceManagerMock(...args),
  })
);

vi.mock(
  "../src/local-service/lifecycle/daemon-lifecycle-journal",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/local-service/lifecycle/daemon-lifecycle-journal")
    >()),
    emitDaemonLifecycleEvent: (
      ...args: Parameters<typeof emitDaemonLifecycleEventMock>
    ) => emitDaemonLifecycleEventMock(...args),
  })
);

vi.mock(
  "../src/local-service/lifecycle/daemon-service-command-spec",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/local-service/lifecycle/daemon-service-command-spec")
    >()),
    buildDaemonSystemServiceCommandSpec: (
      ...args: Parameters<typeof buildDaemonSystemServiceCommandSpecMock>
    ) => buildDaemonSystemServiceCommandSpecMock(...args),
    ensureDaemonSystemServiceCommandFiles: (
      ...args: Parameters<typeof ensureDaemonSystemServiceCommandFilesMock>
    ) => ensureDaemonSystemServiceCommandFilesMock(...args),
  })
);

import {
  journalDaemonStopSignalEvidence,
  resolveSupervisorRegistrationReconcileDecision,
  startDaemonServiceRegistrationReconcileLoop,
} from "../src/local-service/lifecycle/daemon-service-registration-reconcile";

function buildManagerMock(status: {
  installed: boolean;
  running?: boolean;
  enabled?: boolean;
}) {
  return {
    controller: "launchd" as const,
    install: vi.fn(async () => undefined),
    uninstall: vi.fn(async () => undefined),
    enableAutostart: vi.fn(async () => undefined),
    disableAutostart: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    deactivate: vi.fn(async () => undefined),
    status: vi.fn(async () => ({
      installed: status.installed,
      running: status.running ?? true,
      enabled: status.enabled ?? true,
    })),
    waitUntilAbsent: vi.fn(async () => undefined),
    waitUntilStopped: vi.fn(async () => undefined),
    waitUntilRunning: vi.fn(async () => undefined),
  };
}

function journaledResults(): string[] {
  return emitDaemonLifecycleEventMock.mock.calls.map(([event]) => event.result);
}

beforeEach(() => {
  readRegistrationRepairStateMock.mockResolvedValue(null);
  resolveDaemonServiceRuntimeMetadataMock.mockReturnValue({
    autoStart: true,
    managedBySystemService: true,
    serviceController: "launchd",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveSupervisorRegistrationReconcileDecision", () => {
  const presentObservation = { enabled: true, installed: true, running: true };
  const missingObservation = { enabled: true, installed: false, running: true };

  it("does nothing for an unsupervised daemon", () => {
    expect(
      resolveSupervisorRegistrationReconcileDecision({
        consecutiveRepairFailures: 0,
        managedBySystemService: false,
        observation: missingObservation,
        repairPending: false,
      })
    ).toEqual({ action: "none", reason: "not_supervised" });
  });

  it("skips when the status probe was unavailable", () => {
    expect(
      resolveSupervisorRegistrationReconcileDecision({
        consecutiveRepairFailures: 0,
        managedBySystemService: true,
        observation: null,
        repairPending: false,
      })
    ).toEqual({ action: "none", reason: "status_unavailable" });
  });

  it("does nothing while the registration is present", () => {
    expect(
      resolveSupervisorRegistrationReconcileDecision({
        consecutiveRepairFailures: 0,
        managedBySystemService: true,
        observation: presentObservation,
        repairPending: false,
      })
    ).toEqual({ action: "none", reason: "registration_present" });
  });

  it("respects an explicitly disabled registration when no repair is pending", () => {
    expect(
      resolveSupervisorRegistrationReconcileDecision({
        consecutiveRepairFailures: 0,
        managedBySystemService: true,
        observation: { enabled: false, installed: true, running: true },
        repairPending: false,
      })
    ).toEqual({ action: "none", reason: "registration_present" });
  });

  it("continues a known partial repair without overriding an initial explicit disable", () => {
    expect(
      resolveSupervisorRegistrationReconcileDecision({
        consecutiveRepairFailures: 1,
        managedBySystemService: true,
        observation: { enabled: false, installed: true, running: true },
        repairPending: true,
      })
    ).toEqual({ action: "repair", reason: "repair_incomplete" });
  });

  it("repairs a missing registration", () => {
    expect(
      resolveSupervisorRegistrationReconcileDecision({
        consecutiveRepairFailures: 0,
        managedBySystemService: true,
        observation: missingObservation,
        repairPending: false,
      })
    ).toEqual({ action: "repair", reason: "registration_missing" });
  });

  it("stops repairing after consecutive failures are exhausted", () => {
    expect(
      resolveSupervisorRegistrationReconcileDecision({
        consecutiveRepairFailures: 3,
        managedBySystemService: true,
        observation: missingObservation,
        repairPending: true,
      })
    ).toEqual({ action: "none", reason: "repair_exhausted" });
  });
});

describe("startDaemonServiceRegistrationReconcileLoop", () => {
  it("repairs a missing registration and journals the drift", async () => {
    const status = { installed: false };
    const manager = buildManagerMock(status);
    manager.install.mockImplementation(() => {
      status.installed = true;
      return Promise.resolve(undefined);
    });
    resolveDaemonServiceManagerMock.mockResolvedValue(manager);
    const stop = startDaemonServiceRegistrationReconcileLoop({
      intervalMs: 5,
      isStopRequested: () => false,
    });

    await vi.waitFor(() => {
      expect(manager.install).toHaveBeenCalled();
    });
    await stop();

    expect(ensureDaemonSystemServiceCommandFilesMock).toHaveBeenCalledWith({
      controller: "launchd",
    });
    expect(markRegistrationRepairPendingMock).toHaveBeenCalledWith("launchd");
    expect(clearRegistrationRepairPendingMock).toHaveBeenCalledOnce();
    expect(withRegistrationMutationLockMock).toHaveBeenCalledWith(
      expect.any(Function),
      {
        command: "OpenMeld Service registration reconcile",
        intent: "upgrade_reconcile",
      }
    );
    expect(journaledResults()).toContain("drift_detected");
    expect(journaledResults()).toContain("repaired");
  });

  it("keeps repairing its own partial definition after cleanup fails", async () => {
    const status = { enabled: false, installed: false };
    const manager = buildManagerMock(status);
    manager.install
      .mockImplementationOnce(() => {
        status.installed = true;
        readRegistrationRepairStateMock.mockResolvedValue({
          controller: "launchd",
          pendingSince: "2026-08-08T00:00:00.000Z",
        });
        return Promise.reject(
          new Error("new definition could not be removed during rollback")
        );
      })
      .mockImplementationOnce(() => {
        status.enabled = true;
        readRegistrationRepairStateMock.mockResolvedValue(null);
        return Promise.resolve(undefined);
      });
    resolveDaemonServiceManagerMock.mockResolvedValue(manager);
    const stop = startDaemonServiceRegistrationReconcileLoop({
      intervalMs: 5,
      isStopRequested: () => false,
    });

    try {
      await vi.waitFor(() => {
        expect(manager.install).toHaveBeenCalledTimes(2);
        expect(journaledResults()).toContain("repaired");
      });
    } finally {
      await stop();
    }
  });

  it("leaves a present registration untouched", async () => {
    const manager = buildManagerMock({ installed: true });
    resolveDaemonServiceManagerMock.mockResolvedValue(manager);
    const stop = startDaemonServiceRegistrationReconcileLoop({
      intervalMs: 5,
      isStopRequested: () => false,
    });

    await vi.waitFor(() => {
      expect(manager.status).toHaveBeenCalled();
    });
    await stop();

    expect(manager.install).not.toHaveBeenCalled();
    expect(emitDaemonLifecycleEventMock).not.toHaveBeenCalled();
  });

  it("warns with the real probe error when registration status is unavailable", async () => {
    const manager = buildManagerMock({ installed: true });
    manager.status.mockRejectedValue(
      new Error("launchctl registration probe was denied")
    );
    resolveDaemonServiceManagerMock.mockResolvedValue(manager);
    const onWarn = vi.fn();
    const stop = startDaemonServiceRegistrationReconcileLoop({
      intervalMs: 5,
      isStopRequested: () => false,
      onWarn,
    });

    await vi.waitFor(() => {
      expect(onWarn).toHaveBeenCalled();
    });
    await stop();

    expect(onWarn).toHaveBeenCalledWith(
      "supervisor registration status probe was unavailable; skipping this reconcile pass",
      {
        controller: "launchd",
        errorMessage: "launchctl registration probe was denied",
      }
    );
  });

  it("warns when a supervised registration manager is unavailable", async () => {
    resolveDaemonServiceManagerMock.mockResolvedValue(null);
    const onWarn = vi.fn();
    const stop = startDaemonServiceRegistrationReconcileLoop({
      intervalMs: 5,
      isStopRequested: () => false,
      onWarn,
    });

    await vi.waitFor(() => {
      expect(onWarn).toHaveBeenCalledWith(
        "supervisor registration manager was unavailable; skipping this reconcile pass",
        { controller: "launchd" }
      );
    });
    await stop();
  });

  it("journals every nested install and cleanup error from the manager", async () => {
    const manager = buildManagerMock({ installed: false });
    manager.install.mockRejectedValue(
      new AggregateError(
        [
          new Error("launchctl enable failed"),
          new AggregateError(
            [new Error("launchctl disable failed"), new Error("rm failed")],
            "rollback steps failed"
          ),
        ],
        "install and rollback failed"
      )
    );
    resolveDaemonServiceManagerMock.mockResolvedValue(manager);
    const stop = startDaemonServiceRegistrationReconcileLoop({
      intervalMs: 5,
      isStopRequested: () => false,
    });

    try {
      await vi.waitFor(() => {
        expect(emitDaemonLifecycleEventMock).toHaveBeenCalledWith(
          expect.objectContaining({
            result: "repair_failed",
            metadata: expect.objectContaining({
              errorMessages: [
                "install and rollback failed",
                "launchctl enable failed",
                "rollback steps failed",
                "launchctl disable failed",
                "rm failed",
              ],
            }),
          })
        );
      });
    } finally {
      await stop();
    }
  });

  it("never touches the service manager for an unsupervised daemon", async () => {
    resolveDaemonServiceRuntimeMetadataMock.mockReturnValue({
      autoStart: false,
      managedBySystemService: false,
      serviceController: null,
    });
    const stop = startDaemonServiceRegistrationReconcileLoop({
      intervalMs: 5,
      isStopRequested: () => false,
    });

    await vi.waitFor(() => {
      expect(resolveDaemonServiceRuntimeMetadataMock).toHaveBeenCalled();
    });
    await stop();

    expect(resolveDaemonServiceManagerMock).not.toHaveBeenCalled();
  });

  it("gives up after repeated repair failures and journals exhaustion once", async () => {
    const manager = buildManagerMock({ installed: false });
    manager.install.mockRejectedValue(new Error("install denied"));
    resolveDaemonServiceManagerMock.mockResolvedValue(manager);
    const stop = startDaemonServiceRegistrationReconcileLoop({
      intervalMs: 5,
      isStopRequested: () => false,
    });

    try {
      await vi.waitFor(
        () => {
          expect(journaledResults()).toContain("repair_exhausted");
        },
        { timeout: 5000 }
      );
    } finally {
      await stop();
    }

    expect(manager.install).toHaveBeenCalledTimes(3);
    expect(
      journaledResults().filter((result) => result === "repair_exhausted")
    ).toHaveLength(1);
  });
});

describe("journalDaemonStopSignalEvidence", () => {
  it("journals the signal with a supervisor registration snapshot", async () => {
    const manager = buildManagerMock({ installed: false, enabled: false });
    resolveDaemonServiceManagerMock.mockResolvedValue(manager);

    journalDaemonStopSignalEvidence("SIGTERM");

    await vi.waitFor(() => {
      expect(emitDaemonLifecycleEventMock).toHaveBeenCalled();
    });
    expect(emitDaemonLifecycleEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stop.signal.observed",
        result: "observed",
        metadata: expect.objectContaining({
          controller: "launchd",
          managedBySystemService: true,
          signal: "SIGTERM",
          supervisorRegistration: {
            enabled: false,
            installed: false,
            running: true,
          },
        }),
      })
    );
  });

  it("journals without a snapshot when the daemon is not supervised", async () => {
    resolveDaemonServiceRuntimeMetadataMock.mockReturnValue({
      autoStart: false,
      managedBySystemService: false,
      serviceController: null,
    });

    journalDaemonStopSignalEvidence("SIGINT");

    await vi.waitFor(() => {
      expect(emitDaemonLifecycleEventMock).toHaveBeenCalled();
    });
    expect(emitDaemonLifecycleEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stop.signal.observed",
        metadata: expect.objectContaining({
          controller: null,
          managedBySystemService: false,
          signal: "SIGINT",
          supervisorRegistration: null,
        }),
      })
    );
    expect(resolveDaemonServiceManagerMock).not.toHaveBeenCalled();
  });

  it("preserves the manager resolution error in stop-signal evidence", async () => {
    resolveDaemonServiceManagerMock.mockRejectedValue(
      new Error("launchctl manager unavailable")
    );

    journalDaemonStopSignalEvidence("SIGTERM");

    await vi.waitFor(() => {
      expect(emitDaemonLifecycleEventMock).toHaveBeenCalled();
    });
    expect(emitDaemonLifecycleEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stop.signal.observed",
        metadata: expect.objectContaining({
          supervisorRegistration: null,
          supervisorRegistrationError: "launchctl manager unavailable",
        }),
      })
    );
  });

  it("reports a stop-signal evidence write failure without blocking shutdown", async () => {
    const onWarn = vi.fn();
    emitDaemonLifecycleEventMock.mockRejectedValueOnce(
      new Error("lifecycle journal unavailable")
    );

    journalDaemonStopSignalEvidence("SIGTERM", { onWarn });

    await vi.waitFor(() => {
      expect(onWarn).toHaveBeenCalledWith(
        "stop-signal supervisor evidence collection failed",
        {
          errorMessage: "lifecycle journal unavailable",
          signal: "SIGTERM",
        }
      );
    });
  });
});
