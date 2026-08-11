import { access } from "node:fs/promises";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";
import {
  clearDaemonRuntimeLease,
  readDaemonRuntimeLease,
  writeDaemonRuntimeLease,
} from "../src/config/daemon-runtime-lease";
import {
  DAEMON_HEARTBEAT_STALE_MS,
  DAEMON_SERVICE_RUNTIME_STATE_SCHEMA,
  daemonServiceRuntimeStatePath,
  setDaemonServiceRuntimeState,
} from "../src/config/daemon-state";
import {
  clearDaemonRuntimeStateIfDefinitelyStopped,
  readCurrentDaemonRuntimeContext,
} from "../src/local-service/lifecycle/daemon-service-runtime";
import { withTempHome } from "./helpers/fs";

const listDaemonOwnedProcessesMock = vi.hoisted(() => vi.fn());
const resolveDaemonServiceManagerMock = vi.hoisted(() => vi.fn());

vi.mock(
  "../src/local-service/lifecycle/daemon-service-process-inventory",
  () => ({
    listDaemonOwnedProcesses: (...args: unknown[]) =>
      listDaemonOwnedProcessesMock(...args),
  })
);

vi.mock("../src/local-service/lifecycle/daemon-service-manager", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-manager")
  >("../src/local-service/lifecycle/daemon-service-manager");
  return {
    ...actual,
    resolveDaemonServiceManager: (...args: unknown[]) =>
      resolveDaemonServiceManagerMock(...args),
  };
});

describe("local service runtime cleanup", () => {
  it("clears persisted runtime state when effective runtime is not running", async () => {
    await withTempHome(async () => {
      listDaemonOwnedProcessesMock.mockReset().mockResolvedValue([]);
      resolveDaemonServiceManagerMock.mockReset().mockResolvedValue(null);

      await writePersistedRuntimeState({
        openMeldProfileId: null,
        autoStart: false,
        heartbeatAt: null,
        managedBySystemService: false,
        pid: 481_516,
        serviceController: "legacy-detached",
        writeLease: false,
      });

      const decision = await clearDaemonRuntimeStateIfDefinitelyStopped();
      expect(decision.cleared).toBe(true);
      expect(decision.context.effectiveRuntimeStatus).toBe("not_running");

      expect(await readDaemonRuntimeLease()).toBeNull();
      await expect(
        access(daemonServiceRuntimeStatePath())
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("does not clear persisted runtime state while effective runtime is running", async () => {
    await withTempHome(async () => {
      listDaemonOwnedProcessesMock.mockReset().mockResolvedValue([]);
      resolveDaemonServiceManagerMock.mockReset().mockResolvedValue(null);

      await writePersistedRuntimeState({
        openMeldProfileId: null,
        autoStart: false,
        heartbeatAt: null,
        managedBySystemService: false,
        pid: process.pid,
        serviceController: "legacy-detached",
        updatedAt: new Date().toISOString(),
      });

      const decision = await clearDaemonRuntimeStateIfDefinitelyStopped();

      expect(decision.cleared).toBe(false);
      expect(decision.context.effectiveRuntimeStatus).toBe("running");
      expect(await readDaemonRuntimeLease()).toMatchObject({
        mode: "foreground",
        pid: process.pid,
      });

      await clearDaemonRuntimeLease();
    });
  });

  it("does not clear runtime state when observed runtime is stale but the system service still reports running", async () => {
    await withTempHome(async () => {
      listDaemonOwnedProcessesMock.mockReset().mockResolvedValue([
        {
          command: "openmeld service run --mode background",
          mode: "background",
          ownership: "stable_launcher",
          parentPid: 1,
          pid: 601_001,
        },
      ]);
      resolveDaemonServiceManagerMock.mockReset().mockResolvedValue({
        controller: "launchd",
        deactivate: vi.fn(async () => undefined),
        install: vi.fn(async () => undefined),
        start: vi.fn(async () => undefined),
        status: vi.fn(async () => ({
          enabled: true,
          installed: true,
          running: true,
        })),
        stop: vi.fn(async () => undefined),
        uninstall: vi.fn(async () => undefined),
      });

      await writePersistedRuntimeState({
        openMeldProfileId: null,
        autoStart: true,
        heartbeatAt: null,
        managedBySystemService: true,
        pid: 601_000,
        serviceController: "launchd",
      });

      const killSpy = vi.spyOn(process, "kill").mockImplementation(((
        pid: number
      ) => {
        if (pid === 601_000) {
          const error = new Error("process not found") as NodeJS.ErrnoException;
          error.code = "ESRCH";
          throw error;
        }
      }) as typeof process.kill);

      try {
        const decision = await clearDaemonRuntimeStateIfDefinitelyStopped();

        expect(decision.cleared).toBe(false);
        expect(decision.context.runtimeStatus.status).toBe("stale");
        expect(decision.context.effectiveRuntimeStatus).toBe("running");
      } finally {
        killSpy.mockRestore();
      }

      expect(await readDaemonRuntimeLease()).toMatchObject({
        managedBySystemService: true,
        pid: 601_000,
        serviceController: "launchd",
      });
      await expect(access(daemonServiceRuntimeStatePath())).resolves.toBe(
        undefined
      );
    });
  });

  it("does not clear runtime state when stale is caused by heartbeat staleness", async () => {
    await withTempHome(async () => {
      listDaemonOwnedProcessesMock.mockReset().mockResolvedValue([]);
      resolveDaemonServiceManagerMock.mockReset().mockResolvedValue(null);

      await writePersistedRuntimeState({
        openMeldProfileId: null,
        autoStart: false,
        heartbeatAt: new Date(
          Date.now() - DAEMON_HEARTBEAT_STALE_MS - 1000
        ).toISOString(),
        managedBySystemService: false,
        pid: process.pid,
        serviceController: "legacy-detached",
      });

      const decision = await clearDaemonRuntimeStateIfDefinitelyStopped();

      expect(decision.cleared).toBe(false);
      expect(decision.context.runtimeStatus).toMatchObject({
        reason: "heartbeat_stale",
        status: "stale",
      });
      expect(decision.context.effectiveRuntimeStatus).toBe("stale");
      await expect(access(daemonServiceRuntimeStatePath())).resolves.toBe(
        undefined
      );
      expect(await readDaemonRuntimeLease()).toMatchObject({
        pid: process.pid,
      });

      await clearDaemonRuntimeLease();
    });
  });

  it("treats a missing heartbeat as stale when the runtime state is outdated", async () => {
    await withTempHome(async () => {
      listDaemonOwnedProcessesMock.mockReset().mockResolvedValue([]);
      resolveDaemonServiceManagerMock.mockReset().mockResolvedValue(null);

      const staleAt = new Date(
        Date.now() - DAEMON_HEARTBEAT_STALE_MS - 1000
      ).toISOString();
      await writePersistedRuntimeState({
        openMeldProfileId: null,
        autoStart: false,
        heartbeatAt: null,
        managedBySystemService: false,
        pid: process.pid,
        serviceController: "legacy-detached",
        updatedAt: staleAt,
      });

      const decision = await clearDaemonRuntimeStateIfDefinitelyStopped();

      expect(decision.cleared).toBe(false);
      expect(decision.context.runtimeStatus).toMatchObject({
        reason: "heartbeat_stale",
        status: "stale",
      });
      expect(decision.context.effectiveRuntimeStatus).toBe("stale");
      await expect(access(daemonServiceRuntimeStatePath())).resolves.toBe(
        undefined
      );
      expect(await readDaemonRuntimeLease()).toMatchObject({
        heartbeatAt: null,
        pid: process.pid,
        updatedAt: staleAt,
      });

      await clearDaemonRuntimeLease();
    });
  });

  it("does not clear runtime state when service manager status is unavailable for stale system-managed runtime", async () => {
    await withTempHome(async () => {
      listDaemonOwnedProcessesMock.mockReset().mockResolvedValue([
        {
          command: "openmeld service run --mode background",
          mode: "background",
          ownership: "stable_launcher",
          parentPid: 1,
          pid: 701_001,
        },
      ]);
      resolveDaemonServiceManagerMock.mockReset().mockResolvedValue({
        controller: "launchd",
        deactivate: vi.fn(async () => undefined),
        install: vi.fn(async () => undefined),
        start: vi.fn(async () => undefined),
        status: vi.fn(() =>
          Promise.reject(new Error("service manager unavailable"))
        ),
        stop: vi.fn(async () => undefined),
        uninstall: vi.fn(async () => undefined),
      });

      await writePersistedRuntimeState({
        openMeldProfileId: null,
        autoStart: true,
        heartbeatAt: null,
        managedBySystemService: true,
        pid: 701_000,
        serviceController: "launchd",
      });

      const killSpy = vi.spyOn(process, "kill").mockImplementation(((
        pid: number
      ) => {
        if (pid === 701_000) {
          const error = new Error("process not found") as NodeJS.ErrnoException;
          error.code = "ESRCH";
          throw error;
        }
      }) as typeof process.kill);

      try {
        const context = await readCurrentDaemonRuntimeContext();
        const decision = await clearDaemonRuntimeStateIfDefinitelyStopped();

        expect(context.runtimeStatus.status).toBe("stale");
        expect(context.serviceManagerStatus).toBeNull();
        expect(context.effectiveRuntimeStatus).toBe("stale");
        expect(decision.cleared).toBe(false);
        expect(decision.context.effectiveRuntimeStatus).toBe("stale");
      } finally {
        killSpy.mockRestore();
      }

      await expect(access(daemonServiceRuntimeStatePath())).resolves.toBe(
        undefined
      );
      expect(await readDaemonRuntimeLease()).toMatchObject({
        managedBySystemService: true,
        pid: 701_000,
      });
    });
  });
});

async function writePersistedRuntimeState(input: {
  openMeldProfileId: string | null;
  autoStart: boolean;
  heartbeatAt: string | null;
  managedBySystemService: boolean;
  pid: number;
  serviceController: "launchd" | "legacy-detached";
  updatedAt?: string;
  writeLease?: boolean;
}): Promise<void> {
  const updatedAt = input.updatedAt ?? "2026-03-14T00:00:00.000Z";
  await setDaemonServiceRuntimeState({
    openMeldProfileId: input.openMeldProfileId,
    autoStart: input.autoStart,
    command:
      input.serviceController === "launchd"
        ? "launchctl bootstrap openmeld"
        : "openmeld service run --mode foreground",
    gatewayUrl: null,
    heartbeatAt: input.heartbeatAt,
    managedBySystemService: input.managedBySystemService,
    mode: input.managedBySystemService ? "background" : "foreground",
    pid: input.pid,
    schema: DAEMON_SERVICE_RUNTIME_STATE_SCHEMA,
    serviceController: input.serviceController,
    startedAt: "2026-03-14T00:00:00.000Z",
    status: "running",
    stopRequestedAt: null,
    updatedAt,
    v: 1,
  });

  if (input.writeLease !== false) {
    await writeDaemonRuntimeLease({
      bundleId: "service-bundle-1",
      generation: 1,
      heartbeatAt: input.heartbeatAt,
      managedBySystemService: input.managedBySystemService,
      mode: input.managedBySystemService ? "background" : "foreground",
      pid: input.pid,
      schema: "openmeld-daemon-runtime-lease-v1",
      serviceController: input.serviceController,
      startedAt: "2026-03-14T00:00:00.000Z",
      updatedAt,
      v: 1,
    });
  }
}
