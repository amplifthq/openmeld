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
export const RUNTIME_TRANSPORT_DELIVER_TIMEOUT_MS = 10_000;
export const RUNTIME_TRANSPORT_WAIT_TIMEOUT_FALLBACK_MS =
  DEFAULT_DISPATCH_WAIT_WINDOW_MS;
export const RUNTIME_TRANSPORT_WAIT_TIMEOUT_GRACE_MS = 8000;
export const RUNTIME_TRANSPORT_WAIT_TIMEOUT_MAX_MS =
  MAX_DISPATCH_WAIT_WINDOW_MS + 8000;
export const RUNTIME_TRANSPORT_LEASE_TTL_MS = 200_000;
// Bounded window Runtime Transport may hold an accepted delivery while an
// advertised `profileConfigurationRevision` Service converges upward onto the
// frozen dispatch revision after an acknowledged settings write. Ordinary
// propagation finishes in one heartbeat plus one expected-routes v3 exchange,
// so this window covers it in place; anything slower fails closed with
// daemon.profile.configuration_not_synced. Must stay comfortably below
// RUNTIME_TRANSPORT_DELIVER_TIMEOUT_MS so a timed-out wait can never surface
// as the unrelated daemon.delivery.timeout reason.
export const RUNTIME_TRANSPORT_PROFILE_CONFIGURATION_CONVERGENCE_TIMEOUT_MS = 6000;
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
