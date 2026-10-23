import { setTimeout as sleep } from "node:timers/promises";
import { cancel, isCancel, select } from "@clack/prompts";
import {
  type BetterAuthDeviceAuthorizationCodeResponse,
  betterAuthDeviceAuthorizationCodeRequestSchema,
  betterAuthDeviceAuthorizationCodeResponseSchema,
} from "@openmeld/schemas";
import pc from "picocolors";
import {
  type AuthAgentOverviewCommand,
  emitAuthAgentOverview,
} from "../auth/agent-overview";
import {
  type AuthenticationGuidance,
  resolveAuthenticationGuidance,
} from "../auth/auth-guidance";
import {
  type AuthSessionState,
  type AuthSessionTransition,
  assertAuthSessionMutationAvailable,
  beginAuthSessionTransition,
  clearAuthSession,
  getAuthSessionState,
  setAuthSession,
} from "../config/auth-session";
import { resolveAuthBaseUrl } from "../config/auth-url";
import { resolveBaseUrlOrNull } from "../config/base-url";
import {
  type ClearAllSelectedOpenMeldProfileIdsResult,
  clearAllSelectedOpenMeldProfileIds,
} from "../config/openmeld-profile-selection";
import { canAttachAuthTokenToRequest } from "../config/request-headers";
import { tryOpenUrl } from "../lib/open-url";
import { formatInlineOpenMeldCliCommands } from "../runtime/cli-entry-command";
import { resolveRuntimeContext } from "../runtime/context";
import { createAuthLoginGuideError } from "../runtime/dual-view-guide-catalog";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { createPresenter } from "../runtime/presenter";
import { promptTextEntry } from "../ui/text-entry";
import {
  type AuthUserSnapshot,
  type DeviceTokenSuccessResponse,
  extractAuthApiErrorMessage,
  fetchAuthUserSnapshot,
  requestDeviceToken,
  resolveDeviceAuthClientId,
  resolveDeviceTokenExpiresAt,
} from "./auth-device-session-client";
import {
  type AuthStatusSnapshot,
  buildAuthStatusSnapshot,
  renderAuthStatusCard,
  renderAuthStatusGuidanceCard,
} from "./auth-status-shared";
import { finishInterruptedComputerAuthHandoffBeforeAccountChange } from "./computer-auth-handoff-recovery";
import {
  exchangeOneTimeTokenAuthSession,
  OneTimeTokenAuthError,
  type OneTimeTokenAuthFailureCode,
  OneTimeTokenLocalSessionRecoveryError,
  rejectOneTimeTokenCandidateSession,
} from "./one-time-token-auth-session";
import { bestEffortStopCurrentLaneDaemonService } from "./service";

const LOGIN_METHOD_DEVICE = "device";
const LOGIN_METHOD_OTT = "ott";
const LOGIN_METHOD_CANCEL = "__auth_login_method_cancel__";
const AUTH_MENU_ACTION_STATUS = "status";
const AUTH_MENU_ACTION_LOGIN = "login";
const AUTH_MENU_ACTION_LOGOUT = "logout";
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const MAX_POLL_INTERVAL_SECONDS = 60;
const MIN_POLL_INTERVAL_SECONDS = 1;
const POLL_PROGRESS_EMIT_INTERVAL_MS = 15_000;
const TRAILING_SLASH_PATTERN = /\/+$/;

type AuthLoginMethod = typeof LOGIN_METHOD_DEVICE | typeof LOGIN_METHOD_OTT;
type DeviceCodeResponse = BetterAuthDeviceAuthorizationCodeResponse;

type DevicePollProgressEvent = "authorization_pending" | "slow_down";

type DevicePollProgress = {
  event: DevicePollProgressEvent;
  attempt: number;
  intervalSeconds: number;
  remainingSeconds: number;
};

type DeviceAuthFailureCode =
  | "access_denied"
  | "expired_token"
  | "invalid_grant"
  | "unknown";

type ResolvedAuthLoginRequest =
  | {
      method: typeof LOGIN_METHOD_DEVICE;
    }
  | {
      method: typeof LOGIN_METHOD_OTT;
      token: string;
    };

type ResolvedAuthLoginRequestResult =
  | {
      status: "submitted";
      value: ResolvedAuthLoginRequest;
    }
  | {
      status: "back" | "cancelled";
    };

type AuthLoginNavigationResult = "completed" | "back" | "cancelled";

type OneTimeTokenPromptResult =
  | {
      status: "submitted";
      value: string;
    }
  | {
      status: "back" | "cancelled";
    };

class DeviceAuthError extends Error {
  readonly code: DeviceAuthFailureCode;

  constructor(code: DeviceAuthFailureCode, message: string) {
    super(message);
    this.code = code;
  }
}

class AuthHttpError extends Error {
  readonly status: number;
  readonly endpoint: string;

  constructor(input: { message: string; status: number; endpoint: string }) {
    super(input.message);
    this.status = input.status;
    this.endpoint = input.endpoint;
  }
}

export async function runAuthLogin(input: {
  authUrl?: string;
  clientId?: string;
  open?: boolean;
  method?: string;
  ott?: string;
  view?: string;
  agentOverviewHandled?: boolean;
  allowBackToCaller?: boolean;
}): Promise<AuthLoginNavigationResult> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  await finishInterruptedComputerAuthHandoffBeforeAccountChange({
    presenter,
    runtime,
    view: input.view,
  });
  await assertAuthSessionMutationAvailable();
  emitAuthOverviewIfNeeded({
    presenter,
    resolvedView: runtime.resolvedView,
    handled: input.agentOverviewHandled,
    command: "login",
  });
  const authBaseUrl = resolveAuthBaseUrl(input.authUrl);
  const clientId = resolveClientIdForLogin(
    input.clientId,
    runtime.resolvedView
  );
  const requestedBrowserOpen = input.open ?? true;
  const isHumanView = runtime.resolvedView === "human";
  const resolved = await resolveAuthLoginRequest({
    authBaseUrl,
    presenter,
    runtime,
    method: input.method,
    ott: input.ott,
    allowBackToCaller: input.allowBackToCaller === true,
  }).catch((error) => {
    if (runtime.resolvedView === "agent") {
      throw createAuthLoginGuideError(toErrorMessage(error));
    }
    throw error;
  });
  if (resolved.status !== "submitted") {
    return handleAuthLoginExit({
      status: resolved.status,
      allowBackToCaller: input.allowBackToCaller === true,
    });
  }
  const request = resolved.value;

  try {
    if (request.method === LOGIN_METHOD_DEVICE) {
      await runDeviceLoginFlow({
        authBaseUrl,
        clientId,
        isHumanView,
        interactive: runtime.interactive,
        presenter,
        requestedBrowserOpen,
        runtimeResolvedView: runtime.resolvedView,
      });
      return "completed";
    }

    await runOneTimeTokenLoginFlow({
      authBaseUrl,
      clientId,
      isHumanView,
      presenter,
      token: request.token,
    });
    return "completed";
  } catch (error) {
    if (request.method === LOGIN_METHOD_DEVICE) {
      const localHint = resolveLocalAuthAdaptationHint(error, {
        authBaseUrl,
        clientId,
      });
      if (localHint) {
        emitLineWithHumanSpacer({
          presenter,
          isHumanView,
          code: "auth.login.local_adaptation_hint",
          text: isHumanView
            ? `${pc.yellow("⚠️ Local Dev Tip")} ${localHint}`
            : localHint,
        });
      }
    }

    if (runtime.resolvedView === "agent") {
      if (request.method === LOGIN_METHOD_DEVICE) {
        const failure = toDeviceAuthError(error);
        presenter.data({
          code: "auth.login.failure.hints",
          payload: {
            method: LOGIN_METHOD_DEVICE,
            reason: failure.code,
            message: failure.message,
            nextSteps: buildAgentFailureNextSteps(failure.code),
          },
        });
      } else {
        const failure = toOneTimeTokenAuthError(error);
        presenter.data({
          code: "auth.login.failure.hints",
          payload: {
            method: LOGIN_METHOD_OTT,
            reason: failure.code,
            message: failure.message,
            nextSteps: buildAgentOttFailureNextSteps({
              authBaseUrl,
              code: failure.code,
            }),
          },
        });
      }
      throw createAuthLoginGuideError(toErrorMessage(error));
    }
    throw error;
  }
}

export async function runAuthMenu(input?: { view?: string }): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input?.view });
  const presenter = createPresenter(runtime);
  emitAuthOverviewIfNeeded({
    presenter,
    resolvedView: runtime.resolvedView,
    command: "menu",
  });
  if (!canUseInteractivePrompts(runtime)) {
    await runAuthStatus({
      view: input?.view,
      agentOverviewHandled: true,
    });
    return;
  }

  while (true) {
    const action = await select({
      message: "Sign-in action",
      initialValue: AUTH_MENU_ACTION_STATUS,
      options: [
        {
          value: AUTH_MENU_ACTION_STATUS,
          label: "Status",
          hint: "Show your current sign-in status",
        },
        {
          value: AUTH_MENU_ACTION_LOGIN,
          label: "Sign in",
          hint: "Sign in through your browser or with a one-time token",
        },
        {
          value: AUTH_MENU_ACTION_LOGOUT,
          label: "Sign out",
          hint: "Sign out on this device",
        },
      ],
    });

    if (isCancel(action)) {
      cancel("Cancelled.");
      return;
    }

    if (action === AUTH_MENU_ACTION_LOGIN) {
      const result = await runAuthLogin({
        view: input?.view,
        allowBackToCaller: true,
      });
      if (result === "back" || result === "cancelled") {
        continue;
      }
      return;
    }

    if (action === AUTH_MENU_ACTION_LOGOUT) {
      await runAuthLogout({ view: input?.view });
      return;
    }

    await runAuthStatus({ view: input?.view });
    return;
  }
}

async function resolveAuthLoginRequest(input: {
  authBaseUrl: string;
  presenter: ReturnType<typeof createPresenter>;
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  method?: string;
  ott?: string;
  allowBackToCaller: boolean;
}): Promise<ResolvedAuthLoginRequestResult> {
  const explicitMethod = parseAuthLoginMethod(input.method);
  const providedToken = normalizeOptionalString(input.ott);
  const isInteractiveHuman =
    input.runtime.resolvedView === "human" &&
    canUseInteractivePrompts(input.runtime);

  if (providedToken && explicitMethod === LOGIN_METHOD_DEVICE) {
    throw new Error("`--ott` cannot be used with `--method device`");
  }

  const explicitRequest = await resolveExplicitAuthLoginRequest({
    authBaseUrl: input.authBaseUrl,
    presenter: input.presenter,
    runtimeResolvedView: input.runtime.resolvedView,
    explicitMethod,
    providedToken,
    isInteractiveHuman,
    allowBackToCaller: input.allowBackToCaller,
  });
  if (explicitRequest) {
    return explicitRequest;
  }

  return resolveDefaultAuthLoginRequest({
    authBaseUrl: input.authBaseUrl,
    presenter: input.presenter,
    runtimeResolvedView: input.runtime.resolvedView,
    isInteractiveHuman,
    allowBackToCaller: input.allowBackToCaller,
  });
}

async function resolveExplicitAuthLoginRequest(input: {
  authBaseUrl: string;
  presenter: ReturnType<typeof createPresenter>;
  runtimeResolvedView: "human" | "agent";
  explicitMethod: AuthLoginMethod | null;
  providedToken: string | null;
  isInteractiveHuman: boolean;
  allowBackToCaller: boolean;
}): Promise<ResolvedAuthLoginRequestResult | null> {
  if (input.providedToken) {
    return {
      status: "submitted",
      value: {
        method: LOGIN_METHOD_OTT,
        token: input.providedToken,
      },
    };
  }
  if (input.explicitMethod === LOGIN_METHOD_DEVICE) {
    return {
      status: "submitted",
      value: { method: LOGIN_METHOD_DEVICE },
    };
  }
  if (input.explicitMethod !== LOGIN_METHOD_OTT) {
    return null;
  }
  if (input.isInteractiveHuman) {
    return await promptExplicitOttLoginRequest({
      allowBackToCaller: input.allowBackToCaller,
    });
  }
  if (input.runtimeResolvedView === "agent") {
    emitAgentOttRequired({
      authBaseUrl: input.authBaseUrl,
      presenter: input.presenter,
    });
    throw new OneTimeTokenAuthError(
      "missing_access_token",
      "agent sign-in requires `--ott <token>`"
    );
  }
  throw new OneTimeTokenAuthError(
    "missing_access_token",
    "one-time token is required; pass `--ott <token>`"
  );
}

async function promptExplicitOttLoginRequest(input: {
  allowBackToCaller: boolean;
}): Promise<ResolvedAuthLoginRequestResult> {
  const token = await promptOneTimeTokenForHuman({
    allowBack: input.allowBackToCaller,
    backLabel: "Back",
  });
  if (token.status !== "submitted") {
    return {
      status: resolveAuthLoginNestedExitStatus(input.allowBackToCaller),
    };
  }
  return {
    status: "submitted",
    value: {
      method: LOGIN_METHOD_OTT,
      token: token.value,
    },
  };
}

async function resolveDefaultAuthLoginRequest(input: {
  authBaseUrl: string;
  presenter: ReturnType<typeof createPresenter>;
  runtimeResolvedView: "human" | "agent";
  isInteractiveHuman: boolean;
  allowBackToCaller: boolean;
}): Promise<ResolvedAuthLoginRequestResult> {
  if (input.runtimeResolvedView === "agent") {
    emitAgentOttRequired({
      authBaseUrl: input.authBaseUrl,
      presenter: input.presenter,
    });
    throw new Error(
      "agent sign-in requires `--ott <token>`; to force browser sign-in, pass `--method device`"
    );
  }
  if (!input.isInteractiveHuman) {
    return {
      status: "submitted",
      value: { method: LOGIN_METHOD_DEVICE },
    };
  }
  return await promptInteractiveAuthLoginMethod({
    allowBackToCaller: input.allowBackToCaller,
  });
}

async function promptInteractiveAuthLoginMethod(input: {
  allowBackToCaller: boolean;
}): Promise<ResolvedAuthLoginRequestResult> {
  for (;;) {
    const choice = await select({
      message: "Choose a sign-in method",
      initialValue: LOGIN_METHOD_DEVICE,
      options: [
        {
          value: LOGIN_METHOD_DEVICE,
          label: "Browser sign-in",
          hint: "Open the sign-in page in your browser",
        },
        {
          value: LOGIN_METHOD_OTT,
          label: "One-time sign-in token",
          hint: "Paste a token from the sign-in page",
        },
        {
          value: LOGIN_METHOD_CANCEL,
          label: input.allowBackToCaller ? "Back" : "Cancel",
        },
      ],
    });

    if (isCancel(choice) || choice === LOGIN_METHOD_CANCEL) {
      return {
        status: resolveAuthLoginNestedExitStatus(input.allowBackToCaller),
      };
    }
    if (choice === LOGIN_METHOD_DEVICE) {
      return {
        status: "submitted",
        value: { method: LOGIN_METHOD_DEVICE },
      };
    }

    const tokenRequest = await promptNestedOttLoginRequest({
      allowBackToCaller: input.allowBackToCaller,
    });
    if (tokenRequest.status === "back") {
      continue;
    }
    return tokenRequest;
  }
}

async function promptNestedOttLoginRequest(input: {
  allowBackToCaller: boolean;
}): Promise<ResolvedAuthLoginRequestResult> {
  const token = await promptOneTimeTokenForHuman({
    allowBack: true,
    backLabel: "Back",
  });
  if (token.status === "back") {
    return {
      status: "back",
    };
  }
  if (token.status === "cancelled") {
    return {
      status: resolveAuthLoginNestedExitStatus(input.allowBackToCaller),
    };
  }
  if (token.status !== "submitted") {
    return {
      status: "back",
    };
  }
  return {
    status: "submitted",
    value: {
      method: LOGIN_METHOD_OTT,
      token: token.value,
    },
  };
}

async function runDeviceLoginFlow(input: {
  authBaseUrl: string;
  clientId: string;
  isHumanView: boolean;
  interactive: boolean;
  presenter: ReturnType<typeof createPresenter>;
  requestedBrowserOpen: boolean;
  runtimeResolvedView: "human" | "agent";
}): Promise<void> {
  const shouldOpenBrowser =
    input.runtimeResolvedView === "agent" ? false : input.requestedBrowserOpen;
  emitDeviceLoginStartLine({
    presenter: input.presenter,
    isHumanView: input.isHumanView,
    authBaseUrl: input.authBaseUrl,
    clientId: input.clientId,
  });

  if (input.runtimeResolvedView === "agent" && input.requestedBrowserOpen) {
    input.presenter.line({
      code: "auth.login.browser_disabled_for_agent",
      text: "agent view detected; browser auto-open is disabled by default",
    });
  }

  const deviceCodeResponse = await requestDeviceCode({
    authBaseUrl: input.authBaseUrl,
    clientId: input.clientId,
  });

  const verificationUrl = resolveVerificationUrl(
    deviceCodeResponse,
    input.authBaseUrl
  );
  const userCode = normalizeRequiredString(
    deviceCodeResponse.user_code,
    "missing user_code in device code response"
  );

  emitVerificationLines({
    presenter: input.presenter,
    isHumanView: input.isHumanView,
    verificationUrl,
    userCode,
  });

  maybeEmitAgentHumanActionRequired({
    presenter: input.presenter,
    isAgentView: input.runtimeResolvedView === "agent",
    verificationUrl,
    userCode,
  });

  if (shouldOpenBrowser && input.interactive) {
    const opened = await tryOpenUrl(verificationUrl);
    emitBrowserOpenLine({
      presenter: input.presenter,
      isHumanView: input.isHumanView,
      opened,
      verificationUrl,
    });
  }

  const intervalSeconds = resolvePollingIntervalSeconds(
    deviceCodeResponse.interval
  );
  const expiresInSeconds = resolveExpiresInSeconds(
    deviceCodeResponse.expires_in
  );
  const token = await pollForDeviceToken({
    authBaseUrl: input.authBaseUrl,
    clientId: input.clientId,
    deviceCode: deviceCodeResponse.device_code,
    intervalSeconds,
    expiresInSeconds,
    onProgress: createPollingProgressEmitter({
      presenter: input.presenter,
      resolvedView: input.runtimeResolvedView,
    }),
  });
  const authUser = await fetchAuthUserSnapshot({
    authBaseUrl: input.authBaseUrl,
    accessToken: token.access_token,
  });

  await setAuthSession({
    accessToken: token.access_token,
    tokenType: token.token_type ?? "Bearer",
    authBaseUrl: input.authBaseUrl,
    clientId: input.clientId,
    expiresAt: resolveDeviceTokenExpiresAt(token.expires_in),
    scope: normalizeOptionalString(token.scope) ?? undefined,
    user: authUser ?? undefined,
  });

  emitLineWithHumanSpacer({
    presenter: input.presenter,
    isHumanView: input.isHumanView,
    code: "auth.login.success",
    text: input.isHumanView
      ? pc.green(resolveHumanLoginSuccessText(authUser))
      : "sign-in successful; bearer token saved on this device",
  });
}

async function runOneTimeTokenLoginFlow(input: {
  authBaseUrl: string;
  clientId: string;
  isHumanView: boolean;
  presenter: ReturnType<typeof createPresenter>;
  token: string;
}): Promise<void> {
  emitOneTimeTokenLoginStartLine({
    presenter: input.presenter,
    isHumanView: input.isHumanView,
    authBaseUrl: input.authBaseUrl,
  });

  const verified = await exchangeOneTimeTokenAuthSession({
    authBaseUrl: input.authBaseUrl,
    clientId: input.clientId,
    token: input.token,
  });

  let transition: AuthSessionTransition | null = null;
  try {
    transition = await beginAuthSessionTransition({
      accessToken: verified.accessToken,
      tokenType: verified.tokenType,
      authBaseUrl: verified.authBaseUrl,
      clientId: verified.clientId,
      expiresAt: verified.expiresAt,
      user: verified.user,
    });
    await assertOneTimeTokenAuthSessionSaved({
      accessToken: verified.accessToken,
    });
    await transition.commit();
  } catch (error) {
    let failure = error;
    if (transition) {
      try {
        await transition.rollback();
      } catch (recoveryError) {
        failure = new OneTimeTokenLocalSessionRecoveryError({
          cause: error,
          recoveryError,
          redactedValues: [verified.accessToken],
        });
      }
    }
    await rejectOneTimeTokenCandidateSession({
      cause: failure,
      session: verified,
    });
  }

  emitLineWithHumanSpacer({
    presenter: input.presenter,
    isHumanView: input.isHumanView,
    code: "auth.login.success",
    text: input.isHumanView
      ? pc.green(resolveHumanLoginSuccessText(verified.user))
      : "one-time token verified; bearer token saved on this device",
  });
}

async function assertOneTimeTokenAuthSessionSaved(input: {
  accessToken: string;
}): Promise<void> {
  const authState = await getAuthSessionState({
    validateRemote: false,
  }).catch(() => null);
  if (authState?.state !== "valid" || !authState.session) {
    const state = authState?.state ?? "unknown";
    throw new OneTimeTokenAuthError(
      "session_not_saved",
      `one-time token verified, but OpenMeld could not save a usable local sign-in session (${state}); copy a fresh setup command from OpenMeld Web and retry`
    );
  }

  if (authState.session.accessToken !== input.accessToken) {
    throw new OneTimeTokenAuthError(
      "session_not_saved",
      "one-time token verified, but OpenMeld saved a different local sign-in session; copy a fresh setup command from OpenMeld Web and retry"
    );
  }

  const ownerUserId = normalizeOptionalString(authState.session.user?.id);
  if (!ownerUserId) {
    throw new OneTimeTokenAuthError(
      "session_not_saved",
      "one-time token verified, but the saved local sign-in is missing its OpenMeld account ID; copy a fresh setup command from OpenMeld Web and retry"
    );
  }
}

async function promptOneTimeTokenForHuman(input: {
  allowBack: boolean;
  backLabel: string;
}): Promise<OneTimeTokenPromptResult> {
  const result = await promptTextEntry({
    message: "Paste your one-time sign-in token",
    placeholder: "token from the sign-in page",
    allowBack: input.allowBack,
    backLabel: input.backLabel,
    requiredMessage: "Enter a one-time sign-in token.",
    validate: (value) =>
      normalizeOptionalString(value) ? null : "Enter a one-time sign-in token.",
  });
  if (result.status !== "submitted") {
    return result;
  }
  const token = normalizeOptionalString(result.value);
  if (!token) {
    throw new OneTimeTokenAuthError(
      "missing_access_token",
      "one-time token is required"
    );
  }
  return {
    status: "submitted",
    value: token,
  };
}

function resolveAuthLoginNestedExitStatus(
  allowBackToCaller: boolean
): "back" | "cancelled" {
  return allowBackToCaller ? "back" : "cancelled";
}

function handleAuthLoginExit(input: {
  status: "back" | "cancelled";
  allowBackToCaller: boolean;
}): AuthLoginNavigationResult {
  if (input.status === "back" || input.allowBackToCaller) {
    return "back";
  }
  cancel("Cancelled.");
  return "cancelled";
}

function emitAgentOttRequired(input: {
  authBaseUrl: string;
  presenter: ReturnType<typeof createPresenter>;
}): void {
  const loginUrl = `${input.authBaseUrl}/`;
  input.presenter.data({
    code: "auth.login.ott.required",
    payload: {
      reason: "agent_view_requires_explicit_login_method",
      method: LOGIN_METHOD_OTT,
      authBaseUrl: input.authBaseUrl,
      steps: [
        `Open ${loginUrl} in a human-operated browser and sign in.`,
        "Click 'Generate One-Time Token (3 min)' on the auth home page.",
        "Pass the token back to the agent.",
        formatInlineOpenMeldCliCommands(
          "Run: `openmeld login --view agent --ott <token>`"
        ),
      ],
      fallback: formatInlineOpenMeldCliCommands(
        "If you must use device flow, run: `openmeld login --view agent --method device --no-open`"
      ),
    },
  });
}

function parseAuthLoginMethod(
  value: string | undefined
): AuthLoginMethod | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === LOGIN_METHOD_DEVICE || normalized === LOGIN_METHOD_OTT) {
    return normalized;
  }
  throw new Error("invalid --method value: use device|ott");
}

function resolveClientIdForLogin(
  value: string | undefined,
  resolvedView: "human" | "agent"
): string {
  try {
    return resolveDeviceAuthClientId(value);
  } catch (error) {
    if (resolvedView === "agent") {
      throw createAuthLoginGuideError(toErrorMessage(error));
    }
    throw error;
  }
}

function emitDeviceLoginStartLine(input: {
  presenter: ReturnType<typeof createPresenter>;
  isHumanView: boolean;
  authBaseUrl: string;
  clientId: string;
}): void {
  emitLineWithHumanSpacer({
    presenter: input.presenter,
    isHumanView: input.isHumanView,
    code: "auth.login.start",
    text: input.isHumanView
      ? `${pc.cyan("🔐 Device Sign-In")} ${pc.dim(`client ${input.clientId}`)} ${pc.dim(`auth ${input.authBaseUrl}`)}`
      : `starting device sign-in (auth: ${input.authBaseUrl}, client_id: ${input.clientId})`,
  });
}

function emitOneTimeTokenLoginStartLine(input: {
  presenter: ReturnType<typeof createPresenter>;
  isHumanView: boolean;
  authBaseUrl: string;
}): void {
  emitLineWithHumanSpacer({
    presenter: input.presenter,
    isHumanView: input.isHumanView,
    code: "auth.login.start",
    text: input.isHumanView
      ? `${pc.cyan("🔐 One-Time Token Sign-In")} ${pc.dim(`auth ${input.authBaseUrl}`)}`
      : `starting one-time-token sign-in (auth: ${input.authBaseUrl})`,
  });
}

function emitVerificationLines(input: {
  presenter: ReturnType<typeof createPresenter>;
  isHumanView: boolean;
  verificationUrl: string;
  userCode: string;
}): void {
  emitLineWithHumanSpacer({
    presenter: input.presenter,
    isHumanView: input.isHumanView,
    code: "auth.login.verification_url",
    text: input.isHumanView
      ? `${pc.cyan("🌐 Verify URL")} ${pc.underline(input.verificationUrl)}`
      : `open this URL to authorize: ${input.verificationUrl}`,
    data: {
      verificationUrl: input.verificationUrl,
    },
  });
  emitLineWithHumanSpacer({
    presenter: input.presenter,
    isHumanView: input.isHumanView,
    code: "auth.login.user_code",
    text: input.isHumanView
      ? `${pc.yellow("🔑 Code")} ${pc.bold(input.userCode)}`
      : `enter this code: ${input.userCode}`,
    data: {
      userCode: input.userCode,
    },
  });
}

function maybeEmitAgentHumanActionRequired(input: {
  presenter: ReturnType<typeof createPresenter>;
  isAgentView: boolean;
  verificationUrl: string;
  userCode: string;
}): void {
  if (!input.isAgentView) {
    return;
  }
  input.presenter.data({
    code: "auth.login.human_action_required",
    payload: {
      verificationUrl: input.verificationUrl,
      userCode: input.userCode,
      steps: [
        "Ask the human user to open verificationUrl in browser.",
        "Ask the human to confirm the userCode shown on page.",
        "Ask the human to approve the device request.",
        "Wait until the CLI polling returns access_token.",
      ],
    },
  });
}

function emitBrowserOpenLine(input: {
  presenter: ReturnType<typeof createPresenter>;
  isHumanView: boolean;
  opened: boolean;
  verificationUrl: string;
}): void {
  if (input.isHumanView) {
    emitLineWithHumanSpacer({
      presenter: input.presenter,
      isHumanView: true,
      code: input.opened
        ? "auth.login.browser_opened"
        : "auth.login.browser_open_failed",
      text: input.opened
        ? pc.green("✅ Browser opened")
        : `${pc.yellow("⚠️ Open URL manually")} ${pc.underline(input.verificationUrl)}`,
    });
    return;
  }

  input.presenter.line({
    code: input.opened
      ? "auth.login.browser_opened"
      : "auth.login.browser_open_failed",
    text: input.opened
      ? "browser opened for verification"
      : "could not auto-open browser; open the URL manually",
  });
}

export async function runAuthLogout(input?: {
  view?: string;
  agentOverviewHandled?: boolean;
}): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input?.view });
  const presenter = createPresenter(runtime);
  await finishInterruptedComputerAuthHandoffBeforeAccountChange({
    presenter,
    runtime,
    view: input?.view,
  });
  await assertAuthSessionMutationAvailable();
  emitAuthOverviewIfNeeded({
    presenter,
    resolvedView: runtime.resolvedView,
    handled: input?.agentOverviewHandled,
    command: "logout",
  });
  const cleanup = await performLogoutLocalCleanup({
    runtime,
  });
  emitLogoutCleanupResult({
    cleanup,
    presenter,
  });
  const cleared = await clearAuthSession();
  if (cleared.preservedSessionPath) {
    presenter.line({
      code: "auth.logout.damaged_session_preserved",
      text: "The damaged sign-in record was saved locally for support. OpenMeld could not identify its old credential. You can review old sign-ins in Account sessions.",
      data: { preservedSessionPath: cleared.preservedSessionPath },
    });
  }
  if (!cleared.hadLocalSession) {
    presenter.line({
      code: "auth.logout.no_session",
      text: "No local sign-in session found.",
    });
    return;
  }

  presenter.line({
    code: "auth.logout.cleared",
    text: "Signed out on this device. To reconnect, get a new setup command from OpenMeld Web.",
  });
}

export async function runAuthStatus(input?: {
  view?: string;
  agentOverviewHandled?: boolean;
}): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input?.view });
  const presenter = createPresenter(runtime);
  emitAuthOverviewIfNeeded({
    presenter,
    resolvedView: runtime.resolvedView,
    handled: input?.agentOverviewHandled,
    command: "status",
  });
  const sessionState = await getAuthSessionState({
    validateRemote: true,
  });
  const humanDataMode = runtime.viewCustomization?.render?.human?.dataMode;
  const mismatchGuidance =
    await resolveAuthStatusEnvironmentMismatch(sessionState);
  if (mismatchGuidance) {
    process.exitCode = 1;
    if (runtime.resolvedView === "human" && humanDataMode !== "envelope") {
      renderAuthStatusGuidanceCard({
        presenter,
        guidance: mismatchGuidance,
        codePrefix: "auth.status.card",
      });
      return;
    }
    presenter.data({
      code: "auth.status.session",
      payload: buildAuthStatusMismatchPayload({
        guidance: mismatchGuidance,
        snapshot: buildAuthStatusSnapshot(sessionState),
      }),
    });
    return;
  }
  const authSnapshot = buildAuthStatusSnapshot(sessionState);
  const statusPayload = buildAuthStatusPayload(authSnapshot);
  process.exitCode = sessionState.state === "valid" ? 0 : 1;

  if (runtime.resolvedView === "human" && humanDataMode !== "envelope") {
    renderAuthStatusCard({
      presenter,
      auth: authSnapshot,
      codePrefix: "auth.status.card",
    });
    return;
  }

  presenter.data({
    code: "auth.status.session",
    payload: statusPayload,
  });
}

async function resolveAuthStatusEnvironmentMismatch(
  sessionState: Awaited<ReturnType<typeof getAuthSessionState>>
): Promise<AuthenticationGuidance | null> {
  if (sessionState.state !== "valid" || !sessionState.session) {
    return null;
  }

  const gatewayUrl = await resolveBaseUrlOrNull();
  if (!gatewayUrl) {
    return null;
  }

  if (canAttachAuthTokenToRequest(sessionState.session, gatewayUrl)) {
    return null;
  }

  return resolveAuthenticationGuidance({
    reason: "mismatch",
    authBaseUrl: sessionState.session.authBaseUrl,
    gatewayUrl,
  });
}

function buildAuthStatusPayload(input: AuthStatusSnapshot): {
  signedIn: boolean;
  state: AuthSessionState;
  reasonCode?: AuthStatusSnapshot["reasonCode"];
  errorMessage?: string;
  authBaseUrl: string | null;
  clientId: string | null;
  tokenType: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  user: { id?: string; email?: string; name?: string } | null;
  organization: {
    active: AuthStatusSnapshot["activeOrganization"];
  };
} {
  const hasUser = Boolean(input.userId || input.userEmail || input.userName);
  return {
    signedIn: input.signedIn,
    state: input.state,
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    authBaseUrl: input.authBaseUrl,
    clientId: input.clientId,
    tokenType: input.tokenType,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    user: hasUser
      ? {
          ...(input.userId ? { id: input.userId } : {}),
          ...(input.userEmail ? { email: input.userEmail } : {}),
          ...(input.userName ? { name: input.userName } : {}),
        }
      : null,
    organization: {
      active: input.activeOrganization,
    },
  };
}

function buildAuthStatusMismatchPayload(input: {
  snapshot: AuthStatusSnapshot;
  guidance: AuthenticationGuidance;
}): {
  signedIn: false;
  state: "mismatch";
  guidanceReason: "mismatch";
  authBaseUrl: string | null;
  gatewayUrl: string | null;
  clientId: string | null;
  tokenType: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  user: { id?: string; email?: string; name?: string } | null;
  organization: {
    active: AuthStatusSnapshot["activeOrganization"];
  };
} {
  const hasUser = Boolean(
    input.snapshot.userId || input.snapshot.userEmail || input.snapshot.userName
  );
  return {
    signedIn: false,
    state: "mismatch",
    guidanceReason: "mismatch",
    authBaseUrl: input.guidance.authBaseUrl,
    gatewayUrl: input.guidance.gatewayUrl,
    clientId: input.snapshot.clientId,
    tokenType: input.snapshot.tokenType,
    createdAt: input.snapshot.createdAt,
    expiresAt: input.snapshot.expiresAt,
    user: hasUser
      ? {
          ...(input.snapshot.userId ? { id: input.snapshot.userId } : {}),
          ...(input.snapshot.userEmail
            ? { email: input.snapshot.userEmail }
            : {}),
          ...(input.snapshot.userName ? { name: input.snapshot.userName } : {}),
        }
      : null,
    organization: {
      active: input.snapshot.activeOrganization,
    },
  };
}

function emitAuthOverviewIfNeeded(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  command: AuthAgentOverviewCommand;
  handled?: boolean;
}): void {
  if (input.resolvedView !== "agent" || input.handled) {
    return;
  }
  emitAuthAgentOverview({
    presenter: input.presenter,
    command: input.command,
  });
}

async function performLogoutLocalCleanup(input: {
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
}): Promise<{
  daemonStop: Awaited<
    ReturnType<typeof bestEffortStopCurrentLaneDaemonService>
  >;
  selectedProfiles: ClearAllSelectedOpenMeldProfileIdsResult;
}> {
  const daemonStop = await bestEffortStopCurrentLaneDaemonService({
    runtime: input.runtime,
  });
  const selectedProfiles = await clearAllSelectedOpenMeldProfileIds();
  return {
    daemonStop,
    selectedProfiles,
  };
}

function emitLogoutCleanupResult(input: {
  cleanup: {
    daemonStop: Awaited<
      ReturnType<typeof bestEffortStopCurrentLaneDaemonService>
    >;
    selectedProfiles: ClearAllSelectedOpenMeldProfileIdsResult;
  };
  presenter: ReturnType<typeof createPresenter>;
}): void {
  const warningText = buildLogoutCleanupWarningText(input.cleanup);
  const data = {
    clearedSessionSelections:
      input.cleanup.selectedProfiles.clearedSessionSelections,
    daemonStopStatus: input.cleanup.daemonStop.status,
    failedSessionIds: input.cleanup.selectedProfiles.failedSessionIds,
    removedFallbackSelection:
      input.cleanup.selectedProfiles.removedFallbackSelection,
    removedLegacySelectionFile:
      input.cleanup.selectedProfiles.removedLegacySelectionFile,
    removedLegacySessionSelectionDirectory:
      input.cleanup.selectedProfiles.removedLegacySessionSelectionDirectory,
    ...(input.cleanup.daemonStop.status === "stopped"
      ? {
          daemonStopSignal: input.cleanup.daemonStop.signal,
        }
      : {}),
  };
  if (warningText) {
    input.presenter.line({
      code: "auth.logout.cleanup_warning",
      text: warningText,
      data,
    });
    return;
  }

  input.presenter.line({
    code: "auth.logout.cleanup",
    text: "Local sign-out cleanup finished for your local OpenMeld.",
    data,
  });
}

function buildLogoutCleanupWarningText(input: {
  daemonStop: Awaited<
    ReturnType<typeof bestEffortStopCurrentLaneDaemonService>
  >;
  selectedProfiles: ClearAllSelectedOpenMeldProfileIdsResult;
}): string | null {
  const warnings: string[] = [];
  if (input.daemonStop.status === "warning") {
    warnings.push(resolveDaemonStopWarningText(input.daemonStop));
  }
  if (input.selectedProfiles.failedSessionIds.length > 0) {
    warnings.push(
      `some selected OpenMeld profile pointers could not be cleared (${input.selectedProfiles.failedSessionIds.join(", ")})`
    );
  }
  if (warnings.length === 0) {
    return null;
  }
  return `Local sign-out cleanup needs attention: ${warnings.join("; ")}`;
}

function resolveDaemonStopWarningText(
  input: Extract<
    Awaited<ReturnType<typeof bestEffortStopCurrentLaneDaemonService>>,
    { status: "warning" }
  >
): string {
  if (input.reason === "process_timeout" || input.reason === "system_timeout") {
    return formatInlineOpenMeldCliCommands(
      "OpenMeld could not confirm that OpenMeld Service stopped. Run `openmeld service stop --force` if it is still running."
    );
  }
  if (input.reason === "invalid_state") {
    return "OpenMeld found stale local OpenMeld Service runtime state and cleared what it could.";
  }
  const detail = input.errorMessage ? ` ${input.errorMessage}` : "";
  return formatInlineOpenMeldCliCommands(
    `OpenMeld could not stop OpenMeld Service cleanly.${detail} Run \`openmeld service stop --force\` if it is still running.`
  );
}

async function requestDeviceCode(input: {
  authBaseUrl: string;
  clientId: string;
}): Promise<DeviceCodeResponse> {
  const endpoint = toAuthEndpoint(input.authBaseUrl, "/api/auth/device/code");
  const requestBody = betterAuthDeviceAuthorizationCodeRequestSchema.parse({
    client_id: input.clientId,
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await parseResponseJson(response);

  if (!response.ok) {
    throw new AuthHttpError({
      message: `failed to request device code: ${extractApiErrorMessage(payload, response.status)}`,
      status: response.status,
      endpoint,
    });
  }

  const parsed =
    betterAuthDeviceAuthorizationCodeResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AuthHttpError({
      message: "device code response did not match the Better Auth contract",
      status: response.status,
      endpoint,
    });
  }
  return parsed.data;
}

async function pollForDeviceToken(input: {
  authBaseUrl: string;
  clientId: string;
  deviceCode: string;
  intervalSeconds: number;
  expiresInSeconds: number;
  onProgress?: (progress: DevicePollProgress) => void;
}): Promise<DeviceTokenSuccessResponse> {
  const deadline = Date.now() + input.expiresInSeconds * 1000;
  let intervalSeconds = input.intervalSeconds;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    const result = await requestDeviceToken({
      authBaseUrl: input.authBaseUrl,
      clientId: input.clientId,
      deviceCode: input.deviceCode,
    });

    if (result.ok) {
      return result.data;
    }

    const errorCode = normalizeOptionalString(result.error.error);
    if (errorCode === "authorization_pending") {
      input.onProgress?.({
        event: "authorization_pending",
        attempt,
        intervalSeconds,
        remainingSeconds: Math.max(
          0,
          Math.ceil((deadline - Date.now()) / 1000)
        ),
      });
      await sleep(intervalSeconds * 1000);
      continue;
    }
    if (errorCode === "slow_down") {
      intervalSeconds = Math.min(
        intervalSeconds + 5,
        MAX_POLL_INTERVAL_SECONDS
      );
      input.onProgress?.({
        event: "slow_down",
        attempt,
        intervalSeconds,
        remainingSeconds: Math.max(
          0,
          Math.ceil((deadline - Date.now()) / 1000)
        ),
      });
      await sleep(intervalSeconds * 1000);
      continue;
    }
    if (errorCode === "access_denied") {
      throw new DeviceAuthError(
        "access_denied",
        "browser sign-in was canceled"
      );
    }
    if (errorCode === "expired_token") {
      throw new DeviceAuthError(
        "expired_token",
        "browser sign-in expired; sign in again"
      );
    }
    if (errorCode === "invalid_grant") {
      throw new DeviceAuthError(
        "invalid_grant",
        "browser sign-in is no longer valid; sign in again"
      );
    }

    throw new DeviceAuthError(
      "unknown",
      `browser sign-in failed: ${extractAuthApiErrorMessage(result.error, result.status)}`
    );
  }

  throw new DeviceAuthError(
    "expired_token",
    "browser sign-in timed out; sign in again"
  );
}

function resolveVerificationUrl(
  response: DeviceCodeResponse,
  authBaseUrl: string
): string {
  const raw =
    normalizeOptionalString(response.verification_uri_complete) ??
    normalizeOptionalString(response.verification_uri);
  if (!raw) {
    throw new Error("missing verification_uri in device code response");
  }

  const url = toAbsoluteUrl(raw, authBaseUrl);
  if (!url.searchParams.has("user_code")) {
    url.searchParams.set("user_code", response.user_code);
  }
  return url.toString();
}

function toAuthEndpoint(baseUrl: string, pathname: string): string {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function toAbsoluteUrl(raw: string, baseUrl: string): URL {
  try {
    return new URL(raw);
  } catch {
    return new URL(raw, baseUrl);
  }
}

function resolvePollingIntervalSeconds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_POLL_INTERVAL_SECONDS;
  }
  return clampInteger(
    value,
    MIN_POLL_INTERVAL_SECONDS,
    MAX_POLL_INTERVAL_SECONDS
  );
}

function resolveExpiresInSeconds(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 30 * 60;
  }
  return clampInteger(value, 60, 24 * 60 * 60);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeRequiredString(
  value: string | null,
  message: string
): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function normalizeOptionalString(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function readStringField(payload: unknown, key: string): string | null {
  if (!(payload && typeof payload === "object" && key in payload)) {
    return null;
  }

  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

async function parseResponseJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}

function extractApiErrorMessage(payload: unknown, status: number): string {
  const errorDescription = normalizeOptionalString(
    readStringField(payload, "error_description")
  );
  if (errorDescription) {
    return errorDescription;
  }
  const detail = normalizeOptionalString(readStringField(payload, "detail"));
  if (detail) {
    return detail;
  }
  const message = normalizeOptionalString(readStringField(payload, "message"));
  if (message) {
    return message;
  }
  const errorCode = normalizeOptionalString(readStringField(payload, "error"));
  if (errorCode) {
    return errorCode;
  }
  return `HTTP ${status}`;
}

function createPollingProgressEmitter(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): (progress: DevicePollProgress) => void {
  let lastPendingEmitAt = 0;
  const isHumanView = input.resolvedView === "human";

  return (progress) => {
    const now = Date.now();
    if (
      progress.event === "authorization_pending" &&
      now - lastPendingEmitAt < POLL_PROGRESS_EMIT_INTERVAL_MS
    ) {
      return;
    }

    if (progress.event === "authorization_pending") {
      lastPendingEmitAt = now;
      const remaining = formatCountdown(progress.remainingSeconds);
      emitLineWithHumanSpacer({
        presenter: input.presenter,
        isHumanView,
        code: "auth.login.polling.pending",
        text: isHumanView
          ? `${pc.yellow("⏳")} ${pc.bold(remaining)} left · poll ${progress.intervalSeconds}s · try ${progress.attempt}`
          : `waiting for approval (attempt ${progress.attempt}, poll in ${progress.intervalSeconds}s, remaining ${progress.remainingSeconds}s)`,
        data: progress,
      });
      return;
    }

    const remaining = formatCountdown(progress.remainingSeconds);
    emitLineWithHumanSpacer({
      presenter: input.presenter,
      isHumanView,
      code: "auth.login.polling.slow_down",
      text: isHumanView
        ? `${pc.yellow("⚠️ Poll Slowed")} ${pc.bold(remaining)} left · poll ${progress.intervalSeconds}s`
        : `server requested slower polling; now every ${progress.intervalSeconds}s (remaining ${progress.remainingSeconds}s)`,
      data: progress,
    });
  };
}

function emitLineWithHumanSpacer(input: {
  presenter: ReturnType<typeof createPresenter>;
  isHumanView: boolean;
  code: string;
  text: string;
  data?: Record<string, unknown>;
}): void {
  input.presenter.line({
    code: input.code,
    text: input.text,
    ...(input.data ? { data: input.data } : {}),
  });
  if (!input.isHumanView) {
    return;
  }
  input.presenter.line({
    code: `${input.code}.spacer`,
    text: "",
  });
}

function resolveHumanLoginSuccessText(user: AuthUserSnapshot | null): string {
  const email = normalizeOptionalString(user?.email);
  if (email) {
    return `✅ Welcome ${email}`;
  }
  return "✅ Signed in.";
}

function toDeviceAuthError(error: unknown): DeviceAuthError {
  if (error instanceof DeviceAuthError) {
    return error;
  }
  if (error instanceof Error) {
    return new DeviceAuthError("unknown", error.message);
  }
  return new DeviceAuthError("unknown", String(error));
}

function toOneTimeTokenAuthError(error: unknown): OneTimeTokenAuthError {
  if (error instanceof OneTimeTokenAuthError) {
    return error;
  }
  if (error instanceof Error) {
    return new OneTimeTokenAuthError("unknown", error.message);
  }
  return new OneTimeTokenAuthError("unknown", String(error));
}

function buildAgentFailureNextSteps(code: DeviceAuthFailureCode): string[] {
  if (code === "access_denied") {
    return [
      "Ask the human to sign in again and approve the device request.",
      "Confirm the verification URL and user_code were opened and submitted.",
      "If denial was intentional, stop retrying.",
    ].map((step) => formatInlineOpenMeldCliCommands(step));
  }
  if (code === "expired_token") {
    return [
      "Sign in again to get a fresh device_code.",
      "Complete approval promptly before token expiry.",
    ].map((step) => formatInlineOpenMeldCliCommands(step));
  }
  if (code === "invalid_grant") {
    return [
      "Sign in again to refresh device_code and user_code.",
      "Verify client_id is allowed (openmeld-cli or openmeld-cli-dev).",
      "Verify auth URL points to the expected auth worker.",
    ].map((step) => formatInlineOpenMeldCliCommands(step));
  }
  return [
    "Retry sign-in once.",
    "If still failing, check auth worker logs and response payload.",
    "Verify auth URL and client_id configuration.",
  ].map((step) => formatInlineOpenMeldCliCommands(step));
}

function buildAgentOttFailureNextSteps(input: {
  authBaseUrl: string;
  code: OneTimeTokenAuthFailureCode;
}): string[] {
  if (input.code === "missing_access_token") {
    return [
      "Auth worker returned no set-auth-token header; verify bearer plugin is enabled.",
      "Retry after confirming auth worker deployment includes one-time-token + bearer plugins.",
    ];
  }
  if (input.code === "session_not_saved") {
    return [
      "Verify the local CLI can persist and reload the bearer session after one-time-token verification.",
      "Return to OpenMeld Web to inspect the current connection state and recovery action.",
      "If it still fails, run `openmeld login --ott <token> --view agent` and inspect the auth worker response.",
    ].map((step) => formatInlineOpenMeldCliCommands(step));
  }
  if (input.code === "expired_token") {
    return [
      `Open ${input.authBaseUrl}/ and generate a fresh one-time token.`,
      "Run `openmeld login --view agent --ott <new-token>` immediately.",
    ].map((step) => formatInlineOpenMeldCliCommands(step));
  }
  if (input.code === "invalid_token") {
    return [
      `Open ${input.authBaseUrl}/ and generate a new one-time token.`,
      "Use the latest token exactly once: `openmeld login --view agent --ott <token>`.",
    ].map((step) => formatInlineOpenMeldCliCommands(step));
  }
  return [
    "Retry once with a newly generated one-time token.",
    `If it still fails, verify auth URL points to the expected worker: ${input.authBaseUrl}`,
    "Check auth worker logs for /api/auth/one-time-token/verify.",
  ].map((step) => formatInlineOpenMeldCliCommands(step));
}

function resolveLocalAuthAdaptationHint(
  error: unknown,
  context: { authBaseUrl: string; clientId: string }
): string | null {
  if (!(error instanceof AuthHttpError)) {
    return null;
  }
  if (error.status !== 404) {
    return null;
  }
  if (!error.endpoint.endsWith("/api/auth/device/code")) {
    return null;
  }

  const normalizedBaseUrl = context.authBaseUrl.replace(
    TRAILING_SLASH_PATTERN,
    ""
  );
  const isDefaultHost = normalizedBaseUrl === "https://auth.openmeld.ai";
  if (!isDefaultHost) {
    return null;
  }

  return formatInlineOpenMeldCliCommands(
    [
      "auth worker does not expose device endpoint on current auth URL.",
      "for local dev: run `openmeld login --auth-url http://localhost:8788 --client-id openmeld-cli-dev`.",
      "or set `OPENMELD_AUTH_URL=http://localhost:8788` before running `openmeld login`.",
    ].join(" ")
  );
}

function formatCountdown(inputSeconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(inputSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
