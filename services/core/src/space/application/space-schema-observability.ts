import type { CoreBindings } from "../../lib/bindings";
import { emitCoreCloudflareRuntimeEvidence } from "../../shared/observability/cloudflare-runtime-evidence";

export function measureSpaceSchemaInitialization<T>(input: {
  env: CoreBindings;
  initialize: () => T;
  nowMs?: () => number;
  spaceId: string;
}): T {
  const nowMs = input.nowMs ?? defaultNowMs;
  const startedAtMs = nowMs();
  let failure: unknown;
  try {
    return input.initialize();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    emitCoreCloudflareRuntimeEvidence(input.env, {
      durationMs: Math.max(0, nowMs() - startedAtMs),
      errorName: resolveErrorName(failure),
      event: "core.openmeld.space.schema_initialization",
      operation: "ensureSpaceSqlSchema",
      reasonCode: "ensure_space_sql_schema",
      runtimeKind: "durable_object",
      spaceId: input.spaceId,
      status: failure === undefined ? "succeeded" : "failed",
      workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
    });
  }
}

function defaultNowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function resolveErrorName(error: unknown): string | null {
  if (error === undefined) {
    return null;
  }
  return error instanceof Error ? error.name : typeof error;
}
