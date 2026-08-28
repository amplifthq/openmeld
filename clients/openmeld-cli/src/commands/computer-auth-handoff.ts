import { confirm, isCancel } from "@clack/prompts";
import {
  beginAuthSessionTransition,
  getAuthSessionState,
  type StoredAuthSession,
} from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import type { Presenter } from "../runtime/presenter/index";
import type { RuntimeContext } from "../runtime/types";
import { runDaemonServiceParticipationGate } from "../system/local-service-participation-gate";
import {
  exchangeComputerAuthorizationGrant,
  type PreparedAuthSession,
  revokePreparedAuthSession,
} from "./computer-auth-session";
import {
  type PrepareSessionExecutorResult,
  type PrepareSessionLocalAgentSelection,
  resolvePrepareSessionForHandoff,
  runPrepareSessionExecutor,
} from "./prepare-session-executor";
import { bestEffortStopCurrentLaneDaemonService } from "./service";

const UNUSED_SETUP_SESSION_CLEANUP_SUFFIX =
  " OpenMeld also could not revoke the unused setup session.";

export async function runComputerAuthorizationHandoff(input: {
  deviceCode: string;
  interactive: boolean;
  localAgentSelection?: PrepareSessionLocalAgentSelection;
  presenter: Presenter;
  runtime: RuntimeContext;
  startSession: string;
  view?: string;
}): Promise<PrepareSessionExecutorResult> {
  const gatewayUrl = await resolveBaseUrl();
  const initialSnapshot = await resolvePrepareSessionForHandoff({
    gatewayUrl,
    opaqueToken: input.startSession,
  });
  const candidate = await exchangeComputerAuthorizationGrant({
    deviceCode: input.deviceCode,
  });
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
    if (!revoked) {
      emitUnusedSetupSessionCleanupWarning(input.presenter);
    }
    return {
      reason: "user_cancelled",
      status: "not_completed",
    };
  }

  const transition = await beginComputerSessionTransition(candidate);

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
    `This setup command and its computer authorization belong to different OpenMeld accounts. Copy a fresh setup command from OpenMeld Web and try again.${
      revoked ? "" : UNUSED_SETUP_SESSION_CLEANUP_SUFFIX
    }`
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
      `OpenMeld could not inspect the current Computer sign-in. The current Computer connection was not changed. ${toErrorMessage(error)}${
        revoked ? "" : UNUSED_SETUP_SESSION_CLEANUP_SUFFIX
      }`,
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
    }${revoked ? "" : UNUSED_SETUP_SESSION_CLEANUP_SUFFIX}`
  );
}

async function beginComputerSessionTransition(
  candidate: PreparedAuthSession
): Promise<Awaited<ReturnType<typeof beginAuthSessionTransition>>> {
  try {
    return await beginAuthSessionTransition(candidate);
  } catch (error) {
    const revoked = await revokePreparedAuthSession(candidate);
    if (!revoked) {
      throw new Error(
        `OpenMeld could not save the new Computer sign-in.${UNUSED_SETUP_SESSION_CLEANUP_SUFFIX} ${toErrorMessage(
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
      `OpenMeld could not verify the account currently connected to this Computer. The current Computer connection was not changed.${
        revoked ? "" : UNUSED_SETUP_SESSION_CLEANUP_SUFFIX
      }`
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
      `This computer is signed in as ${currentAccount}, but the setup command uses ${nextAccount}. Run the setup command in an interactive Terminal to review and confirm the account switch. The current Computer connection was not changed.${
        revoked ? "" : UNUSED_SETUP_SESSION_CLEANUP_SUFFIX
      }`
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

function emitUnusedSetupSessionCleanupWarning(presenter: Presenter): void {
  presenter.line({
    code: "setup.computer_authorization.cleanup_warning",
    text: "OpenMeld kept the current Computer sign-in, but could not revoke the unused setup session. You can remove it later from Account sessions.",
  });
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
  const revoked = await revokePreparedAuthSession(input.candidate);
  if (!revoked) {
    input.presenter.line({
      code: "setup.computer_authorization.cleanup_warning",
      text: "OpenMeld restored the previous Computer sign-in, but could not revoke the unused setup session. You can remove it later from Account sessions.",
    });
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
