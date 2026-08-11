import type { AuthSessionState } from "../config/auth-session";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommands,
} from "../runtime/cli-entry-command";
import type { DualViewGuideInput } from "../runtime/dual-view-guide";

const AUTH_MISMATCH_ERROR_RE =
  /session auth:\s*(.+?),\s*gateway:\s*(.+?)\);?\s*run/u;
const AUTH_MISMATCH_SUMMARY_RE =
  /Current session is for\s+(.+?),\s+but.+?\s+is\s+(.+?)\./u;
const AUTH_PROMPT_ACTION_RE =
  /^Sign in is required before (?<action>.+?)\. What do you want to do\?$/u;

export type AuthenticationGuidanceReason =
  | "required"
  | "expired"
  | "invalid"
  | "revoked"
  | "mismatch";

export type AuthenticationGuidance = {
  reason: AuthenticationGuidanceReason;
  action: string | null;
  authBaseUrl: string | null;
  gatewayUrl: string | null;
  title: string;
  statusLabel: string;
  summary: string;
  promptNextStep: string;
  errorNextStep: string;
  commandErrorMessage: string;
  agentErrorMessage: string;
};

export class OpenMeldAuthenticationError extends Error {
  readonly code = "auth.authentication_required";
  readonly guidance: AuthenticationGuidance;

  constructor(guidance: AuthenticationGuidance) {
    super(guidance.commandErrorMessage);
    this.name = "OpenMeldAuthenticationError";
    this.guidance = guidance;
  }
}

export function createAuthenticationError(input: {
  reason: AuthenticationGuidanceReason;
  action?: string | null;
  authBaseUrl?: string | null;
  gatewayUrl?: string | null;
}): OpenMeldAuthenticationError {
  return new OpenMeldAuthenticationError(resolveAuthenticationGuidance(input));
}

export function resolveAuthenticationGuidance(input: {
  reason: AuthenticationGuidanceReason;
  action?: string | null;
  authBaseUrl?: string | null;
  gatewayUrl?: string | null;
}): AuthenticationGuidance {
  const action = normalizeOptionalString(input.action);
  const authBaseUrl = normalizeOptionalString(input.authBaseUrl);
  const gatewayUrl = normalizeOptionalString(input.gatewayUrl);
  if (input.reason === "mismatch") {
    return {
      reason: input.reason,
      action,
      authBaseUrl,
      gatewayUrl,
      title: "Wrong OpenMeld Environment",
      statusLabel: "wrong OpenMeld environment",
      summary: "This command is using a different OpenMeld environment.",
      promptNextStep: "Choose Sign in now to switch and continue.",
      errorNextStep: formatInlineOpenMeldCliCommands(
        "Run `openmeld login` for this OpenMeld environment, then retry."
      ),
      commandErrorMessage: formatInlineOpenMeldCliCommands(
        `authentication does not match current gateway (session auth: ${
          authBaseUrl ?? "another OpenMeld environment"
        }, gateway: ${gatewayUrl ?? "the current OpenMeld gateway"}); run \`openmeld login\` and retry`
      ),
      agentErrorMessage: formatInlineOpenMeldCliCommands(
        "sign-in is for a different OpenMeld environment; run `openmeld login` for this OpenMeld environment, then retry"
      ),
    };
  }

  const requiredGuidance = resolveRequiredAuthenticationGuidance(input.reason);
  return {
    reason: input.reason,
    action,
    authBaseUrl,
    gatewayUrl,
    ...requiredGuidance,
  };
}

export function buildCommandAuthenticationPromptMessage(
  action?: string
): string {
  const normalizedAction = normalizeOptionalString(action);
  if (!normalizedAction) {
    return "Sign in is required to continue. What do you want to do?";
  }
  return `Sign in is required before ${normalizedAction}. What do you want to do?`;
}

export function buildHumanAuthenticationCard(input: {
  guidance: AuthenticationGuidance;
  mode: "prompt" | "error";
}): {
  title: string;
  rows: Array<{ label: string; value: string }>;
} {
  const rows: Array<{ label: string; value: string }> = [];
  rows.push({
    label: "Status",
    value: buildHumanAuthenticationStatusText(input.guidance),
  });

  if (input.guidance.reason === "mismatch") {
    if (input.guidance.authBaseUrl) {
      rows.push({
        label: "Signed In To",
        value: input.guidance.authBaseUrl,
      });
    }
    if (input.guidance.gatewayUrl) {
      rows.push({
        label: "This Command Uses",
        value: input.guidance.gatewayUrl,
      });
    }
  }

  rows.push({
    label: "Next",
    value:
      input.mode === "prompt"
        ? input.guidance.promptNextStep
        : input.guidance.errorNextStep,
  });

  return {
    title: input.guidance.title,
    rows,
  };
}

export function buildAgentAuthenticationGuide(
  guidance: AuthenticationGuidance
): DualViewGuideInput {
  return {
    summary: guidance.agentErrorMessage,
    humanSteps: buildAgentAuthenticationHumanSteps(guidance),
    agentCommands: [
      "Ask the operator to complete sign-in in a human terminal, then retry the same command.",
    ],
    notes: buildAgentAuthenticationNotes(guidance),
  };
}

export function buildAuthenticationStatusLabel(
  state: AuthSessionState | AuthenticationGuidanceReason
): string {
  switch (state) {
    case "valid":
      return "signed in";
    case "missing":
    case "required":
      return "sign in needed";
    case "expired":
      return "sign in expired";
    case "invalid":
      return "sign in needs refresh";
    case "revoked":
      return "sign in removed";
    case "mismatch":
      return "wrong OpenMeld environment";
    default:
      return "sign in needed";
  }
}

export function resolveAuthenticationReasonFromState(
  state: AuthSessionState
): AuthenticationGuidanceReason | null {
  switch (state) {
    case "missing":
      return "required";
    case "expired":
    case "invalid":
    case "revoked":
      return state;
    default:
      return null;
  }
}

export function isAuthenticationError(
  error: unknown
): error is OpenMeldAuthenticationError {
  return error instanceof OpenMeldAuthenticationError;
}

export function resolveAuthenticationGuidanceFromError(
  error: unknown
): AuthenticationGuidance | null {
  if (error instanceof OpenMeldAuthenticationError) {
    return error.guidance;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  return resolveAuthenticationGuidanceFromMessage(message);
}

export function resolveAuthenticationGuidanceFromMessage(
  message: string
): AuthenticationGuidance | null {
  const normalizedMessage = String(message ?? "").trim();
  if (normalizedMessage.length === 0) {
    return null;
  }
  const loweredMessage = normalizedMessage.toLowerCase();

  const mismatch = AUTH_MISMATCH_ERROR_RE.exec(normalizedMessage);
  if (mismatch?.[1] && mismatch[2]) {
    return resolveAuthenticationGuidance({
      reason: "mismatch",
      authBaseUrl: mismatch[1],
      gatewayUrl: mismatch[2],
    });
  }

  if (normalizedMessage.includes("Current session is for")) {
    const parsed = AUTH_MISMATCH_SUMMARY_RE.exec(normalizedMessage);
    return resolveAuthenticationGuidance({
      reason: "mismatch",
      authBaseUrl: parsed?.[1] ?? null,
      gatewayUrl: parsed?.[2] ?? null,
    });
  }

  if (loweredMessage.includes("auth session expired")) {
    return resolveAuthenticationGuidance({
      reason: "expired",
    });
  }
  if (loweredMessage.includes("invalid local auth session")) {
    return resolveAuthenticationGuidance({
      reason: "invalid",
    });
  }
  if (loweredMessage.includes("auth session revoked")) {
    return resolveAuthenticationGuidance({
      reason: "revoked",
    });
  }
  if (
    loweredMessage.includes("authentication required") ||
    loweredMessage.includes("auth.unauthenticated") ||
    loweredMessage.includes("auth.authentication_required") ||
    loweredMessage.includes("sign-in required")
  ) {
    return resolveAuthenticationGuidance({
      reason: "required",
    });
  }

  return null;
}

export function extractAuthenticationPromptAction(
  promptMessage: string
): string | null {
  const normalizedMessage = String(promptMessage ?? "").trim();
  if (normalizedMessage.length === 0) {
    return null;
  }
  const match = AUTH_PROMPT_ACTION_RE.exec(normalizedMessage);
  return normalizeOptionalString(match?.groups?.action);
}

function resolveRequiredAuthenticationGuidance(
  reason: Exclude<AuthenticationGuidanceReason, "mismatch">
): Omit<
  AuthenticationGuidance,
  "reason" | "action" | "authBaseUrl" | "gatewayUrl"
> {
  switch (reason) {
    case "expired":
      return {
        title: "Sign In Needed",
        statusLabel: "sign in expired",
        summary: "Your OpenMeld sign-in has expired.",
        promptNextStep: "Choose Sign in now to refresh and continue.",
        errorNextStep: formatInlineOpenMeldCliCommands(
          "Run `openmeld login` again to continue."
        ),
        commandErrorMessage: formatInlineOpenMeldCliCommands(
          "sign-in expired; run `openmeld login`"
        ),
        agentErrorMessage: formatInlineOpenMeldCliCommands(
          "sign-in expired; run `openmeld login` in a human terminal, then retry"
        ),
      };
    case "invalid":
      return {
        title: "Sign In Needed",
        statusLabel: "sign in needs refresh",
        summary: "This device's OpenMeld sign-in is no longer valid.",
        promptNextStep: "Choose Sign in now to refresh and continue.",
        errorNextStep: formatInlineOpenMeldCliCommands(
          "Run `openmeld login` again to continue."
        ),
        commandErrorMessage: formatInlineOpenMeldCliCommands(
          "local sign-in is invalid; run `openmeld login`"
        ),
        agentErrorMessage: formatInlineOpenMeldCliCommands(
          "local sign-in is invalid; run `openmeld login` in a human terminal, then retry"
        ),
      };
    case "revoked":
      return {
        title: "Sign In Needed",
        statusLabel: "sign in removed",
        summary: "Your OpenMeld sign-in was revoked.",
        promptNextStep: "Choose Sign in now to refresh and continue.",
        errorNextStep: formatInlineOpenMeldCliCommands(
          "Run `openmeld login` again to continue."
        ),
        commandErrorMessage: formatInlineOpenMeldCliCommands(
          "sign-in was revoked; run `openmeld login`"
        ),
        agentErrorMessage: formatInlineOpenMeldCliCommands(
          "sign-in was revoked; run `openmeld login` in a human terminal, then retry"
        ),
      };
    case "required":
      return {
        title: "Sign In Needed",
        statusLabel: "sign in needed",
        summary: "You're not signed in to OpenMeld yet.",
        promptNextStep: "Choose Sign in now to continue.",
        errorNextStep: formatInlineOpenMeldCliCommands(
          "Run `openmeld login` to continue."
        ),
        commandErrorMessage: formatInlineOpenMeldCliCommands(
          "sign-in required; run `openmeld login`"
        ),
        agentErrorMessage: formatInlineOpenMeldCliCommands(
          "sign-in required; run `openmeld login` in a human terminal, then retry"
        ),
      };
    default:
      return {
        title: "Sign In Needed",
        statusLabel: "sign in needed",
        summary: "You're not signed in to OpenMeld yet.",
        promptNextStep: "Choose Sign in now to continue.",
        errorNextStep: formatInlineOpenMeldCliCommands(
          "Run `openmeld login` to continue."
        ),
        commandErrorMessage: formatInlineOpenMeldCliCommands(
          "sign-in required; run `openmeld login`"
        ),
        agentErrorMessage: formatInlineOpenMeldCliCommands(
          "sign-in required; run `openmeld login` in a human terminal, then retry"
        ),
      };
  }
}

function buildHumanAuthenticationStatusText(
  guidance: AuthenticationGuidance
): string {
  const actionText = guidance.action
    ? ` before ${guidance.action}`
    : " to continue";
  if (guidance.reason === "mismatch") {
    return `Sign in to the right OpenMeld environment${actionText}.`;
  }
  if (
    guidance.reason === "expired" ||
    guidance.reason === "invalid" ||
    guidance.reason === "revoked"
  ) {
    return `Sign in again${actionText}.`;
  }
  return `Sign in${actionText}.`;
}

function buildAgentAuthenticationHumanSteps(
  guidance: AuthenticationGuidance
): string[] {
  const retryStep = guidance.action
    ? `Retry after sign-in, then continue ${guidance.action}.`
    : "Retry the same command after sign-in finishes.";
  const steps = [...formatOpenMeldCliCommands(["openmeld login"]), retryStep];
  if (guidance.reason === "mismatch" && guidance.gatewayUrl) {
    steps.splice(
      1,
      0,
      `Use the OpenMeld environment for ${guidance.gatewayUrl}.`
    );
  }
  return steps;
}

function buildAgentAuthenticationNotes(
  guidance: AuthenticationGuidance
): string[] {
  const notes: string[] = [];
  if (guidance.action) {
    notes.push(`Blocked action: ${guidance.action}`);
  }
  if (guidance.authBaseUrl) {
    notes.push(`Current sign-in: ${guidance.authBaseUrl}`);
  }
  if (guidance.gatewayUrl) {
    notes.push(`Current gateway: ${guidance.gatewayUrl}`);
  }
  return notes;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
