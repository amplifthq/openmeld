import { join } from "node:path";
import {
  createInflightTaskControlRegistry,
  createLocalAdapterContainer,
  createLocalAdapterEntries,
  createLocalTaskInterruptSender,
  createPendingAgentInteractionRegistry,
} from "@openmeld/local-service";
import {
  computerPowerRequestFrameSchema,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  SERVICE_EXECUTION_HOST_PROTOCOL,
  type ServiceExecutionHostCatalog,
  type ServiceExecutionHostIdentity,
  type ServiceExecutionHostInput,
  type ServiceExecutionHostMessage,
  type ServiceExecutionHostSnapshot,
  serviceExecutionHostCatalogSchema,
} from "@openmeld/schemas";
import { createManagedAgentActivityIntegrationRefreshScheduler } from "../../agent-activity/integration-refresh";
import { startLocalAgentActivitySyncLoop } from "../../agent-activity/local-sync";
import { getConfiguredDaemonDispatchLimits } from "../../config/runtime-config";
import type { Presenter } from "../../runtime/presenter/types";
import { parseDaemonFrame } from "../carrier/daemon-frame-transport";
import {
  handleLocalControlPlaneCancel,
  handleLocalControlPlaneInterrupt,
} from "../carrier/local-control-handlers";
import { createDaemonLocalExecutionSlots } from "../carrier/local-execution-slots";
import { resolveLocalConversationExecutionStatus } from "../control-plane/conversation-execution-status";
import { CONTROLLED_SHUTDOWN_RESULT_ACK_TIMEOUT_MS } from "../core/constants";
import { emitRunLine, toErrorMessage } from "../core/logger";
import type {
  CurrentDaemonSocketRef,
  DaemonFrameSink,
  DaemonRuntimePaths,
  InflightDispatchMeta,
  RouteCatalog,
} from "../core/types";
import {
  flushDispatchResultOutbox,
  listDispatchResultOutboxPendingAcknowledgementKeys,
  waitForDispatchResultOutboxAcknowledgement,
} from "../dispatch/dispatch-result-outbox";
import { sendDispatchInteractionRequestFrame } from "../dispatch/send-dispatch-result";
import { resolveComputerFileAccessStorePath } from "../file-access/computer-file-access-store";
import { consumeArmedAgentControllerInterfaceReprobe } from "../inventory/agent-controller-interface-keeper";
import { createComputerPower } from "../power/computer-power";
import { syncLocalServiceProviderConversationProofs } from "../reporting/provider-conversation-proof-sync";
import { syncLocalServiceRuntimeAgentControllerReports } from "../reporting/runtime-agent-controller-report-sync";
import { createRuntimeReportingAttemptObserver } from "../reporting/runtime-reporting-attempt-observer";
import { syncActiveTaskPermissionModes } from "../routing/active-permission-mode-sync";
import {
  createMutableRouteCatalogState,
  createRouteCatalogFromMutableState,
  replaceMutableRouteCatalogState,
} from "../routing/route-catalog-state";
import { loadContextStore } from "../state/context-store";
import { buildLedgerPaths } from "../state/daemon-device-id";
import {
  loadExecutionHostCatalog,
  persistExecutionHostCatalog,
} from "./catalog";
import { ExecutionHostError, type ExecutionHostHandlers } from "./channel";
import {
  createExecutionHostControls,
  isExecutionHostControlFrame,
} from "./controls";
import { createExecutionAdmissionConfirmation } from "./execution-admission";
import { createServiceExecutionInputReceiver } from "./execution-input";
import { handleExecutionHostFrame } from "./frame-router";

type HostEvent = Exclude<ServiceExecutionHostMessage, { type: "reply" }>;

export async function createExecutionHostResources(input: {
  runtimePaths: DaemonRuntimePaths;
  presenter: Presenter;
  observeOwnedProcess?: (event: {
    phase: "process_exit" | "process_spawned";
    processId: number | null;
    signalTarget: "process" | "process_group";
  }) => void;
}) {
  const ledgerPaths = buildLedgerPaths(input.runtimePaths.ledgerRootPath);
  const contextStore = await loadContextStore(
    input.runtimePaths.contextStorePath
  );
  const inflightDispatchMetaByTaskId = new Map<string, InflightDispatchMeta>();
  const inflightTaskControlRegistry = createInflightTaskControlRegistry();
  const pendingAgentInteractionRegistry =
    createPendingAgentInteractionRegistry();
  const interrupt = createLocalTaskInterruptSender({
    registry: inflightTaskControlRegistry,
  });
  const localAdapterContainer = createLocalAdapterContainer(
    createLocalAdapterEntries({
      runtimeWorkdir: process.cwd(),
      sendInterrupt: async (signal) => {
        await interrupt(signal);
      },
      registerRuntimeProcess: (event) => {
        input.observeOwnedProcess?.(event);
        const processId =
          event.phase === "process_exit" ? null : event.processId;
        const updated = inflightTaskControlRegistry.updateTaskProcess({
          processId,
          signalTarget:
            event.phase === "process_exit" ? null : event.signalTarget,
          taskId: event.taskId,
        });
        if (updated) {
          emitRunLine({
            presenter: input.presenter,
            code: "daemon.run.control_process_registered",
            text: `control process ${event.phase === "process_spawned" ? "registered" : "cleared"} for task ${event.taskId}`,
            payload: {
              adapterId: updated.adapterId,
              dispatchId: updated.dispatchId,
              phase: event.phase,
              processId,
              taskId: event.taskId,
              signalTarget: event.signalTarget,
            },
          });
        }
      },
    })
  );
  const emptyCatalog: RouteCatalog = {
    profileIds: [],
    routeByProfileId: new Map(),
    skippedProfiles: [],
  };

  return {
    ledgerPaths,
    contextStore,
    inflightDispatchMetaByTaskId,
    inflightTaskControlRegistry,
    pendingAgentInteractionRegistry,
    localAdapterContainer,
    initialCatalog: emptyCatalog,
    dispatchLimits: await getConfiguredDaemonDispatchLimits(),
  };
}
export type ExecutionHostResources = Awaited<
  ReturnType<typeof createExecutionHostResources>
>;

// One Host owns these execution objects across all replacement cloud sockets.
// No socket, reconnect loop, public listener or independent task scheduler lives
// here. The original execution/approval/result domain owners remain in use.
export function createExecutionHostRuntime(input: {
  resources: ExecutionHostResources;
  hostInstanceId: string;
  identity: ServiceExecutionHostIdentity;
  runtimePaths: DaemonRuntimePaths;
  serviceBundleId: string | null;
  profileOwnerName: string | null;
  presenter: Presenter;
  emit(event: HostEvent): void;
  onWorkStateChange?(quiescent: boolean): void;
}) {
  const identity = input.identity;
  const {
    ledgerPaths,
    contextStore,
    inflightDispatchMetaByTaskId,
    inflightTaskControlRegistry,
    pendingAgentInteractionRegistry,
    localAdapterContainer,
    initialCatalog: emptyCatalog,
  } = input.resources;
  const power = createComputerPower({
    path: join(input.runtimePaths.dataRootPath, "computer-power.json"),
  });
  const localExecutionSlots = createDaemonLocalExecutionSlots({
    limits: input.resources.dispatchLimits,
    presenter: input.presenter,
    onChanged: () => {
      power
        .setActiveTasks(localExecutionSlots.getDrainState().activeGlobal)
        .catch((error) =>
          emitRunLine({
            presenter: input.presenter,
            code: "daemon.power.failed",
            text: toErrorMessage(error),
          })
        );
      input.onWorkStateChange?.(snapshot().localQuiescent);
      invalidate("execution");
    },
  });
  const routeCatalogState = createMutableRouteCatalogState(emptyCatalog);
  const currentSocketRef: CurrentDaemonSocketRef = {
    socket: null,
    connectionGeneration: null,
  };
  const executionAdmission =
    createExecutionAdmissionConfirmation(currentSocketRef);
  currentSocketRef.confirmExecutionAdmission = executionAdmission.confirm;
  const leasesByProfileId = new Map<string, number>();
  const catalogs = new Map<number, RouteCatalog>([[0, emptyCatalog]]);
  let catalogRevision = 0;
  let activeCatalogRevision = 0;
  let generation = 0;
  let draining = false;
  let disposed = false;
  let startupReplayPending = false;
  let connectionAbort: AbortController | null = null;
  let catalogLoad: Promise<ServiceExecutionHostCatalog> | null = null;
  let controllerReport: Promise<
    Awaited<ReturnType<typeof syncLocalServiceRuntimeAgentControllerReports>>
  > | null = null;
  let reportPolicy: "background" | "fresh" | null = null;
  const activeControls = new Set<Promise<unknown>>();
  const executionInput = createServiceExecutionInputReceiver({
    ownerUserId: identity.ownerUserId,
    registry: inflightTaskControlRegistry,
    adapters: localAdapterContainer,
  });
  const envelope = {
    protocol: SERVICE_EXECUTION_HOST_PROTOCOL,
    hostInstanceId: input.hostInstanceId,
  } as const;
  const computerFileAccessStorePath = resolveComputerFileAccessStorePath(
    input.runtimePaths.dataRootPath
  );
  const emit = (event: HostEvent): void => {
    if (!disposed) {
      input.emit(event);
    }
  };
  const invalidate = (scope: "routes" | "activity" | "execution") =>
    emit({ ...envelope, type: "invalidate", scope });
  const owner = {
    lane: identity.lane,
    ownerUserId: identity.ownerUserId,
    localAdapterContainer,
    presenter: input.presenter,
    serviceBundleId: input.serviceBundleId,
  };
  const reportingAttempt = () => {
    const connectionGeneration = currentSocketRef.connectionGeneration;
    return createRuntimeReportingAttemptObserver({
      serviceIdentity: {
        deviceId: identity.deviceId,
        contractGeneration: identity.serviceContractGeneration,
      },
      onAuthenticationFailure: (failure) =>
        emit({
          ...envelope,
          type: "authentication_failure",
          connectionGeneration,
          failure,
        }),
    });
  };

  function snapshot(): ServiceExecutionHostSnapshot {
    const state = localExecutionSlots.getDrainState();
    return {
      pid: process.pid,
      admission: draining ? "draining" : "open",
      activeCount: state.activeGlobal,
      pendingCount: state.pendingCount,
      localQuiescent:
        localExecutionSlots.isQuiescent() && activeControls.size === 0,
      unacknowledgedResultCount:
        listDispatchResultOutboxPendingAcknowledgementKeys({ ledgerPaths })
          .length,
      startupReplayPending,
      adapterIds: localAdapterContainer
        .listAdapters()
        .map((entry) => entry.adapterId),
    };
  }

  function assertConnection(expected: number): DaemonFrameSink {
    if (expected !== generation || !currentSocketRef.socket || disposed) {
      throw new ExecutionHostError(
        "host.connection_replaced",
        "The operation belongs to a retired connector generation."
      );
    }
    return currentSocketRef.socket;
  }

  function replayInteractions(): void {
    const sink = currentSocketRef.socket;
    if (!sink) {
      return;
    }
    for (const pending of pendingAgentInteractionRegistry.list()) {
      const leaseEpoch = leasesByProfileId.get(
        pending.authority.targetProfileId
      );
      if (pending.response || !leaseEpoch) {
        continue;
      }
      sendDispatchInteractionRequestFrame({
        attemptId: pending.authority.attemptId,
        connectionGeneration: generation,
        daemonSessionId: identity.daemonSessionId,
        dispatchId: pending.authority.dispatchId,
        executionIdentityEcho: pending.authority.executionIdentityEcho,
        executionTokenEcho: pending.authority.executionTokenEcho,
        interaction: pending.request,
        leaseEpoch,
        runtimeCoordinatorExecutionId:
          pending.authority.runtimeCoordinatorExecutionId,
        socket: sink,
        taskId: pending.taskId,
      });
    }
  }

  function startResultReplay(): void {
    const recordKeys = listDispatchResultOutboxPendingAcknowledgementKeys({
      ledgerPaths,
    });
    const expectedGeneration = generation;
    startupReplayPending = recordKeys.length > 0;
    if (startupReplayPending) {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.startup_result_replay_started",
        text: "Replaying retained results before accepting new work.",
      });
    }
    const replay = waitForDispatchResultOutboxAcknowledgement({
      abortSignal: connectionAbort?.signal,
      ledgerPaths,
      recordKeys,
    });
    flushDispatchResultOutbox({
      currentSocketRef,
      ledgerPaths,
      presenter: input.presenter,
    });
    replay
      .then((status) => {
        if (
          status === "acknowledged" &&
          generation === expectedGeneration &&
          currentSocketRef.socket &&
          !draining
        ) {
          startupReplayPending = false;
          if (recordKeys.length > 0) {
            emitRunLine({
              presenter: input.presenter,
              code: "daemon.run.startup_result_replay_completed",
              text: "Retained results were acknowledged; new work may be admitted.",
            });
          }
          invalidate("execution");
        }
      })
      .catch((error) => {
        emitRunLine({
          presenter: input.presenter,
          code: "daemon.run.startup_result_replay_failed",
          text: toErrorMessage(error),
        });
      });
  }

  async function reportControllers(policy: "background" | "fresh") {
    if (controllerReport) {
      const previous = controllerReport;
      if (policy !== "fresh" || reportPolicy === "fresh") {
        return await previous;
      }
      await previous;
    }
    const attempt = syncLocalServiceRuntimeAgentControllerReports({
      localAdapterContainer,
      onAttempt: reportingAttempt(),
      probePolicy: policy,
    });
    controllerReport = attempt;
    reportPolicy = policy;
    try {
      return await attempt;
    } finally {
      if (controllerReport === attempt) {
        controllerReport = null;
        reportPolicy = null;
      }
    }
  }

  const controls = createExecutionHostControls({
    computerFileAccessStorePath,
    ledgerPaths,
    localAdapterContainer,
    localExecutionSlots,
    presenter: input.presenter,
    routeCatalogState,
    refreshReports: async () => {
      // A control mutation needs evidence collected after it completed. Even a
      // fresh probe already in flight may have observed the pre-mutation state.
      // This is an ordering barrier only. The earlier report retains its own
      // outcome; its failure must not prevent collecting post-mutation facts.
      await Promise.allSettled([controllerReport]);
      return reportControllers("fresh");
    },
    invalidate,
  });
  const activity = startLocalAgentActivitySyncLoop({
    onError: (error) =>
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.agent_activity_sync_failed",
        text: toErrorMessage(error),
      }),
    onResult: (result) => {
      if (result.status === "idle") {
        return;
      }
      emitRunLine({
        presenter: input.presenter,
        code:
          result.status === "submitted"
            ? "daemon.run.agent_activity_sync"
            : "daemon.run.agent_activity_sync_unavailable",
        text:
          result.status === "submitted"
            ? `Local Agent reporting submitted ${result.submittedCount} activity event(s), ${result.controllerTaskEventSubmittedCount} task callback event(s), and ${result.sessionInventory.submittedSourceCount} Session Inventory source(s).`
            : `Agent Activity sync deferred: ${result.reason ?? "unavailable"}.`,
        payload: {
          ...result.health,
          controllerTaskEventSubmittedCount:
            result.controllerTaskEventSubmittedCount,
          controllerTaskHealth: result.controllerTaskHealth,
          observedCount: result.observedCount,
          reason: result.reason,
          sessionInventory: result.sessionInventory,
          status: result.status,
          submittedCount: result.submittedCount,
        },
      });
    },
  });
  const integrations = createManagedAgentActivityIntegrationRefreshScheduler({
    onError: (error) =>
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.agent_activity_integration_refresh_failed",
        text: toErrorMessage(error),
      }),
    onResult: (result) => {
      if (result.status === "ready") {
        activity.requestSync({ refreshContext: true });
      }
    },
  });
  // Inventory is independent of opening the inherited control endpoint.
  integrations.request();

  function beginDrain(
    options: ServiceExecutionHostInput<"beginDrain"> = {}
  ): ServiceExecutionHostSnapshot {
    if (options.onlyIfIdle) {
      if (draining || disposed) {
        throw new ExecutionHostError(
          "host.draining",
          "The Host already has an admitted stop."
        );
      }
      const current = snapshot();
      if (
        startupReplayPending ||
        !current.localQuiescent ||
        current.unacknowledgedResultCount > 0
      ) {
        return current;
      }
    }
    // No await between the owning work check and closing admission. A Wake or
    // control that arrives first wins; later arrivals see the same drain fence.
    draining = true;
    localExecutionSlots.beginDrain();
    return snapshot();
  }

  async function drain(): Promise<ServiceExecutionHostSnapshot> {
    beginDrain();
    await localExecutionSlots.drain();
    await Promise.allSettled([...activeControls]);
    const drained = snapshot();
    input.onWorkStateChange?.(drained.localQuiescent);
    return drained;
  }

  function trackControl<T>(run: () => Promise<T>): Promise<T> {
    if (draining || disposed) {
      return Promise.reject(
        new ExecutionHostError(
          "host.draining",
          "The execution host is draining; new operations are not admitted."
        )
      );
    }
    input.onWorkStateChange?.(false);
    const operation = Promise.resolve().then(run);
    activeControls.add(operation);
    return operation.finally(() => {
      activeControls.delete(operation);
      input.onWorkStateChange?.(snapshot().localQuiescent);
      invalidate("execution");
    });
  }

  const handlers: Omit<ExecutionHostHandlers, "initialize"> = {
    health: snapshot,
    loadCatalog: async ({ initial }) => {
      if (!catalogLoad) {
        catalogLoad = loadExecutionHostCatalog(owner, initial)
          .then((catalog) => {
            const revision = ++catalogRevision;
            catalogs.set(revision, catalog);
            // Retain the active snapshot plus the latest two loads. Never resolve
            // a retired revision by substituting another set of routes.
            for (const key of catalogs.keys()) {
              if (key !== activeCatalogRevision && key < revision - 1) {
                catalogs.delete(key);
              }
            }
            return serviceExecutionHostCatalogSchema.parse({
              revision,
              expectedRoutesContractVersion:
                catalog.expectedRoutesContractVersion,
              profileIds: catalog.profileIds,
              routes: [...catalog.routeByProfileId.values()],
              skippedProfiles: catalog.skippedProfiles,
              workingFolderExpectedProfileIds:
                catalog.workingFolderExpectedProfileIds,
              workingFolderObservations: catalog.workingFolderObservations,
            });
          })
          .finally(() => {
            catalogLoad = null;
          });
      }
      return await catalogLoad;
    },
    configureConnection: async (request) => {
      if (request.executionAdmissionConfirmation !== true) {
        throw new ExecutionHostError(
          "host.execution_admission_unsupported",
          "The connected server must support execution admission confirmation before this Host can run tasks."
        );
      }
      if (request.connectionGeneration < generation || disposed) {
        throw new ExecutionHostError(
          "host.connection_replaced",
          "An older connector cannot replace the active connection."
        );
      }
      const catalog = catalogs.get(request.catalogRevision);
      if (!catalog || request.catalogRevision < activeCatalogRevision) {
        throw new ExecutionHostError(
          "host.catalog_replaced",
          "The requested Host catalog is no longer available."
        );
      }
      const applyRouteFacts = () => {
        activeCatalogRevision = request.catalogRevision;
        replaceMutableRouteCatalogState(routeCatalogState, catalog);
        leasesByProfileId.clear();
        for (const lease of request.leases) {
          leasesByProfileId.set(lease.profileId, lease.leaseEpoch);
        }
      };
      const syncPermissionModes = async () => {
        const outcomes = await syncActiveTaskPermissionModes({
          catalogState: routeCatalogState,
          inflightTaskControlRegistry,
          localAdapterContainer,
        });
        for (const outcome of outcomes) {
          emitRunLine({
            presenter: input.presenter,
            code: "daemon.run.active_permission_mode_sync",
            text: `active permission update ${outcome.status} for ${outcome.taskId}`,
            payload: outcome,
          });
        }
      };
      const sameConnection =
        request.connectionGeneration === generation &&
        currentSocketRef.socket !== null;
      if (sameConnection) {
        // An ordinary route-catalog refresh changes the applied route facts,
        // not the cloud connection. Keep its sink and result replay intact.
        applyRouteFacts();
        await syncPermissionModes();
        assertConnection(request.connectionGeneration);
        return snapshot();
      }
      connectionAbort?.abort();
      connectionAbort = new AbortController();
      generation = request.connectionGeneration;
      applyRouteFacts();
      const sink: DaemonFrameSink = {
        send: (raw) => {
          if (
            generation !== request.connectionGeneration ||
            currentSocketRef.socket !== sink
          ) {
            throw new ExecutionHostError(
              "host.connection_replaced",
              "This execution frame's connector has been retired."
            );
          }
          const frame = parseDaemonFrame(raw);
          if (!frame) {
            throw new ExecutionHostError(
              "host.invalid_frame",
              "Execution produced an invalid transport frame."
            );
          }
          emit({
            ...envelope,
            type: "frame",
            connectionGeneration: generation,
            frame: { v: RUNTIME_TRANSPORT_SCHEMA_VERSION, ...frame },
          });
        },
      };
      currentSocketRef.socket = sink;
      currentSocketRef.connectionGeneration = generation;
      executionAdmission.resend();
      await syncPermissionModes();
      assertConnection(request.connectionGeneration);
      replayInteractions();
      startResultReplay();
      return snapshot();
    },
    detachConnection: ({ connectionGeneration }) => {
      if (connectionGeneration === generation) {
        connectionAbort?.abort();
        currentSocketRef.socket = null;
        currentSocketRef.connectionGeneration = null;
        // The Host owns accepted work independently of the connector. Keep
        // queued tasks and their lifecycle evidence; admission is confirmed
        // again with RuntimeCoordinator before a provider can start.
      }
      return snapshot();
    },
    heartbeat: ({ connectionGeneration, staleProfileIds }) => {
      assertConnection(connectionGeneration);
      executionAdmission.resend();
      for (const profileId of staleProfileIds) {
        leasesByProfileId.delete(profileId);
      }
      flushDispatchResultOutbox({
        currentSocketRef,
        ledgerPaths,
        presenter: input.presenter,
      });
      replayInteractions();
      return snapshot();
    },
    handleFrame: async ({ connectionGeneration, frame }) => {
      const socket = assertConnection(connectionGeneration);
      if (frame.code === "daemon.dispatch.lifecycle_acknowledged") {
        executionAdmission.receive(frame.payload);
        return {};
      }
      if (frame.code === "daemon.computer_power.request") {
        const parsed = computerPowerRequestFrameSchema.safeParse(frame);
        if (!parsed.success) {
          throw new Error("Invalid computer power request.");
        }
        await trackControl(async () => {
          let result:
            | Awaited<ReturnType<typeof power.request>>
            | { status: "rejected"; code: string; message: string };
          try {
            if (parsed.data.payload.deviceId !== identity.deviceId) {
              throw new Error("This request targets a different computer.");
            }
            result = await power.request(parsed.data.payload.request);
          } catch (error) {
            result = {
              status: "rejected",
              code: "computer.power.rejected",
              message: toErrorMessage(error),
            };
          }
          socket.send(
            JSON.stringify({
              v: 1,
              code: "daemon.computer_power.request_result",
              payload: { requestId: parsed.data.payload.requestId, result },
            })
          );
        });
        return {};
      }
      if (isExecutionHostControlFrame(frame)) {
        await trackControl(() => controls.handleFrame(frame, socket));
        return {};
      }
      if (frame.code === "daemon.dispatch.deliver") {
        if (draining || startupReplayPending) {
          throw new ExecutionHostError(
            "host.admission_closed",
            "Execution admission is closed; the existing Coordinator retains delivery ownership."
          );
        }
        input.onWorkStateChange?.(false);
      }
      handleExecutionHostFrame({
        readRouteByProfileId: () => routeCatalogState.routeByProfileId,
        computerFileAccessStorePath,
        contextStore,
        currentSocketRef,
        daemonSessionId: identity.daemonSessionId,
        parsedFrame: frame,
        inflightDispatchMetaByTaskId,
        inflightTaskControlRegistry,
        ledgerPaths,
        leasesByProfileId,
        localAdapterContainer,
        localExecutionSlots,
        pendingAgentInteractionRegistry,
        profileOwnerName: input.profileOwnerName,
        profileOwnerUserId: identity.ownerUserId,
        requestCurrentWorkingFolderFactRefresh: () => invalidate("routes"),
        presenter: input.presenter,
        routeByProfileId: routeCatalogState.routeByProfileId,
        socket,
      });
      input.onWorkStateChange?.(snapshot().localQuiescent);
      invalidate("execution");
      return {};
    },
    cancel: (payload) =>
      handleLocalControlPlaneCancel({
        localAdapterContainer,
        payload,
        presenter: input.presenter,
        registry: inflightTaskControlRegistry,
      }),
    interrupt: (payload) =>
      handleLocalControlPlaneInterrupt({
        localAdapterContainer,
        payload,
        presenter: input.presenter,
        registry: inflightTaskControlRegistry,
      }),
    executionInput: (payload) => {
      const receive = () => {
        assertConnection(payload.connectionGeneration);
        if (
          leasesByProfileId.get(payload.request.targetProfileId) !==
            payload.leaseEpoch ||
          (payload.operation === "apply" && (draining || startupReplayPending))
        ) {
          throw new ExecutionHostError(
            "host.execution_input_unavailable",
            "The current execution route cannot accept this input."
          );
        }
        return executionInput(payload);
      };
      return payload.operation === "read" ? receive() : trackControl(receive);
    },
    conversationStatus: resolveLocalConversationExecutionStatus,
    setEnabled: (payload) => trackControl(() => controls.setEnabled(payload)),
    reportControllers: async ({ probePolicy }) => {
      const result = await reportControllers(probePolicy);
      return {
        ...result,
        reasonCodes: [...result.reasonCodes],
        hasArmedReprobe: consumeArmedAgentControllerInterfaceReprobe(),
      };
    },
    reportConversations: async () => {
      const result = await syncLocalServiceProviderConversationProofs({
        onAttempt: reportingAttempt(),
        routeCatalog: createRouteCatalogFromMutableState(routeCatalogState),
      });
      return { ...result, reasonCodes: [...result.reasonCodes] };
    },
    persistCatalog: async ({ revision }) => {
      const catalog = catalogs.get(revision);
      if (!catalog || revision !== activeCatalogRevision) {
        throw new ExecutionHostError(
          "host.catalog_replaced",
          "Only the currently accepted catalog can be persisted."
        );
      }
      await persistExecutionHostCatalog(owner, catalog);
      return {};
    },
    syncActivity: ({ refreshIntegrations }) => {
      activity.requestSync({ reconcile: true, refreshContext: true });
      if (refreshIntegrations) {
        // Startup may have skipped installation because no Project was bound.
        // Reuse the Host's coalescing scheduler; never block connector control.
        integrations.request();
      }
      return {};
    },
    beginDrain,
    drain,
    settleResults: async () => {
      if (!snapshot().localQuiescent) {
        throw new ExecutionHostError(
          "host.work_active",
          "Local work must drain before result settlement."
        );
      }
      const recordKeys = listDispatchResultOutboxPendingAcknowledgementKeys({
        ledgerPaths,
      });
      // An idle Host with no retained results needs no cloud connection to
      // prove settlement. In particular, failed connection setup must not
      // force an empty drain into an endless reconnect/close cycle.
      if (recordKeys.length === 0) {
        return { status: "acknowledged" };
      }
      if (!(currentSocketRef.socket && connectionAbort)) {
        return { status: "connection_closed" };
      }
      const abort = new AbortController();
      const onClose = () => abort.abort();
      const connectionSignal = connectionAbort.signal;
      connectionSignal.addEventListener("abort", onClose, { once: true });
      const timer = setTimeout(
        () => abort.abort(),
        CONTROLLED_SHUTDOWN_RESULT_ACK_TIMEOUT_MS
      );
      try {
        const wait = waitForDispatchResultOutboxAcknowledgement({
          abortSignal: abort.signal,
          ledgerPaths,
          recordKeys,
        });
        flushDispatchResultOutbox({
          currentSocketRef,
          ledgerPaths,
          presenter: input.presenter,
        });
        const result = await wait;
        if (result === "acknowledged") {
          return { status: "acknowledged" };
        }
        return {
          status: connectionSignal.aborted ? "connection_closed" : "timeout",
        };
      } finally {
        clearTimeout(timer);
        connectionSignal.removeEventListener("abort", onClose);
      }
    },
    stop: async () => {
      const result = await drain();
      await integrations.stop();
      await activity.stop();
      await power.stop();
      connectionAbort?.abort();
      currentSocketRef.socket = null;
      currentSocketRef.connectionGeneration = null;
      disposed = true;
      return result;
    },
  };

  return {
    handlers,
    snapshot,
    async closeAfterConnectorLoss() {
      if (!disposed) {
        handlers.detachConnection({ connectionGeneration: generation });
        // IPC loss is permanent for this Host, unlike a cloud socket reconnect.
        // Settle unstarted work through the normal result outbox instead of
        // waiting forever for a connector that cannot return.
        executionAdmission.close();
        await handlers.stop({});
      }
    },
  };
}
