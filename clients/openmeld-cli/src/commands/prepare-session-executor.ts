import { createPrepareReadinessApi } from "@openmeld/api-client";
import {
  PREPARE_SESSION_STREAM_PROTOCOL_VERSION,
  prepareSessionResponseSchema,
  prepareSessionStreamServerFrameSchema,
} from "@openmeld/schemas";
import type {
  GetPrepareReadinessResponse,
  PrepareLocalAgentCatalog,
  PrepareLocalReadinessSnapshot,
  PrepareSessionSnapshot,
  PrepareSessionStreamServerFrame,
  PrepareStepId,
} from "@openmeld/schemas/types";
import {
  getSetupFlowCopy,
  PREPARE_SESSION_RECONNECT_GRACE_MS,
} from "@openmeld/start";
import { sleep } from "@openmeld/utils";
import { reconcileNewRunnableBuiltinAgentsForSetup } from "../agents/registry";
import {
  type AuthSessionStateResult,
  getAuthSessionState,
} from "../config/auth-session";
import { readDaemonServiceContract } from "../config/daemon-service-contract";
import {
  appendLocalAgentsGuideUrl,
  buildLocalAgentsGuideUrl,
  buildNoLocalAgentsNoticeLines,
} from "../guides/local-agents-guide-url";
import {
  assertSelectedAgentControllerReportSubmissionsAccepted,
  resolveSelectedAgentControllerReadiness,
  type SelectedAgentControllerReadinessDecision,
  type SelectedAgentControllerReportResult,
  submitSelectedAgentControllerReports,
} from "../local-service/reporting/selected-agent-controller-reporting";
import { buildLocalAgentCatalogFromReadiness } from "../local-service/state/current-device-identity";
import { notifyDaemonRouteCatalogChanged } from "../local-service/state/route-catalog-sync-notifier";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import { getCliVersionInfo } from "../runtime/cli-version";
import type { createPresenter } from "../runtime/presenter/index";
import { computeRetryDelayMs } from "../runtime/retry-delay";
import type { RuntimeContext } from "../runtime/types";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { fetchSpaceRequestWithTimeout } from "../space/fetch-with-timeout";
import { runStartLocalAgentsEnable } from "../start-local/agents-local";
import { collectStartLocalReadiness } from "../start-local/readiness";
import type { StartReadinessSnapshot } from "../start-local/readiness-types";
import {
  isLocalMachineFailureError,
  LocalMachineFailureError,
} from "../system/local-machine-recovery";
import { runDaemonServiceParticipationGate } from "../system/local-service-participation-gate";
import { connectWebSocket } from "../transport/ws";
import { resolveControllingTerminalSession } from "../ui/controlling-terminal";
import { renderInfoCard } from "../ui/info-card";
import { promptSearchSelect } from "../ui/search-select";
import {
  createSetupProgressReporter,
  type SetupProgressStepHandle,
} from "../ui/setup-progress";
import { runAgentsRepair } from "./agents";
import {
  collectPrepareStepDiagnostics,
  type PrepareServiceJobVerdict,
  resolvePrepareServiceJobVerdict,
} from "./prepare-step-diagnostics";
import { syncLocalSetupCurrentDeviceTargetFromServiceContract } from "./setup-current-device";
import { shouldForceSetupServiceRefresh } from "./setup-force-service-refresh";

const PREPARE_TOKEN_HEADER = "x-openmeld-prepare-token";
// computeRetryDelayMs schedule sums to 11750ms across 8 sleeps (attempts 1-8),
// matching the prior fixed 11 x 1000ms = 11000ms budget before giving up.
const REPORT_RUNTIME_CONNECTION_MAX_ATTEMPTS = 9;
const VERIFY_SETUP_POLL_TIMEOUT_MS = 120_000;
const VERIFY_SETUP_RETRY_INITIAL_DELAY_MS = 2000;
const VERIFY_SETUP_RETRY_MAX_DELAY_MS = 5000;
const VERIFY_SETUP_CONVERGING_TIMEOUT_SUPPORT_CODE =
  "verify_setup.converging_timeout";
const VERIFY_SETUP_CONVERGING_TIMEOUT_MESSAGE =
  "OpenMeld Service is still finishing its final checks in the background.";
const VERIFY_SETUP_READINESS_UNREACHABLE_SUPPORT_CODE =
  "verify_setup.readiness_unreachable";
const WAITING_PROGRESS_DELAY_MS = 500;

const TERMINAL_PREPARE_STEP_ORDER: readonly PrepareStepId[] = [
  "prepare_selected_agents",
  "refresh_service",
  "report_runtime",
  "verify_setup",
];

class PrepareSessionBlockedByCoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrepareSessionBlockedByCoreError";
  }
}

export class PrepareSessionCancelledError extends Error {
  constructor() {
    super("Setup was cancelled.");
    this.name = "PrepareSessionCancelledError";
  }
}

type PrepareSessionExecutorInput = {
  gatewayUrl: string;
  startSession: string;
  localAgentSelection?: PrepareSessionLocalAgentSelection;
  runtime: RuntimeContext;
  presenter: ReturnType<typeof createPresenter>;
  interactive: boolean;
  view?: string;
};

export type PrepareSessionExecutorResult =
  | {
      completionFacts?: PrepareSessionExecutorCompletionFacts;
      snapshot: PrepareSessionSnapshot;
      status: "completed";
    }
  | {
      reason: "terminal_replaced" | "user_cancelled";
      status: "not_completed";
    };

export type PrepareSessionExecutorCompletionFacts = {
  openMeldServiceRuntimeIdentity: {
    deviceId: string;
    runtimeLane: string;
  } | null;
  runtimeReports: readonly SelectedAgentControllerReportResult[];
  selectedLocalAgentIds: readonly string[];
};

export type PrepareSessionLocalAgentSelection =
  | {
      mode: "all";
    }
  | {
      mode: "none";
    }
  | {
      localAgentIds: string[];
      mode: "specific";
    };

export async function runPrepareSessionExecutor(
  input: PrepareSessionExecutorInput
): Promise<PrepareSessionExecutorResult> {
  let initial = await resolvePrepareSessionToken({
    gatewayUrl: input.gatewayUrl,
    opaqueToken: input.startSession,
  });
  const alreadyCompleted = finishIfPrepareSessionAlreadyCompleted({
    input,
    snapshot: initial,
  });
  if (alreadyCompleted) {
    return alreadyCompleted;
  }

  let reconnectAttempts = 0;
  let reconnectDeadlineMs: number | null = null;
  while (true) {
    try {
      return await runPrepareSessionExecutorOnce({
        input,
        initial,
        onTerminalConnected: () => {
          reconnectAttempts = 0;
          reconnectDeadlineMs = null;
        },
      });
    } catch (error) {
      if (error instanceof PrepareSessionCancelledError) {
        return {
          reason: "user_cancelled",
          status: "not_completed",
        };
      }
      if (error instanceof PrepareSessionTerminalReplacedError) {
        emitHumanStatus(input, "Terminal replaced", [
          "A newer Terminal command is running this setup.",
          "You can close this window.",
        ]);
        return {
          reason: "terminal_replaced",
          status: "not_completed",
        };
      }
      if (error instanceof PrepareSessionConnectionInterruptedError) {
        const reconnectResult = await reconnectPrepareSession({
          attempts: reconnectAttempts,
          connectionError: error,
          deadlineMs: reconnectDeadlineMs,
          input,
        });
        if (reconnectResult.result) {
          return reconnectResult.result;
        }
        initial = reconnectResult.snapshot;
        reconnectAttempts = reconnectResult.attempts;
        reconnectDeadlineMs = reconnectResult.deadlineMs;
        continue;
      }
      throw error;
    }
  }
}

async function reconnectPrepareSession(input: {
  attempts: number;
  connectionError: PrepareSessionConnectionInterruptedError;
  deadlineMs: number | null;
  input: PrepareSessionExecutorInput;
}): Promise<{
  attempts: number;
  deadlineMs: number;
  result: PrepareSessionExecutorResult | null;
  snapshot: PrepareSessionSnapshot;
}> {
  const deadlineMs =
    input.deadlineMs ?? Date.now() + PREPARE_SESSION_RECONNECT_GRACE_MS;
  let attempts = input.attempts;
  let reconnectFailure: unknown = input.connectionError;
  emitHumanStatus(input.input, "Reconnecting", [
    getSetupFlowCopy("setup").connectTerminalReconnectingSummary,
  ]);

  while (Date.now() < deadlineMs) {
    attempts += 1;
    await sleep(
      Math.min(computeRetryDelayMs(attempts), deadlineMs - Date.now())
    );
    if (Date.now() >= deadlineMs) {
      break;
    }
    let snapshot: PrepareSessionSnapshot;
    try {
      snapshot = await resolvePrepareSessionToken({
        gatewayUrl: input.input.gatewayUrl,
        opaqueToken: input.input.startSession,
      });
    } catch (tokenError) {
      if (tokenError instanceof PrepareSessionTokenRejectedError) {
        throw tokenError;
      }
      reconnectFailure = tokenError;
      continue;
    }
    if (Date.now() >= deadlineMs) {
      break;
    }
    return {
      attempts,
      deadlineMs,
      result: finishIfPrepareSessionAlreadyCompleted({
        input: input.input,
        snapshot,
      }),
      snapshot,
    };
  }
  throw reconnectFailure;
}

function finishIfPrepareSessionAlreadyCompleted(input: {
  input: PrepareSessionExecutorInput;
  snapshot: PrepareSessionSnapshot;
}): PrepareSessionExecutorResult | null {
  if (input.snapshot.lifecycleStatus !== "completed") {
    return null;
  }
  if (input.input.localAgentSelection) {
    assertCompletedPrepareSessionMatchesTerminalSelection({
      selection: input.input.localAgentSelection,
      snapshot: input.snapshot,
    });
  }
  emitHumanSection(input.input, "OpenMeld setup");
  emitPrepareProgressLine(input.input, {
    state: "success",
    text: "Setup is already complete. You can return to OpenMeld Web.",
  });
  return {
    snapshot: input.snapshot,
    status: "completed",
  };
}

async function runPrepareSessionExecutorOnce(input: {
  initial: PrepareSessionSnapshot;
  input: PrepareSessionExecutorInput;
  onTerminalConnected: () => void;
}): Promise<PrepareSessionExecutorResult> {
  // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT setup-session
  // The local terminal is now attached to the Web-issued setup handoff. Phase 2
  // should route real setup state through this path, not parallel setup flows.
  emitHumanSection(input.input, "OpenMeld setup");
  const connectionProgress = startPrepareProgressStep(input.input, {
    code: "prepare.session.progress.connect_terminal",
    text: "Connecting Terminal to OpenMeld Web...",
  });

  let stream: PrepareSessionStream | null = null;
  try {
    stream = await connectPrepareSessionStream({
      gatewayUrl: input.input.gatewayUrl,
      opaqueToken: input.input.startSession,
      prepareSessionId: input.initial.prepareSessionId,
    });
    const connected = await waitForSnapshotWithProgress({
      input: input.input,
      stream,
      progress: connectionProgress,
      predicate: (snapshot) =>
        snapshot.terminalConnection.status === "connected",
      waitingMessage:
        "Still connecting. Keep this Terminal open; OpenMeld Web will update automatically",
    });
    input.onTerminalConnected();
    await enforcePrepareSessionTerminalAuth({
      input: input.input,
      stream,
      snapshot: connected,
    });
    connectionProgress.complete("Terminal connected. Keep this window open.");
    const withLocalAgents = await reportLocalAgentCatalogForSelection({
      input: input.input,
      stream,
      snapshot: connected,
    });
    const selected = await resolveAgentSelection({
      input: input.input,
      stream,
      snapshot: withLocalAgents,
    });
    if (selected.selectedLocalAgentIds.length === 0) {
      return {
        snapshot: selected,
        status: "completed",
      };
    }
    const completed = await executeSelectedAgentPreparation({
      input: input.input,
      stream,
      snapshot: selected,
    });
    return {
      ...(completed.completionFacts
        ? { completionFacts: completed.completionFacts }
        : {}),
      snapshot: completed.snapshot,
      status: "completed",
    };
  } catch (error) {
    connectionProgress.cancel();
    throw error;
  } finally {
    stream?.close();
  }
}

export async function resolveAgentSelection(input: {
  input: PrepareSessionExecutorInput;
  stream: PrepareSessionStream;
  snapshot: PrepareSessionSnapshot;
}): Promise<PrepareSessionSnapshot> {
  if (input.input.localAgentSelection) {
    const guideUrl = buildLocalAgentsGuideUrl(input.input.gatewayUrl);
    const localAgentIds = resolveTerminalSelectedLocalAgentIds({
      guideUrl,
      selection: input.input.localAgentSelection,
      snapshot: input.snapshot,
    });
    if (
      hasAgentSelectionBeenSaved(input.snapshot) &&
      haveSameLocalAgentIds(input.snapshot.selectedLocalAgentIds, localAgentIds)
    ) {
      return input.snapshot;
    }
    return await writeTerminalAgentSelection({
      ...(localAgentIds.length === 0 &&
      input.input.localAgentSelection.mode !== "none"
        ? { emptySelectionGuideUrl: guideUrl }
        : {}),
      input: input.input,
      localAgentIds,
      selectionSource: "explicit",
      stream: input.stream,
      snapshot: input.snapshot,
    });
  }
  if (hasAgentSelectionBeenSaved(input.snapshot)) {
    return input.snapshot;
  }
  const localAgentIds = resolveAutomaticLocalAgentSelection(input.snapshot);
  if (localAgentIds.length === 0) {
    emitAutomaticEmptyLocalAgentSelectionNotice({
      input: input.input,
      snapshot: input.snapshot,
    });
  }
  return await writeTerminalAgentSelection({
    input: input.input,
    localAgentIds,
    selectionSource: "automatic",
    stream: input.stream,
    snapshot: input.snapshot,
  });
}

function resolveAutomaticLocalAgentSelection(
  snapshot: PrepareSessionSnapshot
): string[] {
  return (snapshot.localAgentCatalog?.entries ?? [])
    .filter(
      (entry) =>
        entry.enabled && entry.selectable && entry.launchStatus === "ready"
    )
    .map((entry) => entry.agentId);
}

function emitAutomaticEmptyLocalAgentSelectionNotice(input: {
  input: PrepareSessionExecutorInput;
  snapshot: PrepareSessionSnapshot;
}): void {
  const detectedEntries = (
    input.snapshot.localAgentCatalog?.entries ?? []
  ).filter((entry) => entry.detected);
  const enabledDetectedEntries = detectedEntries.filter(
    (entry) => entry.enabled
  );
  if (detectedEntries.length > 0 && enabledDetectedEntries.length === 0) {
    emitPrepareProgressLine(input.input, {
      state: "success",
      text: "Local agents are off. Setup will continue without them.",
    });
    emitPrepareProgressDetail(
      input.input,
      "You can turn local agents on later from this computer's settings."
    );
    return;
  }
  if (enabledDetectedEntries.length > 0) {
    emitPrepareProgressLine(input.input, {
      state: "success",
      text: "OpenMeld found local agents, but cannot start them yet. Setup will continue without them.",
    });
    emitPrepareProgressDetail(
      input.input,
      "Review local agents later in this computer's settings."
    );
    return;
  }

  emitPrepareNoLocalAgentsNotice({
    guideUrl: buildLocalAgentsGuideUrl(input.input.gatewayUrl),
    input: input.input,
  });
}

function emitPrepareNoLocalAgentsNotice(input: {
  guideUrl: string;
  input: PrepareSessionExecutorInput;
}): void {
  const [summary, ...details] = buildNoLocalAgentsNoticeLines({
    guideUrl: input.guideUrl,
  });
  emitPrepareProgressLine(input.input, {
    state: "success",
    text: summary
      ? `${summary} Setup will continue without local agents.`
      : "Setup will continue without local agents.",
  });
  for (const detail of details) {
    emitPrepareProgressDetail(input.input, detail);
  }
}

export function resolveTerminalSelectedLocalAgentIds(input: {
  guideUrl?: string;
  selection: PrepareSessionLocalAgentSelection;
  snapshot: PrepareSessionSnapshot;
}): string[] {
  if (input.selection.mode === "none") {
    return [];
  }
  const catalog = input.snapshot.localAgentCatalog;
  if (!catalog) {
    throw new Error("OpenMeld could not load the local agent catalog.");
  }

  const selectableById = new Map(
    catalog.entries
      .filter((entry) => entry.selectable)
      .map((entry) => [entry.agentId, entry])
  );

  if (input.selection.mode === "all") {
    return catalog.entries
      .filter((entry) => entry.selectable)
      .map((entry) => entry.agentId);
  }

  const selectedIds = [...new Set(input.selection.localAgentIds)];
  const missingIds = selectedIds.filter(
    (agentId) => !selectableById.has(agentId)
  );
  if (missingIds.length > 0) {
    const selectableIds = [...selectableById.keys()];
    throw new Error(
      [
        `OpenMeld cannot select local agent ${missingIds.join(", ")} for setup.`,
        selectableIds.length > 0
          ? `Selectable local agents: ${selectableIds.join(", ")}.`
          : formatNoSelectableLocalAgentsFound(input.guideUrl),
      ].join(" ")
    );
  }
  return selectedIds;
}

function formatNoSelectableLocalAgentsFound(guideUrl?: string): string {
  const message = "No selectable local agents were found on this computer.";
  return guideUrl ? appendLocalAgentsGuideUrl({ guideUrl, message }) : message;
}

export function assertCompletedPrepareSessionMatchesTerminalSelection(input: {
  selection: PrepareSessionLocalAgentSelection;
  snapshot: PrepareSessionSnapshot;
}): void {
  const localAgentIds = resolveTerminalSelectedLocalAgentIds(input);
  if (
    haveSameLocalAgentIds(input.snapshot.selectedLocalAgentIds, localAgentIds)
  ) {
    return;
  }
  throw new Error(
    [
      "This OpenMeld setup already completed with a different local-agent selection.",
      "Generate a fresh OpenMeld Agent Interface prompt, then run the new setup command.",
    ].join(" ")
  );
}

async function writeTerminalAgentSelection(input: {
  emptySelectionGuideUrl?: string;
  input: PrepareSessionExecutorInput;
  localAgentIds: readonly string[];
  selectionSource: "automatic" | "explicit";
  stream: PrepareSessionStream;
  snapshot: PrepareSessionSnapshot;
}): Promise<PrepareSessionSnapshot> {
  const beforeWriteSnapshot =
    input.stream.getLatestSnapshot() ?? input.snapshot;
  const beforeWriteRevision = beforeWriteSnapshot.sessionRevision;
  const connectionEpoch = requireConnectionEpoch(beforeWriteSnapshot);
  input.stream.writeTerminalAgentSelection({
    connectionEpoch,
    expectedRevision: beforeWriteRevision,
    localAgentIds: [...input.localAgentIds],
  });
  const selectedSnapshot = await input.stream.waitForSnapshot((snapshot) => {
    return (
      snapshot.sessionRevision > beforeWriteRevision &&
      hasAgentSelectionBeenSaved(snapshot)
    );
  });
  emitPrepareProgressLine(input.input, {
    state: "success",
    text: formatTerminalAgentSelectionResult({
      emptySelectionGuideUrl: input.emptySelectionGuideUrl,
      localAgentIds: input.localAgentIds,
      selectionSource: input.selectionSource,
      snapshot: selectedSnapshot,
    }),
  });
  return selectedSnapshot;
}

function formatTerminalAgentSelectionResult(input: {
  emptySelectionGuideUrl?: string;
  localAgentIds: readonly string[];
  selectionSource: "automatic" | "explicit";
  snapshot: PrepareSessionSnapshot;
}): string {
  if (input.localAgentIds.length === 0) {
    const message =
      input.selectionSource === "automatic"
        ? "Enabled local agents: none"
        : "Selected: no local agents";
    return input.emptySelectionGuideUrl
      ? appendLocalAgentsGuideUrl({
          guideUrl: input.emptySelectionGuideUrl,
          message,
        })
      : message;
  }

  const localAgentNames = formatSelectedLocalAgentNames({
    localAgentIds: input.localAgentIds,
    snapshot: input.snapshot,
  });
  return input.selectionSource === "automatic"
    ? `Enabled local agents: ${localAgentNames}`
    : `Selected: ${localAgentNames}`;
}

export async function reportLocalAgentCatalogForSelection(input: {
  input: PrepareSessionExecutorInput;
  stream: PrepareSessionStream;
  snapshot: PrepareSessionSnapshot;
}): Promise<PrepareSessionSnapshot> {
  const connectionEpoch = requireConnectionEpoch(input.snapshot);
  emitHumanSection(input.input, "Local agents");
  const progress = startPrepareProgressStep(input.input, {
    code: "prepare.session.progress.local_agents",
    text: "Checking local agents...",
  });
  const reconciliation = input.input.localAgentSelection
    ? null
    : await reconcileNewRunnableBuiltinAgentsForSetup();
  const readiness = await collectStartLocalReadinessForSetupCatalog(
    input.input,
    progress
  );
  if (reconciliation) {
    if (reconciliation.registeredAgentIds.length > 0) {
      progress.detail({
        code: "prepare.session.progress.local_agents.enabled_automatically",
        text: `Enabled automatically: ${formatReconciledLocalAgentNames({
          agentIds: reconciliation.registeredAgentIds,
          readiness,
        })}.`,
      });
    }
    if (reconciliation.preservedDisabledAgentIds.length > 0) {
      progress.detail({
        code: "prepare.session.progress.local_agents.preserved_off",
        text: `Kept off: ${formatReconciledLocalAgentNames({
          agentIds: reconciliation.preservedDisabledAgentIds,
          readiness,
        })}.`,
      });
    }
  }
  const beforeWriteRevision =
    input.stream.getLatestSnapshot()?.sessionRevision ??
    input.snapshot.sessionRevision;
  input.stream.writeTerminalLocalAgentCatalog({
    connectionEpoch,
    localAgentCatalog: buildLocalAgentCatalogFromReadiness(readiness),
  });
  const reportedSnapshot = await input.stream.waitForSnapshot((snapshot) => {
    return (
      snapshot.sessionRevision > beforeWriteRevision &&
      snapshot.localAgentCatalog !== null
    );
  });
  progress.complete("Local agents checked.");
  return reportedSnapshot;
}

function formatReconciledLocalAgentNames(input: {
  agentIds: readonly string[];
  readiness: StartReadinessSnapshot;
}): string {
  const displayNameByAgentId = new Map(
    input.readiness.agents.candidates.map((candidate) => [
      candidate.agentId,
      candidate.displayName,
    ])
  );
  return input.agentIds
    .map(
      (agentId) =>
        displayNameByAgentId.get(agentId) ??
        formatLocalAgentDisplayName(agentId)
    )
    .join(", ");
}

async function collectStartLocalReadinessForSetupCatalog(
  input: PrepareSessionExecutorInput,
  progress: SetupProgressStepHandle
): Promise<StartReadinessSnapshot> {
  const initialReadiness = await collectStartLocalReadinessForSetup(input);
  const repairableAgentIds =
    resolveRepairableSetupLocalAgentIds(initialReadiness);
  if (repairableAgentIds.length === 0) {
    return initialReadiness;
  }

  progress.detail({
    code: "prepare.session.progress.local_agents.repair",
    text:
      repairableAgentIds.length === 1
        ? `Repairing ${formatLocalAgentDisplayName(
            repairableAgentIds.join("")
          )} before setup reports it...`
        : `Repairing ${repairableAgentIds.length} local agents before setup reports them...`,
  });
  for (const agentId of repairableAgentIds) {
    await repairLocalAgentForSetup({ agentId, input, progress });
  }

  const repairedReadiness = await collectStartLocalReadinessForSetup(input);
  const remainingRepairableAgentIds =
    resolveRepairableSetupLocalAgentIds(repairedReadiness);
  if (remainingRepairableAgentIds.length > 0) {
    throw new Error(
      formatSetupLocalAgentRepairStillRequired(remainingRepairableAgentIds)
    );
  }
  return repairedReadiness;
}

async function collectStartLocalReadinessForSetup(
  input: PrepareSessionExecutorInput
): Promise<StartReadinessSnapshot> {
  return await collectStartLocalReadiness({
    auth: {
      status: "valid",
      email: null,
      authBaseUrl: null,
      gatewayUrl: input.gatewayUrl,
    },
  });
}

function resolveRepairableSetupLocalAgentIds(
  readiness: StartReadinessSnapshot
): string[] {
  return [
    ...new Set(
      readiness.agents.candidates
        .filter((candidate) => {
          return (
            candidate.detected &&
            candidate.enabled &&
            candidate.launchStatus === "needs_repair"
          );
        })
        .map((candidate) => candidate.agentId)
    ),
  ];
}

function formatSetupLocalAgentRepairStillRequired(
  agentIds: readonly string[]
): string {
  const formattedAgentIds = agentIds.map(formatLocalAgentDisplayName);
  const repairCommand =
    agentIds.length === 1
      ? `openmeld agents repair --agent ${agentIds.join("")}`
      : `openmeld agents repair --agent ${agentIds.join(" ")}`;
  return [
    agentIds.length === 1
      ? `${formattedAgentIds.join("")} still needs local setup repair.`
      : `${formattedAgentIds.join(", ")} still need local setup repair.`,
    `Run \`${formatOpenMeldCliCommand(repairCommand)}\`, then copy a fresh setup command from OpenMeld Web and run setup again.`,
  ].join(" ");
}

function hasAgentSelectionBeenSaved(snapshot: PrepareSessionSnapshot): boolean {
  return snapshot.steps.some(
    (step) => step.id === "choose_local_agents" && step.state === "complete"
  );
}

function haveSameLocalAgentIds(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

async function executeSelectedAgentPreparation(input: {
  input: PrepareSessionExecutorInput;
  stream: PrepareSessionStream;
  snapshot: PrepareSessionSnapshot;
}): Promise<{
  completionFacts?: PrepareSessionExecutorCompletionFacts;
  snapshot: PrepareSessionSnapshot;
}> {
  let snapshot = input.snapshot;
  let reportRuntimeResult: TerminalStepRunResult | null = null;
  emitHumanSection(input.input, "Setup progress");
  while (snapshot.lifecycleStatus === "active") {
    const stepId = resolveNextTerminalPrepareStep(snapshot);
    if (stepId === null) {
      return { snapshot };
    }
    const connectionEpoch = requireConnectionEpoch(snapshot);
    const terminalStep = buildTerminalStep({
      connectedComputerId: snapshot.connectedComputerId,
      openMeldServiceRuntimeIdentity:
        resolveRuntimeIdentityFromPrepareSessionSnapshot(snapshot),
      humanProfileId: snapshot.humanProfileId,
      input: input.input,
      localAgentIds: snapshot.selectedLocalAgentIds,
      ownerUserId: snapshot.ownerUserId,
      stepId,
    });
    snapshot = await runTerminalStep({
      input: input.input,
      stream: input.stream,
      connectionEpoch,
      stepId,
      snapshot,
      ...terminalStep,
      onRunResult: (result) => {
        if (stepId === "report_runtime" && result?.runtimeReports) {
          reportRuntimeResult = result;
        }
      },
    });
  }
  return {
    ...(reportRuntimeResult
      ? {
          completionFacts: buildPrepareSessionExecutorCompletionFacts({
            reportRuntimeResult,
            selectedLocalAgentIds: snapshot.selectedLocalAgentIds,
          }),
        }
      : {}),
    snapshot,
  };
}

type RunTerminalStepInput = {
  input: PrepareSessionExecutorInput;
  stream: PrepareSessionStream;
  connectionEpoch: number;
  stepId: PrepareStepId;
  snapshot: PrepareSessionSnapshot;
  message: string;
  run: (
    progress: SetupProgressStepHandle
  ) => Promise<TerminalStepRunResult | undefined>;
  onRunResult?: (result: TerminalStepRunResult | undefined) => void;
  collectDiagnostics?: typeof collectPrepareStepDiagnostics;
  resolveServiceJobVerdict?: typeof resolvePrepareServiceJobVerdict;
};

export async function runTerminalStep(
  input: RunTerminalStepInput
): Promise<PrepareSessionSnapshot> {
  const progress = startPrepareProgressStep(input.input, {
    code: `prepare.session.progress.${input.stepId}`,
    text: input.message,
  });
  const stepStartRevision = input.snapshot.sessionRevision;
  input.stream.writeTerminalStep({
    connectionEpoch: input.connectionEpoch,
    expectedRevision: stepStartRevision,
    stepId: input.stepId,
    status: "started",
  });
  let startedSnapshot: PrepareSessionSnapshot | null = null;
  try {
    startedSnapshot = await input.stream.waitForSnapshot((snapshot) => {
      const step = findStep(snapshot, input.stepId);
      return (
        snapshot.sessionRevision > stepStartRevision && step?.state === "active"
      );
    });
    const openMeldServiceRuntimeIdentity = await input.run(progress);
    input.onRunResult?.(openMeldServiceRuntimeIdentity);
    const completionNotice = openMeldServiceRuntimeIdentity?.completionNotice;
    const stepCompleteRevision = startedSnapshot.sessionRevision;
    input.stream.writeTerminalStep({
      connectionEpoch: input.connectionEpoch,
      expectedRevision: stepCompleteRevision,
      ...(openMeldServiceRuntimeIdentity ?? {}),
      stepId: input.stepId,
      status: "completed",
      ...buildTerminalStepCompletionNoticeWrite(completionNotice),
    });
    const resolvedSnapshot = await input.stream.waitForSnapshot((snapshot) => {
      const step = findStep(snapshot, input.stepId);
      return (
        snapshot.sessionRevision > stepCompleteRevision &&
        (step?.state === "complete" ||
          step?.state === "blocked" ||
          snapshot.phase === "blocked" ||
          snapshot.lifecycleStatus !== "active")
      );
    });
    assertTerminalStepCompletedOrThrow({
      input: input.input,
      snapshot: resolvedSnapshot,
      stepId: input.stepId,
    });
    progress.complete(formatTerminalStepCompleteMessage(input.stepId));
    emitTerminalStepCompletionNotice(input.input, completionNotice);
    return resolvedSnapshot;
  } catch (error) {
    return await handleTerminalStepFailure({
      error,
      input,
      progress,
      startedSnapshot,
    });
  }
}

function requireStartedTerminalStepSnapshot(input: {
  error: unknown;
  executorInput: PrepareSessionExecutorInput;
  progress: SetupProgressStepHandle;
  startedSnapshot: PrepareSessionSnapshot | null;
}): PrepareSessionSnapshot {
  if (
    input.error instanceof PrepareSessionCancelledError ||
    input.error instanceof PrepareSessionConnectionInterruptedError ||
    input.error instanceof PrepareSessionBlockedByCoreError
  ) {
    input.progress.cancel();
    throw input.error;
  }
  if (input.error instanceof PrepareSessionRevisionConflictError) {
    const message =
      "This setup changed while Terminal was working. Copy a fresh setup command from OpenMeld Web and run setup again to continue from the latest step.";
    input.progress.cancel();
    emitHumanStatus(input.executorInput, "Setup changed", [message]);
    throw new Error(message);
  }
  if (input.startedSnapshot === null) {
    input.progress.cancel();
    throw input.error;
  }
  return input.startedSnapshot;
}

async function handleTerminalStepFailure(input: {
  error: unknown;
  input: RunTerminalStepInput;
  progress: SetupProgressStepHandle;
  startedSnapshot: PrepareSessionSnapshot | null;
}): Promise<never> {
  const startedSnapshot = requireStartedTerminalStepSnapshot({
    error: input.error,
    executorInput: input.input.input,
    progress: input.progress,
    startedSnapshot: input.startedSnapshot,
  });
  const rawMessage =
    input.error instanceof Error && input.error.message.trim().length > 0
      ? input.error.message.trim()
      : "Setup could not continue.";
  const localMachineIssue = isLocalMachineFailureError(input.error)
    ? input.error.issue
    : null;
  const serviceJobVerdict = localMachineIssue
    ? null
    : await resolveRefreshServiceJobVerdict({
        stepId: input.input.stepId,
        resolveServiceJobVerdict: input.input.resolveServiceJobVerdict,
      });
  const message = localMachineIssue
    ? rawMessage
    : formatTerminalStepFailureMessage({
        stepId: input.input.stepId,
        rawMessage,
        serviceJobVerdict,
      });
  const reasonCode =
    localMachineIssue?.code ??
    resolveTerminalStepFailureReasonCode({
      rawMessage,
      stepId: input.input.stepId,
      serviceJobVerdict,
    });
  const diagnostics = await (
    input.input.collectDiagnostics ?? collectPrepareStepDiagnostics
  )({
    stepId: input.input.stepId,
    supportCode: reasonCode,
  });
  input.input.stream.writeTerminalStep({
    connectionEpoch: input.input.connectionEpoch,
    expectedRevision: startedSnapshot.sessionRevision,
    stepId: input.input.stepId,
    status: "failed",
    reasonCode,
    message,
    ...(diagnostics === null ? {} : { diagnostics }),
  });
  if (diagnostics !== null) {
    // Bounded settle window so the diagnostics-carrying write (or its
    // stripped resend on cores that predate the field) can land before the
    // stream closes with the thrown failure.
    await waitForTerminalStepWriteToSettle({
      revisionFloor: startedSnapshot.sessionRevision,
      stream: input.input.stream,
    });
  }
  input.progress.fail(message);
  const humanLines = [message];
  if (!localMachineIssue) {
    humanLines.push(
      "After fixing this step, copy a fresh setup command from OpenMeld Web and run setup again."
    );
  }
  if (diagnostics !== null) {
    humanLines.push(
      `A diagnostic summary was shared with OpenMeld to help fix this (support code: ${reasonCode}).`
    );
  }
  emitHumanStatus(input.input.input, "Setup blocked", humanLines);
  if (isLocalMachineFailureError(input.error)) {
    throw input.error;
  }
  const userFacingError = new Error(message);
  (userFacingError as Error & { cause?: unknown }).cause = input.error;
  throw userFacingError;
}

function assertTerminalStepCompletedOrThrow(input: {
  input: PrepareSessionExecutorInput;
  snapshot: PrepareSessionSnapshot;
  stepId: PrepareStepId;
}): void {
  const step = findStep(input.snapshot, input.stepId);
  if (step?.state === "complete" && input.snapshot.phase !== "blocked") {
    return;
  }

  const blocker =
    input.snapshot.blockers.find(
      (candidate) => candidate.stepId === input.stepId
    ) ??
    input.snapshot.blockers[0] ??
    null;
  const message =
    blocker?.message ??
    "OpenMeld setup is blocked. Return to OpenMeld Web for details.";
  emitHumanStatus(input.input, "Setup blocked", [
    message,
    ...(blocker?.reasonCode ? [`Support code: ${blocker.reasonCode}`] : []),
  ]);
  throw new PrepareSessionBlockedByCoreError(message);
}

export function resolveNextTerminalPrepareStep(
  snapshot: PrepareSessionSnapshot
): PrepareStepId | null {
  if (snapshot.selectedLocalAgentIds.length === 0) {
    return null;
  }
  return (
    TERMINAL_PREPARE_STEP_ORDER.find((stepId) => {
      const step = findStep(snapshot, stepId);
      return step?.state !== "complete";
    }) ?? null
  );
}

type BuildTerminalStepInput = {
  connectedComputerId?: string | null;
  openMeldServiceRuntimeIdentity?: TerminalRuntimeIdentity | null;
  humanProfileId?: string | null;
  input: PrepareSessionExecutorInput;
  localAgentIds: readonly string[];
  ownerUserId?: string | null;
  stepId: PrepareStepId;
};

async function runRefreshServiceTerminalStep(
  input: BuildTerminalStepInput,
  progress?: SetupProgressStepHandle
): Promise<TerminalStepRunResult> {
  const gate = await runDaemonServiceParticipationGate({
    intent: "start",
    presenter: input.input.presenter,
    resolvedView: input.input.runtime.resolvedView,
    allowPrompt: input.input.interactive,
    autoRepair: true,
    gatewayUrl: input.input.gatewayUrl,
    ...(input.humanProfileId
      ? { openMeldProfileId: input.humanProfileId }
      : {}),
    ...(input.ownerUserId ? { expectedOwnerUserId: input.ownerUserId } : {}),
    forcePrompt: true,
    ...(shouldForceSetupServiceRefresh() ? { forceRefresh: true } : {}),
    ...(progress ? { serviceProgress: progress } : {}),
    suppressRefreshHumanResultCard: true,
    suppressStartSpinner: true,
    view: input.input.view,
  });
  if (gate.status === "cancelled") {
    throw new PrepareSessionCancelledError();
  }
  if (gate.status !== "aligned") {
    if (gate.localMachineIssue) {
      throw new LocalMachineFailureError({
        issue: gate.localMachineIssue,
      });
    }
    throw new Error(
      gate.errorMessage ?? "OpenMeld Service is not connected yet."
    );
  }
  progress?.detail({
    code: "prepare.session.progress.refresh_service.identity",
    text: "Saving this computer's OpenMeld Service identity...",
  });
  const openMeldServiceRuntimeIdentity =
    await syncLocalSetupCurrentDeviceTargetFromServiceContract({
      ...(input.connectedComputerId
        ? { connectedComputerId: input.connectedComputerId }
        : {}),
      gatewayUrl: input.input.gatewayUrl,
    });
  progress?.detail({
    code: "prepare.session.progress.refresh_service.state",
    text: "Checking local setup state...",
  });
  const readiness = await collectStartLocalReadiness({
    auth: {
      status: "valid",
      email: null,
      authBaseUrl: null,
      gatewayUrl: input.input.gatewayUrl,
    },
  });
  return {
    ...openMeldServiceRuntimeIdentity,
    localReadinessSnapshot: buildPrepareLocalReadinessSnapshot(readiness),
  };
}

export function buildTerminalStep(input: BuildTerminalStepInput): {
  message: string;
  run: (
    progress?: SetupProgressStepHandle
  ) => Promise<TerminalStepRunResult | undefined>;
} {
  switch (input.stepId) {
    case "prepare_selected_agents":
      return {
        message: "Connecting selected local agents...",
        run: async (progress) => {
          const enableResult = await prepareSelectedLocalAgentsForSetup({
            input: input.input,
            localAgentIds: input.localAgentIds,
            progress,
          });
          assertSelectedLocalAgentsEnabledForPrepare(enableResult);
          return undefined;
        },
      };
    case "refresh_service":
      return {
        message: getSetupFlowCopy("setup").cliProgressStartingService,
        run: async (progress) =>
          await runRefreshServiceTerminalStep(input, progress),
      };
    case "report_runtime":
      return {
        message: "Reporting selected local agents to OpenMeld...",
        run: async (progress) => {
          return await connectSelectedLocalAgentsToOpenMeld({
            ...(input.connectedComputerId
              ? { connectedComputerId: input.connectedComputerId }
              : {}),
            ...(input.openMeldServiceRuntimeIdentity
              ? {
                  openMeldServiceRuntimeIdentity:
                    input.openMeldServiceRuntimeIdentity,
                }
              : {}),
            gatewayUrl: input.input.gatewayUrl,
            localAgentIds: input.localAgentIds,
            progress,
            syncRouteCatalog: true,
          });
        },
      };
    case "verify_setup":
      return {
        message: "Checking that selected local agents are connected...",
        run: async () => {
          return await verifySelectedLocalAgentsConnectedToOpenMeld({
            gatewayUrl: input.input.gatewayUrl,
            localAgentIds: input.localAgentIds,
          });
        },
      };
    default:
      throw new Error(`Terminal cannot run prepare step: ${input.stepId}`);
  }
}

function formatTerminalStepCompleteMessage(stepId: PrepareStepId): string {
  switch (stepId) {
    case "prepare_selected_agents":
      return "Connected selected local agents.";
    case "refresh_service":
      return "OpenMeld Service is running.";
    case "report_runtime":
      return "Reported selected local agents to OpenMeld.";
    case "verify_setup":
      return "Verified selected local agents.";
    default:
      return "Step complete.";
  }
}

function formatRuntimeReportWaitingMessage(
  localAgentIds: readonly string[]
): string {
  if (localAgentIds.length <= 1) {
    return `Waiting for ${localAgentIds[0] ?? "the local agent"} to report its runtime...`;
  }
  const lastAgentId = localAgentIds.at(-1);
  const leadingAgentIds = localAgentIds.slice(0, -1).join(", ");
  return `Waiting for ${leadingAgentIds} and ${lastAgentId} to report their runtime...`;
}

type StartLocalAgentsEnableResult = Awaited<
  ReturnType<typeof runStartLocalAgentsEnable>
>;
type StartLocalAgentsEnableError =
  StartLocalAgentsEnableResult["summary"]["errors"][number];
type StartLocalAgentsRepairResult = Awaited<ReturnType<typeof runAgentsRepair>>;
type StartLocalAgentsRepairError =
  StartLocalAgentsRepairResult["summary"]["errors"][number];
type SelectedLocalAgentInstallChoice = NonNullable<
  StartLocalAgentsEnableError["installChoices"]
>[number];
type SelectedLocalAgentInstallChoiceError = {
  agentId: string;
  installChoices?: SelectedLocalAgentInstallChoice[];
  nextSteps?: string[];
  reason: string;
};

async function prepareSelectedLocalAgentsForSetup(input: {
  input: PrepareSessionExecutorInput;
  localAgentIds: readonly string[];
  progress?: SetupProgressStepHandle;
}): Promise<StartLocalAgentsEnableResult> {
  const initialResult = await enableSelectedLocalAgentsForSetup(input);
  if (initialResult.status !== "completed") {
    return initialResult;
  }

  const recoverableErrors = initialResult.summary.errors.filter((error) => {
    return (
      isSelectedLocalAgentNeedsRepairError(error) ||
      error.code === "controller.launch.choice_required"
    );
  });
  if (recoverableErrors.length === 0) {
    return initialResult;
  }

  for (const error of recoverableErrors) {
    await recoverSelectedLocalAgentForSetup({
      error,
      input: input.input,
      progress: input.progress,
    });
  }

  return await enableSelectedLocalAgentsForSetup(input);
}

async function enableSelectedLocalAgentsForSetup(input: {
  input: PrepareSessionExecutorInput;
  installId?: string;
  localAgentIds: readonly string[];
}): Promise<StartLocalAgentsEnableResult> {
  return await runStartLocalAgentsEnable({
    agent: [...input.localAgentIds],
    ...(input.installId ? { install: input.installId } : {}),
    interactive: input.input.interactive,
    presentation: "handoff",
    view: input.input.view,
  });
}

async function recoverSelectedLocalAgentForSetup(input: {
  error: StartLocalAgentsEnableError;
  input: PrepareSessionExecutorInput;
  progress?: SetupProgressStepHandle;
}): Promise<void> {
  if (isSelectedLocalAgentNeedsRepairError(input.error)) {
    await repairSelectedLocalAgentForSetup(input);
    return;
  }

  if (input.error.code === "controller.launch.choice_required") {
    const installId = await resolveSelectedLocalAgentInstallChoice({
      command: "enable",
      error: input.error,
      input: input.input,
      progress: input.progress,
    });
    const enableResult = await enableSelectedLocalAgentsForSetup({
      input: input.input,
      installId,
      localAgentIds: [input.error.agentId],
    });
    assertSelectedLocalAgentRecoveryCompleted({
      errorFormatter: formatSelectedLocalAgentEnableFailure,
      result: enableResult,
    });
  }
}

async function repairSelectedLocalAgentForSetup(input: {
  error: StartLocalAgentsEnableError;
  input: PrepareSessionExecutorInput;
  progress?: SetupProgressStepHandle;
}): Promise<void> {
  await repairLocalAgentForSetup({
    agentId: input.error.agentId,
    input: input.input,
    progress: input.progress,
  });
}

async function repairLocalAgentForSetup(input: {
  agentId: string;
  input: PrepareSessionExecutorInput;
  progress?: SetupProgressStepHandle;
}): Promise<void> {
  const repairResult = await runSelectedLocalAgentRepairForSetup({
    agentId: input.agentId,
    input: input.input,
  });
  const blockingError = resolveRepairBlockingError(repairResult);
  if (!blockingError) {
    if (input.progress) {
      input.progress.detail({
        code: "prepare.session.progress.local_agents.repaired",
        text: `${formatLocalAgentDisplayName(input.agentId)} local setup repaired; continuing setup...`,
      });
    } else {
      emitPrepareProgressLine(input.input, {
        state: "success",
        text: `${formatLocalAgentDisplayName(input.agentId)} local setup repaired.`,
      });
    }
    return;
  }

  if (blockingError.code === "controller.launch.choice_required") {
    const installId = await resolveSelectedLocalAgentInstallChoice({
      command: "repair",
      error: blockingError,
      input: input.input,
      progress: input.progress,
    });
    const selectedRepairResult = await runSelectedLocalAgentRepairForSetup({
      agentId: input.agentId,
      input: input.input,
      installId,
    });
    const selectedBlockingError =
      resolveRepairBlockingError(selectedRepairResult);
    if (!selectedBlockingError) {
      return;
    }
    throw new Error(
      formatSelectedLocalAgentRepairFailure(selectedBlockingError)
    );
  }

  throw new Error(formatSelectedLocalAgentRepairFailure(blockingError));
}

async function runSelectedLocalAgentRepairForSetup(input: {
  agentId: string;
  input: PrepareSessionExecutorInput;
  installId?: string;
}): Promise<StartLocalAgentsRepairResult> {
  return await runAgentsRepair({
    agent: [input.agentId],
    ...(input.installId ? { install: input.installId } : {}),
    interactive: input.input.interactive,
    presentation: "handoff",
    view: input.input.view,
  });
}

function resolveRepairBlockingError(
  result: StartLocalAgentsRepairResult
): StartLocalAgentsRepairError | null {
  if (result.status !== "completed") {
    return {
      agentId: "selected-agent",
      code: "controller.launch.needs_repair",
      reason: "agent repair did not complete",
    };
  }
  return result.summary.errors[0] ?? null;
}

function assertSelectedLocalAgentRecoveryCompleted(input: {
  errorFormatter: (error: StartLocalAgentsEnableError) => string;
  result: StartLocalAgentsEnableResult;
}): void {
  if (input.result.status !== "completed") {
    throw new Error(
      "OpenMeld setup cannot continue until the selected local agent is enabled."
    );
  }
  const blockingError = input.result.summary.errors[0] ?? null;
  if (blockingError) {
    throw new Error(input.errorFormatter(blockingError));
  }
}

async function resolveSelectedLocalAgentInstallChoice(input: {
  command: "enable" | "repair";
  error: SelectedLocalAgentInstallChoiceError;
  input: PrepareSessionExecutorInput;
  progress?: SetupProgressStepHandle;
}): Promise<string> {
  const installChoices = input.error.installChoices ?? [];
  if (installChoices.length === 0) {
    throw new Error(formatSelectedLocalAgentInstallChoiceFailure(input));
  }

  if (installChoices.length === 1) {
    const installChoice = installChoices[0];
    if (!installChoice) {
      throw new Error(formatSelectedLocalAgentInstallChoiceFailure(input));
    }
    const message = `Using ${installChoice.label} for ${formatLocalAgentDisplayName(
      input.error.agentId
    )}.`;
    if (input.progress) {
      input.progress.detail({
        code: "prepare.session.progress.local_agents.install_choice",
        text: message,
      });
    } else {
      emitPrepareProgressLine(input.input, {
        state: "success",
        text: message,
      });
    }
    return installChoice.installId;
  }

  const terminal =
    input.input.runtime.resolvedView === "human"
      ? resolveControllingTerminalSession()
      : null;
  if (!terminal) {
    throw new Error(formatSelectedLocalAgentInstallChoiceFailure(input));
  }

  try {
    const result = await promptSearchSelect(
      {
        message: `Choose the ${formatLocalAgentDisplayName(
          input.error.agentId
        )} install OpenMeld should use`,
        items: installChoices.map((installChoice) => ({
          value: installChoice.installId,
          label: installChoice.label,
          detail: installChoice.detail,
          searchText: [
            installChoice.label,
            installChoice.detail,
            installChoice.commandPath,
            installChoice.installId,
          ].join(" "),
        })),
      },
      terminal.streams
    );
    if (result.status === "submitted") {
      return result.value;
    }
    throw new Error(
      "OpenMeld setup was cancelled before choosing a local agent install."
    );
  } finally {
    terminal.close();
  }
}

function isSelectedLocalAgentNeedsRepairError(
  error: StartLocalAgentsEnableError
): boolean {
  return (
    error.code === "controller.launch.needs_repair" ||
    (error.code === "agents.invalid_agent_id" &&
      normalizeOptionalId(error.reason) === "needs repair")
  );
}

function assertSelectedLocalAgentsEnabledForPrepare(
  result: StartLocalAgentsEnableResult
): void {
  if (result.status !== "completed") {
    throw new Error(
      "OpenMeld setup cannot continue until the selected local agents are enabled. Choose or enable them in Terminal, then run OpenMeld setup again."
    );
  }

  const blockingError = result.summary.errors[0] ?? null;
  if (blockingError) {
    throw new Error(formatSelectedLocalAgentEnableFailure(blockingError));
  }
}

function formatSelectedLocalAgentEnableFailure(
  error: StartLocalAgentsEnableError
): string {
  if (error.code === "controller.launch.choice_required") {
    const commands = resolveSelectedLocalAgentEnableNextSteps(error);
    const reason =
      normalizeOptionalId(error.reason) ||
      `OpenMeld found more than one ${error.agentId} install on this computer.`;
    if (commands.length > 0) {
      return `${reason} Run one of these commands, then return to OpenMeld Web setup: ${formatCommandChoiceList(commands)}.`;
    }
    return `${reason} Run \`${formatOpenMeldCliCommand(
      `openmeld agents enable --agent ${error.agentId}`
    )}\` in an interactive Terminal and choose one install. If this Terminal cannot prompt, run \`${formatOpenMeldCliCommand(
      `openmeld agents enable --agent ${error.agentId} --install <install-id>`
    )}\` with one of the install IDs shown by that enable command, then return to OpenMeld Web setup.`;
  }

  if (error.code === "controller.launch.needs_repair") {
    return `OpenMeld could not connect ${error.agentId} on this computer. Run \`${formatOpenMeldCliCommand(
      `openmeld agents repair --agent ${error.agentId}`
    )}\`, then return to OpenMeld Web setup. Detail: ${error.reason}`;
  }

  const nextStep = error.nextSteps?.[0] ?? null;
  if (nextStep) {
    return `OpenMeld could not connect ${error.agentId} on this computer. Run \`${formatOpenMeldCliCommand(
      nextStep
    )}\`, then return to OpenMeld Web setup. Detail: ${error.reason}`;
  }

  return `OpenMeld could not connect ${error.agentId} on this computer. Detail: ${error.reason}`;
}

function formatSelectedLocalAgentRepairFailure(
  error: StartLocalAgentsRepairError
): string {
  if (error.code === "controller.launch.choice_required") {
    return formatSelectedLocalAgentInstallChoiceFailure({
      command: "repair",
      error,
    });
  }

  return `OpenMeld could not repair ${error.agentId} on this computer. Run \`${formatOpenMeldCliCommand(
    `openmeld agents repair --agent ${error.agentId}`
  )}\`, then return to OpenMeld Web setup. Detail: ${error.reason}`;
}

function formatSelectedLocalAgentInstallChoiceFailure(input: {
  command: "enable" | "repair";
  error: SelectedLocalAgentInstallChoiceError;
}): string {
  const commands =
    input.error.nextSteps && input.error.nextSteps.length > 0
      ? input.error.nextSteps
      : (input.error.installChoices ?? []).map(
          (installChoice) =>
            `openmeld agents ${input.command} --agent ${input.error.agentId} --install ${installChoice.installId}`
        );
  const reason =
    normalizeOptionalId(input.error.reason) ||
    `OpenMeld found more than one ${input.error.agentId} install on this computer.`;
  if (commands.length > 0) {
    return `${reason} Run one of these commands, then return to OpenMeld Web setup: ${formatCommandChoiceList(commands)}.`;
  }
  return `${reason} Run \`${formatOpenMeldCliCommand(
    `openmeld agents ${input.command} --agent ${input.error.agentId}`
  )}\` in an interactive Terminal and choose one install, then return to OpenMeld Web setup.`;
}

function formatLocalAgentDisplayName(agentId: string): string {
  return agentId
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function resolveSelectedLocalAgentEnableNextSteps(
  error: StartLocalAgentsEnableError
): string[] {
  if (error.nextSteps && error.nextSteps.length > 0) {
    return [...error.nextSteps];
  }

  return (error.installChoices ?? []).map(
    (installChoice) =>
      `openmeld agents enable --agent ${error.agentId} --install ${installChoice.installId}`
  );
}

function formatCommandChoiceList(commands: readonly string[]): string {
  return commands
    .map((command) => `\`${formatOpenMeldCliCommand(command)}\``)
    .join(" or ");
}

type PrepareSessionTerminalAuthCheck =
  | {
      status: "ok";
    }
  | {
      message: string;
      reasonCode: string;
      status: "blocked";
    };

export function resolvePrepareSessionTerminalAuthCheck(input: {
  authState: AuthSessionStateResult;
  snapshot: Pick<PrepareSessionSnapshot, "ownerUserId">;
}): PrepareSessionTerminalAuthCheck {
  if (input.authState.state !== "valid" || input.authState.session === null) {
    return {
      status: "blocked",
      reasonCode: "prepare.auth.sign_in_required",
      message: `This Terminal is not signed in to OpenMeld. Run \`${formatOpenMeldCliCommand(
        "openmeld login"
      )}\` with the same account shown in OpenMeld Web, then copy a fresh setup command from OpenMeld Web and run setup again.`,
    };
  }

  const terminalUserId = normalizeOptionalId(input.authState.session.user?.id);
  if (!terminalUserId) {
    return {
      status: "blocked",
      reasonCode: "prepare.auth.account_unknown",
      message: `This Terminal sign-in is missing its OpenMeld account ID. Run \`${formatOpenMeldCliCommand(
        "openmeld login"
      )}\` again with the same account shown in OpenMeld Web, then copy a fresh setup command from OpenMeld Web and run setup again.`,
    };
  }

  if (terminalUserId !== input.snapshot.ownerUserId) {
    const terminalAccount = normalizeOptionalId(
      input.authState.session.user?.email
    );
    return {
      status: "blocked",
      reasonCode: "prepare.auth.account_mismatch",
      message: `This Terminal is signed in${terminalAccount ? ` as ${terminalAccount}` : ""}, but OpenMeld Web is using a different account. Run \`${formatOpenMeldCliCommand(
        "openmeld login"
      )}\` with the account shown in OpenMeld Web, then copy a fresh setup command from OpenMeld Web and run setup again.`,
    };
  }

  return { status: "ok" };
}

async function enforcePrepareSessionTerminalAuth(input: {
  input: PrepareSessionExecutorInput;
  stream: PrepareSessionStream;
  snapshot: PrepareSessionSnapshot;
}): Promise<void> {
  const result = resolvePrepareSessionTerminalAuthCheck({
    authState: await getAuthSessionState(),
    snapshot: input.snapshot,
  });
  if (result.status === "ok") {
    return;
  }
  const connectionEpoch = requireConnectionEpoch(input.snapshot);
  const beforeWriteRevision =
    input.stream.getLatestSnapshot()?.sessionRevision ??
    input.snapshot.sessionRevision;
  input.stream.writeTerminalStep({
    connectionEpoch,
    expectedRevision: input.snapshot.sessionRevision,
    stepId: "connect_terminal",
    status: "failed",
    reasonCode: result.reasonCode,
    message: result.message,
  });
  await input.stream.waitForSnapshot((snapshot) => {
    const step = findStep(snapshot, "connect_terminal");
    return (
      snapshot.sessionRevision > beforeWriteRevision &&
      step?.state === "blocked"
    );
  });
  emitHumanStatus(input.input, "Setup blocked", [
    result.message,
    `Support code: ${result.reasonCode}`,
  ]);
  throw new Error(result.message);
}

async function connectSelectedLocalAgentsToOpenMeld(input: {
  connectedComputerId?: string;
  openMeldServiceRuntimeIdentity?: TerminalRuntimeIdentity;
  gatewayUrl: string;
  localAgentIds: readonly string[];
  progress?: SetupProgressStepHandle;
  syncRouteCatalog?: boolean;
}): Promise<TerminalStepRunResult> {
  let lastTransientError: unknown = null;
  let waitingMessageShown = false;
  for (
    let attempt = 1;
    attempt <= REPORT_RUNTIME_CONNECTION_MAX_ATTEMPTS;
    attempt++
  ) {
    try {
      return await connectSelectedLocalAgentsToOpenMeldOnce(input);
    } catch (error) {
      if (
        !isTransientSelectedAgentConnectionError(error) ||
        attempt >= REPORT_RUNTIME_CONNECTION_MAX_ATTEMPTS
      ) {
        throw error;
      }
      lastTransientError = error;
      if (!waitingMessageShown) {
        waitingMessageShown = true;
        input.progress?.detail({
          code: "prepare.session.progress.report_runtime.waiting",
          text: formatRuntimeReportWaitingMessage(input.localAgentIds),
        });
      }
      await sleep(computeRetryDelayMs(attempt));
    }
  }

  throw (
    lastTransientError ?? new Error("OpenMeld could not connect local agents.")
  );
}

async function connectSelectedLocalAgentsToOpenMeldOnce(input: {
  connectedComputerId?: string;
  openMeldServiceRuntimeIdentity?: TerminalRuntimeIdentity;
  gatewayUrl: string;
  localAgentIds: readonly string[];
  progress?: SetupProgressStepHandle;
  syncRouteCatalog?: boolean;
}): Promise<TerminalStepRunResult> {
  const openMeldServiceRuntimeIdentity =
    input.openMeldServiceRuntimeIdentity ??
    (await syncLocalSetupCurrentDeviceTargetFromServiceContract({
      ...(input.connectedComputerId
        ? { connectedComputerId: input.connectedComputerId }
        : {}),
      gatewayUrl: input.gatewayUrl,
    }));
  const readiness = await collectStartLocalReadiness({
    auth: {
      status: "valid",
      email: null,
      authBaseUrl: null,
      gatewayUrl: input.gatewayUrl,
    },
  });
  const runtimeReports = await submitSelectedAgentControllerReports({
    readiness,
    localAgentIds: input.localAgentIds,
  });
  assertSelectedAgentControllerReportSubmissionsAccepted(runtimeReports);
  emitSelectedLocalAgentAttention(input.progress, runtimeReports);
  if (input.syncRouteCatalog) {
    await notifyRouteCatalogAfterPrepare({
      reason: "prepare_selected_agents_reported",
    });
  }
  return {
    ...openMeldServiceRuntimeIdentity,
    localReadinessSnapshot: buildPrepareLocalReadinessSnapshot(readiness),
    runtimeReports,
  };
}

function emitSelectedLocalAgentAttention(
  progress: SetupProgressStepHandle | undefined,
  runtimeReports: readonly SelectedAgentControllerReportResult[]
): void {
  for (const report of runtimeReports) {
    if (report.localParticipationState === "ready") {
      continue;
    }
    const displayName = formatLocalAgentDisplayName(report.agentId);
    const needsSignIn = report.reasonCodes.some(
      (reasonCode) =>
        reasonCode === "provider_account.access_required" ||
        reasonCode === "controller.auth.unauthenticated"
    );
    progress?.detail({
      code: "prepare.session.progress.report_runtime.agent_attention",
      text: needsSignIn
        ? `${displayName} is enabled, but its local account is not signed in. Sign in before using it.`
        : `${displayName} is enabled, but it is not ready yet. Review it later in this computer's settings.`,
    });
  }
}

function buildPrepareSessionExecutorCompletionFacts(input: {
  reportRuntimeResult: TerminalStepRunResult;
  selectedLocalAgentIds: readonly string[];
}): PrepareSessionExecutorCompletionFacts {
  return {
    openMeldServiceRuntimeIdentity: {
      deviceId: input.reportRuntimeResult.deviceId,
      runtimeLane: input.reportRuntimeResult.runtimeLane,
    },
    runtimeReports: input.reportRuntimeResult.runtimeReports ?? [],
    selectedLocalAgentIds: [...input.selectedLocalAgentIds],
  };
}

function isTransientSelectedAgentConnectionError(error: unknown): boolean {
  const rawMessage = toErrorMessage(error).toLowerCase();
  return (
    rawMessage.includes("service has not finished starting") ||
    rawMessage.includes("openmeld service is not running") ||
    rawMessage.includes("service.not_running") ||
    rawMessage.includes("service_contract_unavailable") ||
    rawMessage.includes("runtime.reporting.write_failed")
  );
}

async function verifySelectedLocalAgentsConnectedToOpenMeld(input: {
  gatewayUrl: string;
  localAgentIds: readonly string[];
}): Promise<TerminalStepRunResult> {
  const openMeldServiceRuntimeIdentity =
    await readTerminalRuntimeIdentityFromServiceContract();
  const readiness = await collectStartLocalReadiness({
    auth: {
      status: "valid",
      email: null,
      authBaseUrl: null,
      gatewayUrl: input.gatewayUrl,
    },
  });
  const selectedReadiness = resolveSelectedAgentControllerReadiness({
    readiness,
    localAgentIds: input.localAgentIds,
  });
  const readySelectedAgents = selectedReadiness.filter(
    (decision) => decision.localParticipationState === "ready"
  );
  const verification = await waitForSelectedRuntimeReadiness({
    gatewayUrl: input.gatewayUrl,
    openMeldServiceRuntimeIdentity,
    selectedReadiness: readySelectedAgents,
  });
  return {
    ...openMeldServiceRuntimeIdentity,
    localReadinessSnapshot: buildPrepareLocalReadinessSnapshot(readiness),
    ...(verification === "converging_timeout"
      ? {
          completionNotice: {
            message: VERIFY_SETUP_CONVERGING_TIMEOUT_MESSAGE,
            supportCode: VERIFY_SETUP_CONVERGING_TIMEOUT_SUPPORT_CODE,
          },
        }
      : {}),
  };
}

async function readTerminalRuntimeIdentityFromServiceContract(): Promise<TerminalRuntimeIdentity> {
  // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT service-session
  // The service contract provides this computer's account/lane/device identity.
  // Other local setup evidence must not replace this fact.
  const serviceContract = await readDaemonServiceContract();
  const deviceId = serviceContract?.deviceId;
  const runtimeLane = serviceContract?.lane;
  if (!(deviceId && runtimeLane)) {
    throw new Error(
      `OpenMeld could not verify selected agents because OpenMeld Service did not provide this computer's device identity yet. Keep OpenMeld Service running, then run \`${formatOpenMeldCliCommand(
        "openmeld setup --view agent"
      )}\` again. You can also run \`${formatOpenMeldCliCommand(
        "openmeld service status --view agent"
      )}\` to inspect the local service.`
    );
  }
  return {
    deviceId,
    runtimeLane,
  };
}

async function notifyRouteCatalogAfterPrepare(input: {
  reason: string;
}): Promise<void> {
  await notifyDaemonRouteCatalogChanged({
    reason: input.reason,
  });
}

async function waitForSelectedRuntimeReadiness(input: {
  gatewayUrl: string;
  openMeldServiceRuntimeIdentity: TerminalRuntimeIdentity;
  selectedReadiness: readonly SelectedAgentControllerReadinessDecision[];
}): Promise<"converging_timeout" | "ready"> {
  // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT agent-controller-report
  // Prepare verifies that selected local capabilities are readable by OpenMeld. It
  // does not prove a later Space Wake will run successfully.
  const agentControllerRefs = input.selectedReadiness.map(
    (decision) => decision.agentControllerRef
  );
  if (agentControllerRefs.length === 0) {
    return "ready";
  }

  const getReadiness = createPrepareReadinessApi(
    createCliApiClientFoundation(input.gatewayUrl)
  ).getReadiness;
  const deadlineMs = Date.now() + VERIFY_SETUP_POLL_TIMEOUT_MS;
  let attempt = 0;
  let lastError: unknown;
  let lastResponse: GetPrepareReadinessResponse | undefined;

  while (true) {
    try {
      lastResponse = await getReadiness({
        agentControllerRefs,
        deviceId: input.openMeldServiceRuntimeIdentity.deviceId,
        lane: input.openMeldServiceRuntimeIdentity.runtimeLane,
      });
      if (
        isSelectedRuntimeReadinessReady({
          agentControllerRefs,
          response: lastResponse,
        })
      ) {
        return "ready";
      }
    } catch (error) {
      lastError = error;
    }

    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    attempt += 1;
    await sleep(Math.min(computeVerifySetupRetryDelayMs(attempt), remainingMs));
  }

  if (!lastResponse) {
    throw buildSelectedRuntimeReadinessUnreachableError(lastError);
  }
  if (
    isSelectedRuntimeReadinessStillConverging({
      agentControllerRefs,
      nowMs: Date.now(),
      response: lastResponse,
    })
  ) {
    return "converging_timeout";
  }
  throw buildSelectedRuntimeReadinessError({
    agentControllerRefs,
    response: lastResponse,
  });
}

function isSelectedRuntimeReadinessReady(input: {
  agentControllerRefs: readonly string[];
  response: GetPrepareReadinessResponse;
}): boolean {
  const runnableAgentControllerRefs = new Set(
    input.response.runnableCapabilities.map(
      (capability) => capability.agentControllerRef
    )
  );
  const missingAgentControllerRef = input.agentControllerRefs.find(
    (agentControllerRef) => !runnableAgentControllerRefs.has(agentControllerRef)
  );
  return (
    input.response.status === "ready" &&
    input.response.openMeldServiceRuntimeId !== undefined &&
    missingAgentControllerRef === undefined
  );
}

function buildSelectedRuntimeReadinessError(input: {
  agentControllerRefs: readonly string[];
  response: GetPrepareReadinessResponse;
}): Error {
  const runnableAgentControllerRefs = new Set(
    input.response.runnableCapabilities.map(
      (capability) => capability.agentControllerRef
    )
  );
  const missingAgentControllerRef = input.agentControllerRefs.find(
    (agentControllerRef) => !runnableAgentControllerRefs.has(agentControllerRef)
  );
  const reasonCode =
    input.response.summary.reasonCodes[0] ??
    input.response.reason ??
    (missingAgentControllerRef
      ? "prepare_readiness.capability_not_ready"
      : "prepare_readiness.not_ready");
  return new Error(
    `OpenMeld could not verify that selected local agents were reported to OpenMeld yet. Keep OpenMeld Service running, then run \`${formatOpenMeldCliCommand(
      "openmeld setup --view agent"
    )}\` again. You can also run \`${formatOpenMeldCliCommand(
      "openmeld service status --view agent"
    )}\` to inspect the local service. Support code: ${reasonCode}.`
  );
}

function buildSelectedRuntimeReadinessUnreachableError(
  lastError: unknown
): Error {
  return new Error(
    `OpenMeld could not reach OpenMeld to verify selected local agents during the setup verification window. Last network error: ${toErrorMessage(
      lastError
    )}. Support code: ${VERIFY_SETUP_READINESS_UNREACHABLE_SUPPORT_CODE}.`,
    { cause: lastError }
  );
}

function isSelectedRuntimeReadinessStillConverging(input: {
  agentControllerRefs: readonly string[];
  nowMs: number;
  response: GetPrepareReadinessResponse;
}): boolean {
  if (
    !input.response.agentControllerReportsRead ||
    input.response.openMeldServiceRuntimeId === undefined
  ) {
    return false;
  }
  const runnableAgentControllerRefs = new Set(
    input.response.runnableCapabilities.map(
      (capability) => capability.agentControllerRef
    )
  );
  const nonRunnableCapabilitiesByRef = new Map(
    input.response.nonRunnableCapabilities.map((capability) => [
      capability.agentControllerRef,
      capability,
    ])
  );
  let unavailableReportCount = 0;
  for (const agentControllerRef of input.agentControllerRefs) {
    if (runnableAgentControllerRefs.has(agentControllerRef)) {
      continue;
    }
    const capability = nonRunnableCapabilitiesByRef.get(agentControllerRef);
    if (
      capability?.status !== "unavailable" ||
      capability.observedAtMs === undefined ||
      capability.expiresAtMs === undefined ||
      capability.observedAtMs > input.nowMs ||
      capability.expiresAtMs <= input.nowMs
    ) {
      return false;
    }
    unavailableReportCount += 1;
  }
  return unavailableReportCount > 0;
}

function computeVerifySetupRetryDelayMs(attempt: number): number {
  const exponentialDelayMs =
    VERIFY_SETUP_RETRY_INITIAL_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(exponentialDelayMs, VERIFY_SETUP_RETRY_MAX_DELAY_MS);
}

function buildPrepareLocalReadinessSnapshot(
  readiness: StartReadinessSnapshot
): PrepareLocalReadinessSnapshot {
  return {
    observedAt: new Date().toISOString(),
    service: {
      installStatus: readiness.service.status,
      runtimeStatus: readiness.service.runtime?.status ?? "unknown",
      installedVersion: readiness.service.installedVersion,
      expectedVersion: readiness.service.expectedVersion,
      ...(readiness.service.executionCompatibility
        ? { executionCompatibility: readiness.service.executionCompatibility }
        : {}),
    },
    skills: {
      status: readiness.skills.status,
      targetCount: readiness.skills.targetCount,
      summary: { ...readiness.skills.summary },
    },
  };
}

// Best-effort launchd job-state verdict for a failed refresh_service step so the
// setup failure surfaced on OpenMeld Web names the root cause (never-spawned / crash
// loop) instead of the generic copy. Diagnostic evidence only; a null verdict
// falls back to the generic message.
async function resolveRefreshServiceJobVerdict(input: {
  stepId: PrepareStepId;
  resolveServiceJobVerdict?: typeof resolvePrepareServiceJobVerdict;
}): Promise<PrepareServiceJobVerdict | null> {
  if (input.stepId !== "refresh_service") {
    return null;
  }
  const resolve =
    input.resolveServiceJobVerdict ?? resolvePrepareServiceJobVerdict;
  return await resolve().catch(() => null);
}

export function formatTerminalStepFailureMessage(input: {
  rawMessage: string;
  stepId: PrepareStepId;
  serviceJobVerdict?: PrepareServiceJobVerdict | null;
}): string {
  if (input.rawMessage.includes("prepare session revision conflict")) {
    return "This setup changed while Terminal was working. Copy a fresh setup command from OpenMeld Web and run setup again to continue from the latest step.";
  }
  if (input.stepId === "refresh_service") {
    if (input.serviceJobVerdict === "never_spawned") {
      return `macOS is blocking the OpenMeld Service background item, so OpenMeld Service never launched. Path A: open System Settings > General > Login Items & Extensions, enable the OpenMeld background item, then copy a fresh setup command from OpenMeld Web and run setup again. Path B: run \`${formatOpenMeldCliCommand(
        "openmeld service start --mode foreground"
      )}\` in a separate terminal and keep it open (Wake stops when you close that window), then run setup again.`;
    }
    if (input.serviceJobVerdict === "crashed") {
      return `OpenMeld Service started but keeps exiting on this Mac. Run \`${formatOpenMeldCliCommand(
        "openmeld service start --mode foreground"
      )}\` to see the live error, fix it, then copy a fresh setup command from OpenMeld Web and run setup again.`;
    }
    const detail = formatTerminalStepFailureDetail(input.rawMessage);
    return `OpenMeld Service did not report a running local connection during setup. Copy a fresh setup command from OpenMeld Web and run setup again to continue from this step. If it fails again, run \`${formatOpenMeldCliCommand(
      "openmeld service start --mode foreground"
    )}\` to see live startup logs, then copy a fresh setup command from OpenMeld Web and run setup again.${
      detail ? ` Detail: ${detail}` : ""
    }`;
  }
  return input.rawMessage;
}

function formatTerminalStepFailureDetail(rawMessage: string): string | null {
  const normalized = rawMessage.replace(/\s+/g, " ").trim();
  if (
    normalized.length === 0 ||
    normalized === "OpenMeld Service is not connected yet."
  ) {
    return null;
  }
  const maxLength = 220;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

function resolveTerminalStepFailureReasonCode(input: {
  rawMessage: string;
  stepId: PrepareStepId;
  serviceJobVerdict?: PrepareServiceJobVerdict | null;
}): string {
  if (input.rawMessage.includes("runtime.registration.device_forgotten")) {
    return "runtime.registration.device_forgotten";
  }
  if (
    input.rawMessage.includes(VERIFY_SETUP_READINESS_UNREACHABLE_SUPPORT_CODE)
  ) {
    return VERIFY_SETUP_READINESS_UNREACHABLE_SUPPORT_CODE;
  }
  if (input.stepId === "refresh_service") {
    if (input.serviceJobVerdict === "never_spawned") {
      return "prepare.refresh_service.service_never_spawned";
    }
    if (input.serviceJobVerdict === "crashed") {
      return "prepare.refresh_service.service_crash_loop";
    }
  }
  return `prepare.${input.stepId}.failed`;
}

function findStep(snapshot: PrepareSessionSnapshot, stepId: PrepareStepId) {
  return snapshot.steps.find((step) => step.id === stepId) ?? null;
}

type TerminalStepWriteInput = {
  connectionEpoch: number;
  deviceId?: string;
  expectedRevision: number;
  localReadinessSnapshot?: PrepareLocalReadinessSnapshot;
  runtimeLane?: string;
  stepId: PrepareStepId;
  status: "completed" | "failed" | "started";
  reasonCode?: string;
  message?: string;
  diagnostics?: string;
};

type TerminalRuntimeIdentity = {
  deviceId: string;
  runtimeLane: string;
};

type TerminalStepRunResult = TerminalRuntimeIdentity & {
  completionNotice?: {
    message: string;
    supportCode: string;
  };
  localReadinessSnapshot?: PrepareLocalReadinessSnapshot;
  runtimeReports?: readonly SelectedAgentControllerReportResult[];
};

function buildTerminalStepCompletionNoticeWrite(
  notice: TerminalStepRunResult["completionNotice"]
): Pick<TerminalStepWriteInput, "message" | "reasonCode"> {
  if (!notice) {
    return {};
  }
  return {
    message: notice.message,
    reasonCode: notice.supportCode,
  };
}

function resolveRuntimeIdentityFromPrepareSessionSnapshot(
  snapshot: PrepareSessionSnapshot
): TerminalRuntimeIdentity | null {
  if (!(snapshot.deviceId && snapshot.runtimeLane)) {
    return null;
  }
  return {
    deviceId: snapshot.deviceId,
    runtimeLane: snapshot.runtimeLane,
  };
}

type TerminalLocalAgentCatalogWriteInput = {
  connectionEpoch: number;
  localAgentCatalog: PrepareLocalAgentCatalog;
};

export type PrepareSessionStream = {
  close(): void;
  getLatestSnapshot(): PrepareSessionSnapshot | null;
  waitForSnapshot(
    predicate: (snapshot: PrepareSessionSnapshot) => boolean
  ): Promise<PrepareSessionSnapshot>;
  writeTerminalLocalAgentCatalog(
    input: TerminalLocalAgentCatalogWriteInput
  ): void;
  writeTerminalAgentSelection(input: {
    connectionEpoch: number;
    expectedRevision: number;
    localAgentIds: string[];
  }): void;
  writeTerminalStep(input: TerminalStepWriteInput): void;
};

export function buildPrepareSessionClientHelloFrame(input: {
  cliVersion: string;
}) {
  return {
    type: "client.hello" as const,
    payload: {
      cliVersion: input.cliVersion,
      protocolVersion: PREPARE_SESSION_STREAM_PROTOCOL_VERSION,
    },
  };
}

export function isLegacyPrepareSessionClientHelloRejection(input: {
  code: string;
  message: string;
}): boolean {
  return (
    input.code === "schema.invalid" &&
    input.message === "Invalid prepare session frame."
  );
}

export function isPrepareSessionFrameSchemaRejection(input: {
  code: string;
}): boolean {
  // Cores that predate a client frame field fail to parse the whole frame:
  // current cores answer prepare.session.protocol_mismatch, the oldest ones
  // schema.invalid. Neither closes the socket, so a stripped resend can land.
  return (
    input.code === "prepare.session.protocol_mismatch" ||
    input.code === "schema.invalid"
  );
}

const TERMINAL_STEP_FAILURE_SETTLE_TIMEOUT_MS = 2000;

async function waitForTerminalStepWriteToSettle(input: {
  revisionFloor: number;
  stream: PrepareSessionStream;
}): Promise<void> {
  let timer: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      input.stream.waitForSnapshot(
        (snapshot) => snapshot.sessionRevision > input.revisionFloor
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, TERMINAL_STEP_FAILURE_SETTLE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Best-effort: a broken stream must not mask the original step failure.
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

export async function waitForSnapshotWithProgress(input: {
  input: PrepareSessionExecutorInput;
  predicate: (snapshot: PrepareSessionSnapshot) => boolean;
  progress?: SetupProgressStepHandle;
  stream: PrepareSessionStream;
  waitingMessage: string;
}): Promise<PrepareSessionSnapshot> {
  let progress: SetupProgressStepHandle | null = input.progress ?? null;
  let progressStartedByWait = false;
  const waitingProgressTimer = setTimeout(() => {
    if (input.progress) {
      input.progress.detail({
        code: "prepare.session.waiting",
        text: input.waitingMessage,
      });
      return;
    }
    progress = startPrepareProgressStep(input.input, {
      code: "prepare.session.waiting",
      text: input.waitingMessage,
    });
    progressStartedByWait = true;
  }, WAITING_PROGRESS_DELAY_MS);
  try {
    return await input.stream.waitForSnapshot(input.predicate);
  } finally {
    clearTimeout(waitingProgressTimer);
    if (progressStartedByWait) {
      progress?.cancel();
    }
  }
}

async function connectPrepareSessionStream(input: {
  gatewayUrl: string;
  opaqueToken: string;
  prepareSessionId: string;
}): Promise<PrepareSessionStream> {
  const ws = await connectWebSocket(
    buildPrepareSessionStreamUrl(input.gatewayUrl, input.prepareSessionId),
    {
      headers: {
        [PREPARE_TOKEN_HEADER]: input.opaqueToken,
      },
    }
  );
  let latestSnapshot: PrepareSessionSnapshot | null = null;
  const waiters: Array<{
    reject: (error: Error) => void;
    predicate: (snapshot: PrepareSessionSnapshot) => boolean;
    resolve: (snapshot: PrepareSessionSnapshot) => void;
  }> = [];
  const rejectWaiters = (error: Error) => {
    for (const waiter of waiters.splice(0)) {
      waiter.reject(error);
    }
  };
  let closedError: PrepareSessionConnectionInterruptedError | null = null;
  let stateWriteSent = false;
  // Stripped copy of the last diagnostics-carrying step write. Cores that
  // predate the diagnostics field reject the whole frame, so the base failure
  // report is resent once without it; snapshots clear the pending copy.
  let pendingStepWriteFallbackFrame: unknown = null;
  const assertStreamOpen = (): void => {
    if (closedError) {
      throw closedError;
    }
  };
  const sendFrame = (frame: unknown): void => {
    assertStreamOpen();
    try {
      ws.send(JSON.stringify(frame));
    } catch (error) {
      closedError = new PrepareSessionConnectionInterruptedError(
        null,
        error instanceof Error ? error.message : "connection failed"
      );
      throw closedError;
    }
  };

  const handleServerErrorFrame = (payload: {
    code: string;
    message: string;
  }): void => {
    if (
      !stateWriteSent &&
      isLegacyPrepareSessionClientHelloRejection(payload)
    ) {
      return;
    }
    if (
      pendingStepWriteFallbackFrame !== null &&
      isPrepareSessionFrameSchemaRejection(payload)
    ) {
      const fallbackFrame = pendingStepWriteFallbackFrame;
      pendingStepWriteFallbackFrame = null;
      try {
        sendFrame(fallbackFrame);
      } catch {
        // Connection lost; the diagnostics attach stays best-effort.
      }
      return;
    }
    rejectWaiters(errorFromPrepareSessionServerError(payload));
  };

  ws.onMessage((raw) => {
    const frame = parseServerFrame(raw);
    if (!frame) {
      return;
    }
    if (frame.type === "terminal.replaced") {
      rejectWaiters(
        new PrepareSessionTerminalReplacedError(frame.payload.message)
      );
      ws.close(4000, "terminal_replaced");
      return;
    }
    if (frame.type === "server.error") {
      handleServerErrorFrame(frame.payload);
      return;
    }
    if (frame.type !== "snapshot" && frame.type !== "snapshot_changed") {
      return;
    }

    pendingStepWriteFallbackFrame = null;
    const snapshot: PrepareSessionSnapshot = frame.payload.snapshot;
    latestSnapshot = snapshot;
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(snapshot)) {
        continue;
      }
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(snapshot);
    }
  });
  ws.onClose((code, reason) => {
    closedError = new PrepareSessionConnectionInterruptedError(code, reason);
    rejectWaiters(closedError);
  });
  ws.onError((error) => {
    closedError = new PrepareSessionConnectionInterruptedError(
      null,
      error instanceof Error ? error.message : "connection failed"
    );
    rejectWaiters(closedError);
  });
  sendFrame(
    buildPrepareSessionClientHelloFrame({
      cliVersion: getCliVersionInfo().version,
    })
  );

  return {
    close: () => ws.close(1000, "prepare_complete"),
    getLatestSnapshot: () => latestSnapshot,
    waitForSnapshot: async (predicate) => {
      const snapshot = latestSnapshot;
      if (snapshot && predicate(snapshot)) {
        return snapshot;
      }
      assertStreamOpen();
      return await new Promise<PrepareSessionSnapshot>((resolve, reject) => {
        waiters.push({ predicate, reject, resolve });
      });
    },
    writeTerminalStep: (step) => {
      if (!latestSnapshot) {
        throw new Error("Setup session snapshot is not available yet.");
      }
      stateWriteSent = true;
      const basePayload = {
        prepareSessionId: latestSnapshot.prepareSessionId,
        connectionEpoch: step.connectionEpoch,
        expectedRevision: step.expectedRevision,
        ...(step.deviceId === undefined ? {} : { deviceId: step.deviceId }),
        ...(step.runtimeLane === undefined
          ? {}
          : { runtimeLane: step.runtimeLane }),
        stepAttemptId: crypto.randomUUID(),
        stepId: step.stepId,
        status: step.status,
        ...(step.reasonCode === undefined
          ? {}
          : { reasonCode: step.reasonCode }),
        ...(step.localReadinessSnapshot === undefined
          ? {}
          : { localReadinessSnapshot: step.localReadinessSnapshot }),
        ...(step.message === undefined ? {} : { message: step.message }),
      };
      if (step.diagnostics === undefined) {
        pendingStepWriteFallbackFrame = null;
        sendFrame({ type: "terminal.step.write", payload: basePayload });
        return;
      }
      pendingStepWriteFallbackFrame = {
        type: "terminal.step.write",
        payload: basePayload,
      };
      sendFrame({
        type: "terminal.step.write",
        payload: { ...basePayload, diagnostics: step.diagnostics },
      });
    },
    writeTerminalLocalAgentCatalog: (catalog) => {
      if (!latestSnapshot) {
        throw new Error("Setup session snapshot is not available yet.");
      }
      stateWriteSent = true;
      sendFrame({
        type: "terminal.local_agent_catalog.write",
        payload: {
          prepareSessionId: latestSnapshot.prepareSessionId,
          connectionEpoch: catalog.connectionEpoch,
          localAgentCatalog: catalog.localAgentCatalog,
        },
      });
    },
    writeTerminalAgentSelection: (selection) => {
      if (!latestSnapshot) {
        throw new Error("Setup session snapshot is not available yet.");
      }
      stateWriteSent = true;
      sendFrame({
        type: "terminal.agent_selection.write",
        payload: {
          prepareSessionId: latestSnapshot.prepareSessionId,
          connectionEpoch: selection.connectionEpoch,
          expectedRevision: selection.expectedRevision,
          localAgentIds: selection.localAgentIds,
        },
      });
    },
  };
}

async function resolvePrepareSessionToken(input: {
  gatewayUrl: string;
  opaqueToken: string;
}): Promise<PrepareSessionSnapshot> {
  const response = await fetchSpaceRequestWithTimeout({
    url: new URL(
      "/v1/prepare/sessions/resolve-token",
      input.gatewayUrl
    ).toString(),
    operation: "prepare.session.resolve_token",
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        opaqueToken: input.opaqueToken,
      }),
    },
  });
  if (!response.ok) {
    throw new PrepareSessionTokenRejectedError(await response.text());
  }
  const responsePayload = await response.json().catch(() => {
    throw new PrepareSessionTokenRejectedError(
      "Invalid prepare session response."
    );
  });
  const parsed = prepareSessionResponseSchema.safeParse(responsePayload);
  if (!parsed.success) {
    throw new PrepareSessionTokenRejectedError(
      "Invalid prepare session response."
    );
  }
  return parsed.data.snapshot;
}

function buildPrepareSessionStreamUrl(
  gatewayUrl: string,
  prepareSessionId: string
): string {
  const url = new URL(
    `/v1/prepare/sessions/${encodeURIComponent(prepareSessionId)}/stream`,
    gatewayUrl
  );
  url.searchParams.set("role", "terminal");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function parseServerFrame(raw: string): PrepareSessionStreamServerFrame | null {
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const parsed = prepareSessionStreamServerFrameSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function requireConnectionEpoch(snapshot: PrepareSessionSnapshot): number {
  const epoch = snapshot.terminalConnection.connectionEpoch;
  if (!epoch) {
    throw new Error("OpenMeld Web has not connected this Terminal yet.");
  }
  return epoch;
}

function normalizeOptionalId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function emitHumanLine(input: PrepareSessionExecutorInput, text: string): void {
  if (input.runtime.resolvedView !== "human") {
    return;
  }
  input.presenter.line({
    code: "prepare.session.status",
    text,
  });
}

function emitHumanSection(
  input: PrepareSessionExecutorInput,
  title: string
): void {
  if (input.runtime.resolvedView !== "human") {
    return;
  }
  emitHumanLine(input, "");
  input.presenter.line({
    code: "prepare.session.section",
    text: title,
  });
}

function emitPrepareProgressLine(
  input: PrepareSessionExecutorInput,
  progress: {
    code?: string;
    data?: Record<string, unknown>;
    state: "pending" | "success";
    text: string;
  }
): void {
  createPrepareProgressReporter(input).line({
    code: progress.code ?? `prepare.session.progress.${progress.state}`,
    data: progress.data,
    state: progress.state,
    text: progress.text,
  });
}

function emitPrepareProgressDetail(
  input: PrepareSessionExecutorInput,
  text: string,
  code?: string
): void {
  createPrepareProgressReporter(input).detail({
    code: code ?? "prepare.session.progress.detail",
    text,
  });
}

function startPrepareProgressStep(
  input: PrepareSessionExecutorInput,
  progress: {
    code: string;
    data?: Record<string, unknown>;
    text: string;
  }
): SetupProgressStepHandle {
  return createPrepareProgressReporter(input).startStep({
    code: progress.code,
    data: progress.data,
    text: progress.text,
  });
}

function createPrepareProgressReporter(
  input: PrepareSessionExecutorInput
): ReturnType<typeof createSetupProgressReporter> {
  return createSetupProgressReporter({
    presenter: input.presenter,
    runtime: input.runtime,
  });
}

function emitHumanStatus(
  input: PrepareSessionExecutorInput,
  title: string,
  lines: readonly string[]
): void {
  if (input.runtime.resolvedView !== "human") {
    return;
  }
  emitHumanLine(input, "");
  renderInfoCard({
    presenter: input.presenter,
    title,
    codePrefix: `prepare.session.${toStatusCodeSlug(title)}`,
    rows: lines.map((line) => ({ label: "", value: line })),
    sanitize: true,
    minContentWidth: 56,
  });
}

function emitTerminalStepCompletionNotice(
  input: PrepareSessionExecutorInput,
  notice: TerminalStepRunResult["completionNotice"]
): void {
  if (!notice) {
    return;
  }
  if (input.runtime.resolvedView === "human") {
    emitHumanStatus(input, "Setup complete — final checks still running", [
      notice.message,
      "This usually completes automatically within a few minutes. You do not need to run setup again.",
      `Run \`${formatOpenMeldCliCommand(
        "openmeld service status"
      )}\` to check progress.`,
      `Support code: ${notice.supportCode}`,
    ]);
    return;
  }
  createPrepareProgressReporter(input).line({
    code: notice.supportCode,
    data: { supportCode: notice.supportCode },
    state: "success",
    text: notice.message,
  });
}

function formatSelectedLocalAgentNames(input: {
  localAgentIds: readonly string[];
  snapshot: PrepareSessionSnapshot;
}): string {
  const entriesById = new Map(
    (input.snapshot.localAgentCatalog?.entries ?? []).map((entry) => [
      entry.agentId,
      entry,
    ])
  );
  return input.localAgentIds
    .map((agentId) => entriesById.get(agentId)?.displayName ?? agentId)
    .join(", ");
}

function toStatusCodeSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  return slug.length > 0 ? slug : "status";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : "unknown error";
  }
  const message = String(error ?? "").trim();
  return message.length > 0 ? message : "unknown error";
}

class PrepareSessionTerminalReplacedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrepareSessionTerminalReplacedError";
  }
}

class PrepareSessionRevisionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrepareSessionRevisionConflictError";
  }
}

export class PrepareSessionConnectionInterruptedError extends Error {
  constructor(code: number | null, reason: string) {
    const suffix =
      code === null ? reason : `${code}${reason ? `: ${reason}` : ""}`;
    super(`Prepare session connection interrupted (${suffix}).`);
    this.name = "PrepareSessionConnectionInterruptedError";
  }
}

class PrepareSessionTokenRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrepareSessionTokenRejectedError";
  }
}

function errorFromPrepareSessionServerError(input: {
  code: string;
  message: string;
}): Error {
  if (input.code === "prepare.session.terminal_stale") {
    return new PrepareSessionTerminalReplacedError(input.message);
  }
  if (input.code === "prepare.session.revision_conflict") {
    return new PrepareSessionRevisionConflictError(input.message);
  }
  return new Error(input.message);
}
