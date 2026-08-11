import type {
  RuntimeReportingChannel,
  RuntimeReportingChannelHealth,
  RuntimeReportingHealthState,
} from "@openmeld/schemas/types";

type RuntimeReportingChannelDiagnosticFacts = {
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastFailureReasonCode: string | null;
  lastSuccessAt: string | null;
};

export type RuntimeReportingHealthDiagnostic = {
  facts: Record<
    RuntimeReportingChannel,
    RuntimeReportingChannelDiagnosticFacts
  >;
  kind: "info" | "ok" | "warn";
  message: string;
};

const REPORTING_SUCCESS_STALE_AFTER_MS = 30 * 60_000;
const REPORTING_DEGRADED_FAILURE_THRESHOLD = 3;
const TRAILING_SENTENCE_PUNCTUATION_RE = /[.!?]+$/u;

const RUNTIME_REPORTING_CHANNEL_LABELS: Record<
  RuntimeReportingChannel,
  string
> = {
  runtimeAgentController: "Runtime agent controller reporting",
  providerConversationProof: "Provider conversation proof reporting",
};

type RuntimeReportingChannelStatus =
  | "degraded"
  | "healthy"
  | "not_applicable"
  | "starting";

type RuntimeReportingChannelEvaluation = {
  channel: RuntimeReportingChannel;
  facts: RuntimeReportingChannelDiagnosticFacts;
  lastFailureMessage: string | null;
  status: RuntimeReportingChannelStatus;
};

export function resolveRuntimeReportingHealthDiagnostic(input: {
  effectiveRuntimeStatus: "not_running" | "running" | "stale" | "unknown";
  healthState: RuntimeReportingHealthState | null;
  nowMs?: number;
  runtimeStartedAt: string | null;
}): RuntimeReportingHealthDiagnostic {
  const nowMs = input.nowMs ?? Date.now();
  const runtimeAgentController = evaluateRuntimeReportingChannel({
    channel: "runtimeAgentController",
    channelHealth: input.healthState?.runtimeAgentController ?? null,
    nowMs,
    runtimeStartedAt:
      input.healthState?.serviceIdentityObservedAt ?? input.runtimeStartedAt,
  });
  const providerConversationProof = evaluateRuntimeReportingChannel({
    channel: "providerConversationProof",
    channelHealth: input.healthState?.providerConversationProof ?? null,
    nowMs,
    runtimeStartedAt:
      input.healthState?.serviceIdentityObservedAt ?? input.runtimeStartedAt,
  });
  const evaluations = [runtimeAgentController, providerConversationProof];
  const facts: RuntimeReportingHealthDiagnostic["facts"] = {
    runtimeAgentController: runtimeAgentController.facts,
    providerConversationProof: providerConversationProof.facts,
  };

  if (input.effectiveRuntimeStatus !== "running") {
    return {
      facts,
      kind: "info",
      message:
        "Local agent reporting health is available when OpenMeld Service is running.",
    };
  }

  const degraded = evaluations.filter(
    (evaluation) => evaluation.status === "degraded"
  );
  if (degraded.length > 0) {
    return {
      facts,
      kind: "warn",
      message: buildDegradedReportingMessage(degraded),
    };
  }

  const stillStarting = evaluations.some(
    (evaluation) => evaluation.status === "starting"
  );
  if (stillStarting) {
    return {
      facts,
      kind: "info",
      message: "Local agent reporting is starting.",
    };
  }

  return {
    facts,
    kind: "ok",
    message: "Local agent reporting is healthy.",
  };
}

function evaluateRuntimeReportingChannel(input: {
  channel: RuntimeReportingChannel;
  channelHealth: RuntimeReportingChannelHealth | null;
  nowMs: number;
  runtimeStartedAt: string | null;
}): RuntimeReportingChannelEvaluation {
  const { channel, channelHealth, nowMs, runtimeStartedAt } = input;
  const facts: RuntimeReportingChannelDiagnosticFacts = {
    consecutiveFailures: channelHealth?.consecutiveFailures ?? 0,
    lastFailureAt: channelHealth?.lastFailure?.at ?? null,
    lastFailureReasonCode: channelHealth?.lastFailure?.reasonCode ?? null,
    lastSuccessAt: channelHealth?.lastSuccessAt ?? null,
  };
  const lastFailureMessage = channelHealth?.lastFailure?.message ?? null;

  if (channelHealth?.applicability?.status === "not_applicable") {
    return { channel, facts, lastFailureMessage, status: "not_applicable" };
  }

  const mostRecentSuccessOrStartAt =
    channelHealth?.lastSuccessAt ??
    channelHealth?.applicability?.observedAt ??
    runtimeStartedAt;
  const referenceAtMs = Date.parse(mostRecentSuccessOrStartAt ?? "");
  const successIsStale =
    !Number.isFinite(referenceAtMs) ||
    nowMs - referenceAtMs > REPORTING_SUCCESS_STALE_AFTER_MS;
  const hasRepeatedFailures =
    facts.consecutiveFailures >= REPORTING_DEGRADED_FAILURE_THRESHOLD;

  if (successIsStale || hasRepeatedFailures) {
    return { channel, facts, lastFailureMessage, status: "degraded" };
  }
  if (!channelHealth?.lastSuccessAt) {
    return { channel, facts, lastFailureMessage, status: "starting" };
  }
  return { channel, facts, lastFailureMessage, status: "healthy" };
}

function buildDegradedReportingMessage(
  degradedEvaluations: readonly RuntimeReportingChannelEvaluation[]
): string {
  const clauses = degradedEvaluations
    .map(describeDegradedReportingChannel)
    .join(" ");
  return `Local agent version and status data may not be syncing to OpenMeld. ${clauses}`;
}

function describeDegradedReportingChannel(
  evaluation: RuntimeReportingChannelEvaluation
): string {
  const label = RUNTIME_REPORTING_CHANNEL_LABELS[evaluation.channel];
  if (evaluation.lastFailureMessage) {
    const failureCount = evaluation.facts.consecutiveFailures;
    const failureCountText = `${failureCount} consecutive ${
      failureCount === 1 ? "failure" : "failures"
    }`;
    const summary = evaluation.lastFailureMessage.replace(
      TRAILING_SENTENCE_PUNCTUATION_RE,
      ""
    );
    return `${label} has ${failureCountText}; last error: ${summary}.`;
  }
  return `${label} has had no successful report in the last 30 minutes.`;
}
