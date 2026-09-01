import { cancel, isCancel, select } from "@clack/prompts";
import { sanitizeDispatchErrorSummary } from "@openmeld/schemas";
import {
  getCurrentCommandCheckState,
  isCurrentCommandCheckScopeActive,
} from "../command-entry-checks/current-command-check-state";
import { runAuthLogin } from "../commands/auth";
import { deriveAuthBaseUrlFromGatewayUrl } from "../config/auth-request-compatibility";
import {
  type AuthSessionStateReasonCode,
  type AuthSessionStateResult,
  getAuthSessionState,
  type StoredAuthSession,
} from "../config/auth-session";
import { canAttachAuthTokenToRequest } from "../config/request-headers";
import type { RuntimeContext } from "../runtime/types";
import { renderTextInfoCard } from "../ui/info-card";
import { outLine } from "../ui/io";
import {
  buildCommandAuthenticationPromptMessage as buildAuthPromptMessage,
  buildHumanAuthenticationCard,
  createAuthenticationError,
  extractAuthenticationPromptAction,
  resolveAuthenticationGuidance,
} from "./auth-guidance";

const COMMAND_AUTH_ACTION_LOGIN = "__command_auth_login__";
const COMMAND_AUTH_ACTION_CANCEL = "__command_auth_cancel__";

export type CommandAuthenticationStatus =
  | "valid"
  | "missing"
  | "invalid"
  | "expired"
  | "revoked"
  | "mismatch"
  | "unavailable"
  | "unknown";

export type EvaluatedCommandAuthentication = {
  status: CommandAuthenticationStatus;
  session: StoredAuthSession | null;
  email: string | null;
  authBaseUrl: string | null;
  reasonCode: AuthSessionStateReasonCode | null;
  errorMessage: string | null;
};

export async function evaluateCommandAuthentication(input?: {
  gatewayUrl?: string;
}): Promise<EvaluatedCommandAuthentication> {
  let authState = await readCommandAuthState();
  if (authState?.reasonCode === "session_token_unavailable") {
    // This recovers one-off token-store failures. A timed-out macOS Keychain
    // helper is cached by its owner, so this re-read never launches it twice.
    authState = (await readCommandAuthState()) ?? authState;
  }
  const session = authState?.session ?? null;
  const authBaseUrl = normalizeOptionalString(session?.authBaseUrl);
  const email = normalizeOptionalString(session?.user?.email);
  const isCompatibleWithGateway =
    authState?.state === "valid" &&
    session !== null &&
    (!(input?.gatewayUrl && input.gatewayUrl.trim().length > 0) ||
      canAttachAuthTokenToRequest(session, input.gatewayUrl));

  return {
    status: resolveCommandAuthenticationStatus({
      authState,
      isCompatibleWithGateway,
    }),
    session,
    email,
    authBaseUrl,
    reasonCode: authState?.reasonCode ?? null,
    errorMessage: sanitizeAuthStateErrorMessage(authState?.errorMessage),
  };
}

export async function ensureCommandAuthenticationOrCancel(input: {
  runtime: Pick<RuntimeContext, "resolvedView" | "interactive">;
  gatewayUrl?: string;
  promptMessage: string;
  allowPrompt?: boolean;
  evaluated?: EvaluatedCommandAuthentication;
  onAuthenticatedSession?: (session: StoredAuthSession) => void;
}): Promise<boolean> {
  const currentState = getCurrentCommandCheckState();
  if (
    isCurrentCommandCheckScopeActive() &&
    currentState.signIn &&
    currentState.signIn.status === "valid" &&
    currentState.signIn.checkedGatewayUrl ===
      normalizeOptionalString(input.gatewayUrl)
  ) {
    return true;
  }
  const auth =
    input.evaluated ??
    (await evaluateCommandAuthentication({
      gatewayUrl: input.gatewayUrl,
    }));
  if (auth.status === "valid" && auth.session) {
    input.onAuthenticatedSession?.(auth.session);
    return true;
  }

  const canPrompt = input.allowPrompt ?? input.runtime.interactive;
  const guidance = resolveAuthenticationGuidance({
    reason: auth.status === "mismatch" ? "mismatch" : resolveAuthReason(auth),
    action: extractAuthenticationPromptAction(input.promptMessage),
    authBaseUrl: auth.authBaseUrl,
    gatewayUrl: input.gatewayUrl,
  });

  if (auth.status === "unavailable") {
    throw createAuthenticationError({
      reason: guidance.reason,
      action: guidance.action,
      authBaseUrl: guidance.authBaseUrl,
      gatewayUrl: guidance.gatewayUrl,
    });
  }

  if (input.runtime.resolvedView !== "human" || !canPrompt) {
    throw createAuthenticationError({
      reason: guidance.reason,
      action: guidance.action,
      authBaseUrl: guidance.authBaseUrl,
      gatewayUrl: guidance.gatewayUrl,
    });
  }

  const card = buildHumanAuthenticationCard({
    guidance,
    mode: "prompt",
  });
  renderTextInfoCard({
    title: card.title,
    rows: card.rows,
    emitLine: outLine,
  });

  const action = await select({
    message: "What do you want to do?",
    options: [
      {
        value: COMMAND_AUTH_ACTION_LOGIN,
        label: "Sign in now",
      },
      {
        value: COMMAND_AUTH_ACTION_CANCEL,
        label: "Cancel",
      },
    ],
  });
  if (isCancel(action) || action === COMMAND_AUTH_ACTION_CANCEL) {
    cancel("Cancelled.");
    return false;
  }

  const authUrl =
    auth.status === "mismatch" && input.gatewayUrl
      ? deriveAuthBaseUrlFromGatewayUrl(input.gatewayUrl)
      : null;
  await runAuthLogin({
    ...(authUrl ? { authUrl } : {}),
    view: input.runtime.resolvedView,
  });

  const afterLogin = await evaluateCommandAuthentication({
    gatewayUrl: input.gatewayUrl,
  });
  if (afterLogin.status !== "valid" || !afterLogin.session) {
    cancel("Cancelled.");
    return false;
  }
  input.onAuthenticatedSession?.(afterLogin.session);
  if (isCurrentCommandCheckScopeActive()) {
    currentState.signIn = {
      checkedGatewayUrl: normalizeOptionalString(input.gatewayUrl),
      status: "valid",
    };
  }

  return true;
}

export function buildCommandAuthMismatchSummary(input: {
  gatewayUrl: string | null;
  authBaseUrl: string | null;
}): string {
  return resolveAuthenticationGuidance({
    reason: "mismatch",
    authBaseUrl: input.authBaseUrl,
    gatewayUrl: input.gatewayUrl,
  }).summary;
}

export function buildCommandAuthMismatchErrorMessage(input: {
  gatewayUrl: string | null;
  authBaseUrl: string | null;
}): string {
  return resolveAuthenticationGuidance({
    reason: "mismatch",
    authBaseUrl: input.authBaseUrl,
    gatewayUrl: input.gatewayUrl,
  }).commandErrorMessage;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveAuthReason(
  auth: EvaluatedCommandAuthentication
): "required" | "expired" | "invalid" | "revoked" | "unavailable" {
  if (
    auth.status === "expired" ||
    auth.status === "invalid" ||
    auth.status === "revoked" ||
    auth.status === "unavailable"
  ) {
    return auth.status;
  }
  return "required";
}

async function readCommandAuthState(): Promise<AuthSessionStateResult | null> {
  try {
    return await getAuthSessionState({
      validateRemote: true,
    });
  } catch (error) {
    return {
      state: "invalid",
      session: null,
      reasonCode: "session_token_unavailable",
      errorMessage:
        sanitizeAuthStateErrorMessage(
          error instanceof Error ? error.message : error
        ) ?? "Authentication state could not be read.",
    };
  }
}

function sanitizeAuthStateErrorMessage(value: unknown): string | null {
  return sanitizeDispatchErrorSummary(normalizeOptionalString(value));
}

function resolveCommandAuthenticationStatus(input: {
  authState: AuthSessionStateResult | null;
  isCompatibleWithGateway: boolean;
}): CommandAuthenticationStatus {
  if (
    input.authState?.state === "valid" &&
    input.authState.session !== null &&
    !input.isCompatibleWithGateway
  ) {
    return "mismatch";
  }
  if (input.authState?.reasonCode === "session_token_unavailable") {
    return "unavailable";
  }
  return input.authState?.state ?? "unknown";
}

export function buildCommandAuthenticationPromptMessage(
  action?: string
): string {
  return buildAuthPromptMessage(action);
}
