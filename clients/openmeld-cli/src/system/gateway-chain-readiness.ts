import {
  OPENMELD_HEADER_PROFILE_ID,
  toErrorMessage,
} from "@openmeld/gateway-contract";
import {
  getAuthSessionState,
  type StoredAuthSession,
} from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import {
  type OpenMeldEnvPreset,
  resolveOpenMeldEnvPreset,
} from "../config/paths";
import { buildRequestAuthHeaders } from "../config/request-headers";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import { DEFAULT_GATEWAY_CHAIN_TIMEOUT_MS as STRATEGY_DEFAULT_GATEWAY_CHAIN_TIMEOUT_MS } from "../strategy-constants";

export const DEFAULT_GATEWAY_CHAIN_TIMEOUT_MS =
  STRATEGY_DEFAULT_GATEWAY_CHAIN_TIMEOUT_MS;

export type GatewayChainFailureKind =
  | "gateway_unreachable"
  | "auth_required"
  | "local_dev_session_missing"
  | "dispatch_storage_not_ready"
  | "chain_unhealthy_unknown";

export type GatewayChainReadiness =
  | {
      applicable: false;
      baseUrl: string | null;
      checkedAt: string;
      details: null;
      errorCode: null;
      errorMessage: null;
      failureKind: null;
      ready: true;
      status: null;
      summary: string;
    }
  | {
      applicable: true;
      baseUrl: string;
      checkedAt: string;
      details: null;
      errorCode: null;
      errorMessage: null;
      failureKind: null;
      ready: true;
      status: number;
      summary: string;
    }
  | {
      applicable: true;
      baseUrl: string;
      checkedAt: string;
      details: string;
      errorCode: string | null;
      errorMessage: string | null;
      failureKind: GatewayChainFailureKind;
      ready: false;
      status: number | null;
      summary: string;
    };

export type GatewayChainGuidance = {
  nextSteps: string[];
  summary: string;
};

export type GatewayChainProfile = {
  openMeldProfileId: string;
  profileName?: string | null;
};

export async function resolveGatewayChainReadiness(
  input: {
    authSession?: StoredAuthSession | null;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    profile?: GatewayChainProfile | null;
    timeoutMs?: number;
  } = {}
): Promise<GatewayChainReadiness> {
  const checkedAt = new Date().toISOString();
  const authSession =
    input.authSession === undefined
      ? await resolveGatewayChainAuthSession()
      : input.authSession;
  const profile = input.profile ?? null;

  if (!(authSession && profile?.openMeldProfileId)) {
    return {
      applicable: false,
      baseUrl: null,
      checkedAt,
      details: null,
      errorCode: null,
      errorMessage: null,
      failureKind: null,
      ready: true,
      status: null,
      summary:
        "Gateway chain check is not applicable for this local connection check.",
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const fallbackBaseUrl = resolveGatewayChainFailureBaseUrl(input.baseUrl);

  try {
    const baseUrl = await resolveBaseUrl(input.baseUrl);
    const endpoint = new URL("/v1/diagnostics/chain", baseUrl).toString();
    const headers = await buildRequestAuthHeaders({
      authSession,
      requestUrl: endpoint,
    });
    headers[OPENMELD_HEADER_PROFILE_ID] = profile.openMeldProfileId;
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(
        input.timeoutMs ?? DEFAULT_GATEWAY_CHAIN_TIMEOUT_MS
      ),
    });
    const raw = await response.text();
    if (response.ok) {
      return {
        applicable: true,
        baseUrl,
        checkedAt,
        details: null,
        errorCode: null,
        errorMessage: null,
        failureKind: null,
        ready: true,
        status: response.status,
        summary: "Gateway auth chain is healthy.",
      };
    }

    const errorDetails = resolveGatewayErrorDetails(raw);
    const failureKind = classifyGatewayChainFailure({
      code: errorDetails.code,
      message: errorDetails.message || errorDetails.details,
      status: response.status,
    });
    return {
      applicable: true,
      baseUrl,
      checkedAt,
      details: formatGatewayHttpFailure(response.status, raw),
      errorCode: errorDetails.code,
      errorMessage: errorDetails.message,
      failureKind,
      ready: false,
      status: response.status,
      summary: describeGatewayChainFailure(failureKind),
    };
  } catch (error) {
    return {
      applicable: true,
      baseUrl: fallbackBaseUrl,
      checkedAt,
      details: toErrorMessage(error),
      errorCode: null,
      errorMessage: toErrorMessage(error),
      failureKind: "gateway_unreachable",
      ready: false,
      status: null,
      summary: describeGatewayChainFailure("gateway_unreachable"),
    };
  }
}

function resolveGatewayChainFailureBaseUrl(value: string | undefined): string {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : "unknown";
}

export function classifyGatewayChainFailure(input: {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}): GatewayChainFailureKind {
  const status = input.status ?? null;
  const code = String(input.code ?? "")
    .trim()
    .toLowerCase();
  const message = String(input.message ?? "")
    .trim()
    .toLowerCase();
  const combined = [code, message]
    .filter((value) => value.length > 0)
    .join(" ");

  if (
    combined.includes("core dispatch storage is not ready") ||
    combined.includes("shared openmeld_db migration is missing") ||
    combined.includes("apply the shared db gate")
  ) {
    return "dispatch_storage_not_ready";
  }

  if (
    combined.includes("gatewayauthrpcentrypoint") ||
    combined.includes("resolverequestauth") ||
    combined.includes("couldn't find a local dev session") ||
    combined.includes('worker "openmeld-auth" not found')
  ) {
    return "local_dev_session_missing";
  }

  if (
    status === 401 ||
    status === 403 ||
    combined.includes("auth.unauthenticated") ||
    combined.includes("authentication required")
  ) {
    return "auth_required";
  }

  if (
    combined.includes("upstream_unreachable") ||
    combined.includes("network.timeout") ||
    combined.includes("timed out") ||
    combined.includes("gateway is unreachable") ||
    combined.includes("can't reach the gateway")
  ) {
    return "gateway_unreachable";
  }

  return "chain_unhealthy_unknown";
}

export function formatGatewayHttpFailure(status: number, raw: string): string {
  const details = extractGatewayErrorDetails(raw);
  if (details) {
    return `HTTP ${status}: ${details}`;
  }
  return `HTTP ${status}`;
}

export function extractGatewayErrorDetails(raw: string): string {
  return resolveGatewayErrorDetails(raw).details;
}

export function resolveGatewayChainRepairGuidance(input: {
  failureKind?: GatewayChainFailureKind | null;
  lane?: OpenMeldEnvPreset;
}): GatewayChainGuidance {
  const lane = input.lane ?? resolveOpenMeldEnvPreset();
  if (input.failureKind === "dispatch_storage_not_ready") {
    if (lane !== "dev-local") {
      return {
        nextSteps: [
          "Retry the OpenMeld command shortly.",
          "If this continues, contact OpenMeld support with the latest command output.",
        ],
        summary:
          "OpenMeld cloud execution storage is temporarily unavailable. Retry shortly; if it continues, contact OpenMeld support.",
      };
    }
    return {
      nextSteps: [
        "pnpm db:migrate:dev",
        "pnpm db:verify:dev",
        "pnpm dev:stop",
        "pnpm dev",
        formatOpenMeldCliCommand("openmeld service status"),
      ],
      summary:
        "Run `pnpm db:migrate:dev`, then `pnpm db:verify:dev`, then restart the local OpenMeld dev stack with `pnpm dev:stop` and `pnpm dev`, then verify with `openmeld service status`.",
    };
  }

  if (lane === "dev-local") {
    const repairCommand = formatOpenMeldCliCommand("openmeld doctor --repair");
    return {
      nextSteps: ["pnpm dev:stop", "pnpm dev", repairCommand],
      summary:
        input.failureKind === "local_dev_session_missing"
          ? `Run \`pnpm dev:stop\`, then \`pnpm dev\`, then \`${repairCommand}\`.`
          : `Restart the local OpenMeld dev stack with \`pnpm dev:stop\` and \`pnpm dev\`, then run \`${repairCommand}\`.`,
    };
  }

  const statusCommand = formatOpenMeldCliCommand("openmeld service status");
  const repairCommand = formatOpenMeldCliCommand("openmeld doctor --repair");
  return {
    nextSteps: [statusCommand, repairCommand],
    summary: `Run \`${statusCommand}\`; if unhealthy run \`${repairCommand}\`.`,
  };
}

export function resolveGatewayChainRetryGuidance(input: {
  failureKind: GatewayChainFailureKind;
  lane?: OpenMeldEnvPreset;
}): GatewayChainGuidance {
  const repairGuidance = resolveGatewayChainRepairGuidance(input);
  const retrySummary = repairGuidance.summary.endsWith(".")
    ? `${repairGuidance.summary.slice(0, -1)}, then retry.`
    : `${repairGuidance.summary}, then retry.`;
  return {
    nextSteps: repairGuidance.nextSteps,
    summary: retrySummary,
  };
}

function describeGatewayChainFailure(
  failureKind: GatewayChainFailureKind
): string {
  switch (failureKind) {
    case "local_dev_session_missing":
      return "OpenMeld gateway can't reach the local OpenMeld auth worker session.";
    case "auth_required":
      return "Gateway auth chain requires sign-in for this OpenMeld environment.";
    case "dispatch_storage_not_ready":
      return "OpenMeld cloud execution storage is temporarily unavailable.";
    case "gateway_unreachable":
      return "Gateway auth chain is unavailable.";
    default:
      return "Gateway auth chain is unhealthy.";
  }
}

async function resolveGatewayChainAuthSession(): Promise<StoredAuthSession | null> {
  const authState = await getAuthSessionState({
    validateRemote: false,
  }).catch(() => null);
  if (authState?.state !== "valid" || !authState.session) {
    return null;
  }
  return authState.session;
}

function resolveGatewayErrorDetails(raw: string): {
  code: string | null;
  details: string;
  message: string | null;
} {
  const text = raw.trim();
  if (!text) {
    return {
      code: null,
      details: "",
      message: null,
    };
  }

  const parsed = parseJson(text);
  if (!parsed || typeof parsed !== "object") {
    return {
      code: null,
      details: truncateText(text),
      message: null,
    };
  }

  const payload = parsed as {
    error?: unknown;
  };
  if (!payload.error || typeof payload.error !== "object") {
    return {
      code: null,
      details: truncateText(text),
      message: null,
    };
  }

  const error = payload.error as {
    code?: unknown;
    message?: unknown;
  };
  const code = typeof error.code === "string" ? error.code : null;
  const message = typeof error.message === "string" ? error.message : null;

  if (code && message) {
    return {
      code,
      details: `${code}: ${message}`,
      message,
    };
  }
  if (message) {
    return {
      code,
      details: message,
      message,
    };
  }
  if (code) {
    return {
      code,
      details: code,
      message,
    };
  }
  return {
    code: null,
    details: truncateText(text),
    message: null,
  };
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function truncateText(text: string, maxLength = 220): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}
