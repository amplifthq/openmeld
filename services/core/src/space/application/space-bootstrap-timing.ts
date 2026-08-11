import type { SpaceBootstrapResponse } from "@openmeld/schemas/types";

export type SpaceBootstrapTimingMetric = {
  name: string;
  description: string;
  durationMs: number;
};

export type SpaceBootstrapTimingCollector = {
  measure: <T>(
    metric: SpaceBootstrapTimingMetricInput,
    read: () => Promise<T> | T
  ) => Promise<T>;
  measureSync: <T>(metric: SpaceBootstrapTimingMetricInput, read: () => T) => T;
  metrics: () => readonly SpaceBootstrapTimingMetric[];
};

export type SpaceBootstrapWithTiming = {
  metrics: readonly SpaceBootstrapTimingMetric[];
  payload: SpaceBootstrapResponse;
  serverTiming: string;
};

type SpaceBootstrapTimingMetricInput = {
  name: string;
  description: string;
};

const SERVER_TIMING_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function createSpaceBootstrapTimingCollector(input?: {
  nowMs?: () => number;
}): SpaceBootstrapTimingCollector {
  const metrics: SpaceBootstrapTimingMetric[] = [];
  const nowMs = input?.nowMs ?? defaultNowMs;

  const record = (
    metric: SpaceBootstrapTimingMetricInput,
    startedAtMs: number
  ) => {
    metrics.push({
      ...metric,
      durationMs: Math.max(0, nowMs() - startedAtMs),
    });
  };

  return {
    async measure<T>(
      metric: SpaceBootstrapTimingMetricInput,
      read: () => Promise<T> | T
    ): Promise<T> {
      const startedAtMs = nowMs();
      try {
        return await read();
      } finally {
        record(metric, startedAtMs);
      }
    },
    measureSync<T>(metric: SpaceBootstrapTimingMetricInput, read: () => T): T {
      const startedAtMs = nowMs();
      try {
        return read();
      } finally {
        record(metric, startedAtMs);
      }
    },
    metrics: () => metrics,
  };
}

export function createSpaceBootstrapWithTiming(input: {
  payload: SpaceBootstrapResponse;
  metrics: readonly SpaceBootstrapTimingMetric[];
}): SpaceBootstrapWithTiming {
  return {
    metrics: input.metrics,
    payload: input.payload,
    serverTiming: formatSpaceBootstrapServerTiming(input.metrics),
  };
}

export function formatSpaceBootstrapServerTiming(
  metrics: readonly SpaceBootstrapTimingMetric[]
): string {
  return [...metrics]
    .sort(compareSpaceBootstrapTimingMetrics)
    .filter((metric) => SERVER_TIMING_TOKEN_PATTERN.test(metric.name))
    .filter((metric) => Number.isFinite(metric.durationMs))
    .map((metric) => {
      const duration = Math.round(Math.max(0, metric.durationMs) * 10) / 10;
      return `${metric.name};dur=${duration};desc="${escapeServerTimingDescription(
        metric.description
      )}"`;
    })
    .join(", ");
}

function compareSpaceBootstrapTimingMetrics(
  left: SpaceBootstrapTimingMetric,
  right: SpaceBootstrapTimingMetric
): number {
  return timingMetricRank(left.name) - timingMetricRank(right.name);
}

function timingMetricRank(name: string): number {
  if (name === "openmeld_bootstrap_total") {
    return 0;
  }
  if (name.startsWith("openmeld_bootstrap_status")) {
    return 10;
  }
  if (name.startsWith("openmeld_bootstrap_members")) {
    return 20;
  }
  if (name.startsWith("openmeld_bootstrap_history")) {
    return 30;
  }
  if (name.startsWith("openmeld_bootstrap_agent_streams")) {
    return 40;
  }
  if (name.startsWith("openmeld_bootstrap_threads")) {
    return 50;
  }
  return 100;
}

function defaultNowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function escapeServerTimingDescription(description: string): string {
  return description.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
