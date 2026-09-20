// biome-ignore-all lint/performance/noBarrelFile: Package entrypoint intentionally re-exports Codex runtime helpers.
import {
  type AdapterAgentControllerConversationOccupancy,
  type AdapterCancelRequest,
  type AdapterCancelResult,
  type AdapterComputerFileAccessVerificationResult,
  type AdapterDispatchContextDelta,
  type AdapterDispatchFailure,
  type AdapterDispatchRequest,
  type AdapterDispatchResult,
  type AdapterDispatchTelemetry,
  type AdapterInterruptRequest,
  type AdapterInterruptResult,
  type AdapterInterruptSignal,
  type AdapterPreviewCallback,
  type AdapterRuntimeProcessEvent,
  type AdapterTransportMode,
  bridgeAgentControllerConversationRef,
  buildAdapterCancelRequest,
  buildExecutableLaunchContract,
  buildInterruptPlan,
  createSharedControlShell,
  createSharedDispatchShell,
  type RuntimeAdapter,
  type RuntimeAgentControllerLaunchContract,
  resolveBuiltinAdapterConversationBridgeSpec,
  verifyCliLaunchContract,
  type WaitForMs,
} from "@openmeld/adapter-core";
import {
  resolveCodexTimeoutMs as resolveCodexTimeoutMsLocal,
  verifyCodexCommandLaunchContract as verifyCodexLaunchContractLocal,
} from "./config/codex-runtime-config.js";
import {
  invokeCodexAppServer as invokeCodexAppServerLocal,
  invokeCodexWithSingleContextHeal as invokeCodexWithSingleContextHealLocal,
} from "./invoke/codex-invoke.js";
import type {
  CodexAppServerActiveTurnRegistrar,
  CodexAppServerActiveTurnRegistration,
} from "./transport/codex-app-server-transport.js";
import {
  buildCodexFileAccessBoundaryGlobalArgs,
  redactCodexFileAccessBoundaryDispatchFailure,
} from "./transport/codex-file-access-boundary.js";
import {
  type WaitForCodexThreadWriterAvailability,
  waitForCodexThreadWriterAvailability,
} from "./transport/codex-thread-writer-availability.js";

export type CodexInvokeResult = {
  contextDelta?: AdapterDispatchContextDelta;
  output: string;
  telemetry?: AdapterDispatchTelemetry;
};

type CodexDispatchRequest = AdapterDispatchRequest & {
  cancellationSignal?: AbortSignal;
};

export type CodexInvokeFn = (
  input: CodexDispatchRequest & {
    onPreview?: AdapterPreviewCallback;
  }
) => Promise<CodexInvokeResult>;

export type CodexInvokeByTransportMode = Partial<
  Record<AdapterTransportMode, CodexInvokeFn>
>;

export type CodexInterruptSignalFn = (
  signal: AdapterInterruptSignal
) => Promise<void>;

export type CodexCancelSignalFn = (
  input: AdapterCancelRequest
) => Promise<void>;

type CodexAppServerActiveTurn = Pick<
  CodexAppServerActiveTurnRegistration,
  "interrupt" | "threadId" | "turnId"
>;

export type CodexAdapterOptions = {
  codexBin?: string;
  codexTimeoutMs?: number | null;
  enableLocalCliTransport?: boolean;
  gracefulTimeoutMs?: number;
  invoke?: CodexInvokeFn;
  invokeByMode?: CodexInvokeByTransportMode;
  launchContract?: RuntimeAgentControllerLaunchContract;
  registerRuntimeProcess?: (
    input: AdapterRuntimeProcessEvent & { taskId: string }
  ) => void;
  sendCancel?: CodexCancelSignalFn;
  sendInterrupt?: CodexInterruptSignalFn;
  waitForMs?: WaitForMs;
  waitForThreadWriterAvailability?: WaitForCodexThreadWriterAvailability;
};

export {
  type CodexInstalledLaunchCandidatesOptions,
  isCodexHostApplicationCommandPath,
  resolveCodexTimeoutMs,
  resolveInstalledCodexLaunchCandidates,
  resolveInstalledCodexLaunchContract,
  verifyCodexCommandLaunchContract,
  verifyCodexLaunchContract,
} from "./config/codex-runtime-config.js";
export { isLikelyContextLostError } from "./context/codex-context-heal.js";
export {
  type CodexInvokeResult as CodexRuntimeInvokeResult,
  CodexRuntimeError,
  invokeCodexAppServer,
  invokeCodexWithSingleContextHeal,
} from "./invoke/codex-invoke.js";
export { processCodexStdoutLine } from "./output/codex-output-parser.js";
export { extractCodexToolActivityEvent } from "./output/codex-tool-activity.js";
export {
  type CodexAppServerAccountProbeResult,
  CodexAppServerTransportError,
  classifyCodexThreadWriterConflict,
  forkCodexAppServerThread,
  invokeCodexAppServerTransport,
  probeCodexAppServerAccount,
  resolveCodexAppServerCompletedTurn,
  verifyCodexAppServerThread,
} from "./transport/codex-app-server-transport.js";
export {
  CodexCliTransportError,
  invokeCodexCliTransport,
} from "./transport/codex-cli-transport.js";
export { waitForCodexThreadWriterAvailability } from "./transport/codex-thread-writer-availability.js";
export { projectCodexUsageLimits } from "./usage/codex-usage-limits.js";

const CODEX_CONVERSATION_BRIDGE_SPEC =
  resolveBuiltinAdapterConversationBridgeSpec("codex");
const TEST_DISABLE_DEFAULT_INVOKE = Symbol.for(
  "openmeld.test.disableDefaultInvoke"
);

/**
 * Reader for {@link CodexDispatchStopEvidence}, keyed off the adapter object the
 * way {@link TEST_DISABLE_DEFAULT_INVOKE} keys off runtime options.
 *
 * {@link RuntimeAdapter} is the adapter's whole surface, and the stop evidence
 * has to travel out of a `cancel` or `interrupt` call into the Core path that
 * decides whether a successor may take an occupied reservation. Widening that
 * shared type for one adapter's control-plane bookkeeping would put a Codex-only
 * field on every adapter, so the reader rides along as a symbol-keyed property
 * that only a caller holding this symbol can find.
 */
export const READ_CODEX_DISPATCH_STOP_EVIDENCE = Symbol.for(
  "openmeld.codex.readDispatchStopEvidence"
);
const COMPUTER_FILE_ACCESS_ATTESTATION_TTL_MS = 5 * 60 * 1000;
const MAX_COMPUTER_FILE_ACCESS_ATTESTATIONS = 32;

type ComputerFileAccessAttestation = {
  expiresAtMs: number;
  result: Promise<AdapterComputerFileAccessVerificationResult>;
};

type OccupiedCodexDispatch = {
  abortController: AbortController;
  taskId: string;
};

/**
 * Whether the adapter has stopped a task, and whether Codex must still be asked
 * to stop a turn that is in flight. A handoff may only take the reservation on a
 * record with `turnWasRunning: false`: with no turn to interrupt, nothing else in
 * this process can resume the thread, so the successor is the only remaining
 * claimant.
 */
export type CodexDispatchStopEvidence = {
  stoppedAtMs: number;
  taskId: string;
  turnWasRunning: boolean;
};

/**
 * What a Stop proved about a dispatch, held past the end of the dispatch call it
 * landed in.
 *
 * An occupied dispatch waits for the provider thread writer without holding it,
 * so a Stop that lands there aborts the wait loop before it can resume the
 * thread again: the attempt ends `runtime.turn.cancelled` and Codex never saw a
 * turn. That is the evidence a handoff needs before a successor may take the
 * reservation. A Stop that lands on a running turn is recorded the same way, so
 * that a later attempt for the same task cannot read it as proof that nothing
 * ran.
 */
type StoppedCodexDispatch = CodexDispatchStopEvidence;

type OccupiedCodexDispatchState = {
  occupancy: AdapterAgentControllerConversationOccupancy | null;
  registration: OccupiedCodexDispatch | null;
};

export const createCodexAdapter = (
  options: CodexAdapterOptions
): RuntimeAdapter => {
  const activeAppServerTurns = new Map<string, CodexAppServerActiveTurn>();
  const computerFileAccessAttestations = new Map<
    string,
    ComputerFileAccessAttestation
  >();
  const occupiedDispatches = new Map<string, OccupiedCodexDispatch>();
  // A Stop that ends an occupied wait must outlive the dispatch call it landed
  // in, because the wait loop resumes `thread/resume` on its own timer. A retry
  // that starts after the Stop would race a successor for the thread writer and
  // could win it, handing the same work to two executions. These entries are the
  // gate the loop consults before it resumes a thread.
  const stoppedDispatches = new Map<string, StoppedCodexDispatch>();
  const registerAppServerTurn = (
    registration: CodexAppServerActiveTurnRegistration
  ) => {
    const activeTurn = {
      interrupt: registration.interrupt,
      threadId: registration.threadId,
      turnId: registration.turnId,
    };
    activeAppServerTurns.set(registration.taskId, activeTurn);
    return () => {
      if (activeAppServerTurns.get(registration.taskId) === activeTurn) {
        activeAppServerTurns.delete(registration.taskId);
      }
    };
  };
  const sendInterrupt: CodexInterruptSignalFn = async (signal) => {
    const activeTurn = activeAppServerTurns.get(signal.taskId);
    if (activeTurn) {
      await activeTurn.interrupt();
      return;
    }

    if (options.sendInterrupt) {
      await options.sendInterrupt(signal);
      return;
    }

    throw Object.assign(
      new Error("Codex App Server interrupt is not available for this task."),
      {
        code: "adapter.unsupported",
      }
    );
  };
  const controlShell = createSharedControlShell({
    gracefulTimeoutMs: options.gracefulTimeoutMs,
    sendCancel: options.sendCancel,
    sendInterrupt,
    waitForMs: options.waitForMs,
  });
  const fallbackCancel = controlShell.cancel;
  const cancel: NonNullable<RuntimeAdapter["cancel"]> = async (request) => {
    const occupiedDispatchAborted = abortOccupiedCodexDispatch({
      occupiedDispatches,
      request,
    });
    if (occupiedDispatchAborted && !activeAppServerTurns.has(request.taskId)) {
      recordStoppedCodexDispatch({
        request,
        stoppedDispatches,
        turnWasRunning: false,
      });
      return {
        accepted: true,
        deliveryPath: "cancel",
        // The wait was aborted with no turn running, so nothing can start for
        // this task any more. That is the one answer here strong enough for
        // work that replaces this attempt.
        localAttemptOutcome: "withdrawn_before_start",
        reasonCode: "accepted",
        signalDelivery: "sent",
        taskId: request.taskId,
      };
    }
    const turnWasRunning = activeAppServerTurns.has(request.taskId);
    const result = fallbackCancel
      ? await fallbackCancel(request)
      : ({
          accepted: false,
          reasonCode: "adapter.unsupported",
          signalDelivery: "not_sent",
          taskId: request.taskId,
        } satisfies AdapterCancelResult);
    if (occupiedDispatchAborted || turnWasRunning) {
      recordStoppedCodexDispatch({
        request,
        stoppedDispatches,
        turnWasRunning,
      });
    }
    // A turn that had already started keeps its own result and effects. The
    // interrupt is a request, not a completion barrier, so this says what was
    // asked for rather than claiming the attempt is gone.
    return turnWasRunning && result.accepted
      ? {
          ...result,
          localAttemptOutcome: "stop_requested_after_start" as const,
        }
      : result;
  };
  const interrupt: RuntimeAdapter["interrupt"] = async (request) => {
    const occupiedDispatchAborted = abortOccupiedCodexDispatch({
      occupiedDispatches,
      request,
    });
    if (occupiedDispatchAborted && !activeAppServerTurns.has(request.taskId)) {
      recordStoppedCodexDispatch({
        request,
        stoppedDispatches,
        turnWasRunning: false,
      });
      return {
        accepted: true,
        plan: buildInterruptPlan(request),
        reasonCode: "accepted",
        signalDelivery: "sent",
        taskId: request.taskId,
      };
    }
    const turnWasRunning = activeAppServerTurns.has(request.taskId);
    const result = await interruptCodexActiveAppServerTurn({
      activeAppServerTurns,
      request,
      fallbackInterrupt: controlShell.interrupt,
    });
    if (occupiedDispatchAborted || turnWasRunning) {
      recordStoppedCodexDispatch({
        request,
        stoppedDispatches,
        turnWasRunning,
      });
    }
    return result;
  };
  const sharedDispatch = createSharedDispatchShell({
    adapterId: "codex",
    bridgeSpec: CODEX_CONVERSATION_BRIDGE_SPEC,
    invoke: options.invoke,
    invokeByMode: resolveCodexInvokeByTransportMode({
      options,
      registerAppServerTurn,
    }),
    repairConversationPolicy: "require_canonical",
    resolveDefaultInvoke: () => resolveDefaultCodexInvoke(options),
    runtimeOptions: options,
  });
  const dispatch: RuntimeAdapter["dispatch"] = (request) =>
    dispatchCodexWithConversationOccupancy({
      occupiedDispatches,
      request,
      sharedDispatch,
      stoppedDispatches,
      waitForThreadWriterAvailability:
        options.waitForThreadWriterAvailability ??
        waitForCodexThreadWriterAvailability,
    });

  const verifyComputerFileAccessBoundary: NonNullable<
    RuntimeAdapter["verifyComputerFileAccessBoundary"]
  > = async (request) => {
    if (
      request.agentControllerPermissionMode === "codex:customConfig" ||
      (request.transportMode !== "codex-app-server" &&
        request.transportMode !== "local-cli")
    ) {
      return {
        reasonCode: "computer.file_access.controller_unsupported",
        supported: false,
      };
    }
    try {
      const configuredLaunchContract = resolveConfiguredCodexLaunchContract({
        codexBin: options.codexBin,
        inputLaunchContract: request.launchContract,
        optionLaunchContract: options.launchContract,
      });
      if (!configuredLaunchContract) {
        return {
          reasonCode: "computer.file_access.capability_unverified",
          supported: false,
        };
      }
      const probeArgs = [
        ...buildCodexFileAccessBoundaryGlobalArgs({
          boundary: request.boundary,
          executionMode: request.executionMode,
          permissionMode: request.agentControllerPermissionMode,
        }),
        "--version",
      ];
      const cacheKey = JSON.stringify({
        launchContract: configuredLaunchContract,
        probeArgs,
        workingDirectory: request.workingDirectory,
      });
      const nowMs = Date.now();
      const cached = computerFileAccessAttestations.get(cacheKey);
      if (cached && cached.expiresAtMs > nowMs) {
        return await cached.result;
      }
      if (cached) {
        computerFileAccessAttestations.delete(cacheKey);
      }
      const result = resolveCodexDispatchLaunchContract({
        codexBin: options.codexBin,
        inputLaunchContract: request.launchContract,
        optionLaunchContract: options.launchContract,
      })
        .then((launchContract) =>
          verifyCliLaunchContract({
            cwd: request.workingDirectory,
            displayName: "Codex file access boundary",
            launchContract,
            probeArgs,
            timeoutMs: 5000,
          })
        )
        .then<AdapterComputerFileAccessVerificationResult>((verification) =>
          verification.ok
            ? { supported: true }
            : {
                // Preserve a useful failure class without exposing stderr or
                // the private paths in the requested permission profile.
                reasonCode:
                  verification.failureKind === "completed_negative"
                    ? "computer.file_access.launch_rejected"
                    : "computer.file_access.capability_unverified",
                supported: false,
              }
        )
        .catch<AdapterComputerFileAccessVerificationResult>(() => ({
          reasonCode: "computer.file_access.capability_unverified",
          supported: false,
        }));
      rememberComputerFileAccessAttestation({
        attestations: computerFileAccessAttestations,
        cacheKey,
        value: {
          expiresAtMs: nowMs + COMPUTER_FILE_ACCESS_ATTESTATION_TTL_MS,
          result,
        },
      });
      return await result;
    } catch {
      return {
        reasonCode: "computer.file_access.capability_unverified",
        supported: false,
      };
    }
  };

  // The stop-evidence reader is not part of `RuntimeAdapter`, so it is attached
  // after the literal rather than declared inside it: one Codex-only
  // control-plane field is not worth widening an interface every adapter
  // implements.
  return Object.assign(
    {
      adapterId: "codex",
      cancel,
      dispatch,
      interrupt,
      verifyComputerFileAccessBoundary,
    } satisfies RuntimeAdapter,
    {
      [READ_CODEX_DISPATCH_STOP_EVIDENCE]: (
        taskId: string
      ): CodexDispatchStopEvidence | null =>
        stoppedDispatches.get(taskId) ?? null,
    }
  );
};

function readCodexConversationOccupancy(
  result: Awaited<ReturnType<RuntimeAdapter["dispatch"]>>,
  request: AdapterDispatchRequest
): AdapterAgentControllerConversationOccupancy | null {
  if (
    result.status !== "failed" ||
    request.transportMode !== "codex-app-server" ||
    !result.agentControllerConversationOccupancy
  ) {
    return null;
  }
  return result.agentControllerConversationOccupancy;
}

function abortOccupiedCodexDispatch(input: {
  occupiedDispatches: ReadonlyMap<string, OccupiedCodexDispatch>;
  request: { taskId: string };
}): boolean {
  const occupiedDispatch = input.occupiedDispatches.get(input.request.taskId);
  if (!occupiedDispatch) {
    return false;
  }
  occupiedDispatch.abortController.abort();
  return true;
}

/**
 * Records that a Stop ended a task, so no later attempt for it resumes the
 * thread.
 *
 * `turnWasRunning` is the part a caller must not drop: a Stop the adapter answers
 * without interrupting a native turn is evidence that nothing else in this
 * process holds the writer, while a Stop that lands on a running turn is only a
 * request. Both are recorded, because a record that hid the second kind would let
 * a later attempt read a running turn as a stopped one.
 */
function recordStoppedCodexDispatch(input: {
  request: { taskId: string };
  stoppedDispatches: Map<string, StoppedCodexDispatch>;
  turnWasRunning: boolean;
}): void {
  const existing = input.stoppedDispatches.get(input.request.taskId);
  const turnWasRunning = existing
    ? existing.turnWasRunning || input.turnWasRunning
    : input.turnWasRunning;
  input.stoppedDispatches.set(input.request.taskId, {
    stoppedAtMs: existing?.stoppedAtMs ?? Date.now(),
    taskId: input.request.taskId,
    turnWasRunning,
  });
}

function buildCodexDispatchCancelledResult(): AdapterDispatchFailure {
  return {
    errorCode: "runtime.turn.cancelled",
    errorMessage: "runtime.turn.cancelled: This OpenMeld request was stopped",
    errorType: "adapter",
    status: "failed",
  };
}

/**
 * Whether a dispatch result proves the attempt never reached a native turn.
 *
 * A Stop that lands while a dispatch is in flight must not be reported as
 * `runtime.turn.cancelled`: the transport uses that code for "Codex was stopped
 * before starting a turn", so claiming it for an attempt that may have won the
 * thread writer lock would tell Core nothing ran while a turn is running, and
 * invite a second execution of the same work. Only the transport's own pre-turn
 * cancellation and a refused `thread/resume` prove nothing started; every other
 * result is reported exactly as it came back, output included.
 */
function codexDispatchStoppedBeforeTurn(
  result: AdapterDispatchResult
): boolean {
  return (
    result.status === "failed" &&
    (result.errorCode === "runtime.turn.cancelled" ||
      result.agentControllerConversationOccupancy !== undefined)
  );
}

async function emitCodexConversationAvailable(input: {
  occupancy: AdapterAgentControllerConversationOccupancy;
  request: AdapterDispatchRequest;
}): Promise<void> {
  await input.request.onRuntimeEvent?.({
    agentControllerConversationId:
      input.occupancy.agentControllerConversationId,
    contractVersion: input.occupancy.contractVersion,
    phase: "agent_controller_conversation_available",
    tsMs: Date.now(),
  });
}

function rememberComputerFileAccessAttestation(input: {
  attestations: Map<string, ComputerFileAccessAttestation>;
  cacheKey: string;
  value: ComputerFileAccessAttestation;
}): void {
  while (input.attestations.size >= MAX_COMPUTER_FILE_ACCESS_ATTESTATIONS) {
    const oldestKey = input.attestations.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    input.attestations.delete(oldestKey);
  }
  input.attestations.set(input.cacheKey, input.value);
}

export const buildCodexInterruptRequest = (input: {
  reason?: string;
  taskId: string;
}): AdapterInterruptRequest => ({
  mode: "graceful",
  reason: input.reason,
  taskId: input.taskId,
});

export const buildCodexCancelRequest = (input: {
  reason?: string;
  taskId: string;
}): AdapterCancelRequest =>
  buildAdapterCancelRequest({
    reason: input.reason,
    taskId: input.taskId,
  });

async function dispatchCodexWithConversationOccupancy(input: {
  occupiedDispatches: Map<string, OccupiedCodexDispatch>;
  request: AdapterDispatchRequest;
  sharedDispatch: (
    request: CodexDispatchRequest
  ) => Promise<AdapterDispatchResult>;
  stoppedDispatches: ReadonlyMap<string, StoppedCodexDispatch>;
  waitForThreadWriterAvailability: WaitForCodexThreadWriterAvailability;
}): Promise<AdapterDispatchResult> {
  const state: OccupiedCodexDispatchState = {
    occupancy: null,
    registration: null,
  };
  try {
    while (true) {
      // A Stop that already landed outranks everything below it: the loop
      // resumes `thread/resume` on its own timer, so without this gate a retry
      // could win the thread writer back from the successor that took the
      // reservation.
      if (input.stoppedDispatches.has(input.request.taskId)) {
        return buildCodexDispatchCancelledResult();
      }
      const cancellationSignal =
        state.registration?.abortController.signal ?? undefined;
      if (cancellationSignal?.aborted) {
        return buildCodexDispatchCancelledResult();
      }
      const result = await input.sharedDispatch({
        ...input.request,
        ...(cancellationSignal ? { cancellationSignal } : {}),
      });
      if (
        state.registration?.abortController.signal.aborted &&
        codexDispatchStoppedBeforeTurn(result)
      ) {
        return buildCodexDispatchCancelledResult();
      }
      const occupancy = readCodexConversationOccupancy(result, input.request);
      if (occupancy) {
        const waitOutcome = await waitForOccupiedCodexConversation({
          ...input,
          occupancy,
          state,
        });
        if (waitOutcome === "cancelled") {
          return buildCodexDispatchCancelledResult();
        }
        continue;
      }
      if (state.occupancy) {
        await emitCodexConversationAvailable({
          occupancy: state.occupancy,
          request: input.request,
        });
        state.occupancy = null;
      }
      return finalizeCodexDispatchResult({ request: input.request, result });
    }
  } finally {
    removeOccupiedCodexDispatchRegistration({
      occupiedDispatches: input.occupiedDispatches,
      state,
      taskId: input.request.taskId,
    });
  }
}

async function waitForOccupiedCodexConversation(input: {
  occupancy: AdapterAgentControllerConversationOccupancy;
  occupiedDispatches: Map<string, OccupiedCodexDispatch>;
  request: AdapterDispatchRequest;
  state: OccupiedCodexDispatchState;
  waitForThreadWriterAvailability: WaitForCodexThreadWriterAvailability;
}): Promise<"cancelled" | "retry"> {
  const registration = ensureOccupiedCodexDispatchRegistration(input);
  if (!input.state.occupancy) {
    await input.request.onRuntimeEvent?.({
      agentControllerConversationId:
        input.occupancy.agentControllerConversationId,
      contractVersion: input.occupancy.contractVersion,
      phase: "agent_controller_conversation_occupied",
      tsMs: Date.now(),
    });
    input.state.occupancy = input.occupancy;
  }
  const waitResult = await input.waitForThreadWriterAvailability({
    env: input.request.env,
    occupancy: input.occupancy,
    signal: registration.abortController.signal,
  });
  if (waitResult === "aborted" || registration.abortController.signal.aborted) {
    return "cancelled";
  }
  if (waitResult === "release_observed") {
    await emitCodexConversationAvailable({
      occupancy: input.occupancy,
      request: input.request,
    });
    input.state.occupancy = null;
  }
  return registration.abortController.signal.aborted ? "cancelled" : "retry";
}

function ensureOccupiedCodexDispatchRegistration(input: {
  occupiedDispatches: Map<string, OccupiedCodexDispatch>;
  request: AdapterDispatchRequest;
  state: OccupiedCodexDispatchState;
}): OccupiedCodexDispatch {
  if (input.state.registration) {
    return input.state.registration;
  }
  const registration = {
    abortController: new AbortController(),
    taskId: input.request.taskId,
  };
  input.state.registration = registration;
  input.occupiedDispatches.set(input.request.taskId, registration);
  return registration;
}

function finalizeCodexDispatchResult(input: {
  request: AdapterDispatchRequest;
  result: AdapterDispatchResult;
}): AdapterDispatchResult {
  if (
    input.result.status === "failed" &&
    input.request.computerFileAccessBoundary !== undefined
  ) {
    return redactCodexFileAccessBoundaryDispatchFailure(input.result);
  }
  return input.result;
}

function removeOccupiedCodexDispatchRegistration(input: {
  occupiedDispatches: Map<string, OccupiedCodexDispatch>;
  state: OccupiedCodexDispatchState;
  taskId: string;
}): void {
  const registration = input.state.registration;
  if (
    registration &&
    input.occupiedDispatches.get(input.taskId) === registration
  ) {
    input.occupiedDispatches.delete(input.taskId);
  }
}

const resolveDefaultCodexInvoke = (
  options: CodexAdapterOptions
): CodexInvokeFn => {
  const codexTimeoutMs = options.codexTimeoutMs ?? resolveCodexTimeoutMsLocal();

  return async (input): Promise<CodexInvokeResult> => {
    const launchContract = await resolveCodexDispatchLaunchContract({
      codexBin: options.codexBin,
      inputLaunchContract: input.launchContract,
      optionLaunchContract: options.launchContract,
    });
    const onProcessControlEvent = options.registerRuntimeProcess
      ? (event: AdapterRuntimeProcessEvent) => {
          options.registerRuntimeProcess?.({
            ...event,
            taskId: input.taskId,
          });
        }
      : undefined;
    const result = await invokeCodexWithSingleContextHealLocal({
      agentControllerPermissionMode: input.agentControllerPermissionMode,
      computerFileAccessBoundary: input.computerFileAccessBoundary,
      launchContract,
      codexTimeoutMs,
      codexWorkdir: input.runtimeContext.providerRuntimeWorkingDirectory,
      conversationPolicy: input.conversationPolicy,
      env: input.env,
      executionMode: input.executionMode,
      ...(onProcessControlEvent ? { onProcessControlEvent } : {}),
      ...(input.onPreview ? { onPreview: input.onPreview } : {}),
      ...(input.onRuntimeEvent ? { onRuntimeEvent: input.onRuntimeEvent } : {}),
      prompt: input.prompt,
      streamingMode: input.streamingMode,
      threadId: normalizeOptionalText(input.agentControllerConversationId),
    });

    const agentControllerConversation = CODEX_CONVERSATION_BRIDGE_SPEC
      ? bridgeAgentControllerConversationRef({
          bridgeSpec: CODEX_CONVERSATION_BRIDGE_SPEC,
          agentControllerConversationId: result.threadId,
        })
      : null;
    return {
      contextDelta: {
        agentControllerConversationId: result.threadId,
        refreshed: result.contextHealed,
        ...(agentControllerConversation ? { agentControllerConversation } : {}),
      },
      output: result.output,
      ...(result.telemetry ? { telemetry: result.telemetry } : {}),
    };
  };
};

const resolveCodexInvokeByTransportMode = (input: {
  options: CodexAdapterOptions;
  registerAppServerTurn: CodexAppServerActiveTurnRegistrar;
}): CodexInvokeByTransportMode | undefined => {
  if (input.options.invoke || isDefaultInvokeDisabledForTests(input.options)) {
    return input.options.invokeByMode;
  }
  return {
    "codex-app-server": resolveDefaultCodexAppServerInvoke(input),
    ...(input.options.enableLocalCliTransport
      ? { "local-cli": resolveDefaultCodexInvoke(input.options) }
      : {}),
    ...(input.options.invokeByMode ?? {}),
  };
};

const resolveDefaultCodexAppServerInvoke = (input: {
  options: CodexAdapterOptions;
  registerAppServerTurn: CodexAppServerActiveTurnRegistrar;
}): CodexInvokeFn => {
  const codexTimeoutMs =
    input.options.codexTimeoutMs ?? resolveCodexTimeoutMsLocal();

  return async (dispatchInput): Promise<CodexInvokeResult> => {
    const launchContract = await resolveCodexDispatchLaunchContract({
      codexBin: input.options.codexBin,
      inputLaunchContract: dispatchInput.launchContract,
      optionLaunchContract: input.options.launchContract,
    });
    const onProcessControlEvent = input.options.registerRuntimeProcess
      ? (event: AdapterRuntimeProcessEvent) => {
          input.options.registerRuntimeProcess?.({
            ...event,
            taskId: dispatchInput.taskId,
          });
        }
      : undefined;
    const result = await invokeCodexAppServerLocal({
      agentControllerPermissionMode:
        dispatchInput.agentControllerPermissionMode,
      cancellationSignal: dispatchInput.cancellationSignal,
      computerFileAccessBoundary: dispatchInput.computerFileAccessBoundary,
      launchContract,
      codexTimeoutMs,
      codexWorkdir:
        dispatchInput.runtimeContext.providerRuntimeWorkingDirectory,
      conversationPolicy: dispatchInput.conversationPolicy,
      env: dispatchInput.env,
      executionMode: dispatchInput.executionMode,
      instructionPrompt: dispatchInput.instructionPrompt,
      newSessionTitle: dispatchInput.newSessionTitle,
      onActiveTurn: input.registerAppServerTurn,
      ...(dispatchInput.onInteractionRequest
        ? { onInteractionRequest: dispatchInput.onInteractionRequest }
        : {}),
      ...(onProcessControlEvent ? { onProcessControlEvent } : {}),
      ...(dispatchInput.onPreview
        ? { onPreview: dispatchInput.onPreview }
        : {}),
      ...(dispatchInput.onRuntimeEvent
        ? { onRuntimeEvent: dispatchInput.onRuntimeEvent }
        : {}),
      prompt: dispatchInput.prompt,
      streamingMode: dispatchInput.streamingMode,
      taskId: dispatchInput.taskId,
      threadId: normalizeOptionalText(
        dispatchInput.agentControllerConversationId
      ),
    });

    const agentControllerConversation = CODEX_CONVERSATION_BRIDGE_SPEC
      ? bridgeAgentControllerConversationRef({
          bridgeSpec: CODEX_CONVERSATION_BRIDGE_SPEC,
          agentControllerConversationId: result.threadId,
        })
      : null;
    return {
      contextDelta: {
        agentControllerConversationId: result.threadId,
        ...(result.contextHealed ? { refreshed: true } : {}),
        ...(agentControllerConversation ? { agentControllerConversation } : {}),
      },
      output: result.output,
      ...(result.telemetry ? { telemetry: result.telemetry } : {}),
    };
  };
};

async function interruptCodexActiveAppServerTurn(input: {
  activeAppServerTurns: ReadonlyMap<string, CodexAppServerActiveTurn>;
  fallbackInterrupt: RuntimeAdapter["interrupt"];
  request: AdapterInterruptRequest;
}): Promise<AdapterInterruptResult> {
  const activeTurn = input.activeAppServerTurns.get(input.request.taskId);
  if (!activeTurn) {
    return await input.fallbackInterrupt(input.request);
  }

  const plan: AdapterInterruptResult["plan"] = {
    initial: {
      mode: input.request.mode ?? "graceful",
      reason: input.request.reason ?? "service.interrupt",
      taskId: input.request.taskId,
    },
  };

  try {
    await activeTurn.interrupt();
    return {
      accepted: true,
      plan,
      reasonCode: "accepted",
      signalDelivery: "sent",
      taskId: input.request.taskId,
    };
  } catch (error) {
    return {
      accepted: false,
      plan,
      reasonCode: "signal.send_failed",
      reasonDetail: toErrorMessage(error),
      signalDelivery: "not_sent",
      taskId: input.request.taskId,
    };
  }
}

async function resolveCodexDispatchLaunchContract(input: {
  codexBin?: string;
  inputLaunchContract?: RuntimeAgentControllerLaunchContract | null;
  optionLaunchContract?: RuntimeAgentControllerLaunchContract;
}): Promise<RuntimeAgentControllerLaunchContract> {
  const explicitLaunchContract = resolveConfiguredCodexLaunchContract(input);
  if (explicitLaunchContract) {
    const verification = await verifyCodexLaunchContractLocal({
      launchContract: explicitLaunchContract,
    });
    if (verification.ok) {
      return explicitLaunchContract;
    }
    throw Object.assign(new Error(verification.errorMessage), {
      code: "controller.launch.needs_repair",
      errorType: "config",
    });
  }

  throw Object.assign(
    new Error("Codex launch contract is required for runtime dispatch."),
    {
      code: "controller.launch.needs_repair",
      errorType: "config",
    }
  );
}

function resolveConfiguredCodexLaunchContract(input: {
  codexBin?: string;
  inputLaunchContract?: RuntimeAgentControllerLaunchContract | null;
  optionLaunchContract?: RuntimeAgentControllerLaunchContract;
}): RuntimeAgentControllerLaunchContract | null {
  return (
    input.inputLaunchContract ??
    input.optionLaunchContract ??
    (normalizeOptionalText(input.codexBin)
      ? buildExecutableLaunchContract({
          commandPath: normalizeOptionalText(input.codexBin) as string,
        })
      : null)
  );
}

const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isDefaultInvokeDisabledForTests = (
  options: CodexAdapterOptions
): boolean =>
  (options as Record<PropertyKey, unknown>)[TEST_DISABLE_DEFAULT_INVOKE] ===
  true;
