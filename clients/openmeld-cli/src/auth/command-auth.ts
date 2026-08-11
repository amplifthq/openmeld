import { cancel, isCancel, select } from "@clack/prompts";
import {
  getCurrentCommandCheckState,
  isCurrentCommandCheckScopeActive,
} from "../command-entry-checks/current-command-check-state";
import { runAuthLogin } from "../commands/auth";
import { deriveAuthBaseUrlFromGatewayUrl } from "../config/auth-request-compatibility";
import {
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
  | "unknown";

export type EvaluatedCommandAuthentication = {
  status: CommandAuthenticationStatus;
  session: StoredAuthSession | null;
  email: string | null;
  authBaseUrl: string | null;
};

export async function evaluateCommandAuthentication(input?: {
  gatewayUrl?: string;
}): Promise<EvaluatedCommandAuthentication> {
  const authState = await getAuthSessionState({
    validateRemote: true,
  }).catch(() => null);
  const session = authState?.session ?? null;
  const authBaseUrl = normalizeOptionalString(session?.authBaseUrl);
  const email = normalizeOptionalString(session?.user?.email);
  const isCompatibleWithGateway =
    authState?.state === "valid" &&
    session !== null &&
    (!(input?.gatewayUrl && input.gatewayUrl.trim().length > 0) ||
      canAttachAuthTokenToRequest(session, input.gatewayUrl));

  return {
    status:
      authState?.state === "valid" &&
      session !== null &&
      !isCompatibleWithGateway
        ? "mismatch"
        : (authState?.state ?? "unknown"),
    session,
    email,
    authBaseUrl,
  };
}

export async function ensureCommandAuthenticationOrCancel(input: {
  runtime: Pick<RuntimeContext, "resolvedView" | "interactive">;
  gatewayUrl?: string;
  promptMessage: string;
  allowPrompt?: boolean;
  evaluated?: EvaluatedCommandAuthentication;
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
    return true;
  }

  const canPrompt = input.allowPrompt ?? input.runtime.interactive;
  const guidance = resolveAuthenticationGuidance({
    reason: auth.status === "mismatch" ? "mismatch" : resolveAuthReason(auth),
    action: extractAuthenticationPromptAction(input.promptMessage),
    authBaseUrl: auth.authBaseUrl,
    gatewayUrl: input.gatewayUrl,
  });

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
): "required" | "expired" | "invalid" | "revoked" {
  if (
    auth.status === "expired" ||
    auth.status === "invalid" ||
    auth.status === "revoked"
  ) {
    return auth.status;
  }
  return "required";
}

export function buildCommandAuthenticationPromptMessage(
  action?: string
): string {
  return buildAuthPromptMessage(action);
}
