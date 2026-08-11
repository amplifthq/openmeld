import { note } from "@clack/prompts";
import pc from "picocolors";
import {
  buildAuthenticationStatusLabel,
  createAuthenticationError,
  resolveAuthenticationGuidance,
} from "../auth/auth-guidance";
import {
  buildCommandAuthMismatchSummary,
  ensureCommandAuthenticationOrCancel,
  evaluateCommandAuthentication,
} from "../auth/command-auth";
import type { StoredAuthSession } from "../config/auth-session";
import { updateConfiguredStartV1OnboardingState } from "../config/runtime-config";
import { runOnboardingDisclaimerGate } from "../onboarding/disclaimer";
import { formatInlineOpenMeldCliCommands } from "../runtime/cli-entry-command";
import { createStartAuthenticationGuideError } from "../runtime/dual-view-guide-catalog";
import type { createPresenter } from "../runtime/presenter/index";
import type { RuntimeContext } from "../runtime/types";
import { collectStartLocalReadiness } from "../start-local/readiness";
import type { StartReadinessSnapshot } from "../start-local/readiness-types";
import {
  formatDaemonServiceMissingStatus,
  formatDaemonServiceOutdatedStatus,
} from "../system/local-service-install-attention";
import type { InteractivePromptStreams } from "../ui/interactive-prompt";

export type { StartReadinessSnapshot } from "../start-local/readiness-types";

type StartPresenter = ReturnType<typeof createPresenter>;

export async function runStartDisclaimerStep(input: {
  runtime: RuntimeContext;
  presenter: StartPresenter;
  interactive: boolean;
  streams?: InteractivePromptStreams;
}): Promise<boolean> {
  return await runOnboardingDisclaimerGate({
    runtime: input.runtime,
    presenter: input.presenter,
    interactive: input.interactive,
    codePrefix: "start.disclaimer",
    streams: input.streams,
  });
}

export async function markStartV1Completed(): Promise<void> {
  const now = new Date().toISOString();
  await updateConfiguredStartV1OnboardingState((current) => ({
    ...(current ?? {}),
    lastCompletedAt: now,
  }));
}

export async function ensureStartAuthentication(input: {
  runtime: RuntimeContext;
  presenter: StartPresenter;
  interactive: boolean;
  gatewayUrl: string;
}): Promise<{
  session: StoredAuthSession;
  auth: StartReadinessSnapshot["auth"];
} | null> {
  const { runtime, presenter, interactive, gatewayUrl } = input;
  const authState = await evaluateStartAuthentication({
    gatewayUrl,
  });
  if (authState.status === "valid" && authState.session) {
    return {
      session: authState.session,
      auth: buildStartReadinessAuth({
        authState,
        gatewayUrl,
      }),
    };
  }

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "start.auth.human_action_required",
      payload: {
        reason:
          authState.status === "mismatch"
            ? "authentication_environment_mismatch"
            : "authentication_required",
        nextSteps: buildStartAuthenticationNextSteps({
          gatewayUrl,
          authBaseUrl: authState.authBaseUrl,
          mismatch: authState.status === "mismatch",
        }),
      },
    });
    throw createStartAuthenticationGuideError();
  }

  const ready = await ensureCommandAuthenticationOrCancel({
    runtime,
    gatewayUrl,
    promptMessage: "Sign in is required to continue. What do you want to do?",
    allowPrompt: interactive,
    evaluated: authState,
  });
  if (!ready) {
    return null;
  }

  const afterLogin = await evaluateStartAuthentication({
    gatewayUrl,
  });
  if (afterLogin.status !== "valid" || !afterLogin.session) {
    throw createAuthenticationError({
      reason: resolveStartAuthenticationReason(afterLogin.status),
      action: "continuing setup",
      authBaseUrl: afterLogin.authBaseUrl,
      gatewayUrl,
    });
  }

  return {
    session: afterLogin.session,
    auth: buildStartReadinessAuth({
      authState: afterLogin,
      gatewayUrl,
    }),
  };
}

export async function collectStartReadinessSnapshot(input: {
  auth: StartReadinessSnapshot["auth"];
}): Promise<StartReadinessSnapshot> {
  return await collectStartLocalReadiness({
    auth: input.auth,
  });
}

export function emitStartReadinessSnapshot(input: {
  runtime: RuntimeContext;
  presenter: StartPresenter;
  readiness: StartReadinessSnapshot;
}): void {
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "start.readiness",
      payload: input.readiness,
    });
    return;
  }

  const authLine = formatStartReadinessAuthLine(input.readiness.auth);
  const skillsLine = formatStartReadinessSkillsLine(input.readiness.skills);
  const agentLines = formatStartReadinessAgentLines(input.readiness.agents);
  const serviceLine = formatStartReadinessServiceLine(input.readiness.service);
  const lines = [authLine, skillsLine, ...agentLines, serviceLine];
  note(lines.join("\n"), "Setup Check");
}

function formatReadinessToneText(
  tone: "success" | "warning" | "info",
  value: string
): string {
  if (tone === "success") {
    return pc.green(value);
  }
  if (tone === "warning") {
    return pc.yellow(value);
  }
  return pc.cyan(value);
}

function formatReadinessLine(input: {
  label: string;
  tone: "success" | "warning" | "info";
  state: string;
  detail?: string;
}): string {
  const line = `${input.label}: ${formatReadinessToneText(input.tone, input.state)}`;
  if (!input.detail) {
    return line;
  }
  return `${line} ${pc.dim(input.detail)}`;
}

function evaluateStartAuthentication(input: { gatewayUrl: string }) {
  return evaluateCommandAuthentication({
    gatewayUrl: input.gatewayUrl,
  });
}

function buildStartReadinessAuth(input: {
  authState: Awaited<ReturnType<typeof evaluateStartAuthentication>>;
  gatewayUrl: string;
}): StartReadinessSnapshot["auth"] {
  return {
    status: input.authState.status,
    email: input.authState.email,
    authBaseUrl: input.authState.authBaseUrl,
    gatewayUrl: input.gatewayUrl,
  };
}

function formatStartReadinessAuthLine(
  auth: StartReadinessSnapshot["auth"]
): string {
  if (auth.status === "valid") {
    if (auth.email) {
      return formatReadinessLine({
        label: "Sign-in",
        tone: "success",
        state: "Signed in",
        detail: `(${auth.email})`,
      });
    }
    return formatReadinessLine({
      label: "Sign-in",
      tone: "success",
      state: "Signed in",
    });
  }
  if (auth.status === "mismatch") {
    return formatReadinessLine({
      label: "Sign-in",
      tone: "warning",
      state: buildCommandAuthMismatchSummary({
        gatewayUrl: auth.gatewayUrl,
        authBaseUrl: auth.authBaseUrl,
      }),
    });
  }
  const reason = resolveStartAuthenticationReason(auth.status);
  if (reason !== "mismatch") {
    const guidance = resolveAuthenticationGuidance({
      reason,
      gatewayUrl: auth.gatewayUrl,
      authBaseUrl: auth.authBaseUrl,
    });
    return formatReadinessLine({
      label: "Sign-in",
      tone: "warning",
      state: buildAuthenticationStatusLabel(reason),
      detail: guidance.errorNextStep,
    });
  }
  return formatReadinessLine({
    label: "Sign-in",
    tone: "warning",
    state: "Couldn't check right now.",
  });
}

function resolveStartAuthenticationReason(
  status: Awaited<ReturnType<typeof evaluateStartAuthentication>>["status"]
): "required" | "expired" | "invalid" | "revoked" | "mismatch" {
  if (status === "mismatch") {
    return status;
  }
  if (status === "expired" || status === "invalid" || status === "revoked") {
    return status;
  }
  return "required";
}

function formatStartReadinessSkillsLine(
  skills: StartReadinessSnapshot["skills"]
): string {
  if (skills.status === "up_to_date") {
    return formatReadinessLine({
      label: "Skills Setup",
      tone: "success",
      state: "Up to date.",
    });
  }
  if (skills.status === "no_targets") {
    return formatReadinessLine({
      label: "Skills Setup",
      tone: "info",
      state: "No local targets detected.",
    });
  }
  if (skills.status === "action_required") {
    return formatReadinessLine({
      label: "Skills Setup",
      tone: "warning",
      state: "Needs attention",
      detail: `(${skills.summary.outdated} outdated, ${skills.summary.missing} missing).`,
    });
  }
  return formatReadinessLine({
    label: "Skills Setup",
    tone: "warning",
    state: "Couldn't check right now.",
  });
}

function formatStartReadinessAgentLines(
  agents: StartReadinessSnapshot["agents"]
): string[] {
  if (agents.status !== "ok") {
    return [
      formatReadinessLine({
        label: "Agents",
        tone: "warning",
        state: "Couldn't check right now.",
      }),
    ];
  }
  if (agents.totalBuiltins === 0) {
    return [
      formatReadinessLine({
        label: "Agents",
        tone: "info",
        state: "No built-in agents found on this computer yet.",
      }),
    ];
  }
  const needsChoice = agents.needsChoice ?? 0;
  const needsRepair = agents.needsRepair ?? 0;
  const detectedTotal =
    agents.detectedSupported +
    needsChoice +
    needsRepair +
    agents.detectedNotSupportedYet;
  return [
    [
      `Agents: ${detectedTotal} found`,
      pc.dim("·"),
      formatReadinessToneText(
        "success",
        `${agents.detectedSupported} available to use`
      ),
      pc.dim(
        `· ${needsChoice} need your choice · ${needsRepair} need repair · ${agents.detectedNotSupportedYet} coming soon · ${agents.notDetected} not found.`
      ),
    ].join(" "),
  ];
}

function formatStartReadinessServiceLine(
  service: StartReadinessSnapshot["service"]
): string {
  if (service.status === "installed_current") {
    if (service.runtime?.status === "running") {
      return formatReadinessLine({
        label: "OpenMeld Service Runtime",
        tone: "success",
        state: "Connected",
        detail: `(v${service.expectedVersion}) · running in ${service.runtime.mode ?? "unknown"} mode.`,
      });
    }
    if (service.runtime?.status === "stale") {
      return formatReadinessLine({
        label: "OpenMeld Service Runtime",
        tone: "warning",
        state: `Installed (v${service.expectedVersion}), but runtime status is stale.`,
      });
    }
    if (service.runtime?.status === "not_running") {
      return formatReadinessLine({
        label: "OpenMeld Service Runtime",
        tone: "warning",
        state: `Installed (v${service.expectedVersion}) but not running.`,
      });
    }
    return formatReadinessLine({
      label: "OpenMeld Service Runtime",
      tone: "warning",
      state: `Installed and up to date (v${service.expectedVersion}), runtime unknown.`,
    });
  }
  if (service.status === "installed_outdated") {
    return formatReadinessLine({
      label: "OpenMeld Service Runtime",
      tone: "warning",
      state: formatDaemonServiceOutdatedStatus({
        installedVersion: service.installedVersion ?? undefined,
        expectedVersion: service.expectedVersion,
      }),
    });
  }
  if (service.status === "not_installed") {
    return formatReadinessLine({
      label: "OpenMeld Service Runtime",
      tone: "warning",
      state: formatDaemonServiceMissingStatus(),
    });
  }
  return formatReadinessLine({
    label: "OpenMeld Service Runtime",
    tone: "warning",
    state: "Couldn't check right now.",
  });
}

function buildStartAuthenticationNextSteps(input: {
  gatewayUrl: string;
  authBaseUrl: string | null;
  mismatch: boolean;
}): string[] {
  if (!input.mismatch) {
    return [
      "Run `openmeld login` in an interactive terminal.",
      "After sign-in succeeds, rerun `openmeld start`.",
    ].map((line) => formatInlineOpenMeldCliCommands(line));
  }

  return [
    formatInlineOpenMeldCliCommands(
      "Run `openmeld login` in an interactive terminal for this OpenMeld environment."
    ),
    `Gateway: ${input.gatewayUrl}`,
    ...(input.authBaseUrl ? [`Signed in to: ${input.authBaseUrl}`] : []),
    formatInlineOpenMeldCliCommands(
      "After sign-in succeeds, rerun `openmeld start`."
    ),
  ];
}
