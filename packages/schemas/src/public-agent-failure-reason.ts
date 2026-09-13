import * as z from "zod/v4";
import {
  type AgentRecoveryActionId,
  formatAgentRecoveryActionLabel,
} from "./agent-recovery-action";
import { RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE } from "./runtime-coordinator-reason-code";

export const PROJECT_LOCAL_CONNECTION_FAILURE_REASON_CODES = [
  "project.local_connection.missing",
  "project.local_connection.folder_missing",
  "project.local_connection.invalid",
] as const;

export const projectLocalConnectionFailureReasonCodeSchema = z.enum(
  PROJECT_LOCAL_CONNECTION_FAILURE_REASON_CODES
);

export type ProjectLocalConnectionFailureReasonCode =
  (typeof PROJECT_LOCAL_CONNECTION_FAILURE_REASON_CODES)[number];

export const CODEX_UPGRADE_REQUIRED_REASON =
  "Codex on this computer can't use the selected model. Update Codex or choose another Codex installation, then try again.";
export const CENTER_AGENT_REQUEST_FAILED_PUBLIC_COPY =
  "OpenMeld ran into a problem, so Center Agent couldn't finish your request. You didn't do anything wrong. Try again. If it still doesn't work, open Diagnostics in OpenMeld. If you can't open OpenMeld, ask the person who set it up for your team.";
export const CENTER_AGENT_EMPTY_REPLY_PUBLIC_COPY =
  "Center Agent couldn't generate a reply. Your message is saved.";
export const CENTER_AGENT_REQUEST_START_FAILED_PUBLIC_COPY =
  "Center Agent couldn't start this request. Try again. If it keeps happening, open diagnostics in OpenMeld.";
export const CENTER_AGENT_SOURCE_MESSAGE_MISSING_PUBLIC_COPY =
  "OpenMeld couldn't find the message that started this request, so Center Agent did not run. Send the request again.";
export const CENTER_AGENT_TEMPORARILY_UNAVAILABLE_PUBLIC_COPY =
  "Center Agent isn't available right now. Try again in a moment.";
export const CENTER_AGENT_ORGANIZATION_UNAVAILABLE_PUBLIC_COPY =
  "Center Agent is currently turned off for this Organization. Contact OpenMeld support. You can open diagnostics in OpenMeld to share more details.";
export const CENTER_AGENT_CONTEXT_WINDOW_EXCEEDED_PUBLIC_COPY =
  "This conversation has grown too long for Center Agent to continue in one request. Try again; OpenMeld will shorten older messages before continuing.";
export const CENTER_AGENT_REQUEST_STOPPED_PUBLIC_COPY =
  "This request was stopped.";
export const CENTER_AGENT_EXECUTION_IDENTITY_MISMATCH_PUBLIC_COPY =
  "OpenMeld stopped this request because it could not confirm that the reply came from your Center Agent. Send the request again. If it keeps happening, open diagnostics in OpenMeld.";
export const CENTER_AGENT_REPLY_PUBLICATION_FAILED_PUBLIC_COPY =
  "Center Agent finished your request, but OpenMeld could not show the reply here. Try again. If it keeps happening, open diagnostics in OpenMeld.";
export const CENTER_AGENT_TURN_TIMEOUT_PUBLIC_COPY =
  "Center Agent took too long to finish this request. Try again. If it keeps happening, open diagnostics in OpenMeld.";
export const REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE =
  "remote_agent.tool_result_too_large";
export const REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_PUBLIC_COPY =
  "Center Agent tried to process too much data at once. Try again; it will read large files in smaller sections. If this keeps happening, open diagnostics.";
export const REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE =
  "remote_agent.conversation_history_limit_exceeded";
export const REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_PUBLIC_COPY =
  "Center Agent could not continue this conversation automatically. Try again or open diagnostics.";
export const REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_REASON_CODE =
  "remote_agent.work_loop_continuation_limit_exceeded";
export const REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_PUBLIC_COPY =
  "Center Agent kept working but could not finish this request within the safe execution limit. Try again or open diagnostics.";
const EXACT_PATTERN_PREFIX = "=";
const RUNTIME_PERMISSION_DENIAL_PUBLIC_COPY =
  "The requested action was blocked by the Agent Profile’s permission settings. Review its permissions and choose a less restrictive mode only if you trust the access it grants, then wake the agent again.";
const PROVIDER_UNAVAILABLE_PUBLIC_COPY =
  "The selected model is not responding right now. Switch this agent to another model or try again later.";
const CURSOR_MODEL_INVENTORY_UNAVAILABLE_PUBLIC_COPY =
  "Cursor couldn't confirm which models are available right now. Try waking the agent again.";
const UNSUPPORTED_MODEL_PUBLIC_COPY =
  "The selected model is no longer available for this account. Choose another model in the Agent Profile, then try again.";
const UNSUPPORTED_REASONING_PUBLIC_COPY =
  "The selected model does not support that reasoning setting. Choose an offered model and reasoning setting, then wake the agent again.";
const INTERACTION_PERMISSION_REQUIRED_PUBLIC_COPY =
  "The local agent asked for permission before it could continue. OpenMeld cannot collect that permission response yet. Review the Agent Profile’s permission mode, then wake the agent again.";
const INTERACTION_QUESTION_REQUIRED_PUBLIC_COPY =
  "The local agent asked a question before it could continue. OpenMeld cannot collect that answer yet. Run the task directly in the local agent, or adjust the prompt so it can finish without asking, then wake it again.";
const INTERACTION_PLAN_REQUIRED_PUBLIC_COPY =
  "The local agent asked for plan approval before it could continue. OpenMeld cannot collect that approval yet. Run the task directly in the local agent, or use a mode that does not require plan approval, then wake it again.";
const INTERACTION_UNSUPPORTED_PUBLIC_COPY =
  "The local agent requested an interactive response that OpenMeld does not support yet. Run the task directly in the local agent, resolve the request there, then wake it again.";
const HTML_ERROR_BODY_RE = /^\s*</;

export const DISPATCH_ERROR_SUMMARY_MAX_LENGTH = 512;

export function resolveCenterAgentCallbackFailureMessage(input: {
  failureCode: string;
  failureMessage: string;
}): string {
  switch (input.failureCode) {
    case "remote_agent.empty_assistant_response":
      return CENTER_AGENT_EMPTY_REPLY_PUBLIC_COPY;
    case "remote_agent.execution_cancelled":
      return CENTER_AGENT_REQUEST_STOPPED_PUBLIC_COPY;
    case "remote_agent.turn.context_window_exceeded":
      return CENTER_AGENT_CONTEXT_WINDOW_EXCEEDED_PUBLIC_COPY;
    case "remote_agent.execution_identity_mismatch":
      return CENTER_AGENT_EXECUTION_IDENTITY_MISMATCH_PUBLIC_COPY;
    case "remote_agent.callback_publish_failed":
      return CENTER_AGENT_REPLY_PUBLICATION_FAILED_PUBLIC_COPY;
    case "remote_agent.provider.authentication_failed":
    case "remote_agent.provider.rate_limited":
    case "remote_agent.provider.unavailable":
      return (
        resolveMappedPublicAgentFailureReason(
          input.failureCode,
          "Center Agent"
        ) ?? CENTER_AGENT_REQUEST_FAILED_PUBLIC_COPY
      );
    case "remote_agent.turn.timeout":
      return CENTER_AGENT_TURN_TIMEOUT_PUBLIC_COPY;
    case REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE:
      return REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_PUBLIC_COPY;
    case REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE:
      return REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_PUBLIC_COPY;
    case REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_REASON_CODE:
      return REMOTE_AGENT_WORK_LOOP_CONTINUATION_LIMIT_PUBLIC_COPY;
    case "remote_agent.turn_not_completed":
      return CENTER_AGENT_REQUEST_FAILED_PUBLIC_COPY;
    default:
      return CENTER_AGENT_REQUEST_FAILED_PUBLIC_COPY;
  }
}

const DISPATCH_ERROR_REDACTION_REPLACEMENTS: readonly [RegExp, string][] = [
  [/\b(authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi, "$1[redacted]"],
  [/\b((?:set-cookie|cookie)\s*:\s*)[^\r\n]+/gi, "$1[redacted]"],
  [
    /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*[:=]\s*["']?)[^"',;\s}]+/gi,
    "$1[redacted]",
  ],
  [/\bopenMeldDaemon_[A-Za-z0-9._~:/+=-]+/g, "[redacted]"],
  [/\b[A-Fa-f0-9]{40,}\b/g, "[redacted]"],
  [/\b[A-Za-z0-9+/]{40,}={0,2}/g, "[redacted]"],
];

const PUBLIC_FAILURE_CODE_CATEGORY_BY_PREFIX: ReadonlyArray<{
  category: string;
  prefixes: readonly string[];
}> = [
  {
    category: "the local agent needs an interaction",
    prefixes: ["interaction."],
  },
  {
    category: "the runtime rejected the request",
    prefixes: ["runtime."],
  },
  {
    category: "the account needs re-authentication",
    prefixes: ["auth.", "credential.", "login."],
  },
  {
    category: "the model provider had an issue",
    prefixes: [
      "cursor.plan_",
      "provider.",
      "provider_account.",
      "model.",
      "upstream_unreachable",
      "provider_unreachable",
      "provider_exit_error",
    ],
  },
  {
    category: "the computer connection had an issue",
    prefixes: [
      "daemon.",
      "service.",
      "local_service.",
      "route.",
      "background_helper.",
      "controller.",
    ],
  },
  {
    category: "OpenMeld could not route this Wake",
    prefixes: [
      "claim_eligibility.",
      "dispatch.",
      "runtime_coordinator.",
      "agent_profile_binding.",
    ],
  },
  {
    category: "the reply could not be formatted",
    prefixes: ["openmeld.space_action.", "workspace."],
  },
];

export function resolvePublicFailureCodeCategory(errorCode: string): string {
  const normalized = errorCode.toLowerCase();
  const match = PUBLIC_FAILURE_CODE_CATEGORY_BY_PREFIX.find((entry) =>
    entry.prefixes.some((prefix) => normalized.startsWith(prefix))
  );
  return match?.category ?? "the agent hit an unclassified error";
}

function normalizeDispatchErrorSummaryPart(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  let normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  for (const [pattern, replacement] of DISPATCH_ERROR_REDACTION_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function truncateDispatchErrorSummary(value: string): string {
  if (value.length <= DISPATCH_ERROR_SUMMARY_MAX_LENGTH) {
    return value;
  }
  return `${value.slice(0, DISPATCH_ERROR_SUMMARY_MAX_LENGTH - 1).trimEnd()}…`;
}

export function sanitizeDispatchErrorSummary(
  errorMessage: string | null | undefined
): string | null {
  const normalizedInput = normalizeDispatchErrorSummaryPart(errorMessage);
  if (!normalizedInput) {
    return null;
  }

  try {
    const parsed = JSON.parse(errorMessage ?? "") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const root = parsed as Record<string, unknown>;
      const nested =
        root.error &&
        typeof root.error === "object" &&
        !Array.isArray(root.error)
          ? (root.error as Record<string, unknown>)
          : root;
      const code = normalizeDispatchErrorSummaryPart(nested.code);
      const type = normalizeDispatchErrorSummaryPart(nested.type);
      const message =
        normalizeDispatchErrorSummaryPart(nested.message) ??
        normalizeDispatchErrorSummaryPart(nested.detail) ??
        normalizeDispatchErrorSummaryPart(root.detail);
      let classification = type;
      if (code) {
        classification = type && type !== code ? `${code} (${type})` : code;
      }
      const summary = [classification, message].filter(Boolean).join(": ");
      if (summary) {
        return truncateDispatchErrorSummary(summary);
      }
      return "The provider request failed; see operator logs for details.";
    }
  } catch {
    // Plain error messages are normalized and redacted below.
  }

  if (HTML_ERROR_BODY_RE.test(errorMessage ?? "")) {
    return "The provider request failed; see operator logs for details.";
  }
  return truncateDispatchErrorSummary(normalizedInput);
}

export type PublicAgentFailureRecoveryKind =
  | "account_access"
  | "local_agent_connection"
  | "local_agent_prepare"
  | "local_service"
  | "system_retry"
  | "request_ended"
  | "unknown";

export type PublicAgentFailureRecoveryTarget =
  | "agents"
  | "computer"
  | "cursor_account"
  | "prepare_setup";

export type PublicAgentAvailabilityCopyContext = {
  agentControllerId?: string | null;
};

export type PublicAgentAvailabilityCopy = {
  availabilityBadgeLabel?: string;
  availabilitySummary?: string;
  availabilityTooltip?: string;
  controllerInterfaceDescription?: string;
  controllerInterfaceDescriptionFallback?: string;
  manualOnlyAgentDetail?: string;
};

export type PublicAgentFailureRecovery =
  | {
      body: string;
      kind: Exclude<
        PublicAgentFailureRecoveryKind,
        "system_retry" | "request_ended"
      >;
      primaryActionId: AgentRecoveryActionId;
      primaryActionLabel: string;
      recoveryTarget: PublicAgentFailureRecoveryTarget;
    }
  | {
      body: string;
      kind: "system_retry" | "request_ended" | "unknown";
      recoveryTarget: null;
    };

type PublicAgentFailureRecoveryMappingBase = {
  availabilityBadgeLabel?: PublicAgentAvailabilityCopyValue;
  availabilitySummary?: PublicAgentAvailabilityCopyValue;
  availabilityTooltip?: PublicAgentAvailabilityCopyValue;
  body: string | ((targetName: string) => string);
  controllerInterfaceDescription?: PublicAgentAvailabilityCopyValue;
  controllerInterfaceDescriptionFallback?: PublicAgentAvailabilityCopyValue;
  manualOnlyAgentDetail?: PublicAgentAvailabilityCopyValue;
  mappedReasonBody?: string | ((targetName: string) => string);
  patterns: readonly string[];
  preferMappedReasonDetailPatterns?: readonly string[];
  preferMappedReasonOverDetail?: boolean;
};

type PublicAgentAvailabilityCopyValue =
  | string
  | ((context: PublicAgentAvailabilityCopyContext) => string | undefined);

const CONTROLLER_SIGN_IN_AVAILABILITY_COPY_BY_ID: Readonly<
  Record<
    string,
    {
      controllerInterfaceDescription?: string;
      summary: string;
      tooltip: string;
    }
  >
> = {
  "claude-code": {
    summary:
      "Run claude in a terminal on this computer, then sign in to Claude Code.",
    tooltip:
      "Claude Code is not signed in. Run claude in a terminal on this computer.",
  },
  codex: {
    controllerInterfaceDescription:
      "Codex CLI is installed, but this computer is not signed in to Codex.",
    summary:
      "Run codex login in a terminal on this computer to sign in to Codex.",
    tooltip:
      "Codex is not signed in. Run codex login in a terminal on this computer.",
  },
  cursor: {
    controllerInterfaceDescription:
      "Cursor CLI is installed, but this computer is not signed in to Cursor CLI.",
    summary:
      "Run cursor-agent login in a terminal on this computer to sign in to Cursor CLI.",
    tooltip:
      "Cursor CLI is not signed in. Run cursor-agent login in a terminal on this computer.",
  },
  "grok-build": {
    controllerInterfaceDescription:
      "Grok Build is installed, but this computer is not signed in to Grok.",
    summary:
      "Run grok login in a terminal on this computer to sign in to Grok.",
    tooltip:
      "Grok Build is not signed in. Run grok login in a terminal on this computer.",
  },
  openclaw: {
    summary: "Check the model provider sign-in in OpenClaw on this computer.",
    tooltip:
      "OpenClaw's model provider sign-in needs attention on this computer.",
  },
  opencode: {
    summary:
      "Run opencode auth login in a terminal on this computer to sign in to OpenCode.",
    tooltip:
      "OpenCode is not signed in. Run opencode auth login in a terminal on this computer.",
  },
};

const DEFAULT_CONTROLLER_SIGN_IN_AVAILABILITY_COPY = {
  summary: "Sign in to this local agent from a terminal on this computer.",
  tooltip: "This local agent is not signed in on this computer.",
} as const;

type PublicAgentFailureRecoveryMapping =
  | (PublicAgentFailureRecoveryMappingBase & {
      kind: Exclude<
        PublicAgentFailureRecoveryKind,
        "system_retry" | "request_ended"
      >;
      primaryActionId: AgentRecoveryActionId;
      recoveryTarget: PublicAgentFailureRecoveryTarget;
    })
  | (PublicAgentFailureRecoveryMappingBase & {
      kind: "system_retry" | "request_ended";
      recoveryTarget: null;
    });

type PublicAgentAvailabilityOnlyMapping = Omit<
  PublicAgentFailureRecoveryMappingBase,
  "body" | "mappedReasonBody"
> & {
  availabilitySummary: PublicAgentAvailabilityCopyValue;
};

const PUBLIC_AGENT_AVAILABILITY_ONLY_COPY_BY_CODE: readonly PublicAgentAvailabilityOnlyMapping[] =
  [
    {
      availabilityBadgeLabel: "Removed",
      availabilitySummary: "This agent profile no longer exists.",
      availabilityTooltip: "Agent profile deleted",
      patterns: ["=agent_profile.not_found"],
    },
    {
      availabilityBadgeLabel: "Disconnected",
      availabilitySummary:
        "Connect the Center Agent before waking it from this Space.",
      availabilityTooltip: "Disconnected",
      patterns: [
        "=center_agent.designation_required",
        "=center_agent.designation_lookup_failed",
        "=center_agent.designation_store_unavailable",
      ],
    },
    {
      availabilityBadgeLabel: "Available",
      availabilitySummary: "This Agent can answer now.",
      availabilityTooltip: "Agent available",
      patterns: ["=remote_agent.available"],
    },
    {
      availabilityBadgeLabel: "Resting",
      availabilitySummary:
        "Center Agent is resting until the next budget window.",
      availabilityTooltip: "Center Agent resting",
      patterns: ["=remote_agent.budget_resting"],
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "Center Agent cannot answer right now.",
      availabilityTooltip: "Center Agent unavailable",
      patterns: ["remote_agent."],
    },
    {
      availabilityBadgeLabel: "Available",
      availabilitySummary: "Available for Wake",
      availabilityTooltip: "Available for Wake",
      patterns: ["=agent_execution.ready"],
    },
    {
      availabilityBadgeLabel: "Checking",
      availabilitySummary: "Checking this agent's Wake availability.",
      availabilityTooltip: "Checking Wake availability",
      patterns: ["=agent_execution.check_status"],
    },
    {
      availabilityBadgeLabel: "Checking",
      availabilitySummary:
        "OpenMeld couldn't check this local agent. It will try again.",
      availabilityTooltip: "Local agent check unavailable",
      patterns: ["=controller.interface.check_failed"],
    },
    {
      availabilityBadgeLabel: "Checking",
      availabilitySummary: "Checking computer connection.",
      availabilityTooltip: "Checking computer connection",
      patterns: ["=local_service.not_checked", "=service.not_checked"],
    },
    {
      availabilityBadgeLabel: "Checking",
      availabilitySummary: "Checking this agent's Wake route.",
      availabilityTooltip: "Checking Wake route",
      patterns: ["=wake_route.registration_pending"],
    },
    {
      availabilityBadgeLabel: "Connect",
      availabilitySummary:
        "Connect a local agent before this profile can reply.",
      availabilityTooltip: "Connect local agent",
      patterns: ["=wake_route.registration_skipped"],
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary:
        "Resolve this agent's Wake route before it can reply.",
      availabilityTooltip: "Wake route unavailable",
      patterns: ["=wake_route.registration_rejected"],
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "OpenMeld couldn't check this agent's connection.",
      availabilityTooltip: "Connection check unavailable",
      patterns: ["=wake_route.registration_unavailable"],
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary: "This Agent's computer is offline.",
      availabilityTooltip: "Agent computer is offline",
      patterns: ["=wake_route.registration_expired"],
    },
  ];

const buildMalformedSpaceReplyCopy = (targetName: string): string =>
  `${targetName} answered in its local conversation, but it did not tell OpenMeld whether to post a message or stay silent, so nothing was posted.`;

const buildEmptyAgentReplyCopy = (targetName: string): string =>
  `${targetName} finished without returning any text, so OpenMeld had nothing to post. Wake ${formatObjectTargetName(targetName)} again. If this keeps happening, open diagnostics.`;

const buildMissingAgentReplyIdentityCopy = (targetName: string): string =>
  `OpenMeld received a result from ${formatObjectTargetName(targetName)}, but the result did not identify which local agent produced it. To avoid posting under the wrong agent, OpenMeld did not publish it. Open diagnostics to inspect the local agent connection.`;

const PUBLIC_FAILURE_RECOVERY_BY_CODE: readonly PublicAgentFailureRecoveryMapping[] =
  [
    {
      body: (targetName) => {
        const subject = targetName === "This agent" ? "The agent" : targetName;
        const wakeTarget =
          targetName === "This agent" ? "the agent" : targetName;
        return `${subject} finished, but OpenMeld couldn't post its reply. Wake ${wakeTarget} again. If this keeps happening, open diagnostics.`;
      },
      kind: "system_retry",
      patterns: ["=runtime_coordinator.publication_retry_exhausted"],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `${targetName} couldn’t start because its Project isn’t connected on the computer that runs it. Connect that Project on the Agent’s computer, then try again.`,
      kind: "local_agent_prepare",
      patterns: ["=project.local_connection.missing"],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      body: (targetName) =>
        `${targetName} couldn’t start because its Project folder is no longer available on the computer that runs it. Reconnect the folder in Projects, then try again.`,
      kind: "local_agent_prepare",
      patterns: ["=project.local_connection.folder_missing"],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      body: "OpenMeld ran into a system problem before this Wake could run. Try again. If it keeps happening, open diagnostics.",
      kind: "system_retry",
      patterns: [
        "=dispatch.storage.schema_missing",
        "dispatch.storage_not_ready",
        "dispatch.storage_unavailable",
      ],
      recoveryTarget: null,
    },
    {
      body: REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_PUBLIC_COPY,
      kind: "system_retry",
      patterns: [`=${REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE}`],
      recoveryTarget: null,
    },
    {
      body: REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_PUBLIC_COPY,
      kind: "system_retry",
      patterns: [
        `=${REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE}`,
      ],
      recoveryTarget: null,
    },
    {
      availabilityBadgeLabel: "Sign-in needed",
      availabilitySummary: (context) =>
        resolveControllerSignInAvailabilityCopy(context).summary,
      availabilityTooltip: (context) =>
        resolveControllerSignInAvailabilityCopy(context).tooltip,
      body: (targetName) =>
        `${targetName}'s local provider login expired on its computer. Re-authenticate the local agent there (its own CLI, not OpenMeld), then check its status here.`,
      controllerInterfaceDescription: (context) =>
        resolveControllerSignInAvailabilityCopy(context)
          .controllerInterfaceDescription,
      controllerInterfaceDescriptionFallback:
        "Installed, but this controller is not signed in.",
      kind: "local_service",
      mappedReasonBody:
        "The model provider rejected this request because the local provider login expired. Re-authenticate the local agent on its computer, then wake the agent again.",
      patterns: [
        "=controller.auth.unauthenticated",
        "auth.",
        "auth.required",
        "credential.",
        "login.",
      ],
      primaryActionId: "reconnect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      body: (targetName) =>
        `${targetName}'s selected model is not available for this agent's account. Switch it to a different model, then wake the agent again.`,
      kind: "account_access",
      mappedReasonBody: UNSUPPORTED_MODEL_PUBLIC_COPY,
      patterns: ["model.unsupported", "unsupported_model"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: RUNTIME_PERMISSION_DENIAL_PUBLIC_COPY,
      kind: "account_access",
      mappedReasonBody: RUNTIME_PERMISSION_DENIAL_PUBLIC_COPY,
      patterns: ["permission.denied.runtime"],
      primaryActionId: "review_agent_permissions",
      recoveryTarget: "agents",
    },
    {
      body: (targetName) =>
        `${targetName} stopped this Wake because the current Cursor plan has reached its usage limit. Upgrade the Cursor plan, then wake ${targetName} again.`,
      kind: "account_access",
      mappedReasonBody: (targetName) =>
        `${targetName} stopped this Wake because the current Cursor plan has reached its usage limit. Upgrade the Cursor plan, then wake ${targetName} again.`,
      patterns: ["=cursor.plan_upgrade_required"],
      primaryActionId: "manage_cursor_plan",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "cursor_account",
    },
    {
      body: (targetName) =>
        `${targetName} reached a current Usage Limit and cannot start new work. Review Usage Limits before waking it again.`,
      kind: "account_access",
      mappedReasonBody: (targetName) =>
        `${targetName} reached a current Usage Limit and cannot start new work. Review Usage Limits before waking it again.`,
      patterns: ["=usage_exhausted"],
      primaryActionId: "review_agent_settings",
      preferMappedReasonOverDetail: true,
      recoveryTarget: "agents",
    },
    {
      body: (targetName) =>
        `OpenMeld is still checking ${targetName}'s current Usage. Wait a moment, then wake ${targetName} again.`,
      kind: "system_retry",
      mappedReasonBody:
        "OpenMeld is still checking this agent's current Usage. Wait a moment, then wake it again.",
      patterns: ["=usage_checking"],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `${targetName}'s model provider account does not have enough credits for this Wake. Add credits or update billing directly with the provider, then wake the agent again.`,
      kind: "system_retry",
      mappedReasonBody:
        "The model provider rejected this request because the provider account does not have enough credits. Add credits or update billing directly with the provider, then wake the agent again.",
      patterns: [
        "provider.insufficient_balance",
        "quota.exceeded",
        "insufficient_quota",
      ],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `${targetName} hit a provider rate limit before this Wake could reply. Wait a moment, then wake the agent again.`,
      kind: "system_retry",
      mappedReasonBody:
        "The model provider rate-limited this request. Wait a moment, then wake the agent again.",
      patterns: [
        "provider.rate_limited",
        "provider.rate_limit",
        "rate_limited",
        "rate_limit",
      ],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `${targetName}'s provider subscription does not include the access this agent needs. Review the provider plan or account on its computer before waking it again.`,
      kind: "account_access",
      mappedReasonBody: (targetName) =>
        `${targetName}'s provider subscription does not include the access this agent needs. Review the provider plan or account on its computer before waking it again.`,
      patterns: ["provider.subscription_access_unavailable"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: (targetName) =>
        `${targetName}'s selected model is not responding right now. Switch this agent to another model or try again later.`,
      kind: "account_access",
      mappedReasonBody: PROVIDER_UNAVAILABLE_PUBLIC_COPY,
      patterns: [
        "provider.unavailable",
        "provider.bad_gateway",
        "model.provider_unavailable",
      ],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "Fix provider access before this agent can reply.",
      availabilityTooltip: "Provider access needed",
      body: (targetName) =>
        `${targetName} is connected, but its provider subscription does not include the access this agent needs. Review the provider plan or account on its computer before waking it again.`,
      kind: "account_access",
      patterns: ["=provider_account.subscription_access_unavailable"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "Fix provider access before this agent can reply.",
      availabilityTooltip: "Provider access needed",
      body: (targetName) =>
        `${targetName} is connected, but its organization has disabled the provider access this agent needs. Ask the provider account admin to enable access before waking it again.`,
      kind: "account_access",
      patterns: ["=provider_account.organization_access_disabled"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "Review the provider plan, billing, or credits.",
      availabilityTooltip: "Provider quota exhausted",
      body: (targetName) =>
        `${targetName} is connected, but its provider quota or credit balance is exhausted. Review the provider plan, billing, or credits before waking it again.`,
      kind: "account_access",
      patterns: ["=provider_account.capacity_exhausted"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "Fix provider access before this agent can reply.",
      availabilityTooltip: "Provider access needed",
      body: (targetName) =>
        `${targetName}'s provider account needs attention on its computer. Fix access with the provider there, then check its status here.`,
      kind: "account_access",
      patterns: ["provider_account."],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary:
        "This agent shares a reply conversation with another Agent Profile.",
      availabilityTooltip: "Duplicate reply conversation",
      body: (targetName) =>
        `${targetName} shares a reply conversation with another Agent Profile. Review agent settings and choose one Agent Profile to keep this reply conversation.`,
      kind: "local_agent_connection",
      patterns: ["=agent_profile_binding.controller_conversation_conflict"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary:
        "This agent cannot reply from this computer right now.",
      availabilityTooltip: "Unavailable for Wake",
      body: (targetName) =>
        `${targetName} is connected to a different OpenMeld account. Sign in with the correct OpenMeld account, then run setup again.`,
      kind: "system_retry",
      patterns: [
        "agent_profile_binding.owner_mismatch",
        "claim_eligibility.binding_owner_mismatch",
        "claim_eligibility.owner_mismatch",
        "dispatch.claim_eligibility.binding.owner_mismatch",
      ],
      recoveryTarget: null,
    },
    {
      availabilityBadgeLabel: "Workspace unavailable",
      availabilitySummary:
        "OpenMeld could not verify this Agent Profile's workspace.",
      availabilityTooltip:
        "OpenMeld could not verify this Agent Profile's workspace",
      body: (targetName) =>
        `OpenMeld could not verify ${targetName}'s workspace. Try again, and open diagnostics if the problem continues.`,
      kind: "system_retry",
      patterns: [
        "=organization_binding_authorization.lookup_failed",
        "=organization_binding_authorization.preference_unavailable",
        "=organization_binding_authorization.space_org_unavailable",
      ],
      recoveryTarget: null,
    },
    {
      availabilityBadgeLabel: "Wrong workspace",
      availabilitySummary:
        "This Agent Profile belongs to a different workspace.",
      availabilityTooltip: "This Agent Profile belongs to another workspace",
      body: (targetName) =>
        `${targetName} belongs to a different workspace. Choose an Agent Profile created in this workspace.`,
      kind: "system_retry",
      patterns: ["=agent_profile.organization_mismatch"],
      recoveryTarget: null,
    },
    {
      availabilityBadgeLabel: "Workspace unavailable",
      availabilitySummary:
        "OpenMeld could not verify this Agent Profile's workspace.",
      availabilityTooltip:
        "OpenMeld could not verify this Agent Profile's workspace",
      body: (targetName) =>
        `OpenMeld could not verify ${targetName}'s workspace. Try again, and open diagnostics if the problem continues.`,
      kind: "system_retry",
      patterns: [
        "=agent_profile.organization_context_missing",
        "=agent_profile.organization_lookup_failed",
        "=agent_profile.space_organization_unavailable",
      ],
      recoveryTarget: null,
    },
    {
      availabilityBadgeLabel: "Wrong workspace",
      availabilitySummary:
        "This Agent Profile cannot be used in this workspace.",
      availabilityTooltip: "This Agent Profile cannot be used here",
      // Old Core deployments can still emit this family during a rolling
      // upgrade. Keep it safe and non-actionable without reviving the retired
      // authorization product surface.
      body: (targetName) =>
        `${targetName} cannot be used in this workspace. Choose an Agent Profile created here.`,
      kind: "system_retry",
      patterns: [
        "=organization_binding_authorization.required",
        "=organization_binding_authorization.binding_required",
        "=organization_binding_authorization.no_bindings",
        "=organization_binding_authorization.profile_org_mismatch",
        "=organization_binding_authorization.profile_owner_mismatch",
      ],
      recoveryTarget: null,
    },
    {
      availabilityBadgeLabel: "Connection mismatch",
      availabilitySummary:
        "This Agent's saved connection does not match this computer setup. To use this setup, create a new Agent. The existing Agent has not been moved.",
      availabilityTooltip: "Agent connection does not match this setup",
      body: (targetName) =>
        `${targetName}'s saved connection does not match this computer setup. To use this setup, create a new Agent. The existing Agent has not been moved.`,
      kind: "system_retry",
      patterns: [
        "claim_eligibility.binding_runtime_mismatch",
        "claim_eligibility.openmeld_service_runtime_id_mismatch",
        "claim_eligibility.binding_capability_mismatch",
        "=local_service.identity_mismatch",
      ],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `${targetName} is connected to an older computer setup. Update setup on this computer, then try again.`,
      kind: "local_agent_prepare",
      patterns: [
        "claim_eligibility.openmeld_service_runtime_id_missing",
        "claim_eligibility.openmeld_service_runtime_id_not_opaque",
        "claim_eligibility.openmeld_service_runtime_identity_invalid",
        "claim_eligibility.runtime_missing",
        "claim_eligibility.runtime_unavailable",
        "claim_eligibility.agent_controller_report_unknown",
        "claim_eligibility.agent_controller_report_missing",
        "claim_eligibility.agent_controller_report_stale",
        "claim_eligibility.agent_controller_report_disabled",
        "claim_eligibility.agent_controller_report_unavailable",
      ],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Connect",
      availabilitySummary:
        "Connect a local agent before this profile can reply.",
      availabilityTooltip: "Connect local agent",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld needs a current local agent connection from this computer before it can reply.`,
      kind: "local_agent_prepare",
      patterns: ["=agent_profile_binding.agent_controller_report_missing"],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Connect",
      availabilitySummary:
        "Connect a local agent before this profile can reply.",
      availabilityTooltip: "Connect local agent",
      body: (targetName) =>
        `${targetName} is connected, but this computer's local agent connection is out of date. Connect the local agent again.`,
      kind: "local_agent_prepare",
      patterns: ["=agent_profile_binding.agent_controller_report_stale"],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Checking",
      availabilitySummary: "Checking this agent's local controller.",
      availabilityTooltip: "Checking local agent",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld needs a current local agent connection from this computer before it can reply.`,
      kind: "local_agent_prepare",
      patterns: [
        "=runtime.projection_missing",
        "=runtime.agent_controller_report_missing",
      ],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Checking",
      availabilitySummary: "Checking this agent's local controller.",
      availabilityTooltip: "Checking local agent",
      body: (targetName) =>
        `${targetName} is connected, but this computer's local agent connection is out of date. Connect the local agent again.`,
      kind: "local_agent_prepare",
      patterns: ["=runtime.agent_controller_report_stale"],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Connect",
      availabilitySummary:
        "Connect a local agent before this profile can reply.",
      availabilityTooltip: "Connect local agent",
      body: (targetName) =>
        `${targetName} is in this space, but OpenMeld cannot tell which local agent should reply for it yet.`,
      kind: "local_agent_connection",
      mappedReasonBody: (targetName) =>
        `No local agent has been selected to reply for ${formatObjectTargetName(targetName)} yet.`,
      patterns: [
        "agent_profile_binding.missing",
        "agent_profile_binding.disabled",
        "claim_eligibility.binding_missing",
        "claim_eligibility.binding_disabled",
        "claim_eligibility.binding_not_routable",
        "dispatch.claim_eligibility.blocked",
        "dispatch.claim_eligibility.binding.disabled_historical",
        "dispatch.claim_eligibility.binding.enabled_primary",
        "dispatch.claim_eligibility.binding.missing",
        "profile.unbound",
      ],
      manualOnlyAgentDetail: "No local agent selected for Wake",
      primaryActionId: "choose_local_agent",
      recoveryTarget: "agents",
    },
    {
      body: (targetName) =>
        `${targetName} has a conflicting reply connection. Wait a moment, then run setup again if the issue continues.`,
      kind: "local_agent_prepare",
      patterns: [
        "claim_eligibility.binding_conflict",
        "claim_eligibility.lease_conflict",
        "claim_eligibility.runtime_conflict",
        "dispatch.claim_eligibility.binding.conflict",
      ],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      body: "OpenMeld could not verify permission to run this agent. Sign in again, then try once more.",
      kind: "system_retry",
      patterns: [
        "claim_eligibility.caller_not_allowed",
        "claim_eligibility.not_read_after_caller_authorization_failed",
      ],
      recoveryTarget: null,
    },
    {
      body: "This Wake request is no longer active. Send a new message and wake the agent again.",
      kind: "system_retry",
      patterns: [
        "claim_eligibility.non_wake_relation_not_dispatchable",
        "claim_eligibility.dispatch_evidence_missing",
        "claim_eligibility.dispatch_evidence_stale",
        "claim_eligibility.dispatch_missing",
        "claim_eligibility.dispatch_terminal",
        "claim_eligibility.wake_not_allowed_at_creation",
        "claim_eligibility.wake_no_longer_allowed_by_policy",
        "claim_eligibility.space_liveness_missing",
        "claim_eligibility.space_liveness_stale",
        "claim_eligibility.policy_version_mismatch",
      ],
      recoveryTarget: null,
    },
    {
      body: "This agent is no longer a member of this space. Add it back from the space's members panel, then try again.",
      kind: "system_retry",
      patterns: [
        "claim_eligibility.target_no_longer_member",
        "claim_eligibility.target_not_claimable_agent_member",
      ],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `OpenMeld stopped this Wake for ${formatObjectTargetName(targetName)} because the Wake details changed after it was accepted. Send the request again. If this keeps happening, open Diagnostics.`,
      kind: "system_retry",
      patterns: [
        `=${RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_CONFLICT_REASON_CODE}`,
      ],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `This Wake expired before it reached ${formatObjectTargetName(targetName)}. Reconnect the computer, then wake the Agent again.`,
      kind: "local_service",
      patterns: ["runtime_coordinator.delivery_expired"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: (targetName) =>
        `OpenMeld could not start ${formatObjectTargetName(targetName)} in time. Reconnect the computer, then wake the Agent again.`,
      kind: "local_service",
      patterns: ["daemon.delivery.start_timeout", "delivery.start_timeout"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: "OpenMeld could not resume the Agent's conversation in time. Try waking the Agent again. If this keeps happening, open Diagnostics.",
      kind: "system_retry",
      patterns: ["=context.resume_timeout"],
      recoveryTarget: null,
    },
    {
      body: "OpenMeld could not read the latest Space messages to finish this reply. Open Diagnostics for details before trying again.",
      kind: "system_retry",
      patterns: [
        "=dispatch.agent_reply_observation.unavailable",
        "=dispatch.agent_reply_observation.no_progress",
      ],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `${targetName} stopped making progress on this Wake. Reconnect the computer before trying again.`,
      kind: "local_service",
      patterns: ["daemon.delivery.execution_stalled", "runtime.progress_stale"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: (targetName) =>
        `OpenMeld received progress from ${formatObjectTargetName(targetName)}, but could not finish the final result in time.`,
      kind: "local_service",
      patterns: [
        "daemon.delivery.finalization_timeout",
        "delivery.result_timeout",
      ],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: (targetName) =>
        `${targetName} took too long to finish this Wake. Reconnect the computer before trying again.`,
      kind: "local_service",
      patterns: [
        "daemon.delivery.timeout",
        "local_adapter.timeout",
        "timed_out_after_output",
        "timed_out_no_output",
        "=timeout",
      ],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary: "Connect your computer before this Agent can reply.",
      availabilityTooltip: "Computer not connected",
      body: (targetName) =>
        `${targetName}'s computer is disconnected from OpenMeld. Reconnect the computer so it can receive local Wake work.`,
      kind: "local_service",
      patterns: ["=service.not_running"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary: "Connect your computer before this Agent can reply.",
      availabilityTooltip: "Computer not connected",
      body: (targetName) =>
        `OpenMeld is not set up on ${formatPossessiveTargetName(targetName)} computer. Connect the computer so it can receive local Wake work.`,
      kind: "local_service",
      patterns: ["=service.not_installed"],
      primaryActionId: "connect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Needs attention",
      availabilitySummary:
        "OpenMeld found a service problem on this computer. Open Computer details to check it.",
      availabilityTooltip: "Check OpenMeld on Computer",
      body: (targetName) =>
        `OpenMeld found a service problem on ${formatPossessiveTargetName(targetName)} computer. Open Computer details to see what needs attention.`,
      kind: "local_service",
      patterns: ["=service.drifted"],
      primaryActionId: "check_status",
      recoveryTarget: "computer",
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary: "Connect your computer before this Agent can reply.",
      availabilityTooltip: "Computer not connected",
      body: (targetName) =>
        `${targetName}'s computer is not connected to the current OpenMeld account. Reconnect the computer.`,
      kind: "local_service",
      patterns: ["=local_service.not_connected_for_account"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary: "Connect your computer before this Agent can reply.",
      availabilityTooltip: "Computer not connected",
      body: (targetName) =>
        `OpenMeld could not check ${formatPossessiveTargetName(targetName)} computer connection. Reconnect the computer and try again.`,
      kind: "local_service",
      patterns: ["=local_service.unavailable"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Reconnecting",
      availabilitySummary: "Computer is reconnecting.",
      availabilityTooltip: "Reconnecting Computer",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld cannot see an active local Wake route from this computer yet. OpenMeld is checking the route from this computer.`,
      kind: "local_service",
      patterns: ["=local_service.reconnecting"],
      primaryActionId: "check_status",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Checking",
      availabilitySummary: "Checking this agent's Wake route.",
      availabilityTooltip: "Checking Wake route",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld cannot see an active local Wake route from this computer yet. OpenMeld is checking the route from this computer.`,
      kind: "local_service",
      patterns: ["=agent_execution.route_missing", "=route.not_registered"],
      primaryActionId: "check_status",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary: "This Agent's computer is offline.",
      availabilityTooltip: "Agent computer is offline",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld cannot see an active local Wake route from this computer yet. OpenMeld is checking the route from this computer.`,
      kind: "local_service",
      patterns: ["=agent_execution.route_offline", "=route.offline"],
      primaryActionId: "check_status",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "OpenMeld couldn't check this agent's connection.",
      availabilityTooltip: "Connection check unavailable",
      body: (targetName) =>
        `OpenMeld couldn't check ${targetName}'s connection. Try again.`,
      kind: "local_service",
      patterns: ["=agent_execution.route_unavailable", "=route.unavailable"],
      primaryActionId: "check_status",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Update",
      availabilitySummary:
        "Update OpenMeld on your computer before this Agent can reply.",
      availabilityTooltip: "Update OpenMeld on Computer",
      body: "Update OpenMeld on this computer before it can receive local Wake work.",
      kind: "local_service",
      patterns: [
        "background_helper.installed_outdated",
        "background_helper.update_required",
        "service.update_required",
      ],
      primaryActionId: "update_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: "OpenMeld is not set up on this computer.",
      kind: "local_service",
      patterns: ["background_helper.not_installed"],
      primaryActionId: "connect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: (targetName) =>
        `The computer is connected, but ${formatObjectTargetName(targetName)} did not become ready in time for this Wake. Try waking the Agent again in a moment.`,
      kind: "system_retry",
      patterns: ["=daemon.profile.pending_first_report"],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `${formatObjectTargetName(targetName)} did not start before the deadline. This Wake has expired and will not run when the computer reconnects. Send a new Wake if the work is still needed.`,
      kind: "request_ended",
      patterns: ["=wake.device_wait.expired"],
      recoveryTarget: null,
    },
    {
      body: "This waiting Wake could not start because its requester or Agent no longer has access to this Space. Review access before sending a new Wake.",
      kind: "request_ended",
      patterns: ["=wake.device_wait.access_revoked"],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `OpenMeld could not reach ${formatObjectTargetName(targetName)} on this computer for this Wake. Reconnect the computer, then try again.`,
      kind: "local_service",
      patterns: [
        "daemon.profile.offline",
        "daemon.session.not_found",
        "local_service.",
        "route.",
        "service.",
        "service.not_running",
      ],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: buildMalformedSpaceReplyCopy,
      kind: "system_retry",
      mappedReasonBody: buildMalformedSpaceReplyCopy,
      patterns: ["=openmeld.space_action.repair_failed"],
      preferMappedReasonDetailPatterns: [
        "replied, but not with a valid space reply action",
        "finished, but openmeld couldn't post its reply",
        "finished, but openmeld could not post its reply",
        "finished, but did not produce a valid space reply",
        "finished, but its reply could not be posted",
        "finished, but the reply could not be posted",
        "openmeld did not receive a message it could post in this space",
      ],
      recoveryTarget: null,
    },
    {
      body: buildEmptyAgentReplyCopy,
      kind: "system_retry",
      mappedReasonBody: buildEmptyAgentReplyCopy,
      patterns: ["=runtime.reply.empty_output"],
      preferMappedReasonOverDetail: true,
      recoveryTarget: null,
    },
    {
      body: buildMissingAgentReplyIdentityCopy,
      kind: "system_retry",
      mappedReasonBody: buildMissingAgentReplyIdentityCopy,
      patterns: ["=runtime.reply.metadata_missing.agent_controller_ref"],
      preferMappedReasonOverDetail: true,
      recoveryTarget: null,
    },
    {
      body: "OpenMeld found more than one install for this agent on this device. Choose which one OpenMeld should use here, then try again.",
      kind: "local_agent_prepare",
      patterns: ["controller.launch.choice_required", "launch choice"],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      body: "This agent is missing its local workspace on this device. Run `openmeld doctor --repair`, then `openmeld setup --profile <agent-profile-id>`, and try again.",
      kind: "local_agent_prepare",
      patterns: ["workspace.missing", "profile.workspace.missing"],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      body: "This agent's local workspace is broken on this device. Run `openmeld doctor --repair`, then `openmeld setup --profile <agent-profile-id>`, and try again.",
      kind: "local_agent_prepare",
      patterns: ["workspace.invalid", "profile.workspace.invalid"],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      body: CODEX_UPGRADE_REQUIRED_REASON,
      kind: "local_agent_prepare",
      patterns: ["controller.client.upgrade_required"],
      primaryActionId: "manage_local_agent",
      recoveryTarget: "computer",
    },
    {
      body: "This local agent is not available on this device. Connect a local agent, then try again.",
      kind: "local_agent_prepare",
      patterns: ["controller.runtime.missing"],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      body: (targetName) =>
        `${targetName} could not start on this device. Repair it on this device, then try again.`,
      kind: "local_agent_prepare",
      patterns: ["controller.launch.needs_repair"],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Turned off",
      availabilitySummary:
        "This local agent is turned off in OpenMeld on this computer. Turn it on before this profile can reply.",
      availabilityTooltip:
        "This local agent is turned off in OpenMeld on this computer.",
      body: (targetName) =>
        `${targetName}'s local agent is turned off in OpenMeld on this computer. Turn it on, then wake the agent again.`,
      kind: "local_agent_prepare",
      mappedReasonBody:
        "This local agent is turned off in OpenMeld on this computer. Turn it on, then wake the agent again.",
      patterns: ["=controller.registry.disabled"],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Connect",
      availabilitySummary:
        "Connect a local agent before this profile can reply.",
      availabilityTooltip: "Connect local agent",
      body: (targetName) =>
        `${targetName} is connected, but local agent setup is not complete on this computer yet. Finish local agent setup here.`,
      kind: "local_agent_prepare",
      patterns: [
        "=controller.bootstrap.failed",
        "=controller.gateway.unhealthy",
      ],
      primaryActionId: "connect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      body: "The model provider rejected this request because the provider credentials are invalid or expired. Reconnect the provider account, then wake the agent again.",
      kind: "account_access",
      mappedReasonBody:
        "The model provider rejected this request because the provider credentials are invalid or expired. Reconnect the provider account, then wake the agent again.",
      patterns: ["auth", "credential", "login"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: (targetName) =>
        `${targetName} asked for permission before it could continue. OpenMeld cannot collect that permission response yet. Review the Agent Profile’s permission mode, then wake the agent again.`,
      kind: "account_access",
      mappedReasonBody: INTERACTION_PERMISSION_REQUIRED_PUBLIC_COPY,
      patterns: ["=interaction.permission_required"],
      primaryActionId: "review_agent_permissions",
      recoveryTarget: "agents",
    },
    {
      body: INTERACTION_QUESTION_REQUIRED_PUBLIC_COPY,
      kind: "system_retry",
      patterns: ["=interaction.question_required"],
      recoveryTarget: null,
    },
    {
      body: INTERACTION_PLAN_REQUIRED_PUBLIC_COPY,
      kind: "system_retry",
      patterns: ["=interaction.plan_required"],
      recoveryTarget: null,
    },
    {
      body: INTERACTION_UNSUPPORTED_PUBLIC_COPY,
      kind: "system_retry",
      patterns: ["=interaction.unsupported"],
      recoveryTarget: null,
    },
    {
      body: UNSUPPORTED_REASONING_PUBLIC_COPY,
      kind: "account_access",
      patterns: ["=model.reasoning_unsupported"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: CURSOR_MODEL_INVENTORY_UNAVAILABLE_PUBLIC_COPY,
      kind: "system_retry",
      patterns: ["=model.inventory_unavailable"],
      preferMappedReasonOverDetail: true,
      recoveryTarget: null,
    },
    {
      body: UNSUPPORTED_MODEL_PUBLIC_COPY,
      kind: "account_access",
      patterns: [
        "=model.unavailable",
        "model.unsupported",
        "unsupported_model",
      ],
      preferMappedReasonOverDetail: true,
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: "The model provider rejected this request because the provider account does not have enough credits or quota. Add credits, increase the provider quota, or update billing, then wake the agent again.",
      kind: "account_access",
      mappedReasonBody:
        "The model provider rejected this request because the provider account does not have enough credits or quota. Add credits, increase the provider quota, or update billing, then wake the agent again.",
      patterns: ["quota"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: "The model provider rate-limited this request. Wait a moment or raise the provider limit, then wake the agent again.",
      kind: "account_access",
      mappedReasonBody:
        "The model provider rate-limited this request. Wait a moment or raise the provider limit, then wake the agent again.",
      patterns: ["rate"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: "The agent does not have permission to reply here.",
      kind: "account_access",
      patterns: ["forbidden", "permission", "unauthorized"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
    {
      body: "The model provider was unreachable. Check provider status or network access, then wake the agent again.",
      kind: "unknown",
      mappedReasonBody:
        "The model provider was unreachable. Check provider status or network access, then wake the agent again.",
      patterns: ["network", "provider", "unavailable", "upstream"],
      primaryActionId: "review_agent_settings",
      recoveryTarget: "agents",
    },
  ] as const;

export function resolvePublicAgentFailureRecovery(input: {
  errorCode: string | null | undefined;
  includeUnknown?: boolean;
  targetLabel?: string | null | undefined;
}): PublicAgentFailureRecovery | null {
  const normalizedErrorCode = normalizeOptionalText(
    input.errorCode
  )?.toLowerCase();
  if (!normalizedErrorCode) {
    return null;
  }

  const targetName = normalizeOptionalText(input.targetLabel) ?? "This agent";
  const mapping = findPublicFailureRecoveryMapping(normalizedErrorCode);
  if (!mapping) {
    return input.includeUnknown === false
      ? null
      : {
          body: `OpenMeld did not receive enough error details to explain why ${targetName} could not reply. Open diagnostics for technical details.`,
          kind: "unknown",
          recoveryTarget: null,
        };
  }

  const body = resolvePublicAgentFailureBody(mapping.body, targetName);
  if (mapping.recoveryTarget === null) {
    return {
      body,
      kind: mapping.kind,
      recoveryTarget: null,
    };
  }

  return {
    body,
    kind: mapping.kind,
    primaryActionId: mapping.primaryActionId,
    primaryActionLabel: formatAgentRecoveryActionLabel(mapping.primaryActionId),
    recoveryTarget: mapping.recoveryTarget,
  };
}

export function resolveMappedPublicAgentFailureReason(
  errorCode: string | null | undefined,
  targetLabel?: string | null | undefined
): string | null {
  const normalizedErrorCode = normalizeOptionalText(errorCode)?.toLowerCase();
  if (!normalizedErrorCode) {
    return null;
  }

  const mapping =
    PUBLIC_FAILURE_RECOVERY_BY_CODE.find((candidate) =>
      candidate.patterns.some((pattern) =>
        matchesPublicFailureReasonPattern(normalizedErrorCode, pattern)
      )
    ) ?? null;
  if (!mapping) {
    return null;
  }

  return resolvePublicAgentFailureBody(
    mapping.mappedReasonBody ?? mapping.body,
    normalizeOptionalText(targetLabel) ?? "This agent"
  );
}

export function shouldPreferMappedPublicAgentFailureReason(
  errorCode: string | null | undefined,
  detail?: string | null | undefined
): boolean {
  const normalizedErrorCode = normalizeOptionalText(errorCode)?.toLowerCase();
  if (!normalizedErrorCode) {
    return false;
  }

  const mapping = findPublicFailureRecoveryMapping(normalizedErrorCode);
  if (!mapping) {
    return false;
  }
  if (mapping.preferMappedReasonOverDetail) {
    return true;
  }

  const normalizedDetail = normalizeOptionalText(detail)?.toLowerCase();
  return normalizedDetail
    ? (mapping.preferMappedReasonDetailPatterns?.some((pattern) =>
        normalizedDetail.includes(pattern)
      ) ?? false)
    : false;
}

export function isProjectLocalConnectionFailureReasonCode(
  value: string | null | undefined
): value is ProjectLocalConnectionFailureReasonCode {
  return projectLocalConnectionFailureReasonCodeSchema.safeParse(value).success;
}

export function resolvePublicAgentAvailabilityCopy(
  reasonCode: string | null | undefined,
  context: PublicAgentAvailabilityCopyContext = {}
): PublicAgentAvailabilityCopy | null {
  const normalizedReasonCode = normalizeOptionalText(reasonCode)?.toLowerCase();
  if (!normalizedReasonCode) {
    return null;
  }

  const mapping =
    PUBLIC_AGENT_AVAILABILITY_ONLY_COPY_BY_CODE.find((candidate) =>
      candidate.patterns.some((pattern) =>
        matchesPublicFailureReasonPattern(normalizedReasonCode, pattern)
      )
    ) ??
    PUBLIC_FAILURE_RECOVERY_BY_CODE.find(
      (candidate) =>
        candidate.availabilitySummary !== undefined &&
        candidate.patterns.some((pattern) =>
          matchesPublicFailureReasonPattern(normalizedReasonCode, pattern)
        )
    ) ??
    null;
  if (!mapping) {
    return null;
  }

  return {
    availabilityBadgeLabel: resolvePublicAgentAvailabilityCopyValue(
      mapping.availabilityBadgeLabel,
      context
    ),
    availabilitySummary: resolvePublicAgentAvailabilityCopyValue(
      mapping.availabilitySummary,
      context
    ),
    availabilityTooltip: resolvePublicAgentAvailabilityCopyValue(
      mapping.availabilityTooltip,
      context
    ),
    controllerInterfaceDescription: resolvePublicAgentAvailabilityCopyValue(
      mapping.controllerInterfaceDescription,
      context
    ),
    controllerInterfaceDescriptionFallback:
      resolvePublicAgentAvailabilityCopyValue(
        mapping.controllerInterfaceDescriptionFallback,
        context
      ),
    manualOnlyAgentDetail: resolvePublicAgentAvailabilityCopyValue(
      mapping.manualOnlyAgentDetail,
      context
    ),
  };
}

function resolvePublicAgentAvailabilityCopyValue(
  value: PublicAgentAvailabilityCopyValue | undefined,
  context: PublicAgentAvailabilityCopyContext
): string | undefined {
  return typeof value === "function" ? value(context) : value;
}

function resolveControllerSignInAvailabilityCopy(
  context: PublicAgentAvailabilityCopyContext
): {
  controllerInterfaceDescription?: string;
  summary: string;
  tooltip: string;
} {
  return (
    CONTROLLER_SIGN_IN_AVAILABILITY_COPY_BY_ID[
      context.agentControllerId ?? ""
    ] ?? DEFAULT_CONTROLLER_SIGN_IN_AVAILABILITY_COPY
  );
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function formatObjectTargetName(targetName: string): string {
  return targetName === "This agent" ? "this agent" : targetName;
}

function formatPossessiveTargetName(targetName: string): string {
  const objectTargetName = formatObjectTargetName(targetName);
  return objectTargetName.endsWith("s")
    ? `${objectTargetName}'`
    : `${objectTargetName}'s`;
}

function matchesPublicFailureReasonPattern(
  normalizedErrorCode: string,
  pattern: string
): boolean {
  if (pattern.startsWith(EXACT_PATTERN_PREFIX)) {
    return normalizedErrorCode === pattern.slice(EXACT_PATTERN_PREFIX.length);
  }
  return normalizedErrorCode.includes(pattern);
}

function findPublicFailureRecoveryMapping(
  normalizedErrorCode: string
): PublicAgentFailureRecoveryMapping | null {
  return (
    PUBLIC_FAILURE_RECOVERY_BY_CODE.find((candidate) =>
      candidate.patterns.some((pattern) =>
        matchesPublicFailureReasonPattern(normalizedErrorCode, pattern)
      )
    ) ?? null
  );
}

function resolvePublicAgentFailureBody(
  body: string | ((targetName: string) => string),
  targetName: string
): string {
  return typeof body === "function" ? body(targetName) : body;
}
