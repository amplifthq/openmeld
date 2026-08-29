import { confirm, isCancel } from "@clack/prompts";
import {
  AuthSessionRecoveryInProgressError,
  beginAuthSessionTransition,
  getAuthSessionState,
  type StoredAuthSession,
} from "../config/auth-session";
import { resolveAuthBaseUrl } from "../config/auth-url";
import { resolveBaseUrl } from "../config/base-url";
import type { Presenter } from "../runtime/presenter/index";
import type { RuntimeContext } from "../runtime/types";
import { runDaemonServiceParticipationGate } from "../system/local-service-participation-gate";
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
  type PrepareSessionExecutorResult,
  type PrepareSessionLocalAgentSelection,
  resolvePrepareSessionForHandoff,
  runPrepareSessionExecutor,
} from "./prepare-session-executor";
import { bestEffortStopCurrentLaneDaemonService } from "./service";

type ComputerAuthHandoffInput = {
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
  const recoveryOutcome = await recoverInterruptedComputerAuthHandoff({
    presenter: input.presenter,
    runtime: input.runtime,
    view: input.view,
  });
  if (recoveryOutcome === "deferred") {
    throw new AuthSessionRecoveryInProgressError();
  }
  const gatewayUrl = await resolveBaseUrl();
  const initialSnapshot = await resolvePrepareSessionForHandoff({
    gatewayUrl,
    opaqueToken: input.startSession,
  });
  const candidate = await input.exchangeCandidate();
  await assertPrepareSessionOwner({
    candidate,
    ownerUserId: initialSnapshot.ownerUserId,
  });
  const currentSession = await resolveCurrentComputerSession(candidate);
  const confirmed = await confirmComputerAccountSwitch({
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
    return {
      reason: "user_cancelled",
      status: "not_completed",
    };
  }

  const transition = await beginComputerSessionTransition({
    candidate,
    expectedPreviousSession: currentSession,
    gatewayUrl,
  });

  try {
    const sessionResult = await runPrepareSessionExecutor({
      gatewayUrl,
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
): Promise<StoredAuthSession | null> {
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

  const revoked = await revokePreparedAuthSession(candidate);
  const detail =
    normalizeOptionalString(currentState.errorMessage) ??
    normalizeOptionalString(currentState.reasonCode);
  throw new Error(
    `OpenMeld could not inspect the current Computer sign-in. The current Computer connection was not changed.${
      detail ? ` ${detail}` : ""
    }${formatComputerAuthCleanupFailureSuffix(revoked)}`
  );
}

async function beginComputerSessionTransition(input: {
  candidate: PreparedAuthSession;
  expectedPreviousSession: StoredAuthSession | null;
  gatewayUrl: string;
}): Promise<Awaited<ReturnType<typeof beginAuthSessionTransition>>> {
  try {
    return await beginAuthSessionTransition(input.candidate, {
      computerHandoff: { gatewayUrl: input.gatewayUrl },
      expectedPreviousSession: input.expectedPreviousSession,
    });
  } catch (error) {
    const revoked = await revokePreparedAuthSession(input.candidate);
    if (!revoked.ok) {
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

async function confirmComputerAccountSwitch(input: {
  candidate: PreparedAuthSession;
  currentSession: StoredAuthSession | null;
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

  const confirmed = await confirm({
    initialValue: false,
    message: `Switch this computer from ${currentAccount} to ${nextAccount}?`,
  });
  if (isCancel(confirmed) || !confirmed) {
    input.presenter.line({
      code: "setup.account_switch.cancelled",
      text: "Account switch canceled. The current Computer connection was not changed.",
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
  view?: string;
}): Promise<void> {
  await input.transition.rollback();
  const recovered = await recoverInterruptedComputerAuthHandoff({
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
