export const DAEMON_RECONCILE_IN_PROGRESS_CODE =
  "openmeld.daemon.reconcile_in_progress";

const DAEMON_RECONCILE_IN_PROGRESS_MESSAGE =
  "OpenMeld background service update is already running in another OpenMeld process. Wait a moment, then retry if needed.";

export class DaemonReconcileInProgressError extends Error {
  readonly code = DAEMON_RECONCILE_IN_PROGRESS_CODE;

  constructor() {
    super(DAEMON_RECONCILE_IN_PROGRESS_MESSAGE);
    this.name = "DaemonReconcileInProgressError";
  }
}

export function createDaemonReconcileInProgressError(): DaemonReconcileInProgressError {
  return new DaemonReconcileInProgressError();
}

export function isDaemonReconcileInProgressError(
  error: unknown
): error is DaemonReconcileInProgressError {
  if (error instanceof DaemonReconcileInProgressError) {
    return true;
  }
  if (!error || typeof error !== "object") {
    return false;
  }
  return (
    (error as { code?: unknown }).code === DAEMON_RECONCILE_IN_PROGRESS_CODE
  );
}
