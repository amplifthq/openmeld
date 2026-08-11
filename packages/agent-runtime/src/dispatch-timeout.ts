// Agent work can legitimately run for minutes or hours. Do not use a fixed
// wall-clock timeout as the normal execution policy; only explicit caller
// supplied watchdogs may fail a local process by elapsed time.
export const DEFAULT_AGENT_EXECUTION_TIMEOUT_MS = null as number | null;

// Backward-compatible export for older call sites. New code should use
// DEFAULT_AGENT_EXECUTION_TIMEOUT_MS so the no-fixed-timeout contract is obvious.
export const DEFAULT_LOCAL_ADAPTER_PROCESS_TIMEOUT_MS =
  DEFAULT_AGENT_EXECUTION_TIMEOUT_MS;
export const DEFAULT_DISPATCH_START_TIMEOUT_MS = 30_000 as const;
export const DEFAULT_DISPATCH_WAIT_WINDOW_MS = 30_000 as const;
export const MAX_DISPATCH_WAIT_WINDOW_MS = 120_000 as const;
export const DEFAULT_TASK_LIFECYCLE_HEARTBEAT_INTERVAL_MS = 15_000 as const;
export const DEFAULT_TASK_PROGRESS_EVIDENCE_STALE_AFTER_MS = 90_000 as const;
export const DEFAULT_DISPATCH_FINALIZATION_TIMEOUT_MS = 30_000 as const;
