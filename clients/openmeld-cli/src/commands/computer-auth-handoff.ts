import {
  type ComputerConnectionIntent,
  computerConnectionIntentSchema,
} from "@openmeld/schemas";
import type { PrepareSessionContinuation } from "@openmeld/schemas/types";
import {
  AuthSessionChangedBeforeTransitionError,
  type AuthSessionMetadata,
  AuthSessionRecoveryInProgressError,
  beginAuthSessionTransition,
  buildStoredAuthSessionIdentity,
  getAuthSessionMetadata,
  getAuthSessionState,
} from "../config/auth-session";
import { resolveAuthBaseUrl } from "../config/auth-url";
import { resolveBaseUrl } from "../config/base-url";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import type { Presenter } from "../runtime/presenter/index";
import type { RuntimeContext } from "../runtime/types";
import { runDaemonServiceParticipationGate } from "../system/local-service-participation-gate";
import { promptConfirm } from "../ui/confirm";
import {
  emitUnusedSetupSessionCleanupWarning,
  formatComputerAuthCleanupFailureSuffix,
  recoverInterruptedComputerAuthHandoff,
} from "./computer-auth-handoff-recovery";
import {
  exchangeComputerAuthorizationGrant,
  type PreparedAuthSession,
  revokePreparedAuthSession,
} from "./computer-auth-session";
import { exchangeOneTimeTokenAuthSession } from "./one-time-token-auth-session";
import {
  connectPrepareSessionStream,
  type PrepareSessionExecutorResult,
  type PrepareSessionLocalAgentSelection,
  reportPrepareHandoffStopped,
  resolvePrepareSessionForHandoff,
  runPrepareSessionExecutor,
} from "./prepare-session-executor";
import { bestEffortStopCurrentLaneDaemonService } from "./service";

type ComputerAuthHandoffInput = {
  connectionIntent?: ComputerConnectionIntent;
  interactive: boolean;
  localAgentSelection?: PrepareSessionLocalAgentSelection;
  presenter: Presenter;
  runtime: RuntimeContext;
  startSession: string;
  view?: string;
};

export function runComputerAuthorizationHandoff(
  input: ComputerAuthHandoffInput & { deviceCode: string }
): Promise<PrepareSessionExecutorResult> {
  return runPreparedComputerAuthHandoff({
    ...input,
    exchangeCandidate: async () =>
      await exchangeComputerAuthorizationGrant({
        deviceCode: input.deviceCode,
      }),
  });
}

export function runOneTimeTokenComputerHandoff(
  input: ComputerAuthHandoffInput & { oneTimeToken: string }
): Promise<PrepareSessionExecutorResult> {
  return runPreparedComputerAuthHandoff({
    ...input,
    exchangeCandidate: async () =>
      await exchangeOneTimeTokenAuthSession({
        authBaseUrl: resolveAuthBaseUrl(),
        clientId: "openmeld-cli",
        token: input.oneTimeToken,
      }),
  });
}

async function runPreparedComputerAuthHandoff(
  input: ComputerAuthHandoffInput & {
    exchangeCandidate: () => Promise<PreparedAuthSession>;
  }
): Promise<PrepareSessionExecutorResult> {
  const gatewayUrl = await resolveBaseUrl();
  const initialSnapshot = await resolvePrepareSessionForHandoff({
    gatewayUrl,
    opaqueToken: input.startSession,
  });
  // Connect the existing Setup transport before asking for account consent so
  // Web observes the outcome even when no local account transition starts.
  const stream = await connectPrepareSessionStream({
    gatewayUrl,
    opaqueToken: input.startSession,
    prepareSessionId: initialSnapshot.prepareSessionId,
  });
  let executorStarted = false;
  let failureReported = false;
  try {
    const recoveryOutcome = await recoverInterruptedComputerAuthHandoff({
      onProgress: (progress) => stream.writeConnectionProgress?.(progress),
      presenter: input.presenter,
      runtime: input.runtime,
      view: input.view,
    });
    if (recoveryOutcome === "deferred") {
      throw new AuthSessionRecoveryInProgressError({ recoveryRequired: true });
    }
    const notifyStopped = async (reasonCode: string, message: string) => {
      try {
        await reportPrepareHandoffStopped({ stream, reasonCode, message });
        failureReported = true;
      } catch {
        input.presenter.line({
          code: "setup.handoff.notification_failed",
          text: "OpenMeld Web could not be updated. Return to Web and get a new setup command to try again.",
        });
      }
    };
    let candidate: PreparedAuthSession;
    try {
      candidate = await input.exchangeCandidate();
    } catch (error) {
      await notifyStopped(
        "prepare.authorization_failed",
        "Computer authorization could not finish. Get a new setup command to try again."
      );
      throw error;
    }
    await assertPrepareSessionOwner({
      candidate,
      ownerUserId: initialSnapshot.ownerUserId,
    });
    const currentSession = await resolveCurrentComputerSession(candidate);
    await assertReviewedComputerConnection(
      input.connectionIntent,
      candidate,
      currentSession
    );
    const confirmed = await confirmComputerAccountSwitch({
      reviewedConnection: Boolean(input.connectionIntent),
      candidate,
      currentSession,
      interactive: input.interactive,
      presenter: input.presenter,
      resolvedView: input.runtime.resolvedView,
    });
    if (!confirmed) {
      const revoked = await revokePreparedAuthSession(candidate);
      if (!revoked.ok) {
        emitUnusedSetupSessionCleanupWarning(input.presenter, revoked.error);
      }
      await notifyStopped(
        "prepare.account_switch_cancelled",
        "Account switch canceled. The current computer connection was not changed."
      );
      return {
        reason: "user_cancelled",
        status: "not_completed",
      };
    }

    const transition = await beginComputerSessionTransition({
      candidate,
      expectedPreviousSession: currentSession,
      gatewayUrl,
      prepareContinuation: {
        prepareSessionId: initialSnapshot.prepareSessionId,
        ...(input.localAgentSelection
          ? { localAgentSelection: input.localAgentSelection }
          : {}),
      },
    });

    try {
      executorStarted = true;
      const sessionResult = await runPrepareSessionExecutor({
        gatewayUrl,
        connectedStream: stream,
        initialSnapshot,
        startSession: input.startSession,
        runtime: input.runtime,
        presenter: input.presenter,
        interactive: input.interactive,
        localAgentSelection: input.localAgentSelection,
        view: input.view,
      });
      if (sessionResult.status !== "completed") {
        await restorePreviousComputerAfterFailedHandoff({
          candidate,
          gatewayUrl,
          presenter: input.presenter,
          runtime: input.runtime,
          transition,
          stream,
          view: input.view,
        });
        return sessionResult;
      }
      await transition.commit();
      return sessionResult;
    } catch (error) {
      try {
        await restorePreviousComputerAfterFailedHandoff({
          candidate,
          gatewayUrl,
          presenter: input.presenter,
          runtime: input.runtime,
          transition,
          stream,
          view: input.view,
        });
      } catch (recoveryError) {
        throw new Error(
          `Computer setup failed, and OpenMeld could not restore the previous local account: ${toErrorMessage(
            recoveryError
          )}`,
          { cause: error }
        );
      }
      throw error;
    }
  } catch (error) {
    if (!(executorStarted || failureReported)) {
      try {
        await reportPrepareHandoffStopped({
          stream,
          reasonCode: "prepare.handoff_failed",
          error,
          message:
            "OpenMeld couldn't finish connecting this computer. Check Terminal for the next step.",
        });
      } catch {
        // Reporting must not replace the actionable original failure.
      }
    }
    throw error;
  } finally {
    stream.close();
  }
}

async function assertReviewedComputerConnection(
  review: ComputerConnectionIntent | undefined,
  candidate: PreparedAuthSession,
  currentSession: AuthSessionMetadata | null
) {
  if (!review) {
    return;
  }
  const intent = computerConnectionIntentSchema.safeParse(review);
  if (
    intent.success &&
    intent.data.expectedAccount === candidate.user.id &&
    intent.data.previousSessionIdentity ===
      buildStoredAuthSessionIdentity(currentSession)
  ) {
    return;
  }
  const revoked = await revokePreparedAuthSession(candidate);
  throw new Error(
    `The computer sign-in changed. Review the connection again before continuing.${formatComputerAuthCleanupFailureSuffix(revoked)}`
  );
}

async function assertPrepareSessionOwner(input: {
  candidate: PreparedAuthSession;
  ownerUserId: string;
}): Promise<void> {
  if (input.candidate.user.id === input.ownerUserId) {
    return;
  }
  const revoked = await revokePreparedAuthSession(input.candidate);
  throw new Error(
    `This setup command and its computer authorization belong to different OpenMeld accounts. Copy a fresh setup command from OpenMeld Web and try again.${formatComputerAuthCleanupFailureSuffix(
      revoked
    )}`
  );
}

async function resolveCurrentComputerSession(
  candidate: PreparedAuthSession
): Promise<AuthSessionMetadata | null> {
  let currentState: Awaited<ReturnType<typeof getAuthSessionState>>;
  try {
    currentState = await getAuthSessionState({
      validateRemote: false,
    });
  } catch (error) {
    const revoked = await revokePreparedAuthSession(candidate);
    throw new Error(
      `OpenMeld could not inspect the current Computer sign-in. The current Computer connection was not changed. ${toErrorMessage(error)}${formatComputerAuthCleanupFailureSuffix(
        revoked
      )}`,
      { cause: error }
    );
  }
  if (currentState.state === "missing" || currentState.session) {
    return currentState.session;
  }
  if (
    currentState.reasonCode === "session_token_unavailable" ||
    currentState.reasonCode === "session_token_missing"
  ) {
    const metadata = await getAuthSessionMetadata();
    if (metadata?.user?.id?.trim()) {
      // Metadata identifies the account the user is replacing; it never
      // authorizes execution. The fresh grant was verified above.
      return metadata;
    }
  }

  const revoked = await revokePreparedAuthSession(candidate);
  const detail =
    normalizeOptionalString(currentState.errorMessage) ??
    normalizeOptionalString(currentState.reasonCode);
  throw new Error(
    `OpenMeld could not inspect the current Computer sign-in. The current Computer connection was not changed. Run \`${formatOpenMeldCliCommand("openmeld auth logout")}\` to sign out on this computer, then get a new setup command from OpenMeld Web.${
      detail ? ` ${detail}` : ""
    }${formatComputerAuthCleanupFailureSuffix(revoked)}`
  );
}

async function beginComputerSessionTransition(input: {
  candidate: PreparedAuthSession;
  expectedPreviousSession: AuthSessionMetadata | null;
  gatewayUrl: string;
  prepareContinuation: PrepareSessionContinuation;
}): Promise<Awaited<ReturnType<typeof beginAuthSessionTransition>>> {
  try {
    return await beginAuthSessionTransition(input.candidate, {
      computerHandoff: {
        gatewayUrl: input.gatewayUrl,
        prepareContinuation: input.prepareContinuation,
      },
      expectedPreviousSession: input.expectedPreviousSession,
    });
  } catch (error) {
    const revoked = await revokePreparedAuthSession(input.candidate);
    if (!revoked.ok) {
      if (error instanceof AuthSessionChangedBeforeTransitionError) {
        throw attachComputerAuthCleanupFailure({
          accessToken: input.candidate.accessToken,
          cleanupError: revoked.error,
          error,
        });
      }
      throw new Error(
        `OpenMeld could not save the new Computer sign-in.${formatComputerAuthCleanupFailureSuffix(revoked)} ${toErrorMessage(
          error
        )}`,
        { cause: error }
      );
    }
    throw error;
  }
}

function attachComputerAuthCleanupFailure(input: {
  accessToken: string;
  cleanupError: {
    endpoint: string;
    message: string;
    operation: string;
    status: number | null;
  };
  error: AuthSessionChangedBeforeTransitionError;
}): AuthSessionChangedBeforeTransitionError & {
  cleanup: {
    endpoint: string;
    message: string;
    operation: string;
    status: number | null;
  };
} {
  const redact = (value: string): string =>
    input.accessToken
      ? value.split(input.accessToken).join("<REDACTED>")
      : value;
  return Object.assign(input.error, {
    cleanup: {
      endpoint: redact(input.cleanupError.endpoint),
      message: redact(input.cleanupError.message),
      operation: redact(input.cleanupError.operation),
      status: input.cleanupError.status,
    },
  });
}

async function confirmComputerAccountSwitch(input: {
  reviewedConnection: boolean;
  candidate: PreparedAuthSession;
  currentSession: AuthSessionMetadata | null;
  interactive: boolean;
  presenter: Presenter;
  resolvedView: RuntimeContext["resolvedView"];
}): Promise<boolean> {
  const currentUserId = normalizeOptionalString(input.currentSession?.user?.id);
  if (!input.currentSession) {
    return true;
  }
  if (!currentUserId) {
    const revoked = await revokePreparedAuthSession(input.candidate);
    throw new Error(
      `OpenMeld could not verify the account currently connected to this Computer. The current Computer connection was not changed.${formatComputerAuthCleanupFailureSuffix(
        revoked
      )}`
    );
  }
  if (currentUserId === input.candidate.user.id) {
    return true;
  }
  if (input.reviewedConnection) {
    return true;
  }

  const currentAccount =
    normalizeOptionalString(input.currentSession?.user?.email) ??
    "the current account";
  const nextAccount =
    normalizeOptionalString(input.candidate.user.email) ?? "another account";
  if (!input.interactive || input.resolvedView !== "human") {
    const revoked = await revokePreparedAuthSession(input.candidate);
    throw new Error(
      `This computer is signed in as ${currentAccount}, but the setup command uses ${nextAccount}. Run the setup command in an interactive Terminal to review and confirm the account switch. The current Computer connection was not changed.${formatComputerAuthCleanupFailureSuffix(
        revoked
      )}`
    );
  }

  const decision = await promptConfirm({
    activeLabel: "Switch account",
    inactiveLabel: "Keep current account",
    initialValue: false,
    message: `Switch this computer from ${currentAccount} to ${nextAccount}?`,
  });
  if (decision !== "confirmed") {
    input.presenter.line({
      code: "setup.account_switch.cancelled",
      text: "Account switch canceled. The current Computer connection was not changed. To try again, return to OpenMeld Web and get a new setup command.",
    });
    return false;
  }
  return true;
}

async function restorePreviousComputerAfterFailedHandoff(input: {
  candidate: PreparedAuthSession;
  gatewayUrl: string;
  presenter: Presenter;
  runtime: RuntimeContext;
  transition: Awaited<ReturnType<typeof beginAuthSessionTransition>>;
  stream: Awaited<ReturnType<typeof connectPrepareSessionStream>>;
  view?: string;
}): Promise<void> {
  await input.transition.rollback();
  const recovered = await recoverInterruptedComputerAuthHandoff({
    onProgress: (progress) => input.stream.writeConnectionProgress?.(progress),
    presenter: input.presenter,
    runtime: input.runtime,
    view: input.view,
  });
  if (recovered === "none") {
    await restoreLegacyComputerAuthTransition(input);
  }
}

async function restoreLegacyComputerAuthTransition(input: {
  candidate: PreparedAuthSession;
  gatewayUrl: string;
  presenter: Presenter;
  runtime: RuntimeContext;
  transition: Awaited<ReturnType<typeof beginAuthSessionTransition>>;
  view?: string;
}): Promise<void> {
  const revoked = await revokePreparedAuthSession(input.candidate);
  if (!revoked.ok) {
    emitUnusedSetupSessionCleanupWarning(input.presenter, revoked.error);
  }

  const previousOwnerUserId = normalizeOptionalString(
    input.transition.previousSession?.user?.id
  );
  if (!previousOwnerUserId) {
    const stopped = await bestEffortStopCurrentLaneDaemonService({
      runtime: input.runtime,
    });
    if (stopped.status === "warning") {
      throw new Error(
        stopped.errorMessage ??
          "OpenMeld could not stop the incomplete Computer connection."
      );
    }
    return;
  }

  const restored = await runDaemonServiceParticipationGate({
    intent: "start",
    presenter: input.presenter,
    resolvedView: input.runtime.resolvedView,
    allowPrompt: false,
    autoRepair: true,
    expectedOwnerUserId: previousOwnerUserId,
    forcePrompt: true,
    forceRefresh: true,
    gatewayUrl: input.gatewayUrl,
    suppressRefreshHumanResultCard: true,
    suppressStartSpinner: true,
    view: input.view,
  });
  if (restored.status !== "aligned") {
    throw new Error(
      restored.errorMessage ??
        "OpenMeld could not reconnect the previous Computer account."
    );
  }
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : String(error ?? "unknown error");
}
