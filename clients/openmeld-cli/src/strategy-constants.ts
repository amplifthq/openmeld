import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";

// CLI and local daemon timing policy values. Keep this deployment-local; Core
// and Web have their own constants files even when values intentionally match.
export const DEFAULT_GATEWAY_CHAIN_TIMEOUT_MS = 30_000;
export const DEFAULT_REMOTE_SESSION_TIMEOUT_MS = 8000;
export const LOOPBACK_REMOTE_SESSION_TIMEOUT_MS = 1500;
export const DEFAULT_WEB_AGENT_SELECTION_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_WEB_AGENT_SELECTION_POLL_INTERVAL_MS = 2000;
export const DEFAULT_SPACE_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_SPACE_CONVERSATION_VALIDATE_TIMEOUT_MS = 60_000;
export const MIN_SPACE_REQUEST_TIMEOUT_MS = 1000;
export const MAX_SPACE_REQUEST_TIMEOUT_MS = 120_000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000;
export const MIN_HEARTBEAT_INTERVAL_MS = 5000;
export const MAX_HEARTBEAT_INTERVAL_MS = 60_000;
// Daemon stream keepalive PING cadence. Sub-idle (below the gateway/Cloudflare
// idle-eviction window) and independent of the heartbeat, so a quiet daemon
// socket stays warm even when no heartbeat is due. Carries no lease/readiness.
export const DAEMON_STREAM_KEEPALIVE_INTERVAL_MS = 20_000;
// Each keepalive PING must see the hub's auto-answered PONG within this
// window, or the socket is treated as half-open and terminated so the normal
// reconnect path (which also redelivers in-flight dispatch pushes) can run.
// Without this deadline a half-open socket is only detected by the heartbeat
// failure path, which can take ~40s+ at the idle-grown heartbeat interval.
export const DAEMON_STREAM_KEEPALIVE_PONG_TIMEOUT_MS = 10_000;
export const CATALOG_SYNC_INTERVAL_MULTIPLIER = 3;
export const MIN_CATALOG_SYNC_INTERVAL_MS = 15_000;
export const MAX_CATALOG_SYNC_INTERVAL_MS = 45_000;
export const CATALOG_SYNC_RETRY_INTERVAL_MS = 5000;
export const CATALOG_SYNC_SIGNAL_POLL_INTERVAL_MS = 1000;
export const ROUTE_CATALOG_LOAD_TIMEOUT_MS = 15_000;
export const RUNTIME_AGENT_CONTROLLER_REPORT_SYNC_INTERVAL_MS = 5 * 60_000;
export const RUNTIME_AGENT_CONTROLLER_REPORT_SYNC_RETRY_INTERVAL_MS = 60_000;
export const PROVIDER_CONVERSATION_PROOF_SYNC_INTERVAL_MS = 5 * 60_000;
export const PROVIDER_CONVERSATION_PROOF_SYNC_RETRY_INTERVAL_MS = 60_000;
export const RUNTIME_STATE_PERSIST_MIN_INTERVAL_MS = 60_000;
export const DAEMON_STREAM_CONNECT_TIMEOUT_MS = 15_000;
export const REGISTER_RESPONSE_TIMEOUT_MS = 10_000;
export const HEARTBEAT_RESPONSE_TIMEOUT_MS = 15_000;
export const DAEMON_RUNTIME_CONTRACT_EPOCH =
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH;
export const OPENCLAW_CLI_TIMEOUT_MS = 30_000;
