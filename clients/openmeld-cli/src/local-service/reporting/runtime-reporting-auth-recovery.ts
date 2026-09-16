export type RuntimeReportingAuthenticationFailure = {
  credentialFingerprint?: string;
  message: string;
  reasonCode: string;
};

export type RuntimeReportingAuthenticationRecoveryResult =
  | { status: "requested" }
  | { status: "debounced"; retryAfterMs: number };

const AUTHENTICATION_RECOVERY_COOLDOWN_MS = 5 * 60_000;

export function createRuntimeReportingAuthenticationRecovery(input: {
  now?: () => number;
  requestCarrierHandshake: (
    failure: RuntimeReportingAuthenticationFailure
  ) => Promise<void> | void;
}): (
  failure: RuntimeReportingAuthenticationFailure
) => Promise<RuntimeReportingAuthenticationRecoveryResult> {
  let lastRecoveryAttemptAtMs: number | null = null;
  const now = input.now ?? Date.now;

  return async (failure) => {
    const nowMs = now();
    if (lastRecoveryAttemptAtMs !== null) {
      const retryAfterMs = Math.max(
        0,
        AUTHENTICATION_RECOVERY_COOLDOWN_MS - (nowMs - lastRecoveryAttemptAtMs)
      );
      if (retryAfterMs > 0) {
        return { retryAfterMs, status: "debounced" };
      }
    }

    lastRecoveryAttemptAtMs = nowMs;
    await input.requestCarrierHandshake(failure);
    return { status: "requested" };
  };
}
