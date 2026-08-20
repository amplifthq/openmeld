import type {
  AgentProfileCreationApprovalPolicy,
  AgentProfileCreationRequestSource,
  AgentProfileCreationSessionStrategy,
} from "@openmeld/schemas/types";

export class ProfileCreationRequestCliError extends Error {
  readonly code: string;
  readonly nextStep: string;
  readonly title: string;

  constructor(input: {
    code: string;
    message: string;
    nextStep: string;
    title: string;
  }) {
    super(input.message);
    this.name = "ProfileCreationRequestCliError";
    this.code = input.code;
    this.nextStep = input.nextStep;
    this.title = input.title;
  }
}

export function resolveTargetOwnerUserId(input: {
  callerUserId: string | null;
  value?: string;
}): string {
  const value = requireText(input.value, "Target owner");
  if (value.toLowerCase() !== "self") {
    return value;
  }
  if (input.callerUserId) {
    return input.callerUserId;
  }
  throw new ProfileCreationRequestCliError({
    code: "profile.creation_request.owner_identity_unavailable",
    message:
      "OpenMeld could not resolve your user ID from the current sign-in.",
    nextStep:
      "Run `openmeld org directory --view agent`, then pass `--owner <user-id>`.",
    title: "Target Owner Needed",
  });
}

export function parseSessionStrategy(
  value: string | undefined
): AgentProfileCreationSessionStrategy {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? "new";
  if (
    normalized === "new" ||
    normalized === "resume" ||
    normalized === "fork"
  ) {
    return normalized;
  }
  throw new ProfileCreationRequestCliError({
    code: "profile.creation_request.session_strategy_invalid",
    message: "Session must be new, resume, or fork.",
    nextStep: "Pass `--session new`, `--session resume`, or `--session fork`.",
    title: "Session Strategy Invalid",
  });
}

export function parseRequestSource(
  value: string | undefined
): AgentProfileCreationRequestSource {
  const normalized =
    normalizeOptionalText(value)?.toLowerCase().replaceAll("-", "_") ?? "cli";
  if (normalized === "cli" || normalized === "local_agent") {
    return normalized;
  }
  throw new ProfileCreationRequestCliError({
    code: "profile.creation_request.source_invalid",
    message: "CLI requests must identify their source as CLI or Local Agent.",
    nextStep: "Pass `--source cli` or `--source local-agent`.",
    title: "Request Source Invalid",
  });
}

export function parseApprovalPolicy(
  value: string | undefined,
  label: string
): AgentProfileCreationApprovalPolicy {
  const normalized = normalizeOptionalText(value)
    ?.toLowerCase()
    .replaceAll("-", "_");
  if (
    normalized === "never_allow" ||
    normalized === "ask_every_time" ||
    normalized === "automatically_allow"
  ) {
    return normalized;
  }
  throw new ProfileCreationRequestCliError({
    code: "profile.creation_request.approval_policy_invalid",
    message: `${label} must be never-allow, ask-every-time, or automatically-allow.`,
    nextStep:
      "Use one of the approval policies shown by `openmeld profiles requests preferences set --help`.",
    title: "Approval Policy Invalid",
  });
}

export function validateNativeSessionInput(input: {
  nativeSessionId: string | undefined;
  sessionStrategy: AgentProfileCreationSessionStrategy;
}): void {
  if (input.sessionStrategy === "new" && input.nativeSessionId) {
    throw new ProfileCreationRequestCliError({
      code: "profile.creation_request.native_session_unexpected",
      message: "A new-session request cannot include a native Session ID.",
      nextStep: "Remove `--native-session`, or choose resume or fork.",
      title: "Native Session Not Needed",
    });
  }
  if (input.sessionStrategy !== "new" && !input.nativeSessionId) {
    throw new ProfileCreationRequestCliError({
      code: "profile.creation_request.native_session_required",
      message: "Resume and fork requests require the native Session ID.",
      nextStep: "Pass `--native-session <provider-session-id>`.",
      title: "Native Session Needed",
    });
  }
}

export function requireText(value: unknown, label: string): string {
  const normalized = normalizeOptionalText(value);
  if (normalized) {
    return normalized;
  }
  throw new ProfileCreationRequestCliError({
    code: "profile.creation_request.argument_required",
    message: `${label} is required.`,
    nextStep: "Run this command with `--help` to see the required arguments.",
    title: `${label} Needed`,
  });
}

export function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
