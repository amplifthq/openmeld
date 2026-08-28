import * as z from "zod/v4";
import {
  type AgentRecoveryActionId,
  formatAgentRecoveryActionLabel,
} from "./agent-recovery-action";

export const PROJECT_LOCAL_CONNECTION_FAILURE_REASON_CODES = [
  "project.local_connection.missing",
  "project.local_connection.folder_missing",
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
  "Center Agent didn't return a reply. Try again. If it keeps happening, open diagnostics in OpenMeld.";
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
const OPENCLAW_PERMISSION_REQUIRED_RE = /\b[a-z0-9_]+_permission_required\b/;
const LEADING_ERROR_CODE_PREFIX_RE = /^[a-z][\w.]*:\s+/i;
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
    category: "the local OpenMeld Service had an issue",
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
      kind: Exclude<PublicAgentFailureRecoveryKind, "system_retry">;
      primaryActionId: AgentRecoveryActionId;
      primaryActionLabel: string;
      recoveryTarget: PublicAgentFailureRecoveryTarget;
    }
  | {
      body: string;
      kind: "system_retry" | "unknown";
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
      kind: Exclude<PublicAgentFailureRecoveryKind, "system_retry">;
      primaryActionId: AgentRecoveryActionId;
      recoveryTarget: PublicAgentFailureRecoveryTarget;
    })
  | (PublicAgentFailureRecoveryMappingBase & {
      kind: "system_retry";
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
      availabilitySummary: "Center Agent can answer now.",
      availabilityTooltip: "Center Agent available",
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
      availabilitySummary: "Can reply from this computer in Spaces.",
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
      availabilitySummary: "Checking OpenMeld Service.",
      availabilityTooltip: "Checking OpenMeld Service",
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
      availabilitySummary:
        "This agent's Wake route is unavailable right now. Check OpenMeld Service on its computer.",
      availabilityTooltip:
        "Wake route unavailable. Check OpenMeld Service on its computer.",
      patterns: ["=wake_route.registration_unavailable"],
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary:
        "This agent's connection is offline. Check OpenMeld Service on its computer.",
      availabilityTooltip:
        "Agent connection is offline. Check OpenMeld Service on its computer.",
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
      primaryActionId: "reconnect_local_agent",
      recoveryTarget: "prepare_setup",
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
      kind: "local_service",
      patterns: ["=provider_account.subscription_access_unavailable"],
      primaryActionId: "reconnect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "Fix provider access before this agent can reply.",
      availabilityTooltip: "Provider access needed",
      body: (targetName) =>
        `${targetName} is connected, but its organization has disabled the provider access this agent needs. Ask the provider account admin to enable access before waking it again.`,
      kind: "local_service",
      patterns: ["=provider_account.organization_access_disabled"],
      primaryActionId: "reconnect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary:
        "Add credits, update billing, or wait for the displayed reset time.",
      availabilityTooltip: "Provider quota exhausted",
      body: (targetName) =>
        `${targetName} is connected, but its provider quota or credit balance is exhausted. Add credits, update billing, or wait for the displayed reset time before waking it again.`,
      kind: "local_service",
      patterns: ["=provider_account.capacity_exhausted"],
      primaryActionId: "reconnect_local_agent",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary: "Fix provider access before this agent can reply.",
      availabilityTooltip: "Provider access needed",
      body: (targetName) =>
        `${targetName}'s provider account needs attention on its computer. Fix access with the provider there, then check its status here.`,
      kind: "local_service",
      patterns: ["provider_account."],
      primaryActionId: "reconnect_local_agent",
      recoveryTarget: "prepare_setup",
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
      availabilityBadgeLabel: "Wake access off",
      availabilitySummary:
        "Turn on Wake access before this agent can reply in this Organization.",
      availabilityTooltip: "Wake access is off for this Organization",
      // organization_binding_authorization has several sub-codes (required,
      // binding_required, no_bindings, profile_org_mismatch, ...) that all
      // mean the same thing to a reader: the organization hasn't turned Wake
      // access on for this agent's binding. One pattern on the shared prefix
      // covers all of them instead of enumerating each sub-code -- matching
      // wake-failure-display.ts's resolveOrganizationWakeFailureDisplay and
      // agent-wake-availability.ts's members-panel classification, which
      // both already prefix-match this reason code family. recoveryTarget is
      // null (no button) because this table's only destinations are
      // "agents" and "prepare_setup" -- neither is where this is actually
      // fixed (the organization's Wake Access setting), so a button here
      // would repeat the review-agent-settings dead end this table's other
      // entries were rewritten to stop doing.
      body: (targetName) =>
        `Wake access is off for ${targetName} in this organization. Turn it on to let ${targetName} reply in this Space.`,
      kind: "system_retry",
      patterns: ["organization_binding_authorization."],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `${targetName} is connected to an older computer setup. Update setup on this computer, then try again.`,
      kind: "local_agent_prepare",
      patterns: [
        "claim_eligibility.binding_runtime_mismatch",
        "claim_eligibility.openmeld_service_runtime_id_missing",
        "claim_eligibility.openmeld_service_runtime_id_mismatch",
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
      body: (targetName) =>
        `${targetName} is connected to a different local agent setup. Update setup on this computer, then try again.`,
      kind: "local_agent_prepare",
      patterns: ["claim_eligibility.binding_capability_mismatch"],
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
        `This Wake expired before it reached ${formatObjectTargetName(targetName)}. Start or reconnect OpenMeld Service, then wake the agent again.`,
      kind: "local_service",
      patterns: ["runtime_coordinator.delivery_expired"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: (targetName) =>
        `OpenMeld could not start ${formatObjectTargetName(targetName)} in time. Start or reconnect OpenMeld Service, then wake the agent again.`,
      kind: "local_service",
      patterns: ["daemon.delivery.start_timeout", "delivery.start_timeout"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: (targetName) =>
        `${targetName} stopped making progress on this Wake. Reconnect OpenMeld Service before trying again.`,
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
        `${targetName} took too long to finish this Wake. Reconnect OpenMeld Service before trying again.`,
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
      availabilitySummary:
        "Connect OpenMeld Service on this computer before this agent can reply.",
      availabilityTooltip:
        "OpenMeld Service is not connected on this computer.",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld Service is not running on this computer. Start OpenMeld Service so this computer can receive local Wake work.`,
      kind: "local_service",
      patterns: ["=service.not_running"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary:
        "Connect OpenMeld Service on this computer before this agent can reply.",
      availabilityTooltip:
        "OpenMeld Service is not connected on this computer.",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld Service is not installed on this computer. Install OpenMeld Service so this computer can receive local Wake work.`,
      kind: "local_service",
      patterns: ["=service.not_installed"],
      primaryActionId: "connect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Update",
      availabilitySummary:
        "Update OpenMeld Service before this agent can reply.",
      availabilityTooltip: "Update OpenMeld Service",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld Service on this computer needs repair before it can receive local Wake work.`,
      kind: "local_service",
      patterns: ["=service.drifted"],
      primaryActionId: "update_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary:
        "Connect OpenMeld Service on this computer before this agent can reply.",
      availabilityTooltip:
        "OpenMeld Service is not connected on this computer.",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld Service is not connected for this OpenMeld account on this computer. Reconnect OpenMeld Service for this account.`,
      kind: "local_service",
      patterns: ["=local_service.not_connected_for_account"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary:
        "Connect OpenMeld Service on this computer before this agent can reply.",
      availabilityTooltip:
        "OpenMeld Service is not connected on this computer.",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld Service is using a different local runtime than this agent expects. Reconnect OpenMeld Service on this computer.`,
      kind: "local_service",
      patterns: ["=local_service.identity_mismatch"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Offline",
      availabilitySummary:
        "Connect OpenMeld Service on this computer before this agent can reply.",
      availabilityTooltip:
        "OpenMeld Service is not connected on this computer.",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld could not check OpenMeld Service for this account. Reconnect OpenMeld Service and try again.`,
      kind: "local_service",
      patterns: ["=local_service.unavailable"],
      primaryActionId: "reconnect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Reconnecting",
      availabilitySummary: "OpenMeld Service is reconnecting on this computer.",
      availabilityTooltip: "Reconnecting OpenMeld Service",
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
      availabilitySummary:
        "This agent's connection is offline. Check OpenMeld Service on its computer.",
      availabilityTooltip:
        "Agent connection is offline. Check OpenMeld Service on its computer.",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld cannot see an active local Wake route from this computer yet. OpenMeld is checking the route from this computer.`,
      kind: "local_service",
      patterns: ["=agent_execution.route_offline", "=route.offline"],
      primaryActionId: "check_status",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Unavailable",
      availabilitySummary:
        "This agent's Wake route is unavailable right now. Check OpenMeld Service on its computer.",
      availabilityTooltip:
        "Wake route unavailable. Check OpenMeld Service on its computer.",
      body: (targetName) =>
        `${targetName} is connected, but OpenMeld cannot see an active local Wake route from this computer yet. OpenMeld is checking the route from this computer.`,
      kind: "local_service",
      patterns: ["=agent_execution.route_unavailable", "=route.unavailable"],
      primaryActionId: "check_status",
      recoveryTarget: "prepare_setup",
    },
    {
      availabilityBadgeLabel: "Update",
      availabilitySummary:
        "Update OpenMeld Service before this agent can reply.",
      availabilityTooltip: "Update OpenMeld Service",
      body: "OpenMeld Service must be updated before this computer can receive local Wake work.",
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
      body: "OpenMeld Service is not installed on this computer.",
      kind: "local_service",
      patterns: ["background_helper.not_installed"],
      primaryActionId: "connect_openmeld_service",
      recoveryTarget: "prepare_setup",
    },
    {
      body: (targetName) =>
        `OpenMeld Service is connected, but ${formatObjectTargetName(targetName)} did not become ready in time for this Wake. Try waking the agent again in a moment.`,
      kind: "system_retry",
      patterns: ["=daemon.profile.pending_first_report"],
      recoveryTarget: null,
    },
    {
      body: (targetName) =>
        `OpenMeld could not reach ${formatObjectTargetName(targetName)} on this computer for this Wake. Reconnect OpenMeld Service, then try again.`,
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

export function resolveDetailedPublicAgentFailureReason(
  errorMessage: string | null | undefined
): string | null {
  const normalizedMessage = normalizeProviderFailureMessage(errorMessage);
  if (!normalizedMessage) {
    return null;
  }

  const lowered = normalizedMessage.toLowerCase();
  const usageLimitReason = resolveProviderUsageLimitPassthroughReason(
    normalizedMessage,
    lowered
  );
  if (usageLimitReason) {
    return usageLimitReason;
  }
  const providerFailureReason =
    resolveRuntimeOrProviderAccountFailureReason(lowered);
  if (providerFailureReason) {
    return providerFailureReason;
  }
  if (
    lowered.includes("model is not supported") &&
    lowered.includes("chatgpt account")
  ) {
    return "The current Codex model is not available for this ChatGPT-backed account.";
  }
  if (lowered.includes("requires a newer version of codex")) {
    return CODEX_UPGRADE_REQUIRED_REASON;
  }
  if (
    lowered.includes("model is not supported") ||
    lowered.includes("unsupported model")
  ) {
    return UNSUPPORTED_MODEL_PUBLIC_COPY;
  }
  if (
    lowered.includes("oauth token refresh failed") ||
    lowered.includes("failed to refresh oauth token")
  ) {
    if (lowered.includes("openclaw logs --follow")) {
      return "Authentication failed in OpenClaw. Run `openclaw logs --follow`, re-authenticate, then retry.";
    }
    return "Authentication failed while refreshing the provider token. Re-authenticate in the provider CLI, then retry.";
  }
  if (isClaudeCodeSubscriptionAccessFailure(lowered)) {
    return "Claude Code subscription access is unavailable. Check your Claude Code subscription, then try again.";
  }
  if (isClaudeCodeAccountAccessFailure(lowered)) {
    return "Claude Code access is disabled for this account or organization. Enable Claude Code access in Claude, then try again.";
  }
  if (lowered.includes("openclaw is not installed or not on path")) {
    return "OpenMeld could not start OpenClaw on this device. Install OpenClaw or fix its PATH for background services, then try again.";
  }
  if (lowered.includes("launch contract is required for runtime dispatch")) {
    return "OpenMeld could not start this agent on this device. Repair it on this device, then try again.";
  }
  if (
    lowered.includes("openmeld found more than one") &&
    lowered.includes("install")
  ) {
    return "OpenMeld found more than one install for this agent on this device. Choose which one OpenMeld should use here, then try again.";
  }
  if (isProviderUnreachableFailure(lowered)) {
    return "The model provider was unreachable. Check provider status or network access, then wake the agent again.";
  }
  return null;
}

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
      kind: "system_retry",
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

function isProviderBalanceFailure(value: string): boolean {
  return (
    value.includes("insufficient balance") ||
    value.includes("insufficient_balance") ||
    value.includes("not enough credits") ||
    value.includes("out of credits") ||
    value.includes("credits exhausted") ||
    value.includes("credit balance") ||
    value.includes("account balance") ||
    value.includes("balance is too low") ||
    value.includes("payment required")
  );
}

function isRuntimePermissionApprovalFailure(value: string): boolean {
  return (
    value.includes("permission.denied.runtime") ||
    (value.includes("permission requested") &&
      (value.includes("auto-reject") ||
        value.includes("auto rejecting") ||
        value.includes("auto rejected") ||
        value.includes("rejecting"))) ||
    value.includes("permission for this tool use was denied") ||
    value.includes("permission for this action was denied") ||
    value.includes("permission for this action has been denied") ||
    value.includes("denied by auto mode classifier") ||
    value.includes("user rejected tool use") ||
    value.includes("command denied by sandbox:") ||
    value.includes("sandbox denied exec error") ||
    value.includes("this action was rejected due to unacceptable risk") ||
    (value.includes("execution denied:") &&
      (value.includes("policy") ||
        value.includes("forbidden") ||
        value.includes("approval") ||
        value.includes("sandbox"))) ||
    (value.includes("rejected:") && value.includes("blocked by policy")) ||
    (value.includes("requires approval") && value.includes("policy")) ||
    value.includes("policy forbids commands starting") ||
    value.includes("system_run_denied:") ||
    value.includes("system_run_disabled: security=deny") ||
    value.includes("exec denied:") ||
    value.includes("exec.denied") ||
    value.includes("permission:screenrecording") ||
    OPENCLAW_PERMISSION_REQUIRED_RE.test(value)
  );
}

function resolveProviderUsageLimitPassthroughReason(
  rawMessage: string,
  lowered: string
): string | null {
  if (
    !(
      lowered.includes("usage limit") ||
      lowered.includes("hit your usage limit")
    )
  ) {
    return null;
  }
  // A provider usage-limit notice already reads as native, actionable copy —
  // what happened, what to do, and when it resets. Surface it verbatim (minus
  // the diagnostic error-code prefix) so the user sees the real reason and the
  // reset time instead of a generic fallback (experience-principles #1, #8).
  return normalizeOptionalText(stripLeadingErrorCodePrefix(rawMessage));
}

function stripLeadingErrorCodePrefix(value: string): string {
  return value.replace(LEADING_ERROR_CODE_PREFIX_RE, "");
}

function resolveRuntimeOrProviderAccountFailureReason(
  value: string
): string | null {
  if (isRuntimePermissionApprovalFailure(value)) {
    return RUNTIME_PERMISSION_DENIAL_PUBLIC_COPY;
  }
  if (isProviderBalanceFailure(value)) {
    return "The model provider rejected this request because the provider account does not have enough credits. Add credits or update billing directly with the provider, then wake the agent again.";
  }
  if (isProviderCredentialFailure(value)) {
    return "The model provider rejected this request because the local provider login expired. Re-authenticate the local agent on its computer, then wake the agent again.";
  }
  if (isProviderRateLimitFailure(value)) {
    return "The model provider rate-limited this request. Wait a moment, then wake the agent again.";
  }
  if (isProviderUnavailableFailure(value)) {
    return PROVIDER_UNAVAILABLE_PUBLIC_COPY;
  }
  return null;
}

function isProviderCredentialFailure(value: string): boolean {
  return (
    value.includes("invalid api key") ||
    value.includes("invalid token") ||
    value.includes("expired token") ||
    value.includes("missing api key") ||
    value.includes("missing credentials") ||
    value.includes("authentication_failed") ||
    value.includes("oauth_org_not_allowed") ||
    value.includes("failed to authenticate") ||
    value.includes("oauth session expired") ||
    value.includes("unauthorized") ||
    value.includes("not logged in") ||
    value.includes("401")
  );
}

function isProviderRateLimitFailure(value: string): boolean {
  return (
    value.includes("rate limit") ||
    value.includes("rate_limit") ||
    value.includes("too many requests") ||
    value.includes("throttl") ||
    value.includes("429")
  );
}

function isProviderUnavailableFailure(value: string): boolean {
  return (
    value.includes("bad gateway") ||
    value.includes("gateway timeout") ||
    value.includes("service unavailable") ||
    value.includes("provider unavailable") ||
    value.includes("provider is unavailable") ||
    value.includes("socket hang up") ||
    value.includes("econnreset") ||
    value.includes("etimedout")
  );
}

function isProviderUnreachableFailure(value: string): boolean {
  const hasProviderContext =
    value.includes("provider") ||
    value.includes("upstream") ||
    value.includes("network") ||
    value.includes("connection") ||
    value.includes("request");
  return (
    value.includes("upstream_unreachable") ||
    value.includes("provider_unreachable") ||
    value.includes("provider unavailable") ||
    value.includes("provider is unavailable") ||
    value.includes("upstream unavailable") ||
    value.includes("connection refused") ||
    value.includes("network unreachable") ||
    value.includes("dns") ||
    ((value.includes("timeout") || value.includes("timed out")) &&
      hasProviderContext)
  );
}

function isClaudeCodeAccountAccessFailure(value: string): boolean {
  return (
    (value.includes("organization") &&
      value.includes("disabled") &&
      value.includes("access")) ||
    (value.includes("claude code") &&
      (value.includes("access is disabled") ||
        value.includes("disabled claude code") ||
        value.includes("access unavailable") ||
        value.includes("not enabled")))
  );
}

function isClaudeCodeSubscriptionAccessFailure(value: string): boolean {
  return (
    value.includes("subscription") &&
    (value.includes("disabled") ||
      value.includes("inactive") ||
      value.includes("required") ||
      value.includes("unavailable"))
  );
}

function normalizeProviderFailureMessage(
  value: string | null | undefined
): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }

  const extractedJsonDetail = extractJsonDetail(normalized);
  return normalizeOptionalText(extractedJsonDetail) ?? normalized;
}

function extractJsonDetail(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    return (
      normalizeOptionalText(record.detail) ??
      normalizeOptionalText(record.message) ??
      (record.error &&
      typeof record.error === "object" &&
      !Array.isArray(record.error)
        ? normalizeOptionalText(
            (record.error as Record<string, unknown>).message
          )
        : null)
    );
  } catch {
    return null;
  }
}

function formatObjectTargetName(targetName: string): string {
  return targetName === "This agent" ? "this agent" : targetName;
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
