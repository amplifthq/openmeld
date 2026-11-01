import { readFile, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { join } from "node:path";
import { createInflightTaskControlRegistry } from "@openmeld/local-service";
import { OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION } from "@openmeld/schemas";
import type {
  OpenMeldDaemonCancelRequestPayload,
  OpenMeldDaemonInterruptRequestPayload,
} from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDaemonCancel, runDaemonInterrupt } from "../src/commands/service";
import type { DaemonServiceRuntimeStatus } from "../src/config/daemon-state";
import {
  daemonTokenPath,
  installDaemon,
  readDaemonControlPlaneToken,
} from "../src/config/daemon-state";
import {
  requestLocalConversationExecutionStatus,
  requestLocalDaemonShutdown,
  requestLocalSyncRouteCatalog,
  sendLocalDaemonControlPlaneRequest,
} from "../src/local-service/control-plane/client";
import { startLocalDaemonControlPlaneServer } from "../src/local-service/control-plane/server";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const {
  readCurrentDaemonRuntimeContextMock,
  readCurrentObservedDaemonRuntimeStatusMock,
} = vi.hoisted(() => ({
  readCurrentDaemonRuntimeContextMock: vi.fn(),
  readCurrentObservedDaemonRuntimeStatusMock: vi.fn(),
}));

vi.mock("../src/local-service/lifecycle/daemon-service-runtime", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-runtime")
  >("../src/local-service/lifecycle/daemon-service-runtime");
  return {
    ...actual,
    readCurrentDaemonRuntimeContext: (...args: unknown[]) =>
      readCurrentDaemonRuntimeContextMock(...args),
    readCurrentObservedDaemonRuntimeStatus: (...args: unknown[]) =>
      readCurrentObservedDaemonRuntimeStatusMock(...args),
  };
});

const BASE_CONTEXT = {
  healthPayload: {
    checkedAt: "2026-04-01T00:00:00.000Z",
    reasonCode: "ok",
    runtimeState: "healthy" as const,
    state: "ok" as const,
  },
  historyEntries: [],
  statusPayload: {
    checkedAt: "2026-04-01T00:00:00.000Z",
    daemonVersion: "0.4.0",
    installed: true,
    running: true,
    runtimeRoot: "/tmp/daemon-runtime",
  },
};

const RUNNING_RUNTIME_STATUS: DaemonServiceRuntimeStatus = {
  status: "running" as const,
  mode: "foreground" as const,
  pid: process.pid,
  startedAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  managedBySystemService: false,
  serviceController: "unknown" as const,
  autoStart: false,
};

function buildRuntimeContext(
  input: {
    effectiveRuntimeStatus?: "not_running" | "running" | "stale";
    runtimeStatus?: DaemonServiceRuntimeStatus;
  } = {}
) {
  const runtimeStatus = input.runtimeStatus ?? RUNNING_RUNTIME_STATUS;
  return {
    status: {
      installed: true,
      state: null,
    },
    runtimeStatus,
    serviceManager: null,
    serviceManagerStatus: null,
    legacySharedService: null,
    effectiveRuntimeStatus:
      input.effectiveRuntimeStatus ?? runtimeStatus.status,
  };
}

async function writeRawControlPlaneRequest(input: {
  endpoint: string;
  rawRequest: string;
}): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = createConnection(input.endpoint);
    let response = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      reject(new Error("timed out waiting for local daemon control response"));
    }, 1000);

    const settle = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(input.rawRequest);
    });
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.includes("\n")) {
        socket.destroy();
        settle(() => {
          resolve(response.trim());
        });
      }
    });
    socket.once("error", (error) => {
      settle(() => {
        reject(error);
      });
    });
    socket.once("end", () => {
      settle(() => {
        resolve(response.trim());
      });
    });
  });
}

describe("local service control-plane", () => {
  beforeEach(() => {
    readCurrentObservedDaemonRuntimeStatusMock.mockReset().mockResolvedValue({
      ...RUNNING_RUNTIME_STATUS,
    });
    readCurrentDaemonRuntimeContextMock
      .mockReset()
      .mockResolvedValue(buildRuntimeContext());
  });

  it("tracks inflight task control records by task and dispatch selectors", () => {
    const registry = createInflightTaskControlRegistry();
    registry.registerTask({
      adapterId: "codex",
      dispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: "rce-1",
      taskId: "task-1",
    });
    registry.updateTaskProcess({
      processId: 1234,
      taskId: "task-1",
    });

    expect(
      registry.resolveTarget({ by: "task", taskId: "task-1" })
    ).toMatchObject({
      record: {
        adapterId: "codex",
        dispatchId: "dispatch-1",
        processId: 1234,
        runtimeCoordinatorExecutionId: "rce-1",
        taskId: "task-1",
      },
    });
    expect(
      registry.resolveTarget({ by: "dispatch", dispatchId: "dispatch-1" })
    ).toMatchObject({
      record: {
        taskId: "task-1",
      },
    });

    registry.removeTask("task-1");
    expect(registry.resolveTarget({ by: "task", taskId: "task-1" })).toBeNull();
    expect(
      registry.resolveTarget({ by: "dispatch", dispatchId: "dispatch-1" })
    ).toBeNull();
  });

  it("keeps the latest dispatch owner when an older task is removed", () => {
    const registry = createInflightTaskControlRegistry();
    registry.registerTask({
      adapterId: "codex",
      dispatchId: "dispatch-shared",
      taskId: "task-older",
    });
    registry.registerTask({
      adapterId: "codex",
      dispatchId: "dispatch-shared",
      taskId: "task-newer",
    });

    registry.removeTask("task-older");

    expect(
      registry.resolveTarget({ by: "dispatch", dispatchId: "dispatch-shared" })
    ).toMatchObject({
      record: {
        taskId: "task-newer",
      },
    });
  });

  it("does not delete a reused dispatch mapping when a task is re-registered", () => {
    const registry = createInflightTaskControlRegistry();
    registry.registerTask({
      adapterId: "codex",
      dispatchId: "dispatch-original",
      taskId: "task-1",
    });
    registry.registerTask({
      adapterId: "codex",
      dispatchId: "dispatch-original",
      taskId: "task-2",
    });

    registry.registerTask({
      adapterId: "codex",
      dispatchId: "dispatch-updated",
      taskId: "task-1",
    });

    expect(
      registry.resolveTarget({
        by: "dispatch",
        dispatchId: "dispatch-original",
      })
    ).toMatchObject({
      record: {
        taskId: "task-2",
      },
    });
    expect(
      registry.resolveTarget({
        by: "dispatch",
        dispatchId: "dispatch-updated",
      })
    ).toMatchObject({
      record: {
        taskId: "task-1",
      },
    });
  });

  it("round-trips interrupt and cancel requests through the local service control server", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const token = await readDaemonControlPlaneToken();
      expect(token).toBeTruthy();

      const server = await startLocalDaemonControlPlaneServer({
        expectedToken: token ?? "missing",
        getContext: async () => ({
          ...BASE_CONTEXT,
          interruptHandler: async (
            payload: OpenMeldDaemonInterruptRequestPayload
          ) => ({
            accepted: true,
            resolvedDispatchId: "dispatch-1",
            resolvedTaskId: "task-1",
            target: payload.target,
          }),
          cancelHandler: async (
            payload: OpenMeldDaemonCancelRequestPayload
          ) => ({
            accepted: true,
            note: "force_interrupt_fallback",
            resolvedDispatchId: "dispatch-2",
            resolvedTaskId: "task-2",
            target: payload.target,
          }),
        }),
      });

      try {
        const interruptResponse = await sendLocalDaemonControlPlaneRequest({
          request: {
            v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
            command: "interrupt",
            payload: {
              target: {
                by: "dispatch",
                dispatchId: "dispatch-1",
              },
            },
          },
        });
        expect(interruptResponse).toMatchObject({
          code: "service.interrupt",
          payload: {
            accepted: true,
            resolvedDispatchId: "dispatch-1",
            resolvedTaskId: "task-1",
            target: {
              by: "dispatch",
              dispatchId: "dispatch-1",
            },
          },
        });

        const cancelResponse = await sendLocalDaemonControlPlaneRequest({
          request: {
            v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
            command: "cancel",
            payload: {
              target: {
                by: "task",
                taskId: "task-2",
              },
            },
          },
        });
        expect(cancelResponse).toMatchObject({
          code: "service.cancel",
          payload: {
            accepted: true,
            note: "force_interrupt_fallback",
            resolvedDispatchId: "dispatch-2",
            resolvedTaskId: "task-2",
            target: {
              by: "task",
              taskId: "task-2",
            },
          },
        });
      } finally {
        await server.close();
      }
    });
  });

  it("sends an idle update over its distinct authenticated command and preserves a busy refusal", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const token = await readDaemonControlPlaneToken();
      const ordinary = vi.fn(() => ({
        accepted: true,
        mode: "graceful" as const,
        gracePeriodMs: 1000,
      }));
      const phases: Array<{ command?: string; phase: string }> = [];
      const server = await startLocalDaemonControlPlaneServer({
        expectedToken: token ?? "missing",
        onRequestPhase: (event) => phases.push(event),
        getContext: () => ({
          ...BASE_CONTEXT,
          shutdownHandler: ordinary,
          shutdownIfIdleHandler: (payload) => ({
            accepted: false,
            mode: "graceful",
            gracePeriodMs: payload.gracePeriodMs,
          }),
        }),
      });
      try {
        expect(
          await requestLocalDaemonShutdown({
            endpoint: server.endpoint,
            onlyIfIdle: true,
            payload: { mode: "graceful", gracePeriodMs: 1000 },
          })
        ).toEqual({ accepted: false, mode: "graceful", gracePeriodMs: 1000 });
        expect(ordinary).not.toHaveBeenCalled();
        expect(phases).toContainEqual(
          expect.objectContaining({
            command: "shutdown_if_idle",
            phase: "authenticated",
          })
        );
        expect(
          phases.some((event) => event.phase === "shutdown_admitted")
        ).toBe(false);
      } finally {
        await server.close();
      }
    });
  });

  it("bounds the caller despite admitted shutdown progress without cancelling the drain", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const token = await readDaemonControlPlaneToken();
      const admitted = Promise.withResolvers<void>();
      const completion = Promise.withResolvers<void>();
      const phases: string[] = [];
      const server = await startLocalDaemonControlPlaneServer({
        expectedToken: token ?? "missing",
        onRequestPhase: (event) => phases.push(event.phase),
        getContext: async () => ({
          ...BASE_CONTEXT,
          shutdownHandler: async (payload, lifecycle) => {
            lifecycle?.onAdmitted();
            admitted.resolve();
            await completion.promise;
            return {
              accepted: true,
              gracePeriodMs: payload.gracePeriodMs,
              mode: payload.mode,
            };
          },
        }),
      });

      try {
        const shutdown = requestLocalDaemonShutdown({
          endpoint: server.endpoint,
          payload: {
            gracePeriodMs: 5000,
            mode: "graceful",
          },
          timeoutMs: 1100,
        });
        const observedShutdown = shutdown.then(
          (value) => ({ value }),
          (error: unknown) => ({ error })
        );
        await admitted.promise;
        await expect(observedShutdown).resolves.toMatchObject({
          error: { code: "daemon.control.timeout" },
        });
        completion.resolve();
        expect(phases).toEqual([
          "received",
          "authenticated",
          "shutdown_admitted",
        ]);
      } finally {
        completion.resolve();
        await server.close();
      }
    });
  });

  it("times out when shutdown stalls before admission", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const token = await readDaemonControlPlaneToken();
      const releaseToken = Promise.withResolvers<string>();
      const getContext = vi.fn(() => BASE_CONTEXT);
      const server = await startLocalDaemonControlPlaneServer({
        resolveExpectedToken: async () => await releaseToken.promise,
        getContext,
      });

      try {
        const shutdown = requestLocalDaemonShutdown({
          endpoint: server.endpoint,
          payload: { gracePeriodMs: 5000, mode: "graceful" },
          timeoutMs: 1500,
        });
        const observedShutdown = shutdown.then(
          () => ({ status: "resolved" as const }),
          (error: unknown) => ({ error, status: "rejected" as const })
        );
        const outcome = await Promise.race([
          observedShutdown,
          new Promise<{ status: "pending" }>((resolve) => {
            setTimeout(() => resolve({ status: "pending" }), 2200);
          }),
        ]);
        expect(outcome).toMatchObject({
          error: { code: "daemon.control.timeout" },
          status: "rejected",
        });
        expect(getContext).not.toHaveBeenCalled();
      } finally {
        releaseToken.resolve(token ?? "missing");
        await server.close();
      }
    });
  });

  it("preserves an admitted shutdown error before the caller deadline", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const token = await readDaemonControlPlaneToken();
      const admitted = Promise.withResolvers<void>();
      const completion = Promise.withResolvers<void>();
      const server = await startLocalDaemonControlPlaneServer({
        expectedToken: token ?? "missing",
        getContext: () => ({
          ...BASE_CONTEXT,
          shutdownHandler: async (_payload, lifecycle) => {
            lifecycle?.onAdmitted();
            admitted.resolve();
            await completion.promise;
            throw new Error("controlled drain failed");
          },
        }),
      });

      try {
        const shutdown = requestLocalDaemonShutdown({
          endpoint: server.endpoint,
          payload: { gracePeriodMs: 5000, mode: "graceful" },
          timeoutMs: 1100,
        });
        await admitted.promise;
        completion.resolve();
        await expect(shutdown).rejects.toMatchObject({
          code: "service.internal",
          message: "controlled drain failed",
        });
      } finally {
        completion.resolve();
        await server.close();
      }
    });
  });

  it("cleans up admitted-shutdown response progress when the client disconnects", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const token = await readDaemonControlPlaneToken();
      const admitted = Promise.withResolvers<void>();
      const completion = Promise.withResolvers<void>();
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
      const server = await startLocalDaemonControlPlaneServer({
        expectedToken: token ?? "missing",
        getContext: () => ({
          ...BASE_CONTEXT,
          shutdownHandler: async (_payload, lifecycle) => {
            lifecycle?.onAdmitted();
            admitted.resolve();
            await completion.promise;
            return { accepted: true, gracePeriodMs: 5000, mode: "graceful" };
          },
        }),
      });
      const socket = createConnection(server.endpoint);

      try {
        await new Promise<void>((resolve, reject) => {
          socket.once("connect", resolve);
          socket.once("error", reject);
        });
        socket.write(
          `${JSON.stringify({
            authToken: token,
            command: "shutdown",
            payload: { gracePeriodMs: 5000, mode: "graceful" },
            v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
          })}\n`
        );
        await admitted.promise;
        const progressTimer = setIntervalSpy.mock.results.at(-1)?.value;
        expect(progressTimer).toBeDefined();

        const closed = new Promise<void>((resolve) =>
          socket.once("close", resolve)
        );
        socket.destroy();
        await closed;

        await vi.waitFor(() => {
          expect(clearIntervalSpy).toHaveBeenCalledWith(progressTimer);
        });
      } finally {
        completion.resolve();
        socket.destroy();
        await server.close();
        setIntervalSpy.mockRestore();
        clearIntervalSpy.mockRestore();
      }
    });
  });

  it("round-trips conversation execution status requests through the local service control server", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const token = await readDaemonControlPlaneToken();
      expect(token).toBeTruthy();

      const server = await startLocalDaemonControlPlaneServer({
        expectedToken: token ?? "missing",
        getContext: async () => ({
          ...BASE_CONTEXT,
          conversationExecutionStatusHandler: async () => ({
            agentContextLookupKey:
              "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b|agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c|builtin%3Acodex|local-cli|sha256%3Aworkspace-a",
            controllerLaunchStatus: "ready",
            executionState: null,
            localRuntimeContext: {
              agentContextLookupKey:
                "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b|agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c|builtin%3Acodex|local-cli|sha256%3Aworkspace-a",
              runtimeWorkspaceFingerprint: "sha256:workspace-a",
              status: "missing",
            },
            providerConversationProof: {
              agentControllerConversationId: null,
              checkedAt: null,
              errorCode: null,
              errorMessage: null,
              errorType: null,
              expiresAt: null,
              intrusive: false,
              method: null,
              provider: null,
              status: "not_run",
              transportMode: "local-cli",
            },
            runtimeWorkspace: {
              configPath: "/tmp/workspace.json",
              configuredWorkspacePath: "/tmp/workspace",
              fingerprint: "sha256:workspace-a",
              path: "/tmp/workspace",
              reasonCode: null,
              reasonText: null,
              runtimeContext: {
                providerRuntimeWorkingDirectory: "/tmp/workspace",
              },
              status: "ready",
              workspaceMode: "openmeld_managed",
            },
          }),
        }),
      });

      try {
        const response = await requestLocalConversationExecutionStatus({
          payload: {
            agentControllerConversationId:
              "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
            boundAgentControllerRef: "builtin:codex",
            agentControllerRef: "builtin:codex",
            spaceId:
              "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b",
            targetProfileId: "agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c",
            transportMode: "local-cli",
            validate: true,
          },
        });

        expect(response).toMatchObject({
          agentContextLookupKey:
            "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b|agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c|builtin%3Acodex|local-cli|sha256%3Aworkspace-a",
          controllerLaunchStatus: "ready",
          localRuntimeContext: {
            status: "missing",
          },
          providerConversationProof: {
            status: "not_run",
          },
          runtimeWorkspace: {
            status: "ready",
          },
        });
      } finally {
        await server.close();
      }
    });
  });

  it("fails fast when the local control endpoint is missing", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });

      await expect(
        sendLocalDaemonControlPlaneRequest({
          request: {
            v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
            command: "interrupt",
            payload: {
              target: {
                by: "task",
                taskId: "task-missing",
              },
            },
          },
        })
      ).rejects.toMatchObject({
        code: "daemon.control.endpoint_missing",
      });
    });
  });

  it("translates a stale local service invalid_request error into a contract mismatch for conversation execution status", async () => {
    await withTempHome(async (homeDir) => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const endpoint = join(homeDir, "contract.sock");
      const server = createServer((socket) => {
        socket.setEncoding("utf8");
        socket.once("data", () => {
          socket.end(
            `${JSON.stringify({
              code: "service.error",
              payload: {
                errorCode: "service.invalid_request",
                errorMessage: "invalid daemon control-plane request",
              },
              v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
            })}\n`
          );
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(endpoint, () => resolve());
      });

      try {
        await expect(
          requestLocalConversationExecutionStatus({
            endpoint,
            payload: {
              agentControllerConversationId:
                "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
              boundAgentControllerRef: "builtin:codex",
              agentControllerRef: "builtin:codex",
              spaceId:
                "50d3f22b939bd6492e28d93dac6848f0909db431c832a5951af5fcced3d0d73b",
              targetProfileId: "agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c",
              transportMode: "local-cli",
              validate: true,
            },
          })
        ).rejects.toMatchObject({
          code: "daemon.control.contract_mismatch",
          message:
            "local OpenMeld Service must be restarted because the daemon control-plane contract changed on this device",
        });
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
    });
  });

  it("requests immediate local route catalog sync through the control-plane", async () => {
    await withTempHome(async (homeDir) => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const endpoint = join(homeDir, "route.sock");
      const server = createServer((socket) => {
        socket.setEncoding("utf8");
        socket.once("data", () => {
          socket.end(
            `${JSON.stringify({
              code: "service.sync_route_catalog",
              payload: {
                accepted: true,
                addedProfileIds: ["agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c"],
                keptProfileIds: [],
                profileIds: ["agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c"],
                removedProfileIds: [],
                skippedProfiles: [
                  {
                    profileId: "agt_19fcab6d-6484-4410-90d6-c1658d4f53c8",
                    profileName: "Codex",
                    skipReason: "workspace.missing",
                  },
                ],
                syncStatus: "changed",
              },
              v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
            })}\n`
          );
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(endpoint, () => resolve());
      });

      try {
        const response = await requestLocalSyncRouteCatalog({
          endpoint,
          payload: {
            reason: "profile_created",
          },
        });

        expect(response).toEqual({
          accepted: true,
          addedProfileIds: ["agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c"],
          keptProfileIds: [],
          profileIds: ["agt_be830d2b-b912-40bd-8bfa-41d23cdb0a3c"],
          removedProfileIds: [],
          skippedProfiles: [
            {
              profileId: "agt_19fcab6d-6484-4410-90d6-c1658d4f53c8",
              profileName: "Codex",
              skipReason: "workspace.missing",
            },
          ],
          syncStatus: "changed",
        });
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
    });
  });

  it("times out when the local service control endpoint accepts the socket but never responds", async () => {
    await withTempHome(async (homeDir) => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const endpoint = join(homeDir, "timeout.sock");
      const server = createServer((socket) => {
        socket.setEncoding("utf8");
        socket.on("data", () => undefined);
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(endpoint, () => resolve());
      });

      try {
        await expect(
          sendLocalDaemonControlPlaneRequest({
            endpoint,
            timeoutMs: 50,
            request: {
              v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
              command: "interrupt",
              payload: {
                target: {
                  by: "task",
                  taskId: "task-timeout",
                },
              },
            },
          })
        ).rejects.toMatchObject({
          code: "daemon.control.timeout",
          message: "local daemon control timed out after 50ms",
        });
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
    });
  });

  it("fails fast when local service control auth token does not match", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const token = await readDaemonControlPlaneToken();
      expect(token).toBeTruthy();

      const server = await startLocalDaemonControlPlaneServer({
        expectedToken: "wrong-token",
        getContext: async () => BASE_CONTEXT,
      });

      try {
        await expect(
          sendLocalDaemonControlPlaneRequest({
            request: {
              v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
              command: "cancel",
              payload: {
                target: {
                  by: "dispatch",
                  dispatchId: "dispatch-auth",
                },
              },
            },
          })
        ).rejects.toMatchObject({
          code: "auth.unauthenticated",
        });
      } finally {
        await server.close();
      }
    });
  });

  it("accepts the current token after the token file changes while the service is running", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const originalToken = await readDaemonControlPlaneToken();
      expect(originalToken).toBeTruthy();

      const server = await startLocalDaemonControlPlaneServer({
        resolveExpectedToken: async () =>
          (await readDaemonControlPlaneToken()) ?? "missing",
        getContext: async () => BASE_CONTEXT,
      });

      try {
        const tokenState = JSON.parse(
          await readFile(daemonTokenPath(), "utf8")
        ) as Record<string, unknown>;
        const rotatedToken = `${originalToken}-rotated`;
        await writeFile(
          daemonTokenPath(),
          `${JSON.stringify({
            ...tokenState,
            token: rotatedToken,
            updatedAt: new Date().toISOString(),
          })}\n`,
          { encoding: "utf8", mode: 0o600 }
        );

        await expect(
          sendLocalDaemonControlPlaneRequest({
            request: {
              v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
              command: "health",
            },
          })
        ).resolves.toMatchObject({ code: "service.health" });
      } finally {
        await server.close();
      }
    });
  });

  it("emits structured agent output for accepted interrupt and cancel requests", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const token = await readDaemonControlPlaneToken();
      expect(token).toBeTruthy();

      const server = await startLocalDaemonControlPlaneServer({
        expectedToken: token ?? "missing",
        getContext: async () => ({
          ...BASE_CONTEXT,
          interruptHandler: async (
            payload: OpenMeldDaemonInterruptRequestPayload
          ) => ({
            accepted: true,
            resolvedDispatchId: "dispatch-agent-1",
            resolvedTaskId: "task-agent-1",
            target: payload.target,
          }),
          cancelHandler: async (
            payload: OpenMeldDaemonCancelRequestPayload
          ) => ({
            accepted: true,
            note: "force_interrupt_fallback",
            resolvedDispatchId: "dispatch-agent-2",
            resolvedTaskId: "task-agent-2",
            target: payload.target,
          }),
        }),
      });

      readCurrentObservedDaemonRuntimeStatusMock.mockResolvedValue({
        status: "running",
        mode: "foreground",
        pid: process.pid,
        startedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        managedBySystemService: false,
        serviceController: "unknown",
        autoStart: false,
      });

      try {
        const interruptStdout = await withCapturedStdio(async () => {
          await runDaemonInterrupt({
            dispatch: "dispatch-agent-1",
            view: "agent",
          });
        });
        expect(interruptStdout.stdout).toContain("daemon.interrupt.result");
        expect(interruptStdout.stdout).toContain("dispatch-agent-1");

        const cancelStdout = await withCapturedStdio(async () => {
          await runDaemonCancel({
            task: "task-agent-2",
            view: "agent",
          });
        });
        expect(cancelStdout.stdout).toContain("daemon.cancel.result");
        expect(cancelStdout.stdout).toContain("force_interrupt_fallback");
      } finally {
        readCurrentObservedDaemonRuntimeStatusMock.mockReset();
        await server.close();
      }
    });
  });

  it("does not treat a stale raw runtime state as not running when the effective local service runtime is running", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const token = await readDaemonControlPlaneToken();
      expect(token).toBeTruthy();

      const server = await startLocalDaemonControlPlaneServer({
        expectedToken: token ?? "missing",
        getContext: async () => ({
          ...BASE_CONTEXT,
          interruptHandler: async (
            payload: OpenMeldDaemonInterruptRequestPayload
          ) => ({
            accepted: true,
            resolvedDispatchId: "dispatch-effective-running",
            resolvedTaskId: "task-effective-running",
            target: payload.target,
          }),
        }),
      });

      readCurrentObservedDaemonRuntimeStatusMock.mockResolvedValue({
        ...RUNNING_RUNTIME_STATUS,
        managedBySystemService: true,
        mode: "background",
        serviceController: "launchd",
        status: "stale",
      });
      readCurrentDaemonRuntimeContextMock.mockResolvedValue(
        buildRuntimeContext({
          effectiveRuntimeStatus: "running",
          runtimeStatus: {
            ...RUNNING_RUNTIME_STATUS,
            managedBySystemService: true,
            mode: "background",
            serviceController: "launchd",
            status: "stale",
          },
        })
      );

      try {
        const stdout = await withCapturedStdio(async () => {
          await runDaemonInterrupt({
            dispatch: "dispatch-effective-running",
            view: "agent",
          });
        });

        expect(stdout.stdout).toContain("daemon.interrupt.result");
        expect(stdout.stdout).not.toContain("daemon.interrupt.not_running");
      } finally {
        await server.close();
      }
    });
  });

  it("exits non-zero after emitting not-running output when local service control is unavailable", async () => {
    await withTempHome(async () => {
      readCurrentObservedDaemonRuntimeStatusMock.mockResolvedValue({
        status: "not_running",
        mode: null,
        pid: null,
        startedAt: null,
        updatedAt: null,
        managedBySystemService: false,
        serviceController: "unknown",
        autoStart: false,
      });
      readCurrentDaemonRuntimeContextMock.mockResolvedValue({
        status: {
          installed: false,
          state: null,
        },
        runtimeStatus: {
          status: "not_running",
          mode: null,
          pid: null,
          startedAt: null,
          updatedAt: null,
          managedBySystemService: false,
          serviceController: "unknown",
          autoStart: false,
        },
        serviceManager: null,
        serviceManagerStatus: null,
        legacySharedService: null,
        effectiveRuntimeStatus: "not_running",
      });

      const captured = await withCapturedStdio(async () => {
        try {
          await runDaemonInterrupt({
            dispatch: "dispatch-missing",
            view: "agent",
          });
          return null;
        } catch (error) {
          return error;
        }
      });

      expect(captured.result).toBeInstanceOf(Error);
      expect((captured.result as Error).message).toBe(
        "daemon.control.not_running"
      );
      expect(captured.stdout).toContain("daemon.interrupt.not_running");
    });
  });

  it("emits a structured failed result before rejecting an invalid target selector", async () => {
    await withTempHome(async () => {
      const captured = await withCapturedStdio(async () => {
        try {
          await runDaemonInterrupt({
            view: "agent",
          });
          return null;
        } catch (error) {
          return error;
        }
      });

      expect(captured.result).toBeInstanceOf(Error);
      expect((captured.result as Error).message).toBe(
        "exactly one of --dispatch or --task is required"
      );
      expect(captured.stdout).toContain("daemon.interrupt.failed");
      expect(captured.stdout).toContain(
        '"errorCode":"daemon.control.invalid_target_selector"'
      );
      expect(captured.stdout).toContain('"target":null');
    });
  });

  it("emits a structured failed result before rejecting an invalid control-plane response", async () => {
    await withTempHome(async () => {
      const requestSpy = vi
        .spyOn(
          await import("../src/local-service/control-plane/client"),
          "sendLocalDaemonControlPlaneRequest"
        )
        .mockResolvedValue({
          v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
          code: "service.cancel",
          payload: {
            accepted: true,
            resolvedDispatchId: "dispatch-invalid",
            resolvedTaskId: "task-invalid",
            target: {
              by: "dispatch",
              dispatchId: "dispatch-invalid",
            },
          },
        });

      try {
        const captured = await withCapturedStdio(async () => {
          try {
            await runDaemonInterrupt({
              dispatch: "dispatch-invalid",
              view: "agent",
            });
            return null;
          } catch (error) {
            return error;
          }
        });

        expect(requestSpy).toHaveBeenCalledTimes(1);
        expect(captured.result).toBeInstanceOf(Error);
        expect((captured.result as Error).message).toBe(
          "daemon.control.invalid_response: expected service.interrupt, received service.cancel"
        );
        expect(captured.stdout).toContain("daemon.interrupt.failed");
        expect(captured.stdout).toContain(
          '"errorCode":"daemon.control.invalid_response"'
        );
        expect(captured.stdout).toContain('"dispatchId":"dispatch-invalid"');
      } finally {
        requestSpy.mockRestore();
      }
    });
  });

  it("exits non-zero after emitting a rejected interrupt result", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const token = await readDaemonControlPlaneToken();
      expect(token).toBeTruthy();

      const server = await startLocalDaemonControlPlaneServer({
        expectedToken: token ?? "missing",
        getContext: async () => ({
          ...BASE_CONTEXT,
          interruptHandler: async (
            payload: OpenMeldDaemonInterruptRequestPayload
          ) => ({
            accepted: false,
            note: "task.not_found",
            target: payload.target,
          }),
        }),
      });

      try {
        const captured = await withCapturedStdio(async () => {
          try {
            await runDaemonInterrupt({
              dispatch: "dispatch-rejected",
              view: "agent",
            });
            return null;
          } catch (error) {
            return error;
          }
        });

        expect(captured.result).toBeInstanceOf(Error);
        expect((captured.result as Error).message).toContain(
          "daemon.control.rejected"
        );
        expect(captured.stdout).toContain("daemon.interrupt.result");
        expect(captured.stdout).toContain('"accepted":false');
      } finally {
        await server.close();
      }
    });
  });

  it("exits non-zero after emitting a rejected cancel result", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const token = await readDaemonControlPlaneToken();
      expect(token).toBeTruthy();

      const server = await startLocalDaemonControlPlaneServer({
        expectedToken: token ?? "missing",
        getContext: async () => ({
          ...BASE_CONTEXT,
          cancelHandler: async (
            payload: OpenMeldDaemonCancelRequestPayload
          ) => ({
            accepted: false,
            note: "adapter.unsupported",
            target: payload.target,
          }),
        }),
      });

      try {
        const captured = await withCapturedStdio(async () => {
          try {
            await runDaemonCancel({
              task: "task-rejected",
              view: "agent",
            });
            return null;
          } catch (error) {
            return error;
          }
        });

        expect(captured.result).toBeInstanceOf(Error);
        expect((captured.result as Error).message).toContain(
          "daemon.control.rejected"
        );
        expect(captured.stdout).toContain("daemon.cancel.result");
        expect(captured.stdout).toContain('"accepted":false');
      } finally {
        await server.close();
      }
    });
  });

  it("rejects oversized local service control requests before waiting for the socket to end", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.4.0",
        source: "daemon.command.install",
      });
      const token = await readDaemonControlPlaneToken();
      expect(token).toBeTruthy();

      const server = await startLocalDaemonControlPlaneServer({
        expectedToken: token ?? "missing",
        getContext: async () => BASE_CONTEXT,
      });

      try {
        const oversizedRequest = JSON.stringify({
          authToken: token,
          command: "health",
          padding: "x".repeat(70 * 1024),
          v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
        });
        const rawResponse = await writeRawControlPlaneRequest({
          endpoint: server.endpoint,
          rawRequest: oversizedRequest,
        });

        expect(JSON.parse(rawResponse)).toMatchObject({
          code: "service.error",
          payload: {
            errorCode: "service.invalid_request",
          },
        });
      } finally {
        await server.close();
      }
    });
  });
});
