import {
  DEFAULT_DISPATCH_WAIT_WINDOW_MS,
  MAX_DISPATCH_WAIT_WINDOW_MS,
} from "@openmeld/agent-runtime";

// Core-owned timing and threshold policy values. Do not share this file across
// deployment layers; mirror cross-end relationships in the execution log.
export const PROVIDER_ACCESS_EVIDENCE_TTL_MS = 60 * 60 * 1000;
export const DELIVERY_STABILITY_DEFAULT_METRICS_WINDOW_MS = 60_000;
export const DELIVERY_STABILITY_DEFAULT_DISPATCHING_TIMEOUT_MS = 5000;
export const RUNTIME_TRANSPORT_LOOKUP_TIMEOUT_MS = 5000;
// Recovery reads may receive a platform shutdown error near the end of the
// 30-second drain window. This is one total read budget, including retries;
// it never limits or changes the lifetime of an Agent execution.
export const RUNTIME_TRANSPORT_RECOVERY_READ_TIMEOUT_MS = 30_000;
export const RUNTIME_TRANSPORT_READ_MAX_ATTEMPTS = 3;
export const RUNTIME_TRANSPORT_READ_RETRY_BASE_DELAY_MS = 100;
export const RUNTIME_TRANSPORT_DELIVER_TIMEOUT_MS = 30_000;
export const RUNTIME_TRANSPORT_WAIT_TIMEOUT_FALLBACK_MS =
  DEFAULT_DISPATCH_WAIT_WINDOW_MS;
export const RUNTIME_TRANSPORT_WAIT_TIMEOUT_GRACE_MS = 8000;
export const RUNTIME_TRANSPORT_WAIT_TIMEOUT_MAX_MS =
  MAX_DISPATCH_WAIT_WINDOW_MS + 8000;
export const RUNTIME_TRANSPORT_LEASE_TTL_MS = 200_000;
// Bounded window Runtime Transport may hold an accepted delivery while an
// advertised `profileConfigurationRevision` Service converges upward onto the
// frozen dispatch revision after an acknowledged settings write. It is DERIVED,
// not an independent magic number: the convergence wait happens inside the
// /deliver-dispatch call, so the window must stay below
// RUNTIME_TRANSPORT_DELIVER_TIMEOUT_MS by a margin that absorbs one client->DO
// round trip plus DO scheduling jitter. A larger gap would let the outer
// delivery timeout mask the intended daemon.profile.configuration_not_synced
// outcome; a smaller gap would reject healthy Services mid-propagation.
//
// Relationship to the local OpenMeld Service contract (see
// clients/openmeld-cli/src/strategy-constants.ts): after the refresh nudge the
// healthy chain is a zero-delay heartbeat (HEARTBEAT_RESPONSE_TIMEOUT_MS cap)
// followed by the forced catalog sync that ends in a register report
// (ROUTE_CATALOG_LOAD_TIMEOUT_MS and REGISTER_RESPONSE_TIMEOUT_MS are
// failure-detection caps, not healthy durations), so ordinary convergence is a
// couple of round trips, well under this window. Anything slower than the
// window fails closed with daemon.profile.configuration_not_synced and the
// durable outbox redrive takes over.
export const RUNTIME_TRANSPORT_DELIVER_CONVERGENCE_SAFETY_MARGIN_MS = 3000;
export const RUNTIME_TRANSPORT_PROFILE_CONFIGURATION_CONVERGENCE_TIMEOUT_MS =
  RUNTIME_TRANSPORT_DELIVER_TIMEOUT_MS -
  RUNTIME_TRANSPORT_DELIVER_CONVERGENCE_SAFETY_MARGIN_MS;
export const RUNTIME_TRANSPORT_PROFILE_CONFIGURATION_CONVERGENCE_POLL_INTERVAL_MS = 400;
export const RUNTIME_TRANSPORT_RESULT_TTL_MS = 5 * 60 * 1000;
export const RUNTIME_TRANSPORT_WAIT_RESULT_DEFAULT_TIMEOUT_MS =
  DEFAULT_DISPATCH_WAIT_WINDOW_MS;
export const RUNTIME_TRANSPORT_WAIT_RESULT_MAX_TIMEOUT_MS =
  MAX_DISPATCH_WAIT_WINDOW_MS;
export const RUNTIME_TRANSPORT_WAIT_RESULT_TIMEOUT_MS =
  DEFAULT_DISPATCH_WAIT_WINDOW_MS;
export const RUNTIME_COORDINATOR_PROGRESS_EVIDENCE_WATCHDOG_INTERVAL_MS = 30_000;
export const PREPARE_SESSION_TTL_MS = 30 * 60 * 1000;
export const PREPARE_TOKEN_TTL_MS = 10 * 60 * 1000;
export const SPACE_OUTBOX_ALARM_REDRIVE_INTERVAL_MS = 15_000;
// Includes connection acquisition (itself capped at 10s). The PostgreSQL owner
// allows 1s for origin cleanup and caps client disposal at 2s, keeping this
// transaction gate below the platform's 30s reset limit.
export const SPACE_POSTGRES_TRANSACTION_TIMEOUT_MS = 15_000;
export const EXECUTION_TARGET_MUTATION_LEASE_MS = 5 * 60_000;
// A Wake blocked by a target edit gets the full lease plus one outbox alarm
// to retry before Core publishes a visible no-execution failure.
export const EXECUTION_TARGET_MUTATION_WAKE_WAIT_MAX_MS =
  EXECUTION_TARGET_MUTATION_LEASE_MS + SPACE_OUTBOX_ALARM_REDRIVE_INTERVAL_MS;
