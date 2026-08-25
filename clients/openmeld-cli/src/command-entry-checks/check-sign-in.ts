import { cancel, isCancel, select } from "@clack/prompts";
import {
  buildHumanAuthenticationCard,
  resolveAuthenticationGuidance,
} from "../auth/auth-guidance";
import {
  buildCommandAuthenticationPromptMessage,
  ensureCommandAuthenticationOrCancel,
  evaluateCommandAuthentication,
} from "../auth/command-auth";
import { runAuthLogin } from "../commands/auth";
import { deriveAuthBaseUrlFromGatewayUrl } from "../config/auth-request-compatibility";
import { formatOpenMeldCliCommands } from "../runtime/cli-entry-command";
import { buildAgentCheckResult } from "./build-agent-check-result";
import { getCommandEntryCopy } from "./command-entry-copy";
import { getCurrentCommandCheckState } from "./current-command-check-state";
import {
  buildBlockedEntryCheckResult,
  ENTRY_CHECK_BLOCKED_ERROR_CODES,
} from "./entry-check-blocked-json";
import { showHumanCheckCard } from "./show-human-check-card";
import type {
  CommandCheckRequirement,
  CommandEntryContext,
  CommandEntryResult,
} from "./types";

const SIGN_IN_NOW = "__command_entry_sign_in_now__";
const CONTINUE_WITHOUT_SIGN_IN = "__command_entry_continue_without_sign_in__";
const CANCEL_SIGN_IN = "__command_entry_cancel_sign_in__";

export async function runSignInCheck(input: {
  context: CommandEntryContext;
  requirement: CommandCheckRequirement;
}): Promise<CommandEntryResult> {
  if (
    hasValidCurrentSignIn(
      getCurrentCommandCheckState().signIn,
      input.context.gatewayUrl
    )
  ) {
    return {
      status: "continue",
    };
  }

  const evaluated = await evaluateCommandAuthentication({
    ...(input.context.gatewayUrl
      ? { gatewayUrl: input.context.gatewayUrl }
      : {}),
  });
  setCurrentSignInStatus(evaluated.status, input.context.gatewayUrl);

  if (evaluated.status === "valid") {
    return {
      status: "continue",
    };
  }

  const copy = getCommandEntryCopy(input.context.entryName);
  const guidance = buildSignInGuidance({
    status: evaluated.status,
    action: copy.signInAction,
    authBaseUrl: evaluated.authBaseUrl,
    gatewayUrl: input.context.gatewayUrl,
  });

  if (input.requirement.mode === "status-only") {
    emitSignInStatus({
      context: input.context,
      guidance,
      blocking: false,
      authStateReasonCode: evaluated.reasonCode,
      authStateErrorMessage: evaluated.errorMessage,
    });
    return {
      status: "continue",
    };
  }

  if (input.requirement.mode === "required") {
    return await runRequiredSignInCheck({
      context: input.context,
      action: copy.signInAction,
      guidance,
      evaluated,
    });
  }

  if (!(input.requirement.mode === "optional")) {
    return {
      status: "continue",
    };
  }

  return await runOptionalSignInCheck({
    context: input.context,
    action: copy.signInAction,
    guidance,
    evaluated,
  });
}

async function runRequiredSignInCheck(input: {
  context: CommandEntryContext;
  action: string | null;
  guidance: ReturnType<typeof resolveAuthenticationGuidance>;
  evaluated: Awaited<ReturnType<typeof evaluateCommandAuthentication>>;
}): Promise<CommandEntryResult> {
  if (input.context.jsonOutput) {
    const unavailable = input.evaluated.status === "unavailable";
    return buildBlockedEntryCheckResult({
      code: unavailable
        ? ENTRY_CHECK_BLOCKED_ERROR_CODES.signInUnavailable
        : ENTRY_CHECK_BLOCKED_ERROR_CODES.signIn,
      message: [
        input.guidance.agentErrorMessage,
        ...(unavailable && input.evaluated.errorMessage
          ? [`Diagnostic: ${input.evaluated.errorMessage}`]
          : []),
      ].join(" "),
    });
  }
  if (
    input.context.runtime.resolvedView !== "human" ||
    !input.context.allowPrompt
  ) {
    emitSignInStatus({
      context: input.context,
      guidance: input.guidance,
      blocking: true,
      authStateReasonCode: input.evaluated.reasonCode,
      authStateErrorMessage: input.evaluated.errorMessage,
    });
    return {
      status: "blocked",
      exitCode: 1,
    };
  }

  const authenticated = await ensureCommandAuthenticationOrCancel({
    runtime: input.context.runtime,
    ...(input.context.gatewayUrl
      ? { gatewayUrl: input.context.gatewayUrl }
      : {}),
    promptMessage: buildCommandAuthenticationPromptMessage(
      input.action ?? undefined
    ),
    allowPrompt: true,
    evaluated: input.evaluated,
  });
  if (!authenticated) {
    return {
      status: "cancelled",
    };
  }

  setCurrentSignInStatus("valid", input.context.gatewayUrl);
  return {
    status: "continue",
  };
}

async function runOptionalSignInCheck(input: {
  context: CommandEntryContext;
  action: string | null;
  guidance: ReturnType<typeof resolveAuthenticationGuidance>;
  evaluated: Awaited<ReturnType<typeof evaluateCommandAuthentication>>;
}): Promise<CommandEntryResult> {
  if (
    input.context.runtime.resolvedView !== "human" ||
    !input.context.allowPrompt
  ) {
    emitSignInStatus({
      context: input.context,
      guidance: input.guidance,
      blocking: false,
      authStateReasonCode: input.evaluated.reasonCode,
      authStateErrorMessage: input.evaluated.errorMessage,
    });
    return {
      status: "continue",
    };
  }

  showOptionalSignInCard({
    context: input.context,
    action: input.action,
    guidance: input.guidance,
  });
  const selected = await select({
    message: "What do you want to do?",
    options: [
      {
        value: SIGN_IN_NOW,
        label: "Sign in now",
      },
      {
        value: CONTINUE_WITHOUT_SIGN_IN,
        label: "Continue without sign in",
      },
      {
        value: CANCEL_SIGN_IN,
        label: "Cancel",
      },
    ],
  });

  if (isCancel(selected) || selected === CANCEL_SIGN_IN) {
    cancel("Cancelled.");
    return {
      status: "cancelled",
    };
  }
  if (selected === CONTINUE_WITHOUT_SIGN_IN) {
    return {
      status: "continue",
    };
  }

  return await runOptionalSignInLogin({
    context: input.context,
    action: input.action,
    evaluatedStatus: input.evaluated.status,
  });
}

function showOptionalSignInCard(input: {
  context: CommandEntryContext;
  action: string | null;
  guidance: ReturnType<typeof resolveAuthenticationGuidance>;
}): void {
  const card = buildHumanAuthenticationCard({
    guidance: input.guidance,
    mode: "prompt",
  });
  showHumanCheckCard({
    presenter: input.context.presenter,
    codePrefix: "command.entry.sign_in.optional.card",
    title: card.title,
    status: card.rows[0]?.value ?? input.guidance.statusLabel,
    why: input.action
      ? `This command needs sign-in before ${input.action}.`
      : "This command can do more after sign-in.",
    next: input.guidance.promptNextStep,
  });
}

async function runOptionalSignInLogin(input: {
  context: CommandEntryContext;
  action: string | null;
  evaluatedStatus: Awaited<
    ReturnType<typeof evaluateCommandAuthentication>
  >["status"];
}): Promise<CommandEntryResult> {
  const authUrl = resolveSignInAuthUrl({
    status: input.evaluatedStatus,
    gatewayUrl: input.context.gatewayUrl,
  });
  await runAuthLogin({
    ...(authUrl ? { authUrl } : {}),
    view: input.context.runtime.resolvedView,
  });

  const afterLogin = await evaluateCommandAuthentication({
    ...(input.context.gatewayUrl
      ? { gatewayUrl: input.context.gatewayUrl }
      : {}),
  });
  setCurrentSignInStatus(afterLogin.status, input.context.gatewayUrl);
  if (afterLogin.status === "valid") {
    return {
      status: "continue",
    };
  }

  emitSignInStatus({
    context: input.context,
    guidance: buildSignInGuidance({
      status: afterLogin.status,
      action: input.action,
      authBaseUrl: afterLogin.authBaseUrl,
      gatewayUrl: input.context.gatewayUrl,
    }),
    blocking: false,
    authStateReasonCode: afterLogin.reasonCode,
    authStateErrorMessage: afterLogin.errorMessage,
  });
  return {
    status: "continue",
  };
}

function hasValidCurrentSignIn(
  signIn: ReturnType<typeof getCurrentCommandCheckState>["signIn"],
  gatewayUrl: string | null
): boolean {
  return !!(
    signIn &&
    signIn.status === "valid" &&
    signIn.checkedGatewayUrl === gatewayUrl
  );
}

function setCurrentSignInStatus(
  status: Awaited<ReturnType<typeof evaluateCommandAuthentication>>["status"],
  gatewayUrl: string | null
): void {
  getCurrentCommandCheckState().signIn = {
    checkedGatewayUrl: gatewayUrl,
    status,
  };
}

function buildSignInGuidance(input: {
  status: Awaited<ReturnType<typeof evaluateCommandAuthentication>>["status"];
  action: string | null;
  authBaseUrl: string | null;
  gatewayUrl: string | null;
}): ReturnType<typeof resolveAuthenticationGuidance> {
  return resolveAuthenticationGuidance({
    reason:
      input.status === "mismatch"
        ? "mismatch"
        : resolveGuidanceReason(input.status),
    ...(input.action ? { action: input.action } : {}),
    ...(input.authBaseUrl ? { authBaseUrl: input.authBaseUrl } : {}),
    ...(input.gatewayUrl ? { gatewayUrl: input.gatewayUrl } : {}),
  });
}

function resolveSignInAuthUrl(input: {
  status: Awaited<ReturnType<typeof evaluateCommandAuthentication>>["status"];
  gatewayUrl: string | null;
}): string | undefined {
  if (!(input.status === "mismatch" && input.gatewayUrl)) {
    return undefined;
  }
  return deriveAuthBaseUrlFromGatewayUrl(input.gatewayUrl) ?? undefined;
}

function emitSignInStatus(input: {
  context: CommandEntryContext;
  guidance: ReturnType<typeof resolveAuthenticationGuidance>;
  blocking: boolean;
  authStateReasonCode?: Awaited<
    ReturnType<typeof evaluateCommandAuthentication>
  >["reasonCode"];
  authStateErrorMessage?: Awaited<
    ReturnType<typeof evaluateCommandAuthentication>
  >["errorMessage"];
}): void {
  if (input.context.runtime.resolvedView === "human") {
    const card = buildHumanAuthenticationCard({
      guidance: input.guidance,
      mode: input.blocking ? "error" : "prompt",
    });
    showHumanCheckCard({
      presenter: input.context.presenter,
      codePrefix: "command.entry.sign_in.card",
      title: card.title,
      status: card.rows[0]?.value ?? input.guidance.statusLabel,
      why: input.guidance.summary,
      next:
        input.blocking && input.context.allowPrompt === false
          ? input.guidance.errorNextStep
          : input.guidance.promptNextStep,
    });
    return;
  }

  const signInUnavailable = input.guidance.reason === "unavailable";
  input.context.presenter.data({
    code: input.blocking
      ? "command.entry.sign_in.blocked"
      : "command.entry.sign_in.status",
    payload: buildAgentCheckResult({
      code: signInUnavailable
        ? ENTRY_CHECK_BLOCKED_ERROR_CODES.signInUnavailable
        : ENTRY_CHECK_BLOCKED_ERROR_CODES.signIn,
      status: input.blocking ? "blocked" : "needs_attention",
      reason: input.guidance.agentErrorMessage,
      nextSteps: signInUnavailable
        ? formatOpenMeldCliCommands([
            "Retry the same command.",
            "If it still fails, run `openmeld auth status --view agent` for diagnostics.",
          ])
        : formatOpenMeldCliCommands(["openmeld login"]),
      humanActionRequired: !signInUnavailable,
      canContinueAfterFix: true,
      details: {
        guidanceReason: input.guidance.reason,
        action: input.guidance.action,
        ...(input.authStateReasonCode
          ? { authStateReasonCode: input.authStateReasonCode }
          : {}),
        ...(input.authStateErrorMessage
          ? { authStateErrorMessage: input.authStateErrorMessage }
          : {}),
        ...(input.guidance.authBaseUrl
          ? { authBaseUrl: input.guidance.authBaseUrl }
          : {}),
        ...(input.guidance.gatewayUrl
          ? { gatewayUrl: input.guidance.gatewayUrl }
          : {}),
      },
    }),
  });
}

function resolveGuidanceReason(
  status:
    | "missing"
    | "invalid"
    | "expired"
    | "revoked"
    | "unavailable"
    | "unknown"
    | "mismatch"
    | "valid"
): "required" | "expired" | "invalid" | "revoked" | "unavailable" {
  if (
    status === "expired" ||
    status === "invalid" ||
    status === "revoked" ||
    status === "unavailable"
  ) {
    return status;
  }
  return "required";
}
