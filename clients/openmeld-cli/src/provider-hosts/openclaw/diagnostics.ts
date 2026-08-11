import { providerDispatchRuntimeContextSchema } from "@openmeld/schemas";
import type {
  OpenMeldDaemonTaskResultPayload,
  ProviderDispatchRuntimeContext,
} from "@openmeld/schemas/types";
import type { OpenMeldProfile } from "../../config/openmeld-profiles-api";
import { prepareProviderRuntime } from "../prepare-provider-runtime";
import type { OpenClawLocalBootstrapResult } from "./local-bootstrap";
import type { OpenClawLocalBootstrapStoreError } from "./local-bootstrap-store";
import {
  readOpenClawLocalBootstrapState,
  resolveOpenClawLocalBootstrapPaths,
} from "./local-bootstrap-store";
import {
  findOpenClawAgentById,
  findOpenClawAgentsByWorkspace,
  matchesExpectedWorkspace,
  type OpenClawAuthStatus,
  resolveOpenClawAuthStatus,
  resolveOpenClawProviderRuntimeWorkingDirectory,
} from "./local-state";
import {
  fetchOpenClawGatewayHealth,
  listOpenClawAgents,
  listOpenClawGatewayAgents,
  type OpenClawAgentSummary,
} from "./official-cli";

export type OpenClawDiagnosticsMode = "inspect" | "repair";

export type OpenClawBootstrapStatus =
  | "healthy"
  | "missing"
  | "binding_conflict"
  | "workspace_mismatch"
  | "workspace_ambiguous"
  | "invalid";

export type OpenClawBootstrapResolution =
  | OpenClawLocalBootstrapResult["resolution"]
  | null;

export type OpenClawGatewayHealthStatus = "healthy" | "unhealthy";

export type OpenClawGatewayVisibilityDiagnosticStatus =
  | "visible"
  | "not_visible"
  | "restarted_then_visible"
  | "restart_failed"
  | "not_checked";

export type OpenClawLocalDiagnostics = {
  agentId: string | null;
  authStatus: OpenClawAuthStatus;
  bootstrapResolution: OpenClawBootstrapResolution;
  bootstrapStatus: OpenClawBootstrapStatus;
  errorCode: string | null;
  gatewayHealth: OpenClawGatewayHealthStatus;
  gatewayVisibility: OpenClawGatewayVisibilityDiagnosticStatus;
  message: string | null;
  workspaceDir: string;
};

export type OpenClawLocalDiagnosticsFailure = {
  errorCode: string | null;
  kind: "failed";
  message: string;
};

export type OpenClawLocalDiagnosticsState =
  | OpenClawLocalDiagnostics
  | OpenClawLocalDiagnosticsFailure;

type OpenClawLocalDiagnosticsDeps = {
  fetchGatewayHealth: typeof fetchOpenClawGatewayHealth;
  listAgents: typeof listOpenClawAgents;
  listGatewayAgents: typeof listOpenClawGatewayAgents;
  prepareRuntime: typeof prepareProviderRuntime;
  readBootstrapState: typeof readOpenClawLocalBootstrapState;
};

type DiagnosticsBootstrapRead =
  | {
      agentId: string | null;
      error: null;
      kind: "existing";
    }
  | {
      agentId: null;
      error: null;
      kind: "missing";
    }
  | {
      agentId: null;
      error: OpenClawLocalBootstrapStoreError | null;
      kind: "invalid";
    };

const DEFAULT_OPENCLAW_LOCAL_DIAGNOSTICS_DEPS: OpenClawLocalDiagnosticsDeps = {
  fetchGatewayHealth: fetchOpenClawGatewayHealth,
  listAgents: listOpenClawAgents,
  listGatewayAgents: listOpenClawGatewayAgents,
  prepareRuntime: prepareProviderRuntime,
  readBootstrapState: readOpenClawLocalBootstrapState,
};

export async function resolveOpenClawLocalDiagnostics(
  input: {
    mode: OpenClawDiagnosticsMode;
    openClawBin?: string;
    profile: Pick<OpenMeldProfile, "openMeldProfileId" | "profileName">;
    providerRuntimeWorkingDirectory?: string;
  },
  deps: OpenClawLocalDiagnosticsDeps = DEFAULT_OPENCLAW_LOCAL_DIAGNOSTICS_DEPS
): Promise<OpenClawLocalDiagnostics> {
  const providerRuntimeWorkingDirectory =
    resolveOpenClawProviderRuntimeWorkingDirectory(
      input.providerRuntimeWorkingDirectory
    );
  const bootstrapPaths = resolveOpenClawLocalBootstrapPaths({
    openMeldProfileId: input.profile.openMeldProfileId,
  });

  if (input.mode === "repair") {
    return await resolveRepairModeDiagnostics({
      bootstrapPaths,
      providerRuntimeWorkingDirectory,
      deps,
      openClawBin: input.openClawBin,
      profile: input.profile,
    });
  }

  return await resolveInspectModeDiagnostics({
    bootstrapPaths,
    providerRuntimeWorkingDirectory,
    deps,
    openClawBin: input.openClawBin,
    profile: input.profile,
  });
}

export function createOpenClawLocalDiagnosticsFailure(
  error: unknown
): OpenClawLocalDiagnosticsFailure {
  return {
    errorCode: extractErrorCode(error),
    kind: "failed",
    message: toErrorMessage(error),
  };
}

export function isOpenClawLocalDiagnosticsFailure(
  diagnostics: OpenClawLocalDiagnosticsState | null | undefined
): diagnostics is OpenClawLocalDiagnosticsFailure {
  return (
    diagnostics !== null &&
    diagnostics !== undefined &&
    typeof diagnostics === "object" &&
    "kind" in diagnostics &&
    diagnostics.kind === "failed"
  );
}

export function resolveOpenClawLocalDiagnosticsValue(
  diagnostics: OpenClawLocalDiagnosticsState | null | undefined
): OpenClawLocalDiagnostics | null {
  if (!diagnostics || isOpenClawLocalDiagnosticsFailure(diagnostics)) {
    return null;
  }
  return diagnostics;
}

async function resolveRepairModeDiagnostics(input: {
  bootstrapPaths: ReturnType<typeof resolveOpenClawLocalBootstrapPaths>;
  providerRuntimeWorkingDirectory: string;
  deps: OpenClawLocalDiagnosticsDeps;
  openClawBin?: string;
  profile: Pick<OpenMeldProfile, "openMeldProfileId" | "profileName">;
}): Promise<OpenClawLocalDiagnostics> {
  try {
    const preparation = await input.deps.prepareRuntime({
      agentControllerRef: "builtin:openclaw",
      daemonWorkingDirectory: input.providerRuntimeWorkingDirectory,
      mode: "reply_readiness",
      openClawBin: input.openClawBin,
      profileName: input.profile.profileName,
      runtimeContext: resolveDiagnosticsRuntimeContext(
        input.providerRuntimeWorkingDirectory
      ),
      targetProfileId: input.profile.openMeldProfileId,
    });
    if (preparation.preparationDetails.kind !== "openclaw") {
      throw new Error(
        "OpenClaw runtime preparation returned a non-OpenClaw preparation result"
      );
    }
    return {
      agentId: preparation.preparationDetails.bootstrap.agentId,
      authStatus: preparation.preparationDetails.bootstrap.authStatus,
      bootstrapResolution: preparation.preparationDetails.bootstrap.resolution,
      bootstrapStatus: "healthy",
      errorCode: null,
      gatewayHealth: "healthy",
      gatewayVisibility: mapGatewayVisibilityPayload(
        preparation.preparationDetails.openClawGatewayVisibility
      ),
      message: null,
      workspaceDir: preparation.runtimeContext.providerRuntimeWorkingDirectory,
    };
  } catch (error) {
    const inspected = await inspectBootstrapState({
      bootstrapPaths: input.bootstrapPaths,
      providerRuntimeWorkingDirectory: input.providerRuntimeWorkingDirectory,
      deps: input.deps,
      error,
      openClawBin: input.openClawBin,
      profile: input.profile,
    });
    const failureDetail = resolveDiagnosticsFailureDetail({
      error,
      inspected,
    });
    if (failureDetail.errorCode === "controller.gateway.unhealthy") {
      return {
        ...inspected,
        bootstrapResolution: null,
        errorCode: failureDetail.errorCode,
        gatewayHealth: hasGatewayVisibilityPayload(error)
          ? "healthy"
          : "unhealthy",
        gatewayVisibility: resolveGatewayVisibilityFailureStatus(error),
        message: failureDetail.message,
      };
    }
    return {
      ...inspected,
      bootstrapResolution: null,
      errorCode: failureDetail.errorCode,
      gatewayHealth: "unhealthy",
      gatewayVisibility: "not_checked",
      message: failureDetail.message,
    };
  }
}

async function resolveInspectModeDiagnostics(input: {
  bootstrapPaths: ReturnType<typeof resolveOpenClawLocalBootstrapPaths>;
  providerRuntimeWorkingDirectory: string;
  deps: OpenClawLocalDiagnosticsDeps;
  openClawBin?: string;
  profile: Pick<OpenMeldProfile, "openMeldProfileId" | "profileName">;
}): Promise<OpenClawLocalDiagnostics> {
  const inspected = await inspectBootstrapState({
    bootstrapPaths: input.bootstrapPaths,
    providerRuntimeWorkingDirectory: input.providerRuntimeWorkingDirectory,
    deps: input.deps,
    error: null,
    openClawBin: input.openClawBin,
    profile: input.profile,
  });

  if (inspected.bootstrapStatus !== "healthy" || !inspected.agentId) {
    return {
      ...inspected,
      bootstrapResolution: null,
      gatewayHealth: "unhealthy",
      gatewayVisibility: "not_checked",
    };
  }

  const gatewayHealth = await input.deps
    .fetchGatewayHealth({
      cwd: input.providerRuntimeWorkingDirectory,
      openClawBin: input.openClawBin,
    })
    .then(() => "healthy" as const)
    .catch((error) => ({
      errorCode: extractErrorCode(error),
      message: toErrorMessage(error),
    }));

  if (gatewayHealth !== "healthy") {
    return {
      ...inspected,
      bootstrapResolution: null,
      errorCode: gatewayHealth.errorCode,
      gatewayHealth: "unhealthy",
      gatewayVisibility: "not_checked",
      message: gatewayHealth.message,
    };
  }

  const visibility = await resolveInspectGatewayVisibility({
    agentId: inspected.agentId,
    cwd: input.providerRuntimeWorkingDirectory,
    deps: input.deps,
    openClawBin: input.openClawBin,
  });

  return {
    ...inspected,
    bootstrapResolution: null,
    errorCode: visibility.errorCode,
    gatewayHealth: "healthy",
    gatewayVisibility: visibility.gatewayVisibility,
    message: visibility.message,
  };
}

async function inspectBootstrapState(input: {
  bootstrapPaths: ReturnType<typeof resolveOpenClawLocalBootstrapPaths>;
  providerRuntimeWorkingDirectory: string;
  deps: OpenClawLocalDiagnosticsDeps;
  error: unknown;
  openClawBin?: string;
  profile: Pick<OpenMeldProfile, "openMeldProfileId" | "profileName">;
}): Promise<OpenClawLocalDiagnostics> {
  const listedAgents = await input.deps.listAgents({
    cwd: input.providerRuntimeWorkingDirectory,
    openClawBin: input.openClawBin,
  });
  const workspaceAgents = findOpenClawAgentsByWorkspace({
    agents: listedAgents,
    workspace: input.providerRuntimeWorkingDirectory,
  });
  const bootstrapRead = await readBootstrapStateForDiagnostics({
    openMeldProfileId: input.profile.openMeldProfileId,
    readBootstrapState: input.deps.readBootstrapState,
  });
  const targetAgent = resolveDiagnosticsTargetAgent({
    bootstrapRead,
    listedAgents,
    workspaceAgents,
  });
  const authStatus = await resolveOpenClawAuthStatus({
    agents: listedAgents,
    targetAgent,
  });
  const status = resolveBootstrapStatusForDiagnostics({
    bootstrapRead,
    error: input.error,
    expectedWorkspace: input.providerRuntimeWorkingDirectory,
    targetAgent,
    workspaceAgents,
  });

  return {
    agentId: targetAgent?.agentId ?? bootstrapRead.agentId ?? null,
    authStatus,
    bootstrapResolution: null,
    bootstrapStatus: status.bootstrapStatus,
    errorCode: status.errorCode,
    gatewayHealth: "unhealthy",
    gatewayVisibility: "not_checked",
    message: status.message,
    workspaceDir: input.providerRuntimeWorkingDirectory,
  };
}

async function resolveInspectGatewayVisibility(input: {
  agentId: string;
  cwd: string;
  deps: OpenClawLocalDiagnosticsDeps;
  openClawBin?: string;
}): Promise<{
  errorCode: string | null;
  gatewayVisibility: OpenClawGatewayVisibilityDiagnosticStatus;
  message: string | null;
}> {
  try {
    const agents = await input.deps.listGatewayAgents({
      cwd: input.cwd,
      openClawBin: input.openClawBin,
    });
    return {
      errorCode: null,
      gatewayVisibility: agents.some((agent) => agent.agentId === input.agentId)
        ? "visible"
        : "not_visible",
      message: null,
    };
  } catch (error) {
    return {
      errorCode: extractErrorCode(error),
      gatewayVisibility: "not_checked",
      message: toErrorMessage(error),
    };
  }
}

function resolveDiagnosticsFailureDetail(input: {
  error: unknown;
  inspected: OpenClawLocalDiagnostics;
}): {
  errorCode: string | null;
  message: string | null;
} {
  const inspectedErrorCode =
    typeof input.inspected.errorCode === "string" &&
    input.inspected.errorCode.trim().length > 0
      ? input.inspected.errorCode.trim()
      : null;
  const inspectedMessage =
    typeof input.inspected.message === "string" &&
    input.inspected.message.trim().length > 0
      ? input.inspected.message.trim()
      : null;
  return {
    errorCode: inspectedErrorCode ?? extractErrorCode(input.error),
    message: inspectedMessage ?? toErrorMessage(input.error),
  };
}

function resolveDiagnosticsTargetAgent(input: {
  bootstrapRead: DiagnosticsBootstrapRead;
  listedAgents: OpenClawAgentSummary[];
  workspaceAgents: OpenClawAgentSummary[];
}): OpenClawAgentSummary | null {
  if (input.bootstrapRead.kind === "existing" && input.bootstrapRead.agentId) {
    return (
      findOpenClawAgentById({
        agentId: input.bootstrapRead.agentId,
        agents: input.listedAgents,
      }) ??
      (input.workspaceAgents.length === 1
        ? (input.workspaceAgents[0] ?? null)
        : null)
    );
  }
  return input.workspaceAgents.length === 1
    ? (input.workspaceAgents[0] ?? null)
    : null;
}

async function readBootstrapStateForDiagnostics(input: {
  openMeldProfileId: string;
  readBootstrapState: typeof readOpenClawLocalBootstrapState;
}): Promise<DiagnosticsBootstrapRead> {
  try {
    const state = await input.readBootstrapState({
      openMeldProfileId: input.openMeldProfileId,
    });
    if (!state) {
      return {
        agentId: null,
        error: null,
        kind: "missing",
      };
    }
    return {
      agentId: state.agentId,
      error: null,
      kind: "existing",
    };
  } catch (error) {
    return {
      agentId: null,
      error:
        error && typeof error === "object" && "code" in error && "path" in error
          ? (error as OpenClawLocalBootstrapStoreError)
          : null,
      kind: "invalid",
    };
  }
}

function resolveBootstrapStatusForDiagnostics(input: {
  bootstrapRead: DiagnosticsBootstrapRead;
  error: unknown;
  expectedWorkspace: string;
  targetAgent: OpenClawAgentSummary | null;
  workspaceAgents: OpenClawAgentSummary[];
}): {
  bootstrapStatus: OpenClawBootstrapStatus;
  errorCode: string | null;
  message: string | null;
} {
  const explicitDiagnostic = resolveExplicitBootstrapDiagnostic(input.error);
  if (explicitDiagnostic) {
    return explicitDiagnostic;
  }

  switch (input.bootstrapRead.kind) {
    case "existing":
      return resolveExistingBootstrapStatus({
        expectedWorkspace: input.expectedWorkspace,
        targetAgent: input.targetAgent,
        workspaceAgents: input.workspaceAgents,
      });
    case "invalid":
      return resolveInvalidBootstrapStatus({
        bootstrapRead: input.bootstrapRead,
        error: input.error,
        workspaceAgents: input.workspaceAgents,
      });
    case "missing":
      return resolveMissingBootstrapStatus(input.workspaceAgents);
    default: {
      const unexpectedBootstrapRead: never = input.bootstrapRead;
      throw new Error(
        `Unexpected OpenClaw bootstrap read kind: ${String(unexpectedBootstrapRead)}`
      );
    }
  }
}

function buildBootstrapDiagnosticStatus(
  bootstrapStatus: OpenClawBootstrapStatus,
  errorCode: string | null,
  message: string | null
): {
  bootstrapStatus: OpenClawBootstrapStatus;
  errorCode: string | null;
  message: string | null;
} {
  return {
    bootstrapStatus,
    errorCode,
    message,
  };
}

function resolveExplicitBootstrapDiagnostic(error: unknown): {
  bootstrapStatus: OpenClawBootstrapStatus;
  errorCode: string | null;
  message: string | null;
} | null {
  const explicitErrorCode = extractErrorCode(error);
  const explicitMessage = error ? toErrorMessage(error) : null;
  switch (explicitErrorCode) {
    case "openclaw.bootstrap.binding_conflict":
      return buildBootstrapDiagnosticStatus(
        "binding_conflict",
        explicitErrorCode,
        explicitMessage
      );
    case "openclaw.bootstrap.workspace_mismatch":
      return buildBootstrapDiagnosticStatus(
        "workspace_mismatch",
        explicitErrorCode,
        explicitMessage
      );
    case "openclaw.bootstrap.workspace_ambiguous":
      return buildBootstrapDiagnosticStatus(
        "workspace_ambiguous",
        explicitErrorCode,
        explicitMessage
      );
    case "openclaw.bootstrap.state_invalid":
    case "openclaw.bootstrap.version_mismatch":
      return buildBootstrapDiagnosticStatus(
        "invalid",
        explicitErrorCode,
        explicitMessage
      );
    default:
      return null;
  }
}

function resolveExistingBootstrapStatus(input: {
  expectedWorkspace: string;
  targetAgent: OpenClawAgentSummary | null;
  workspaceAgents: OpenClawAgentSummary[];
}): {
  bootstrapStatus: OpenClawBootstrapStatus;
  errorCode: string | null;
  message: string | null;
} {
  if (!input.targetAgent) {
    return resolveMissingBootstrapStatus(input.workspaceAgents, {
      missingAgentMeansConflict: true,
    });
  }
  if (
    !matchesExpectedWorkspace({
      actualWorkspace: input.targetAgent.workspace,
      expectedWorkspace: input.expectedWorkspace,
    })
  ) {
    return buildBootstrapDiagnosticStatus(
      "workspace_mismatch",
      "openclaw.bootstrap.workspace_mismatch",
      null
    );
  }
  return buildBootstrapDiagnosticStatus("healthy", null, null);
}

function resolveInvalidBootstrapStatus(input: {
  bootstrapRead: Extract<DiagnosticsBootstrapRead, { kind: "invalid" }>;
  error: unknown;
  workspaceAgents: OpenClawAgentSummary[];
}): {
  bootstrapStatus: OpenClawBootstrapStatus;
  errorCode: string | null;
  message: string | null;
} {
  if (input.workspaceAgents.length > 1) {
    return buildBootstrapDiagnosticStatus(
      "workspace_ambiguous",
      "openclaw.bootstrap.workspace_ambiguous",
      null
    );
  }
  return buildBootstrapDiagnosticStatus(
    "invalid",
    input.bootstrapRead.error?.code ?? extractErrorCode(input.error),
    input.bootstrapRead.error?.message ??
      (input.error ? toErrorMessage(input.error) : null)
  );
}

function resolveMissingBootstrapStatus(
  workspaceAgents: OpenClawAgentSummary[],
  input: { missingAgentMeansConflict?: boolean } = {}
): {
  bootstrapStatus: OpenClawBootstrapStatus;
  errorCode: string | null;
  message: string | null;
} {
  if (workspaceAgents.length > 1) {
    return buildBootstrapDiagnosticStatus(
      "workspace_ambiguous",
      "openclaw.bootstrap.workspace_ambiguous",
      null
    );
  }
  if (input.missingAgentMeansConflict && workspaceAgents.length === 1) {
    return buildBootstrapDiagnosticStatus(
      "binding_conflict",
      "openclaw.bootstrap.binding_conflict",
      null
    );
  }
  return buildBootstrapDiagnosticStatus("missing", null, null);
}

function mapGatewayVisibilityPayload(
  visibility: NonNullable<
    OpenMeldDaemonTaskResultPayload["openClawGatewayVisibility"]
  >
): OpenClawGatewayVisibilityDiagnosticStatus {
  return visibility.gatewayVisibility === "visible_after_restart"
    ? "restarted_then_visible"
    : "visible";
}

function resolveGatewayVisibilityFailureStatus(
  error: unknown
): OpenClawGatewayVisibilityDiagnosticStatus {
  const providerErrorCode = extractProviderErrorCode(error);
  if (providerErrorCode === "openclaw.gateway.restart_failed") {
    return "restart_failed";
  }
  if (
    providerErrorCode === "openclaw.gateway.agent_not_visible" ||
    providerErrorCode === "openclaw.gateway.invalid_agent_id"
  ) {
    return "not_visible";
  }
  const openClawGatewayVisibility = extractGatewayVisibilityPayload(error);
  if (
    openClawGatewayVisibility?.gatewayVisibility === "missing_after_restart"
  ) {
    return "not_visible";
  }
  if (
    openClawGatewayVisibility?.gatewayVisibility === "missing_before_restart"
  ) {
    return "restart_failed";
  }
  return "not_checked";
}

function resolveDiagnosticsRuntimeContext(
  providerRuntimeWorkingDirectory: string
): ProviderDispatchRuntimeContext {
  const parsed = providerDispatchRuntimeContextSchema.safeParse({
    providerRuntimeWorkingDirectory,
  });
  if (parsed.success) {
    return parsed.data;
  }
  const validationDetails = parsed.error.issues
    .map((issue) => {
      const path =
        issue.path.length > 0
          ? issue.path.join(".")
          : "providerRuntimeWorkingDirectory";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
  throw new Error(
    `invalid OpenClaw providerRuntimeWorkingDirectory: ${validationDetails}`
  );
}

function hasGatewayVisibilityPayload(error: unknown): boolean {
  return extractGatewayVisibilityPayload(error) !== null;
}

function extractGatewayVisibilityPayload(
  error: unknown
): NonNullable<
  OpenMeldDaemonTaskResultPayload["openClawGatewayVisibility"]
> | null {
  if (!(error && typeof error === "object")) {
    return null;
  }
  const openClawGatewayVisibility = (
    error as {
      openClawGatewayVisibility?: NonNullable<
        OpenMeldDaemonTaskResultPayload["openClawGatewayVisibility"]
      > | null;
    }
  ).openClawGatewayVisibility;
  return openClawGatewayVisibility ?? null;
}

function extractErrorCode(error: unknown): string | null {
  if (!(error && typeof error === "object" && "code" in error)) {
    return null;
  }
  const normalized = String((error as { code?: unknown }).code ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function extractProviderErrorCode(error: unknown): string | null {
  if (!(error && typeof error === "object" && "providerErrorCode" in error)) {
    return null;
  }
  const normalized = String(
    (error as { providerErrorCode?: unknown }).providerErrorCode ?? ""
  ).trim();
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
