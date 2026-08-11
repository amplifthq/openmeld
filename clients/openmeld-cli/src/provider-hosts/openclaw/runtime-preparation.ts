import { openMeldDaemonTaskResultOpenClawGatewayVisibilityStatusSchema } from "@openmeld/schemas";
import type {
  OpenMeldDaemonTaskResultPayload,
  ProviderDispatchRuntimeContext,
} from "@openmeld/schemas/types";
import { normalizeOptionalText } from "../../local-service/core/logger";
import { DaemonServiceRunError } from "../../local-service/core/types";
import {
  ensureOpenClawGatewayAgentVisible,
  ensureOpenClawLocalBootstrap,
  type OpenClawGatewayVisibilityError,
  type OpenClawLocalBootstrapResult,
} from "./local-bootstrap";
import { fetchOpenClawGatewayHealth } from "./official-cli";

export type OpenClawRuntimePreparationMode = "dispatch" | "reply_readiness";

export type OpenClawRuntimePreparationDetails = {
  kind: "openclaw";
  bootstrap: OpenClawLocalBootstrapResult;
  openClawGatewayVisibility: NonNullable<
    OpenMeldDaemonTaskResultPayload["openClawGatewayVisibility"]
  >;
};

export type OpenClawRuntimePreparationResult = {
  envOverrides: Record<string, string | undefined>;
  preparationDetails: OpenClawRuntimePreparationDetails;
  runtimeContext: ProviderDispatchRuntimeContext;
};

type OpenClawRuntimePreparationDeps = {
  ensureBootstrap: typeof ensureOpenClawLocalBootstrap;
  ensureGatewayAgentVisible: typeof ensureOpenClawGatewayAgentVisible;
  fetchGatewayHealth: typeof fetchOpenClawGatewayHealth;
};

const DEFAULT_OPENCLAW_RUNTIME_PREPARATION_DEPS: OpenClawRuntimePreparationDeps =
  {
    ensureBootstrap: ensureOpenClawLocalBootstrap,
    ensureGatewayAgentVisible: ensureOpenClawGatewayAgentVisible,
    fetchGatewayHealth: fetchOpenClawGatewayHealth,
  };

export async function prepareOpenClawRuntime(
  input: {
    daemonWorkingDirectory: string;
    mode: OpenClawRuntimePreparationMode;
    openClawBin?: string;
    profileName: string | null;
    runtimeContext: ProviderDispatchRuntimeContext;
    targetProfileId: string;
  },
  deps: OpenClawRuntimePreparationDeps = DEFAULT_OPENCLAW_RUNTIME_PREPARATION_DEPS
): Promise<OpenClawRuntimePreparationResult> {
  const profileName = normalizeOptionalText(input.profileName);
  if (!profileName) {
    throw new DaemonServiceRunError({
      code: "controller.bootstrap.failed",
      message:
        "controller.bootstrap.failed: OpenClaw bootstrap requires an OpenMeld profile name",
    });
  }

  const providerRuntimeWorkingDirectory =
    input.runtimeContext.providerRuntimeWorkingDirectory;
  const bootstrap = await deps
    .ensureBootstrap({
      openClawBin: input.openClawBin,
      profile: {
        openMeldProfileId: input.targetProfileId,
        profileName,
      },
      providerRuntimeWorkingDirectory,
    })
    .catch((error) => {
      throw new DaemonServiceRunError({
        code: "controller.bootstrap.failed",
        message: `controller.bootstrap.failed: ${toErrorMessage(error)}`,
        providerErrorCode: extractErrorCode(error),
      });
    });

  if (input.mode === "reply_readiness") {
    await deps
      .fetchGatewayHealth({
        cwd: providerRuntimeWorkingDirectory,
        openClawBin: input.openClawBin,
      })
      .catch((error) => {
        throw new DaemonServiceRunError({
          code: "controller.gateway.unhealthy",
          message: `controller.gateway.unhealthy: ${toErrorMessage(error)}`,
          providerErrorCode: extractErrorCode(error),
        });
      });
  }

  const openClawGatewayVisibility = await deps
    .ensureGatewayAgentVisible({
      agentId: bootstrap.agentId,
      openClawBin: input.openClawBin,
      providerRuntimeWorkingDirectory,
    })
    .catch((error) => {
      const gatewayFailure = buildOpenClawGatewayVisibilityFailure(error);
      throw new DaemonServiceRunError({
        code: "controller.gateway.unhealthy",
        message: `controller.gateway.unhealthy: ${toErrorMessage(error)}`,
        providerErrorCode: extractErrorCode(error),
        ...gatewayFailure,
      });
    });

  return {
    envOverrides: {
      OPENMELD_DAEMON_RUNTIME_OPENCLAW_AGENT_ID: bootstrap.agentId,
    },
    preparationDetails: {
      bootstrap,
      kind: "openclaw",
      openClawGatewayVisibility: {
        agentId: openClawGatewayVisibility.agentId,
        gatewayRestartAttempted:
          openClawGatewayVisibility.gatewayRestartAttempted,
        gatewayVisibility: openClawGatewayVisibility.gatewayVisibility,
      },
    },
    runtimeContext: input.runtimeContext,
  };
}

function buildOpenClawGatewayVisibilityFailure(error: unknown): {
  openClawGatewayVisibility?: NonNullable<
    OpenMeldDaemonTaskResultPayload["openClawGatewayVisibility"]
  >;
} {
  const diagnostics = resolveOpenClawGatewayVisibilityDiagnostics(error);
  return diagnostics ? { openClawGatewayVisibility: diagnostics } : {};
}

function extractErrorCode(error: unknown): string | undefined {
  if (!(error && typeof error === "object" && "code" in error)) {
    return undefined;
  }
  const normalized = normalizeOptionalText((error as { code?: unknown }).code);
  return normalized ?? undefined;
}

function resolveOpenClawGatewayVisibilityDiagnostics(
  error: unknown
):
  | NonNullable<OpenMeldDaemonTaskResultPayload["openClawGatewayVisibility"]>
  | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const diagnostics = (error as OpenClawGatewayVisibilityError).diagnostics;
  if (
    !diagnostics ||
    typeof diagnostics !== "object" ||
    !normalizeOptionalText(diagnostics.agentId)
  ) {
    return undefined;
  }
  const parsedGatewayVisibility =
    openMeldDaemonTaskResultOpenClawGatewayVisibilityStatusSchema.safeParse(
      diagnostics.gatewayVisibility
    );
  if (!parsedGatewayVisibility.success) {
    return undefined;
  }
  return {
    agentId: diagnostics.agentId,
    gatewayRestartAttempted: diagnostics.gatewayRestartAttempted,
    gatewayVisibility: parsedGatewayVisibility.data,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
