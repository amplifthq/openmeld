import {
  prepareStepDiagnosticsBundleSchema,
  redactPrepareStepDiagnosticsBundle,
} from "@openmeld/schemas";
import type {
  CreatePrepareSessionRequest,
  PrepareBlocker,
  PrepareDiagnosticResponse,
  PrepareOpaqueToken,
  PrepareSessionEvent,
  PrepareSessionPhase,
  PrepareSessionSnapshot,
  PrepareSetupBootstrapWrite,
  PrepareStep,
  PrepareStepDiagnosticsBundle,
  PrepareStepId,
  PrepareStepState,
  TerminalAgentSelectionWrite,
  TerminalLocalAgentCatalogWrite,
  TerminalStepWrite,
  WebAgentSelectionWrite,
} from "@openmeld/schemas/types";
import {
  PREPARE_SESSION_TTL_MS,
  PREPARE_TOKEN_TTL_MS,
} from "../../strategy-constants";
import {
  appendPrepareSessionEvent,
  createPrepareSessionRecord,
  listPrepareSessionEvents,
  mintPrepareSessionTokenRecord,
  readPrepareSessionRecord,
  readPrepareSessionRecordByTokenDigest,
  revokePrepareSessionTokenRecords,
  updatePrepareSessionSnapshotIfRevision,
} from "../infrastructure/d1/prepare-session-repo";
import {
  createPrepareOpaqueToken,
  digestPrepareOpaqueToken,
} from "./prepare-session-token";

const DEFAULT_PREPARE_SESSION_TTL_MS = PREPARE_SESSION_TTL_MS;
const DEFAULT_PREPARE_TOKEN_TTL_MS = PREPARE_TOKEN_TTL_MS;

const PREPARE_STEP_ORDER: readonly PrepareStepId[] = [
  "computer",
  "connect_terminal",
  "choose_local_agents",
  "prepare_selected_agents",
  "refresh_service",
  "report_runtime",
  "verify_setup",
  "ready",
];

const PREPARE_TERMINAL_STEP_ORDER: readonly PrepareStepId[] = [
  "refresh_service",
  "prepare_selected_agents",
  "report_runtime",
  "verify_setup",
];

const PREPARE_STEP_COPY: Record<
  PrepareStepId,
  {
    title: string;
    summary: string;
  }
> = {
  computer: {
    title: "Computer",
    summary: "This computer is selected for setup.",
  },
  connect_terminal: {
    title: "Connect Terminal",
    summary: "Run the setup command in Terminal and keep it open.",
  },
  choose_local_agents: {
    title: "Choose local agents",
    summary:
      "Choose the local agents OpenMeld should prepare on this computer.",
  },
  prepare_selected_agents: {
    title: "Prepare selected agents",
    summary: "OpenMeld is preparing the selected local agents.",
  },
  refresh_service: {
    title: "Start or refresh OpenMeld Service",
    summary: "OpenMeld Service keeps local agents available in the background.",
  },
  report_runtime: {
    title: "Connect selected agents to OpenMeld",
    summary: "OpenMeld is saving which selected agents this computer can run.",
  },
  verify_setup: {
    title: "Verify setup",
    summary: "OpenMeld is checking setup for the selected agents.",
  },
  ready: {
    title: "Setup complete",
    summary:
      "This computer finished setup. Wake availability is checked separately.",
  },
};

export class PrepareSessionNotFoundError extends Error {
  constructor() {
    super("prepare session not found");
  }
}

export class PrepareSessionRevisionConflictError extends Error {
  constructor() {
    super("prepare session revision conflict");
  }
}

export class PrepareSessionTokenInvalidError extends Error {
  constructor() {
    super("prepare session token is invalid or expired");
  }
}

export class PrepareSessionTerminalConnectionStaleError extends Error {
  constructor() {
    super("prepare terminal connection is stale");
  }
}

export class PrepareSessionSetupBootstrapNotReadyError extends Error {
  constructor() {
    super("prepare session is not ready for setup bootstrap result");
  }
}

export class PrepareSessionNavigationActionAlreadyStartedError extends Error {
  constructor() {
    super(
      "This setup action has already started. Continue explicitly to create a fresh Terminal command."
    );
  }
}

export async function createPrepareSessionUseCase(input: {
  db: D1Database;
  ownerUserId: string;
  request: CreatePrepareSessionRequest;
  now?: Date;
  createOpaqueToken?: () => PrepareOpaqueToken;
  hashOpaqueToken?: (token: PrepareOpaqueToken) => Promise<string>;
  createId?: () => string;
}): Promise<{
  snapshot: PrepareSessionSnapshot;
  opaqueToken: PrepareOpaqueToken;
  opaqueTokenExpiresAt: string;
}> {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const tokenExpiresAtMs = nowMs + DEFAULT_PREPARE_TOKEN_TTL_MS;
  const snapshot = buildInitialPrepareSessionSnapshot({
    prepareSessionId: input.createId?.() ?? crypto.randomUUID(),
    ownerUserId: input.ownerUserId,
    request: input.request,
    now,
  });
  const opaqueToken = input.createOpaqueToken?.() ?? createPrepareOpaqueToken();
  const tokenDigest = await (input.hashOpaqueToken ?? digestPrepareOpaqueToken)(
    opaqueToken
  );
  const event = buildPrepareSessionEvent({
    snapshot,
    eventType: "session.created",
    actor: "web",
    now,
    message: "Prepare session created.",
  });
  const creationIdempotencyKey = input.request.sourceNavigationAction
    ? JSON.stringify([
        input.request.sourceNavigationAction.spaceId,
        input.request.sourceNavigationAction.signalId,
      ])
    : null;
  const inserted = await createPrepareSessionRecord({
    creationIdempotencyKey,
    db: input.db,
    snapshot,
    tokenDigest,
    tokenIssuedAtMs: nowMs,
    tokenExpiresAtMs,
    event,
  });
  if (!inserted) {
    if (creationIdempotencyKey !== null) {
      throw new PrepareSessionNavigationActionAlreadyStartedError();
    }
    throw new Error("failed to create prepare session");
  }
  return {
    snapshot,
    opaqueToken,
    opaqueTokenExpiresAt: new Date(tokenExpiresAtMs).toISOString(),
  };
}

export async function readPrepareSessionSnapshotUseCase(input: {
  db: D1Database;
  prepareSessionId: string;
}): Promise<PrepareSessionSnapshot> {
  const record = await readPrepareSessionRecord(input);
  if (!record) {
    throw new PrepareSessionNotFoundError();
  }
  return record.snapshot;
}

export async function resolvePrepareSessionTokenUseCase(input: {
  db: D1Database;
  opaqueToken: PrepareOpaqueToken;
  now?: Date;
  hashOpaqueToken?: (token: PrepareOpaqueToken) => Promise<string>;
}): Promise<PrepareSessionSnapshot> {
  const tokenDigest = await (input.hashOpaqueToken ?? digestPrepareOpaqueToken)(
    input.opaqueToken
  );
  const record = await readPrepareSessionRecordByTokenDigest({
    db: input.db,
    tokenDigest,
    nowMs: (input.now ?? new Date()).getTime(),
  });
  if (!record) {
    throw new PrepareSessionTokenInvalidError();
  }
  return record.snapshot;
}

export async function mintPrepareSessionReconnectTokenUseCase(input: {
  db: D1Database;
  prepareSessionId: string;
  ownerUserId: string;
  now?: Date;
  createOpaqueToken?: () => PrepareOpaqueToken;
  hashOpaqueToken?: (token: PrepareOpaqueToken) => Promise<string>;
}): Promise<{
  opaqueToken: PrepareOpaqueToken;
  opaqueTokenExpiresAt: string;
}> {
  const snapshot = await readPrepareSessionSnapshotUseCase({
    db: input.db,
    prepareSessionId: input.prepareSessionId,
  });
  if (snapshot.ownerUserId !== input.ownerUserId) {
    throw new PrepareSessionNotFoundError();
  }

  const now = input.now ?? new Date();
  const opaqueToken = input.createOpaqueToken?.() ?? createPrepareOpaqueToken();
  const tokenDigest = await (input.hashOpaqueToken ?? digestPrepareOpaqueToken)(
    opaqueToken
  );
  const tokenExpiresAtMs = now.getTime() + DEFAULT_PREPARE_TOKEN_TTL_MS;
  const didMint = await mintPrepareSessionTokenRecord({
    db: input.db,
    prepareSessionId: snapshot.prepareSessionId,
    ownerUserId: snapshot.ownerUserId,
    tokenDigest,
    issuedAtMs: now.getTime(),
    expiresAtMs: tokenExpiresAtMs,
  });
  if (!didMint) {
    throw new Error("failed to mint prepare session token");
  }
  await appendPrepareSessionEvent({
    db: input.db,
    ownerUserId: snapshot.ownerUserId,
    event: buildPrepareSessionEvent({
      snapshot,
      eventType: "token.minted",
      actor: "web",
      now,
      message: "Reconnect token minted.",
    }),
  });
  return {
    opaqueToken,
    opaqueTokenExpiresAt: new Date(tokenExpiresAtMs).toISOString(),
  };
}

export async function registerPrepareTerminalConnectionUseCase(input: {
  db: D1Database;
  prepareSessionId: string;
  connectionId: string;
  now?: Date;
}): Promise<PrepareSessionSnapshot> {
  const snapshot = await readPrepareSessionSnapshotUseCase(input);
  const now = input.now ?? new Date();
  const previousEpoch = snapshot.terminalConnection.connectionEpoch ?? 0;
  const nextEpoch = previousEpoch + 1;
  const replacedTerminal =
    snapshot.terminalConnection.status === "connected" &&
    snapshot.terminalConnection.connectionId !== null;
  const reconnectingActiveSession =
    previousEpoch > 0 && snapshot.lifecycleStatus === "active";
  const next = updateSnapshot(snapshot, now, (draft) => {
    if (reconnectingActiveSession) {
      resetTerminalOwnedSteps(draft, now, {
        preserveServiceAlignment: false,
      });
    }
    draft.terminalConnection = {
      status: "connected",
      connectionId: input.connectionId,
      connectionEpoch: nextEpoch,
      connectedAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      disconnectedAt: null,
      disconnectReason: null,
    };
    setStepState(draft, "connect_terminal", "complete", now);
    resumePrepareSessionAfterTerminalConnect(draft, now);
  });
  await writeSnapshotAndEvent({
    db: input.db,
    previous: snapshot,
    next,
    event: buildPrepareSessionEvent({
      snapshot: next,
      eventType: replacedTerminal
        ? "terminal.connection_replaced"
        : "terminal.connected",
      actor: "terminal",
      stepId: "connect_terminal",
      connectionEpoch: nextEpoch,
      now,
      message: replacedTerminal
        ? "A newer Terminal connection replaced the previous one."
        : "Terminal connected.",
    }),
  });
  return next;
}

export async function disconnectPrepareTerminalConnectionUseCase(input: {
  db: D1Database;
  prepareSessionId: string;
  connectionEpoch: number;
  reasonCode: string;
  now?: Date;
}): Promise<PrepareSessionSnapshot> {
  const snapshot = await readPrepareSessionSnapshotUseCase(input);
  assertCurrentTerminalConnection(snapshot, input.connectionEpoch);
  const now = input.now ?? new Date();
  const keepBusinessState =
    snapshot.lifecycleStatus !== "active" || isConnectTerminalBlocked(snapshot);
  const next = updateSnapshot(snapshot, now, (draft) => {
    draft.terminalConnection = {
      ...draft.terminalConnection,
      status: "disconnected",
      lastSeenAt: now.toISOString(),
      disconnectedAt: now.toISOString(),
      disconnectReason: input.reasonCode,
    };
    if (!keepBusinessState) {
      draft.phase = "terminal_disconnected";
      setStepState(draft, "connect_terminal", "terminal_disconnected", now);
      resetIncompleteStepsAfterConnectTerminal(draft, now);
    }
  });
  await writeSnapshotAndEvent({
    db: input.db,
    previous: snapshot,
    next,
    event: buildPrepareSessionEvent({
      snapshot: next,
      eventType: "terminal.disconnected",
      actor: "terminal",
      stepId: "connect_terminal",
      connectionEpoch: input.connectionEpoch,
      reasonCode: input.reasonCode,
      now,
      message: "Terminal disconnected.",
    }),
  });
  return next;
}

function isConnectTerminalBlocked(snapshot: PrepareSessionSnapshot): boolean {
  return snapshot.steps.some(
    (step) => step.id === "connect_terminal" && step.state === "blocked"
  );
}

export async function writeWebAgentSelectionUseCase(input: {
  db: D1Database;
  write: WebAgentSelectionWrite;
  now?: Date;
}): Promise<PrepareSessionSnapshot> {
  const snapshot = await readPrepareSessionSnapshotUseCase({
    db: input.db,
    prepareSessionId: input.write.prepareSessionId,
  });
  return await writeAgentSelectionFromSnapshot({
    actor: "web",
    db: input.db,
    snapshot,
    write: input.write,
    now: input.now,
  });
}

export async function writeTerminalAgentSelectionUseCase(input: {
  db: D1Database;
  write: TerminalAgentSelectionWrite;
  now?: Date;
}): Promise<PrepareSessionSnapshot> {
  const snapshot = await readPrepareSessionSnapshotUseCase({
    db: input.db,
    prepareSessionId: input.write.prepareSessionId,
  });
  assertCurrentTerminalConnection(snapshot, input.write.connectionEpoch);
  return await writeAgentSelectionFromSnapshot({
    actor: "terminal",
    connectionEpoch: input.write.connectionEpoch,
    db: input.db,
    snapshot,
    write: input.write,
    now: input.now,
  });
}

async function writeAgentSelectionFromSnapshot(input: {
  actor: "terminal" | "web";
  connectionEpoch?: number;
  db: D1Database;
  snapshot: PrepareSessionSnapshot;
  write: WebAgentSelectionWrite;
  now?: Date;
}): Promise<PrepareSessionSnapshot> {
  if (input.snapshot.sessionRevision !== input.write.expectedRevision) {
    throw new PrepareSessionRevisionConflictError();
  }
  const now = input.now ?? new Date();
  const selectionChanged = !haveSameLocalAgentIds(
    input.snapshot.selectedLocalAgentIds,
    input.write.localAgentIds
  );
  const next = updateSnapshot(input.snapshot, now, (draft) => {
    draft.selectedLocalAgentIds = [...input.write.localAgentIds];
    if (input.connectionEpoch !== undefined) {
      draft.terminalConnection = {
        ...draft.terminalConnection,
        lastSeenAt: now.toISOString(),
      };
    }
    setStepState(draft, "choose_local_agents", "complete", now);
    if (selectionChanged) {
      resetTerminalOwnedSteps(draft, now);
    }
    if (input.write.localAgentIds.length === 0) {
      advancePrepareSessionWithoutLocalAgents(draft, now);
      return;
    }
    if (draft.terminalConnection.status === "connected") {
      resumeTerminalOwnedSteps(draft, now);
    } else {
      draft.phase = "waiting_for_terminal";
      setStepState(draft, "connect_terminal", "active", now);
    }
  });
  await writeSnapshotAndEvent({
    db: input.db,
    previous: input.snapshot,
    next,
    event: buildPrepareSessionEvent({
      snapshot: next,
      eventType:
        input.actor === "terminal"
          ? "terminal.agent_selection_saved"
          : "web.agent_selection_saved",
      actor: input.actor,
      stepId: "choose_local_agents",
      connectionEpoch: input.connectionEpoch,
      localAgentIds: input.write.localAgentIds,
      now,
      message:
        input.write.localAgentIds.length === 0
          ? "Local agent selection saved. No local agents selected."
          : "Local agent selection saved.",
    }),
  });
  return next;
}

export async function writeTerminalLocalAgentCatalogUseCase(input: {
  db: D1Database;
  write: TerminalLocalAgentCatalogWrite;
  now?: Date;
}): Promise<PrepareSessionSnapshot> {
  const snapshot = await readPrepareSessionSnapshotUseCase({
    db: input.db,
    prepareSessionId: input.write.prepareSessionId,
  });
  assertCurrentTerminalConnection(snapshot, input.write.connectionEpoch);

  const now = input.now ?? new Date();
  const next = updateSnapshot(snapshot, now, (draft) => {
    draft.localAgentCatalog = input.write.localAgentCatalog;
    draft.terminalConnection = {
      ...draft.terminalConnection,
      lastSeenAt: now.toISOString(),
    };
    if (
      draft.lifecycleStatus === "active" &&
      !isStepComplete(draft, "choose_local_agents")
    ) {
      draft.phase = "waiting_for_agent_selection";
      setStepState(draft, "choose_local_agents", "waiting_for_user", now);
    }
  });
  await writeSnapshotAndEvent({
    db: input.db,
    previous: snapshot,
    next,
    event: buildPrepareSessionEvent({
      snapshot: next,
      eventType: "terminal.local_agent_catalog_reported",
      actor: "terminal",
      stepId: "choose_local_agents",
      connectionEpoch: input.write.connectionEpoch,
      now,
      message: "Terminal reported local agent catalog.",
    }),
  });
  return next;
}

export async function writeSetupBootstrapResultUseCase(input: {
  db: D1Database;
  ownerUserId: string;
  write: PrepareSetupBootstrapWrite;
  now?: Date;
}): Promise<PrepareSessionSnapshot> {
  const snapshot = await readPrepareSessionSnapshotUseCase({
    db: input.db,
    prepareSessionId: input.write.prepareSessionId,
  });
  if (snapshot.ownerUserId !== input.ownerUserId) {
    throw new PrepareSessionNotFoundError();
  }
  if (snapshot.lifecycleStatus !== "completed" || snapshot.phase !== "ready") {
    throw new PrepareSessionSetupBootstrapNotReadyError();
  }

  const now = input.now ?? new Date();
  const next = updateSnapshot(snapshot, now, (draft) => {
    draft.setupBootstrap = structuredClone(input.write.setupBootstrap);
  });
  await writeSnapshotAndEvent({
    db: input.db,
    previous: snapshot,
    next,
    event: buildPrepareSessionEvent({
      snapshot: next,
      eventType: "terminal.setup_bootstrap_recorded",
      actor: "terminal",
      now,
      message:
        input.write.setupBootstrap.status === "completed"
          ? "Terminal recorded the setup bootstrap result."
          : "Terminal recorded the setup bootstrap failure.",
    }),
  });
  return next;
}

export async function writeTerminalStepUseCase(input: {
  db: D1Database;
  write: TerminalStepWrite;
  now?: Date;
}): Promise<PrepareSessionSnapshot> {
  const snapshot = await readPrepareSessionSnapshotUseCase({
    db: input.db,
    prepareSessionId: input.write.prepareSessionId,
  });
  assertCurrentTerminalConnection(snapshot, input.write.connectionEpoch);
  if (snapshot.sessionRevision !== input.write.expectedRevision) {
    throw new PrepareSessionRevisionConflictError();
  }

  const now = input.now ?? new Date();
  const next = updateSnapshot(snapshot, now, (draft) => {
    draft.terminalConnection = {
      ...draft.terminalConnection,
      lastSeenAt: now.toISOString(),
    };
    if (
      !applyTerminalRuntimeIdentity({
        snapshot: draft,
        stepId: input.write.stepId,
        write: input.write,
        now,
      })
    ) {
      return;
    }
    if (input.write.localReadinessSnapshot !== undefined) {
      draft.localReadinessSnapshot = input.write.localReadinessSnapshot;
    }
    if (
      !applyTerminalStepOrderGuard({
        snapshot: draft,
        status: input.write.status,
        stepId: input.write.stepId,
        now,
      })
    ) {
      return;
    }
    if (input.write.status === "started") {
      draft.phase = phaseForActiveStep(input.write.stepId);
      setStepState(draft, input.write.stepId, "active", now);
      return;
    }

    if (input.write.status === "completed") {
      completeTerminalStep(draft, input.write.stepId, now);
      return;
    }

    blockPrepareSession({
      snapshot: draft,
      stepId: input.write.stepId,
      reasonCode: input.write.reasonCode ?? "prepare.step_failed",
      message: input.write.message ?? "Setup could not continue.",
      now,
    });
  });
  await writeSnapshotAndEvent({
    db: input.db,
    previous: snapshot,
    next,
    event: buildPrepareSessionEvent({
      snapshot: next,
      eventType: eventTypeForTerminalStepWrite(input.write.status),
      actor: "terminal",
      stepId: input.write.stepId,
      connectionEpoch: input.write.connectionEpoch,
      reasonCode: input.write.reasonCode ?? null,
      now,
      message: input.write.message ?? null,
    }),
  });
  if (
    input.write.status === "failed" &&
    input.write.diagnostics !== undefined
  ) {
    emitPrepareStepFailureDiagnosticsLog({
      snapshot: next,
      write: input.write,
    });
  }
  return next;
}

function emitPrepareStepFailureDiagnosticsLog(input: {
  snapshot: PrepareSessionSnapshot;
  write: TerminalStepWrite;
}): void {
  // Diagnostic evidence only: this single structured line makes the
  // CLI-collected bundle queryable via Workers Logs. It must never be stored
  // or feed availability/Wake decisions.
  if (input.write.diagnostics === undefined) {
    return;
  }
  const diagnostics = parsePrepareStepFailureDiagnosticsForLog(
    input.write.diagnostics
  );
  console.log(
    `[prepare.diagnostics] ${JSON.stringify({
      prepareSessionId: input.write.prepareSessionId,
      deviceId: input.snapshot.deviceId,
      stepId: input.write.stepId,
      reasonCode: input.write.reasonCode ?? null,
      ...diagnostics,
    })}`
  );
}

type PrepareStepFailureDiagnosticsLogFields =
  | { diagnostics: PrepareStepDiagnosticsBundle }
  | {
      diagnosticsRejected: "invalid_json" | "schema_invalid";
      diagnosticsLength: number;
    };

function parsePrepareStepFailureDiagnosticsForLog(
  diagnosticsText: string
): PrepareStepFailureDiagnosticsLogFields {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(diagnosticsText);
  } catch {
    return {
      diagnosticsRejected: "invalid_json",
      diagnosticsLength: diagnosticsText.length,
    };
  }
  const parsed = prepareStepDiagnosticsBundleSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      diagnosticsRejected: "schema_invalid",
      diagnosticsLength: diagnosticsText.length,
    };
  }
  return {
    diagnostics: redactPrepareStepDiagnosticsBundle(parsed.data),
  };
}

function applyTerminalRuntimeIdentity(input: {
  snapshot: PrepareSessionSnapshot;
  stepId: PrepareStepId;
  write: Pick<TerminalStepWrite, "deviceId" | "runtimeLane" | "status">;
  now: Date;
}): boolean {
  const deviceId = normalizeOptionalText(input.write.deviceId);
  const runtimeLane = normalizeOptionalText(input.write.runtimeLane);
  if (deviceId === null && runtimeLane === null) {
    if (terminalStepCompletionRequiresRuntimeIdentity(input)) {
      blockPrepareSession({
        snapshot: input.snapshot,
        stepId: input.stepId,
        reasonCode: "prepare.openmeld_service_runtime_identity_incomplete",
        message:
          "OpenMeld could not confirm which computer Terminal prepared. Run the setup command again.",
        now: input.now,
      });
      return false;
    }
    return true;
  }
  if (deviceId === null || runtimeLane === null) {
    blockPrepareSession({
      snapshot: input.snapshot,
      stepId: input.stepId,
      reasonCode: "prepare.openmeld_service_runtime_identity_incomplete",
      message:
        "OpenMeld could not confirm which computer Terminal prepared. Run the setup command again.",
      now: input.now,
    });
    return false;
  }

  input.snapshot.deviceId = deviceId;
  input.snapshot.runtimeLane = runtimeLane;
  return true;
}

function terminalStepCompletionRequiresRuntimeIdentity(input: {
  stepId: PrepareStepId;
  write: Pick<TerminalStepWrite, "status">;
}): boolean {
  return (
    input.write.status === "completed" &&
    (input.stepId === "refresh_service" ||
      input.stepId === "report_runtime" ||
      input.stepId === "verify_setup")
  );
}

function applyTerminalStepOrderGuard(input: {
  snapshot: PrepareSessionSnapshot;
  status: TerminalStepWrite["status"];
  stepId: PrepareStepId;
  now: Date;
}): boolean {
  if (input.status !== "started" && input.status !== "completed") {
    return true;
  }
  if (!isTerminalOwnedPrepareStep(input.stepId)) {
    return true;
  }
  if (isStepActive(input.snapshot, input.stepId)) {
    return true;
  }

  blockPrepareSession({
    snapshot: input.snapshot,
    stepId: input.stepId,
    reasonCode: "prepare.step_out_of_order",
    message:
      "OpenMeld received a setup step out of order. Run the setup command again.",
    now: input.now,
  });
  return false;
}

function isTerminalOwnedPrepareStep(stepId: PrepareStepId): boolean {
  return PREPARE_TERMINAL_STEP_ORDER.includes(stepId);
}

export async function failPrepareSessionUseCase(input: {
  db: D1Database;
  prepareSessionId: string;
  reasonCode: string;
  message: string;
  now?: Date;
}): Promise<PrepareSessionSnapshot> {
  const snapshot = await readPrepareSessionSnapshotUseCase(input);
  const now = input.now ?? new Date();
  const next = updateSnapshot(snapshot, now, (draft) => {
    draft.lifecycleStatus = "failed";
    draft.phase = "failed";
    draft.completedAt = now.toISOString();
    blockPrepareSession({
      snapshot: draft,
      stepId: "verify_setup",
      reasonCode: input.reasonCode,
      message: input.message,
      now,
    });
  });
  await revokePrepareSessionTokenRecords({
    db: input.db,
    prepareSessionId: next.prepareSessionId,
    ownerUserId: next.ownerUserId,
    revokedAtMs: now.getTime(),
  });
  await writeSnapshotAndEvent({
    db: input.db,
    previous: snapshot,
    next,
    event: buildPrepareSessionEvent({
      snapshot: next,
      eventType: "session.failed",
      actor: "system",
      reasonCode: input.reasonCode,
      now,
      message: input.message,
    }),
  });
  return next;
}

export function cancelPrepareSessionUseCase(input: {
  db: D1Database;
  prepareSessionId: string;
  now?: Date;
}): Promise<PrepareSessionSnapshot> {
  return closePrepareSession({
    ...input,
    lifecycleStatus: "cancelled",
    phase: "failed",
    eventType: "session.cancelled",
    message: "Prepare session cancelled.",
  });
}

export function expirePrepareSessionUseCase(input: {
  db: D1Database;
  prepareSessionId: string;
  now?: Date;
}): Promise<PrepareSessionSnapshot> {
  return closePrepareSession({
    ...input,
    lifecycleStatus: "expired",
    phase: "expired",
    eventType: "session.expired",
    message: "Prepare session expired.",
  });
}

export async function readPrepareDiagnosticUseCase(input: {
  db: D1Database;
  prepareSessionId: string;
}): Promise<PrepareDiagnosticResponse> {
  const snapshot = await readPrepareSessionSnapshotUseCase(input);
  const events = await listPrepareSessionEvents(input);
  return { snapshot, events };
}

function buildInitialPrepareSessionSnapshot(input: {
  prepareSessionId: string;
  ownerUserId: string;
  request: CreatePrepareSessionRequest;
  now: Date;
}): PrepareSessionSnapshot {
  const nowIso = input.now.toISOString();
  const expiresAt = new Date(
    input.now.getTime() + DEFAULT_PREPARE_SESSION_TTL_MS
  ).toISOString();
  return {
    prepareSessionId: input.prepareSessionId,
    ownerUserId: input.ownerUserId,
    ...(input.request.connectedComputerId
      ? { connectedComputerId: input.request.connectedComputerId }
      : {}),
    humanProfileId: input.request.humanProfileId ?? null,
    deviceId: input.request.deviceId ?? null,
    runtimeLane: input.request.runtimeLane ?? null,
    targetSpaceId: input.request.targetSpaceId ?? null,
    sessionRevision: 0,
    lifecycleStatus: "active",
    phase: "waiting_for_terminal",
    steps: PREPARE_STEP_ORDER.map((stepId) =>
      buildStep({
        stepId,
        state: initialStepState(stepId),
        now: input.now,
      })
    ),
    localAgentCatalog: null,
    localReadinessSnapshot: null,
    selectedLocalAgentIds: input.request.selectedLocalAgentIds ?? [],
    terminalConnection: {
      status: "never_connected",
      connectionId: null,
      connectionEpoch: null,
      connectedAt: null,
      lastSeenAt: null,
      disconnectedAt: null,
      disconnectReason: null,
    },
    blockers: [],
    diagnosticCorrelationId: `prepare:${input.prepareSessionId}`,
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: null,
    expiresAt,
  };
}

function buildStep(input: {
  stepId: PrepareStepId;
  state: PrepareStepState;
  now: Date;
}): PrepareStep {
  const copy = PREPARE_STEP_COPY[input.stepId];
  const nowIso = input.now.toISOString();
  return {
    id: input.stepId,
    state: input.state,
    title: copy.title,
    summary: copy.summary,
    blockerReasonCode: null,
    startedAt: input.state === "pending" ? null : nowIso,
    completedAt: input.state === "complete" ? nowIso : null,
    updatedAt: nowIso,
  };
}

function updateSnapshot(
  current: PrepareSessionSnapshot,
  now: Date,
  mutate: (draft: PrepareSessionSnapshot) => void
): PrepareSessionSnapshot {
  const draft: PrepareSessionSnapshot = structuredClone(current);
  draft.sessionRevision = current.sessionRevision + 1;
  draft.updatedAt = now.toISOString();
  mutate(draft);
  return draft;
}

function setStepState(
  snapshot: PrepareSessionSnapshot,
  stepId: PrepareStepId,
  state: PrepareStepState,
  now: Date
): void {
  if (state !== "blocked") {
    clearBlockersForStep(snapshot, stepId);
  }
  snapshot.steps = snapshot.steps.map((step) => {
    if (step.id !== stepId) {
      return step;
    }
    return {
      ...step,
      state,
      blockerReasonCode: state === "blocked" ? step.blockerReasonCode : null,
      startedAt: step.startedAt ?? now.toISOString(),
      completedAt: state === "complete" ? now.toISOString() : null,
      updatedAt: now.toISOString(),
    };
  });
}

function resumePrepareSessionAfterTerminalConnect(
  snapshot: PrepareSessionSnapshot,
  now: Date
): void {
  if (snapshot.lifecycleStatus !== "active") {
    return;
  }
  if (!isStepComplete(snapshot, "refresh_service")) {
    snapshot.phase = "starting_service";
    setStepState(snapshot, "refresh_service", "active", now);
    return;
  }
  if (isStepComplete(snapshot, "choose_local_agents")) {
    if (snapshot.selectedLocalAgentIds.length === 0) {
      advancePrepareSessionWithoutLocalAgents(snapshot, now);
      return;
    }
    resumeTerminalOwnedSteps(snapshot, now);
    return;
  }
  if (snapshot.selectedLocalAgentIds.length > 0) {
    setStepState(snapshot, "choose_local_agents", "complete", now);
    resumeTerminalOwnedSteps(snapshot, now);
    return;
  }

  snapshot.phase = "waiting_for_agent_selection";
  setStepState(snapshot, "choose_local_agents", "waiting_for_user", now);
}

function resumeTerminalOwnedSteps(
  snapshot: PrepareSessionSnapshot,
  now: Date
): void {
  const nextStepId = PREPARE_TERMINAL_STEP_ORDER.find(
    (stepId) => !isStepComplete(snapshot, stepId)
  );
  if (!nextStepId) {
    snapshot.lifecycleStatus = "completed";
    snapshot.phase = "ready";
    snapshot.completedAt = now.toISOString();
    setStepState(snapshot, "ready", "complete", now);
    return;
  }

  snapshot.phase = phaseForActiveStep(nextStepId);
  setStepState(snapshot, nextStepId, "active", now);
}

function resetTerminalOwnedSteps(
  snapshot: PrepareSessionSnapshot,
  now: Date,
  options: { preserveServiceAlignment?: boolean } = {}
): void {
  const preserveServiceAlignment =
    options.preserveServiceAlignment !== false &&
    isStepComplete(snapshot, "refresh_service");
  snapshot.lifecycleStatus = "active";
  snapshot.completedAt = null;
  for (const stepId of [...PREPARE_TERMINAL_STEP_ORDER, "ready"] as const) {
    if (stepId === "refresh_service" && preserveServiceAlignment) {
      continue;
    }
    clearBlockersForStep(snapshot, stepId);
    snapshot.steps = snapshot.steps.map((step) =>
      step.id === stepId
        ? {
            ...step,
            state: "pending",
            blockerReasonCode: null,
            startedAt: null,
            completedAt: null,
            updatedAt: now.toISOString(),
          }
        : step
    );
  }
}

function resetIncompleteStepsAfterConnectTerminal(
  snapshot: PrepareSessionSnapshot,
  now: Date
): void {
  snapshot.steps = snapshot.steps.map((step) => {
    if (
      step.id === "computer" ||
      step.id === "connect_terminal" ||
      step.state === "complete"
    ) {
      return step;
    }
    return {
      ...step,
      state: "pending",
      blockerReasonCode: null,
      startedAt: null,
      completedAt: null,
      updatedAt: now.toISOString(),
    };
  });
  snapshot.blockers = snapshot.blockers.filter((blocker) => {
    const step = snapshot.steps.find((item) => item.id === blocker.stepId);
    return step?.state === "blocked";
  });
}

function isStepComplete(
  snapshot: PrepareSessionSnapshot,
  stepId: PrepareStepId
): boolean {
  return snapshot.steps.some(
    (step) => step.id === stepId && step.state === "complete"
  );
}

function isStepActive(
  snapshot: PrepareSessionSnapshot,
  stepId: PrepareStepId
): boolean {
  return snapshot.steps.some(
    (step) => step.id === stepId && step.state === "active"
  );
}

function completeTerminalStep(
  snapshot: PrepareSessionSnapshot,
  stepId: PrepareStepId,
  now: Date
): void {
  setStepState(snapshot, stepId, "complete", now);
  if (stepId === "refresh_service") {
    if (isStepComplete(snapshot, "choose_local_agents")) {
      if (snapshot.selectedLocalAgentIds.length === 0) {
        advancePrepareSessionWithoutLocalAgents(snapshot, now);
      } else {
        resumeTerminalOwnedSteps(snapshot, now);
      }
      return;
    }
    if (snapshot.selectedLocalAgentIds.length > 0) {
      setStepState(snapshot, "choose_local_agents", "complete", now);
      resumeTerminalOwnedSteps(snapshot, now);
      return;
    }
    snapshot.phase = "waiting_for_agent_selection";
    setStepState(snapshot, "choose_local_agents", "waiting_for_user", now);
    return;
  }
  if (stepId === "verify_setup" || stepId === "ready") {
    snapshot.lifecycleStatus = "completed";
    snapshot.phase = "ready";
    snapshot.completedAt = now.toISOString();
    setStepState(snapshot, "ready", "complete", now);
    return;
  }

  if (isTerminalOwnedPrepareStep(stepId)) {
    resumeTerminalOwnedSteps(snapshot, now);
    return;
  }

  const nextStepId = nextStepAfter(stepId);
  if (!nextStepId) {
    return;
  }
  snapshot.phase =
    nextStepId === "choose_local_agents"
      ? "waiting_for_agent_selection"
      : phaseForActiveStep(nextStepId);
  setStepState(
    snapshot,
    nextStepId,
    nextStepId === "choose_local_agents" ? "waiting_for_user" : "active",
    now
  );
}

function advancePrepareSessionWithoutLocalAgents(
  snapshot: PrepareSessionSnapshot,
  now: Date
): void {
  if (!isStepComplete(snapshot, "refresh_service")) {
    snapshot.lifecycleStatus = "active";
    snapshot.completedAt = null;
    if (snapshot.terminalConnection.status === "connected") {
      snapshot.phase = "starting_service";
      setStepState(snapshot, "refresh_service", "active", now);
    } else {
      snapshot.phase = "waiting_for_terminal";
      setStepState(snapshot, "connect_terminal", "active", now);
    }
    return;
  }
  snapshot.lifecycleStatus = "completed";
  snapshot.phase = "ready";
  snapshot.completedAt = now.toISOString();
  setStepStateWithSummary(
    snapshot,
    "choose_local_agents",
    "No local agents selected.",
    now
  );
  setStepStateWithSummary(
    snapshot,
    "prepare_selected_agents",
    "Skipped. No local agents selected.",
    now
  );
  setStepStateWithSummary(
    snapshot,
    "report_runtime",
    "Skipped. There are no selected local agents to report.",
    now
  );
  setStepStateWithSummary(
    snapshot,
    "verify_setup",
    "Skipped. There are no selected local agents to verify.",
    now
  );
  setStepStateWithSummary(
    snapshot,
    "ready",
    "Computer connected. No local agents were selected.",
    now
  );
}

function setStepStateWithSummary(
  snapshot: PrepareSessionSnapshot,
  stepId: PrepareStepId,
  summary: string,
  now: Date
): void {
  setStepState(snapshot, stepId, "complete", now);
  snapshot.steps = snapshot.steps.map((step) =>
    step.id === stepId ? { ...step, summary } : step
  );
}

function blockPrepareSession(input: {
  snapshot: PrepareSessionSnapshot;
  stepId: PrepareStepId;
  reasonCode: string;
  message: string;
  now: Date;
}): void {
  input.snapshot.phase = "blocked";
  const blocker: PrepareBlocker = {
    blockerId: crypto.randomUUID(),
    stepId: input.stepId,
    reasonCode: input.reasonCode,
    message: input.message,
    severity: "user_action_required",
    retryAction: "refresh",
    createdAt: input.now.toISOString(),
  };
  input.snapshot.blockers = [
    ...input.snapshot.blockers.filter(
      (existing) => existing.stepId !== input.stepId
    ),
    blocker,
  ];
  const blockedStepIndex = PREPARE_STEP_ORDER.indexOf(input.stepId);
  input.snapshot.steps = input.snapshot.steps.map((step) => {
    if (step.id === input.stepId) {
      return {
        ...step,
        state: "blocked",
        blockerReasonCode: input.reasonCode,
        updatedAt: input.now.toISOString(),
      };
    }
    const stepIndex = PREPARE_STEP_ORDER.indexOf(step.id);
    if (stepIndex > blockedStepIndex && step.state !== "complete") {
      return {
        ...step,
        state: "pending",
        blockerReasonCode: null,
        startedAt: null,
        completedAt: null,
        updatedAt: input.now.toISOString(),
      };
    }
    return step;
  });
  input.snapshot.blockers = input.snapshot.blockers.filter((existing) =>
    input.snapshot.steps.some(
      (step) => step.id === existing.stepId && step.state === "blocked"
    )
  );
}

function clearBlockersForStep(
  snapshot: PrepareSessionSnapshot,
  stepId: PrepareStepId
): void {
  snapshot.blockers = snapshot.blockers.filter(
    (blocker) => blocker.stepId !== stepId
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

function nextStepAfter(stepId: PrepareStepId): PrepareStepId | null {
  const index = PREPARE_STEP_ORDER.indexOf(stepId);
  return index >= 0 ? (PREPARE_STEP_ORDER[index + 1] ?? null) : null;
}

function eventTypeForTerminalStepWrite(
  status: TerminalStepWrite["status"]
): PrepareSessionEvent["eventType"] {
  switch (status) {
    case "started":
      return "terminal.step_started";
    case "completed":
      return "terminal.step_completed";
    case "failed":
      return "terminal.step_failed";
    default: {
      const exhaustiveStatus: never = status;
      throw new Error(`unsupported terminal step status: ${exhaustiveStatus}`);
    }
  }
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function initialStepState(stepId: PrepareStepId): PrepareStepState {
  switch (stepId) {
    case "computer":
      return "complete";
    case "connect_terminal":
      return "active";
    case "choose_local_agents":
    case "prepare_selected_agents":
    case "refresh_service":
    case "report_runtime":
    case "verify_setup":
    case "ready":
      return "pending";
    default: {
      const exhaustiveStepId: never = stepId;
      throw new Error(`unsupported prepare step: ${exhaustiveStepId}`);
    }
  }
}

function phaseForActiveStep(stepId: PrepareStepId): PrepareSessionPhase {
  switch (stepId) {
    case "computer":
      return "checking_computer";
    case "connect_terminal":
      return "waiting_for_terminal";
    case "choose_local_agents":
      return "waiting_for_agent_selection";
    case "prepare_selected_agents":
      return "preparing_local_agents";
    case "refresh_service":
      return "starting_service";
    case "report_runtime":
      return "reporting_runtime";
    case "verify_setup":
      return "verifying_readiness";
    case "ready":
      return "ready";
    default: {
      const exhaustiveStepId: never = stepId;
      throw new Error(`unsupported prepare step: ${exhaustiveStepId}`);
    }
  }
}

async function closePrepareSession(input: {
  db: D1Database;
  prepareSessionId: string;
  lifecycleStatus: "cancelled" | "expired";
  phase: "expired" | "failed";
  eventType: "session.cancelled" | "session.expired";
  message: string;
  now?: Date;
}): Promise<PrepareSessionSnapshot> {
  const snapshot = await readPrepareSessionSnapshotUseCase(input);
  const now = input.now ?? new Date();
  const next = updateSnapshot(snapshot, now, (draft) => {
    draft.lifecycleStatus = input.lifecycleStatus;
    draft.phase = input.phase;
    draft.completedAt = now.toISOString();
  });
  await revokePrepareSessionTokenRecords({
    db: input.db,
    prepareSessionId: next.prepareSessionId,
    ownerUserId: next.ownerUserId,
    revokedAtMs: now.getTime(),
  });
  await writeSnapshotAndEvent({
    db: input.db,
    previous: snapshot,
    next,
    event: buildPrepareSessionEvent({
      snapshot: next,
      eventType: input.eventType,
      actor: "system",
      now,
      message: input.message,
    }),
  });
  return next;
}

async function writeSnapshotAndEvent(input: {
  db: D1Database;
  previous: PrepareSessionSnapshot;
  next: PrepareSessionSnapshot;
  event: PrepareSessionEvent;
}): Promise<void> {
  const result = await updatePrepareSessionSnapshotIfRevision({
    db: input.db,
    expectedRevision: input.previous.sessionRevision,
    snapshot: input.next,
  });
  if (result === "missing") {
    throw new PrepareSessionNotFoundError();
  }
  if (result === "conflict") {
    throw new PrepareSessionRevisionConflictError();
  }
  await appendPrepareSessionEvent({
    db: input.db,
    ownerUserId: input.next.ownerUserId,
    event: input.event,
  });
}

function buildPrepareSessionEvent(input: {
  snapshot: PrepareSessionSnapshot;
  eventType: PrepareSessionEvent["eventType"];
  actor: PrepareSessionEvent["actor"];
  stepId?: PrepareStepId | null;
  connectionEpoch?: number | null;
  reasonCode?: string | null;
  message?: string | null;
  localAgentIds?: readonly string[];
  now: Date;
}): PrepareSessionEvent {
  return {
    eventId: crypto.randomUUID(),
    prepareSessionId: input.snapshot.prepareSessionId,
    sessionRevision: input.snapshot.sessionRevision,
    eventType: input.eventType,
    actor: input.actor,
    stepId: input.stepId ?? null,
    connectionEpoch: input.connectionEpoch ?? null,
    reasonCode: input.reasonCode ?? null,
    message: input.message ?? null,
    localAgentIds: [...(input.localAgentIds ?? [])],
    createdAt: input.now.toISOString(),
  };
}

function assertCurrentTerminalConnection(
  snapshot: PrepareSessionSnapshot,
  connectionEpoch: number
): void {
  if (
    snapshot.terminalConnection.status !== "connected" ||
    snapshot.terminalConnection.connectionEpoch !== connectionEpoch
  ) {
    throw new PrepareSessionTerminalConnectionStaleError();
  }
}
