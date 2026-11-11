import {
  resolveCodexTimeoutMs,
  verifyCodexAppServerThread,
} from "@openmeld/adapter-codex";
import {
  buildAgentContextLookupKey,
  buildRuntimeWorkspaceFingerprint,
  loadLedgerState,
} from "@openmeld/local-execution";
import {
  resolveCompatibleAgentContextMatch,
  resolveCompatibleConversationExecutionState,
} from "@openmeld/local-service";
import {
  buildAgentControllerConversationRef,
  normalizeKnownBuiltinAgentControllerId,
  resolveBuiltinAgentControllerConversationKind,
} from "@openmeld/schemas";
import type {
  ConversationExecutionState,
  OpenMeldDaemonConversationExecutionStatusPayload,
  OpenMeldDaemonConversationExecutionStatusRequestPayload,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/schemas/types";
import { resolveProfileWorkspaceRuntime } from "../../profile-workspace/runtime-resolution";
import { normalizeOptionalText } from "../core/logger";
import {
  readLocalEnabledControllers,
  resolveLocalController,
} from "../routing/resolve-controller-support";
import {
  buildLedgerPaths,
  ensureDaemonRuntimePaths,
} from "../state/daemon-device-id";
import { createLedgerIo } from "../state/ledger-io";

export async function resolveLocalConversationExecutionStatus(
  input: OpenMeldDaemonConversationExecutionStatusRequestPayload
): Promise<OpenMeldDaemonConversationExecutionStatusPayload> {
  const localControllers = await readLocalEnabledControllers();
  const localController = resolveLocalController({
    agentControllerRef: input.agentControllerRef,
    localControllers,
  });
  const workspaceResolution = await resolveProfileWorkspaceRuntime({
    openMeldProfileId: input.targetProfileId,
    mode: "dispatch",
  });
  const localLedgerStatus = await resolveLocalLedgerConversationExecution({
    agentControllerRef: input.agentControllerRef,
    spaceId: input.spaceId,
    targetProfileId: input.targetProfileId,
    transportMode: input.transportMode,
    workspaceResolution,
  });
  const providerConversationProof =
    input.validate === true
      ? await resolveLocalProviderConversationProof({
          boundAgentControllerRef: input.boundAgentControllerRef,
          agentControllerConversationId: input.agentControllerConversationId,
          launchContract: localController?.launchContract ?? null,
          profileAgentControllerRef: input.agentControllerRef,
          runtimeWorkingDirectory:
            workspaceResolution.status === "ready"
              ? workspaceResolution.effectiveRuntimeWorkingDirectory
              : null,
          transportMode: input.transportMode,
        })
      : buildProviderConversationProofNotRun(input.transportMode);

  return {
    agentContextLookupKey: localLedgerStatus.agentContextLookupKey,
    controllerLaunchStatus: resolveControllerLaunchStatus(localController),
    executionState: localLedgerStatus.executionState,
    localRuntimeContext: {
      agentContextLookupKey: localLedgerStatus.agentContextLookupKey,
      runtimeWorkspaceFingerprint:
        localLedgerStatus.runtimeWorkspaceFingerprint,
      status: resolveLocalRuntimeContextStatus({
        agentControllerConversationId: input.agentControllerConversationId,
        executionState: localLedgerStatus.executionState,
        previousAgentControllerConversationId:
          localLedgerStatus.previousAgentControllerConversationId ?? null,
      }),
    },
    providerConversationProof,
    runtimeWorkspace: normalizeRuntimeWorkspace(workspaceResolution),
  };
}

function resolveControllerLaunchStatus(
  localController: Awaited<
    ReturnType<typeof readLocalEnabledControllers>
  > extends Map<string, infer T>
    ? T | null
    : never
): OpenMeldDaemonConversationExecutionStatusPayload["controllerLaunchStatus"] {
  if (!localController) {
    return "missing";
  }
  if (localController.enabled !== true) {
    return "disabled";
  }
  if (!localController.launchContract) {
    return "repair_required";
  }
  return "ready";
}

function resolveLocalRuntimeContextStatus(input: {
  agentControllerConversationId: string | null;
  executionState: ConversationExecutionState | null;
  previousAgentControllerConversationId: string | null;
}): OpenMeldDaemonConversationExecutionStatusPayload["localRuntimeContext"]["status"] {
  if (!(input.executionState && input.previousAgentControllerConversationId)) {
    return "missing";
  }
  if (
    input.agentControllerConversationId &&
    input.previousAgentControllerConversationId !==
      input.agentControllerConversationId
  ) {
    return "mismatch";
  }
  return "ready";
}

function normalizeRuntimeWorkspace(
  input: Awaited<ReturnType<typeof resolveProfileWorkspaceRuntime>>
): OpenMeldDaemonConversationExecutionStatusPayload["runtimeWorkspace"] {
  switch (input.status) {
    case "ready":
      return {
        configPath: input.configPath,
        configuredWorkspacePath: input.configuredWorkspacePath,
        fingerprint: buildRuntimeWorkspaceFingerprint(
          input.effectiveRuntimeWorkingDirectory
        ),
        path: input.effectiveRuntimeWorkingDirectory,
        reasonCode: null,
        reasonText: null,
        runtimeContext: input.runtimeContext,
        status: "ready",
        workspaceMode: input.workspaceMode,
      };
    case "missing":
      return {
        configPath: input.configPath,
        configuredWorkspacePath: null,
        fingerprint: null,
        path: null,
        reasonCode: input.reasonCode,
        reasonText: input.reasonText,
        runtimeContext: null,
        status: "missing",
        workspaceMode: null,
      };
    case "invalid":
      return {
        configPath: input.configPath,
        configuredWorkspacePath: input.configuredWorkspacePath ?? null,
        fingerprint: null,
        path: null,
        reasonCode: input.reasonCode,
        reasonText: input.reasonText,
        runtimeContext: null,
        status: "invalid",
        workspaceMode: input.workspaceMode ?? null,
      };
    default:
      throw new Error("unsupported profile workspace runtime status");
  }
}

function buildProviderConversationProofNotRun(
  transportMode: OpenMeldDaemonConversationExecutionStatusRequestPayload["transportMode"]
): OpenMeldDaemonConversationExecutionStatusPayload["providerConversationProof"] {
  return {
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
    transportMode,
  };
}

export async function resolveLocalProviderConversationProof(input: {
  agentControllerConversationId: string | null;
  boundAgentControllerRef: string | null;
  launchContract: RuntimeAgentControllerLaunchContract | null;
  profileAgentControllerRef: string;
  runtimeWorkingDirectory: string | null;
  transportMode: OpenMeldDaemonConversationExecutionStatusRequestPayload["transportMode"];
}): Promise<
  OpenMeldDaemonConversationExecutionStatusPayload["providerConversationProof"]
> {
  const checkedAt = new Date().toISOString();
  const providerId = normalizeKnownBuiltinAgentControllerId(
    input.profileAgentControllerRef
  );
  const provider = resolveProviderConversationProofProvider(providerId);
  const agentControllerConversationId = normalizeOptionalText(
    input.agentControllerConversationId
  );
  const base = {
    agentControllerConversationId,
    checkedAt,
    errorCode: null,
    errorMessage: null,
    errorType: null,
    expiresAt: null,
    intrusive: false,
    method: resolveProviderConversationProofMethod({
      provider,
      transportMode: input.transportMode,
    }),
    provider,
    transportMode: input.transportMode,
  } satisfies Omit<
    OpenMeldDaemonConversationExecutionStatusPayload["providerConversationProof"],
    "status"
  >;

  if (!agentControllerConversationId) {
    return {
      ...base,
      status: "not_applicable",
    };
  }

  if (!(provider === "codex" && input.transportMode === "codex-app-server")) {
    return {
      ...base,
      status: "not_applicable",
    };
  }

  if (!input.launchContract) {
    return {
      ...base,
      errorCode: "controller.launch.needs_repair",
      errorMessage:
        "The current agent profile controller does not have an available local launch contract on this device.",
      errorType: "config",
      status: "failed",
    };
  }

  if (!input.runtimeWorkingDirectory) {
    return {
      ...base,
      errorCode: "workspace.missing",
      errorMessage:
        "The current agent profile workspace is unavailable for dispatch on this device.",
      errorType: "config",
      status: "failed",
    };
  }

  if (
    input.boundAgentControllerRef &&
    input.boundAgentControllerRef !== input.profileAgentControllerRef
  ) {
    return {
      ...base,
      errorCode: "controller_ref_mismatch",
      errorMessage:
        "The bound agent controller conversation controller does not match the current agent profile controller.",
      errorType: "config",
      status: "failed",
    };
  }

  const agentControllerConversationKind = providerId
    ? resolveBuiltinAgentControllerConversationKind(
        input.profileAgentControllerRef
      )
    : null;
  if (!agentControllerConversationKind) {
    return {
      ...base,
      errorCode: "provider_unsupported",
      errorMessage: `Provider conversation proof is not available for ${input.profileAgentControllerRef}.`,
      errorType: "config",
      status: "failed",
    };
  }
  const agentControllerConversation = buildAgentControllerConversationRef({
    agentControllerRef: input.profileAgentControllerRef,
    agentControllerConversationId,
    agentControllerConversationKind,
  });

  try {
    await verifyCodexAppServerThread({
      codexTimeoutMs: resolveProviderConversationProofTimeoutMs(
        resolveCodexTimeoutMs()
      ),
      codexWorkdir: input.runtimeWorkingDirectory,
      launchContract: input.launchContract,
      threadId: agentControllerConversation.agentControllerConversationId,
    });

    return {
      ...base,
      expiresAt: new Date(
        Date.parse(checkedAt) + PROVIDER_CONVERSATION_PROOF_TTL_MS
      ).toISOString(),
      status: "passed",
    };
  } catch (error) {
    return {
      ...base,
      errorCode: readErrorCode(error),
      errorMessage: readErrorMessage(error),
      errorType: readErrorType(error),
      status: "failed",
    };
  }
}

function resolveProviderConversationProofProvider(
  value: string | null
): OpenMeldDaemonConversationExecutionStatusPayload["providerConversationProof"]["provider"] {
  if (value === "codex" || value === "claude-code" || value === "openclaw") {
    return value;
  }
  return null;
}

function resolveProviderConversationProofMethod(input: {
  provider: OpenMeldDaemonConversationExecutionStatusPayload["providerConversationProof"]["provider"];
  transportMode: OpenMeldDaemonConversationExecutionStatusRequestPayload["transportMode"];
}): OpenMeldDaemonConversationExecutionStatusPayload["providerConversationProof"]["method"] {
  if (
    input.provider === "codex" &&
    input.transportMode === "codex-app-server"
  ) {
    return "codex_app_server_thread_read";
  }
  return null;
}

async function resolveLocalLedgerConversationExecution(input: {
  agentControllerRef: string;
  spaceId: string;
  targetProfileId: string;
  transportMode: OpenMeldDaemonConversationExecutionStatusRequestPayload["transportMode"];
  workspaceResolution: Awaited<
    ReturnType<typeof resolveProfileWorkspaceRuntime>
  >;
}): Promise<{
  agentContextLookupKey: string;
  executionState: ConversationExecutionState | null;
  previousAgentControllerConversationId: string | null;
  runtimeWorkspaceFingerprint: string | null;
}> {
  const io = createLedgerIo();
  const runtimePaths = await ensureDaemonRuntimePaths();
  const ledgerState = await loadLedgerState({
    invalidStateStrategy: "backup_and_reset",
    io,
    paths: buildLedgerPaths(runtimePaths.ledgerRootPath),
  });

  if (input.workspaceResolution.status !== "ready") {
    return {
      agentContextLookupKey: buildUnresolvedRuntimeWorkspaceLookupKey({
        agentControllerRef: input.agentControllerRef,
        spaceId: input.spaceId,
        targetProfileId: input.targetProfileId,
        transportMode: input.transportMode,
      }),
      executionState: null,
      previousAgentControllerConversationId: null,
      runtimeWorkspaceFingerprint: null,
    };
  }

  const runtimeWorkspaceFingerprint = buildRuntimeWorkspaceFingerprint(
    input.workspaceResolution.effectiveRuntimeWorkingDirectory
  );
  const keyInput = {
    agentControllerRef: input.agentControllerRef,
    runtimeWorkspaceFingerprint,
    spaceId: input.spaceId,
    targetProfileId: input.targetProfileId,
    transportMode: input.transportMode,
  } as const;
  const agentContextLookupKey = buildAgentContextLookupKey(keyInput);
  const previousAgentContextMatch = resolveCompatibleAgentContextMatch({
    key: keyInput,
    state: ledgerState,
  });
  const executionState = resolveCompatibleConversationExecutionState({
    key: keyInput,
    preferredLookupKey:
      previousAgentContextMatch?.agentContextLookupKey ?? null,
    state: ledgerState,
  });

  return {
    agentContextLookupKey,
    executionState,
    previousAgentControllerConversationId:
      previousAgentContextMatch?.agentContext.agentControllerConversationId ??
      null,
    runtimeWorkspaceFingerprint,
  };
}

function buildUnresolvedRuntimeWorkspaceLookupKey(input: {
  agentControllerRef: string;
  spaceId: string;
  targetProfileId: string;
  transportMode: OpenMeldDaemonConversationExecutionStatusRequestPayload["transportMode"];
}): string {
  return [
    input.spaceId,
    input.targetProfileId,
    encodeURIComponent(input.agentControllerRef),
    input.transportMode,
    "runtime-workspace-unresolved",
  ].join("|");
}

function readErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function readErrorType(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "errorType" in error &&
    typeof error.errorType === "string"
  ) {
    return error.errorType;
  }
  return null;
}

const PROVIDER_CONVERSATION_PROOF_TIMEOUT_MS = 30_000;
const PROVIDER_CONVERSATION_PROOF_TTL_MS = 10 * 60_000;

function resolveProviderConversationProofTimeoutMs(
  runtimeTimeoutMs: number | null
) {
  if (runtimeTimeoutMs === null) {
    return PROVIDER_CONVERSATION_PROOF_TIMEOUT_MS;
  }
  return Math.min(runtimeTimeoutMs, PROVIDER_CONVERSATION_PROOF_TIMEOUT_MS);
}
