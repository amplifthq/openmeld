import * as z from "zod/v4";

/** Core's query observation, never proof of execution or authority to restart. */
export const remoteAgentExecutionReconciliationObservationSchema =
  z.strictObject({
    v: z.literal(1),
    consecutiveFailures: z.int().positive(),
    firstUnavailableAtMs: z.int().nonnegative(),
    lastObservedAtMs: z.int().nonnegative(),
    failureKind: z.enum([
      "transport",
      "invalid_response",
      "unsupported",
      "not_found",
    ]),
    retryState: z.enum(["retrying", "paused"]),
  });

export type RemoteAgentExecutionReconciliationObservation = z.infer<
  typeof remoteAgentExecutionReconciliationObservationSchema
>;

export const REMOTE_AGENT_EXECUTION_CONFIRMATION_PENDING_REASON_CODE =
  "remote_agent.execution_confirmation_pending";
export const REMOTE_AGENT_EXECUTION_CONFIRMATION_WAIT_MS = 240_000;
