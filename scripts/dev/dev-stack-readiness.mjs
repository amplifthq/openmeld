const DEFAULT_DEV_STACK_TIMEOUT_MS = 180_000;
const DEV_STACK_TIMEOUT_ENV_VAR = "OPENMELD_DEV_STACK_TIMEOUT_MS";
const DEV_STACK_ROOT_POLL_INTERVAL_MS = 400;
const DEV_STACK_CHAIN_POLL_INTERVAL_MS = 1000;
const DEV_STACK_CHAIN_GRACE_PERIOD_MS = 1500;
const DEV_STACK_PROBE_TIMEOUT_MS = 1500;
const DEV_STACK_PROGRESS_INTERVAL_MS = 10_000;

const DEV_STACK_ROOT_TARGETS = [
  {
    key: "auth",
    summary: "auth root",
    url: "http://localhost:8788/",
  },
  {
    key: "gateway",
    summary: "gateway root",
    url: "http://localhost:8080/",
  },
];

const DEV_STACK_GATEWAY_CHAIN_TARGET = {
  key: "gateway-chain",
  summary: "gateway auth chain",
  url: "http://localhost:8080/v1/diagnostics/chain",
};

export class LocalDevStackReadinessError extends Error {
  constructor(result, details = {}) {
    super(buildDevStackReadinessFailureMessage(result, details));
    this.name = "LocalDevStackReadinessError";
    this.targetKey = result?.target?.key ?? null;
    this.targetSummary = result?.target?.summary ?? null;
    this.targetUrl = result?.target?.url ?? null;
    this.failure = result?.failure ?? "no_probe_completed";
    this.status = typeof result?.status === "number" ? result.status : null;
    this.raw = result?.raw ?? null;
    this.elapsedMs = Number.isFinite(details.elapsedMs)
      ? Math.max(0, Math.trunc(details.elapsedMs))
      : null;
    this.timeoutMs = Number.isFinite(details.timeoutMs)
      ? Math.max(0, Math.trunc(details.timeoutMs))
      : null;
    this.probeSummary = details.probeSummary ?? null;
  }
}

export async function waitForLocalDevStackReady(input = {}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const targets = resolveDevStackTargets(input);
  const timeoutMs = resolveDevStackTimeoutMs(input);
  const rootPollIntervalMs =
    input.rootPollIntervalMs ?? DEV_STACK_ROOT_POLL_INTERVAL_MS;
  const chainPollIntervalMs =
    input.chainPollIntervalMs ?? DEV_STACK_CHAIN_POLL_INTERVAL_MS;
  const chainGracePeriodMs =
    input.chainGracePeriodMs ?? DEV_STACK_CHAIN_GRACE_PERIOD_MS;
  const progressIntervalMs =
    input.progressIntervalMs ?? DEV_STACK_PROGRESS_INTERVAL_MS;
  const logger = input.logger ?? null;
  const startedAt = Date.now();
  let lastFailure = null;
  let lastRootProbeResults = null;
  let lastChainProbeResult = null;
  let lastProgressLogAt = 0;
  let lastProgressState = null;
  let firstFullyHealthyRootsAt = null;
  let nextChainProbeAt = null;

  while (Date.now() - startedAt < timeoutMs) {
    const rootProbeResults = await Promise.all(
      targets.root.map((target) =>
        probeDevStackTarget({
          fetchImpl,
          target,
        })
      )
    );
    lastRootProbeResults = rootProbeResults;
    const failedRootProbe = rootProbeResults.find(
      (result) => result.ok !== true
    );
    if (failedRootProbe) {
      lastFailure = failedRootProbe;
      lastChainProbeResult = null;
      firstFullyHealthyRootsAt = null;
      nextChainProbeAt = null;
      ({ lastProgressLogAt, lastProgressState } = maybeLogReadinessProgress({
        logger,
        startedAt,
        timeoutMs,
        progressIntervalMs,
        lastProgressLogAt,
        lastProgressState,
        result: failedRootProbe,
        rootProbeResults,
        chainProbeResult: null,
      }));
      await sleep(rootPollIntervalMs);
      continue;
    }

    if (firstFullyHealthyRootsAt === null) {
      firstFullyHealthyRootsAt = Date.now();
      nextChainProbeAt = firstFullyHealthyRootsAt + chainGracePeriodMs;
    }

    const now = Date.now();
    if (now < nextChainProbeAt) {
      ({ lastProgressLogAt, lastProgressState } = maybeLogReadinessProgress({
        logger,
        startedAt,
        timeoutMs,
        progressIntervalMs,
        lastProgressLogAt,
        lastProgressState,
        result: {
          ok: false,
          target: targets.gatewayChain,
          failure: "waiting_for_chain_grace_period",
          raw: "roots healthy; waiting before gateway auth chain probe",
          status: null,
        },
        rootProbeResults,
        chainProbeResult: null,
      }));
      await sleep(Math.min(rootPollIntervalMs, nextChainProbeAt - now));
      continue;
    }

    const chainProbeResult = await probeDevStackTarget({
      fetchImpl,
      target: targets.gatewayChain,
    });
    lastChainProbeResult = chainProbeResult;
    if (chainProbeResult.ok) {
      return {
        summary: "auth, gateway, and gateway auth chain are healthy.",
      };
    }

    lastFailure = chainProbeResult;
    ({ lastProgressLogAt, lastProgressState } = maybeLogReadinessProgress({
      logger,
      startedAt,
      timeoutMs,
      progressIntervalMs,
      lastProgressLogAt,
      lastProgressState,
      result: chainProbeResult,
      rootProbeResults,
      chainProbeResult,
    }));
    nextChainProbeAt = Date.now() + chainPollIntervalMs;
    await sleep(chainPollIntervalMs);
  }

  throw new LocalDevStackReadinessError(lastFailure, {
    elapsedMs: Date.now() - startedAt,
    timeoutMs,
    restartCommand: input.restartCommand,
    probeSummary: buildProbeSummary({
      rootProbeResults: lastRootProbeResults,
      chainProbeResult: lastChainProbeResult,
    }),
  });
}

export function resolveDevStackTargets(input = {}) {
  if (!(input.authBaseUrl || input.gatewayBaseUrl)) {
    return {
      gatewayChain: DEV_STACK_GATEWAY_CHAIN_TARGET,
      root: DEV_STACK_ROOT_TARGETS,
    };
  }

  const authBaseUrl = normalizeDevStackBaseUrl(
    input.authBaseUrl ?? DEV_STACK_ROOT_TARGETS[0].url
  );
  const gatewayBaseUrl = normalizeDevStackBaseUrl(
    input.gatewayBaseUrl ?? DEV_STACK_ROOT_TARGETS[1].url
  );

  return {
    gatewayChain: {
      ...DEV_STACK_GATEWAY_CHAIN_TARGET,
      url: new URL("v1/diagnostics/chain", gatewayBaseUrl).href,
    },
    root: [
      {
        ...DEV_STACK_ROOT_TARGETS[0],
        url: authBaseUrl,
      },
      {
        ...DEV_STACK_ROOT_TARGETS[1],
        url: gatewayBaseUrl,
      },
    ],
  };
}

function normalizeDevStackBaseUrl(value) {
  const url = new URL(String(value));
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.href;
}

export function resolveDevStackTimeoutMs(input = {}) {
  if (Number.isFinite(input.timeoutMs)) {
    const timeoutMs = Math.trunc(input.timeoutMs);
    if (timeoutMs > 0) {
      return timeoutMs;
    }
    throw new Error("dev stack timeoutMs must be a positive integer.");
  }

  const env = input.env ?? process.env;
  const raw = String(env?.[DEV_STACK_TIMEOUT_ENV_VAR] ?? "").trim();
  if (raw.length === 0) {
    return DEFAULT_DEV_STACK_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== raw) {
    throw new Error(
      `${DEV_STACK_TIMEOUT_ENV_VAR} must be a positive integer in milliseconds.`
    );
  }

  return parsed;
}

export function classifyDevStackGatewayChainFailure(text) {
  const normalized = String(text ?? "")
    .trim()
    .toLowerCase();
  if (
    normalized.includes("gatewayauthrpcentrypoint") ||
    normalized.includes("resolverequestauth") ||
    normalized.includes("couldn't find a local dev session") ||
    normalized.includes('worker "openmeld-auth" not found')
  ) {
    return "local_dev_session_missing";
  }
  if (
    normalized.includes("upstream_unreachable") ||
    normalized.includes("timed out") ||
    normalized.includes("network.timeout")
  ) {
    return "gateway_unreachable";
  }
  return "chain_unhealthy_unknown";
}

async function probeDevStackTarget(input) {
  try {
    const response = await input.fetchImpl(input.target.url, {
      method: "GET",
      signal: AbortSignal.timeout(DEV_STACK_PROBE_TIMEOUT_MS),
    });
    const raw = await response.text();
    if (
      isHealthyDevStackProbe({
        response,
        targetKey: input.target.key,
      })
    ) {
      return {
        ok: true,
        target: input.target,
      };
    }
    return {
      ok: false,
      target: input.target,
      failure:
        input.target.key === "gateway-chain"
          ? classifyDevStackGatewayChainFailure(raw)
          : "target_unhealthy",
      raw,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      target: input.target,
      failure: "target_unreachable",
      raw: formatProbeError(error),
      status: null,
    };
  }
}

function formatProbeError(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const causeMessage =
    error.cause instanceof Error ? error.cause.message.trim() : "";
  if (causeMessage.length > 0 && causeMessage !== error.message.trim()) {
    return `${error.message}: ${causeMessage}`;
  }

  return error.message;
}

function isHealthyDevStackProbe(input) {
  if (input.targetKey === "gateway-chain") {
    // The dev stack startup gate proves gateway -> auth/core connectivity.
    // Once the auth worker is reachable, an unauthenticated chain probe should
    // fail as 401/403 instead of 502 local session errors.
    return input.response.status === 401 || input.response.status === 403;
  }

  return input.response.ok;
}

function buildDevStackReadinessFailureMessage(result, details = {}) {
  if (!result) {
    return "local OpenMeld dev stack readiness check timed out before any probe completed.";
  }

  const elapsedText =
    Number.isFinite(details.elapsedMs) && Number.isFinite(details.timeoutMs)
      ? ` after ${formatDuration(details.elapsedMs)} of ${formatDuration(details.timeoutMs)}`
      : "";
  const summaryText =
    typeof details.probeSummary === "string" && details.probeSummary.length > 0
      ? ` Recent probes: ${details.probeSummary}.`
      : "";

  if (result.target.key === "gateway-chain") {
    switch (result.failure) {
      case "local_dev_session_missing": {
        const restartGuidance = details.restartCommand
          ? `Restart \`${String(details.restartCommand)}\``
          : "Run `pnpm dev:stop`, then `pnpm dev`";
        return `local OpenMeld dev stack failed readiness${elapsedText}: ${result.target.summary} is missing a required local Worker session. ${restartGuidance}, then verify \`${result.target.url}\`.${summaryText}`;
      }
      case "gateway_unreachable":
        return `local OpenMeld dev stack failed readiness${elapsedText}: ${result.target.summary} is unavailable (${formatStatus(result.status, result.raw)}).${summaryText}`;
      default:
        return `local OpenMeld dev stack failed readiness${elapsedText}: ${result.target.summary} is unhealthy (${formatStatus(result.status, result.raw)}).${summaryText}`;
    }
  }

  return `local OpenMeld dev stack failed readiness${elapsedText}: ${result.target.summary} is unavailable (${formatStatus(result.status, result.raw)}).${summaryText}`;
}

function formatStatus(status, raw) {
  if (typeof status === "number") {
    const suffix = String(raw ?? "").trim();
    return suffix.length > 0
      ? `HTTP ${status}: ${truncateText(suffix)}`
      : `HTTP ${status}`;
  }
  return truncateText(String(raw ?? "").trim() || "unknown error");
}

function truncateText(text, maxLength = 220) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function maybeLogReadinessProgress(input) {
  if (!input.logger?.log) {
    return {
      lastProgressLogAt: input.lastProgressLogAt,
      lastProgressState: input.lastProgressState,
    };
  }

  const now = Date.now();
  const progressState = buildProgressState(input.result);
  const shouldLog =
    progressState !== input.lastProgressState ||
    now - input.lastProgressLogAt >= input.progressIntervalMs;

  if (!shouldLog) {
    return {
      lastProgressLogAt: input.lastProgressLogAt,
      lastProgressState: input.lastProgressState,
    };
  }

  const elapsedMs = now - input.startedAt;
  input.logger.log(
    [
      `[dev-guard] waiting for local OpenMeld dev stack (${formatDuration(elapsedMs)} / ${formatDuration(input.timeoutMs)}):`,
      formatProgressResult(input.result),
      `Recent probes: ${buildProbeSummary({
        rootProbeResults: input.rootProbeResults,
        chainProbeResult: input.chainProbeResult,
      })}.`,
    ].join(" ")
  );

  return {
    lastProgressLogAt: now,
    lastProgressState: progressState,
  };
}

function buildProgressState(result) {
  return [
    result?.target?.key ?? "unknown",
    result?.failure ?? "unknown",
    result?.status ?? "no-status",
    result?.raw ?? "",
  ].join(":");
}

function formatProgressResult(result) {
  const summary = result?.target?.summary ?? "unknown target";
  const url = result?.target?.url ?? "unknown URL";
  if (result?.failure === "waiting_for_chain_grace_period") {
    return `${summary} is waiting (${formatStatus(result.status, result.raw)}).`;
  }
  return `${summary} is not ready at ${url} (${formatStatus(
    result?.status ?? null,
    result?.raw
  )}).`;
}

function buildProbeSummary(input) {
  const parts = [];
  for (const result of input.rootProbeResults ?? []) {
    parts.push(formatProbeSummaryPart(result));
  }

  if (input.chainProbeResult) {
    parts.push(formatProbeSummaryPart(input.chainProbeResult));
  } else {
    parts.push(`${DEV_STACK_GATEWAY_CHAIN_TARGET.summary}=not probed`);
  }

  return parts.length > 0 ? parts.join("; ") : "no completed probes";
}

function formatProbeSummaryPart(result) {
  const summary = result?.target?.summary ?? "unknown target";
  if (result?.ok) {
    return `${summary}=healthy`;
  }
  return `${summary}=${formatFailureLabel(result)} (${formatStatus(
    result?.status ?? null,
    result?.raw
  )})`;
}

function formatFailureLabel(result) {
  switch (result?.failure) {
    case "target_unreachable":
      return "unreachable";
    case "target_unhealthy":
      return "unhealthy";
    case "local_dev_session_missing":
      return "missing local dev session";
    case "gateway_unreachable":
      return "unreachable";
    case "waiting_for_chain_grace_period":
      return "waiting";
    case "chain_unhealthy_unknown":
      return "unhealthy";
    default:
      return result?.failure ?? "unknown";
  }
}

function formatDuration(ms) {
  const normalizedMs = Math.max(0, Math.trunc(ms));
  if (normalizedMs < 1000) {
    return `${normalizedMs}ms`;
  }
  return `${(normalizedMs / 1000).toFixed(1)}s`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
