import { agentControllerPermissionModeSchema } from "@openmeld/schemas";
import type { AgentControllerPermissionMode } from "@openmeld/schemas/types";
import { parseAgentControllerRef } from "./agent-controller-ref";

export type AgentControllerPermissionModeTone = "neutral" | "warning";

export type AgentControllerPermissionModeDisplayMetadata = {
  description: string;
  fieldLabel: string;
  label: string;
  requiresExplicitConfirmation: boolean;
  tone: AgentControllerPermissionModeTone;
};

export type AgentControllerPermissionModeOption = Omit<
  AgentControllerPermissionModeDisplayMetadata,
  "fieldLabel"
> & {
  value: AgentControllerPermissionMode;
};

export const CLAUDE_CODE_DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE =
  "claude-code:default" satisfies AgentControllerPermissionMode;
export const CODEX_DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE =
  "codex:askForApproval" satisfies AgentControllerPermissionMode;
export const CURSOR_DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE =
  "cursor:default" satisfies AgentControllerPermissionMode;
export const GROK_BUILD_DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE =
  "grok-build:default" satisfies AgentControllerPermissionMode;
export const DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE =
  CLAUDE_CODE_DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE;

const CLAUDE_CODE_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS = [
  {
    description:
      'Default Claude Code permission mode. CLI: claude --permission-mode default --allowedTools "Bash(openmeld)" "Bash(openmeld *)".',
    label: "Ask permissions",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "claude-code:default",
  },
  {
    description:
      'Accept file edits automatically. CLI: claude --permission-mode acceptEdits --allowedTools "Bash(openmeld)" "Bash(openmeld *)".',
    label: "Accept edits",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "claude-code:acceptEdits",
  },
  {
    description:
      'Plan before making changes. CLI: claude --permission-mode plan --allowedTools "Bash(openmeld)" "Bash(openmeld *)".',
    label: "Plan mode",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "claude-code:plan",
  },
  {
    description:
      'Use Claude Code auto mode. CLI: claude --permission-mode auto --allowedTools "Bash(openmeld)" "Bash(openmeld *)".',
    label: "Auto mode",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "claude-code:auto",
  },
  {
    description:
      'Automatically reject permission requests not already allowed. CLI: claude --permission-mode dontAsk --allowedTools "Bash(openmeld)" "Bash(openmeld *)".',
    label: "Don't ask",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "claude-code:dontAsk",
  },
  {
    description:
      "Bypass Claude Code permission prompts. CLI: claude --permission-mode bypassPermissions.",
    label: "Bypass permissions",
    requiresExplicitConfirmation: true,
    tone: "warning",
    value: "claude-code:bypassPermissions",
  },
] as const satisfies readonly AgentControllerPermissionModeOption[];

const CODEX_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS = [
  {
    description:
      "Always ask to edit external files and use the internet. CLI: codex -s workspace-write -a untrusted.",
    label: "Ask for approval",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "codex:askForApproval",
  },
  {
    description:
      'Only ask for actions detected as potentially unsafe. CLI: codex -s workspace-write -a on-request -c approvals_reviewer="auto_review".',
    label: "Approve for me",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "codex:approveForMe",
  },
  {
    description:
      "Unrestricted access to the internet and any file on your computer. CLI: codex --dangerously-bypass-approvals-and-sandbox.",
    label: "Full access",
    requiresExplicitConfirmation: true,
    tone: "warning",
    value: "codex:fullAccess",
  },
  {
    description:
      "Uses permissions defined in config.toml. CLI: codex without OpenMeld sandbox or approval overrides.",
    label: "Custom (config.toml)",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "codex:customConfig",
  },
] as const satisfies readonly AgentControllerPermissionModeOption[];

const CURSOR_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS = [
  {
    description:
      "Use Cursor’s standard permissions. If Cursor needs approval, OpenMeld asks you in the Space.",
    label: "Default",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "cursor:default",
  },
  {
    description:
      "Read-only mode for planning and designing before implementation.",
    label: "Plan",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "cursor:plan",
  },
  {
    description: "Q&A mode — no edits or command execution.",
    label: "Ask",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "cursor:ask",
  },
  {
    description:
      "Use Cursor’s Auto-review (Smart Auto) to automatically run safe actions. If Cursor still needs approval, OpenMeld asks you in the Space.",
    label: "Auto-review (Smart Auto)",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "cursor:autoReview",
  },
  {
    description:
      "Force Cursor to allow commands unless explicitly denied. CLI: cursor-agent --force.",
    label: "Run Everything",
    requiresExplicitConfirmation: true,
    tone: "warning",
    value: "cursor:force",
  },
] as const satisfies readonly AgentControllerPermissionModeOption[];

const GROK_BUILD_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS = [
  {
    description:
      "Use Grok Build’s standard permissions. If Grok needs approval, OpenMeld asks you in the Space.",
    label: "Ask permissions",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "grok-build:default",
  },
  {
    description:
      "Accept file edits automatically. Grok may still ask before running commands or using other tools.",
    label: "Accept edits",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "grok-build:acceptEdits",
  },
  {
    description:
      "Use Grok Build’s plan permission mode. Reads, commands, and MCP tools still follow Grok’s permission rules.",
    label: "Plan mode",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "grok-build:plan",
  },
  {
    description:
      "Let Grok Build automatically run actions it classifies as safe. Grok may still ask for approval.",
    label: "Auto mode",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "grok-build:auto",
  },
  {
    description:
      "Automatically reject actions that are not already allowed instead of waiting for approval.",
    label: "Don't ask",
    requiresExplicitConfirmation: false,
    tone: "neutral",
    value: "grok-build:dontAsk",
  },
  {
    description:
      "Bypass Grok Build permission prompts. Explicit deny rules and safety hooks may still block an action.",
    label: "Bypass permissions",
    requiresExplicitConfirmation: true,
    tone: "warning",
    value: "grok-build:bypassPermissions",
  },
] as const satisfies readonly AgentControllerPermissionModeOption[];

const AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS_BY_CONTROLLER_ID = {
  "claude-code": CLAUDE_CODE_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
  codex: CODEX_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
  cursor: CURSOR_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
  "grok-build": GROK_BUILD_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
} as const satisfies Record<
  string,
  readonly AgentControllerPermissionModeOption[]
>;

const AGENT_CONTROLLER_PERMISSION_MODE_FIELD_LABEL_BY_CONTROLLER_ID = {
  "claude-code": "Claude Code permissions mode",
  codex: "Codex permissions mode",
  cursor: "Cursor permissions mode",
  "grok-build": "Grok Build permissions mode",
} as const satisfies Record<AgentControllerPermissionModeControllerId, string>;

type AgentControllerPermissionModeControllerId =
  keyof typeof AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS_BY_CONTROLLER_ID;

export function resolveAgentControllerPermissionMode(
  value: unknown
): AgentControllerPermissionMode {
  const parsed = agentControllerPermissionModeSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE;
}

export function getAgentControllerPermissionModeDisplayMetadata(
  value: unknown,
  input?: {
    agentControllerRef?: string | null;
  }
): AgentControllerPermissionModeDisplayMetadata {
  const policy = input
    ? resolveAgentControllerPermissionModeForController(value, input)
    : resolveAgentControllerPermissionMode(value);
  const option = resolveAgentControllerPermissionModeOption(policy, input);
  return {
    ...option,
    fieldLabel: getAgentControllerPermissionModeFieldLabel(input),
  };
}

export function getAgentControllerPermissionModeFieldLabel(input?: {
  agentControllerRef?: string | null;
}): string {
  const parsedRef = parseAgentControllerRef(input?.agentControllerRef);
  if (
    parsedRef?.kind === "builtin" &&
    isAgentControllerPermissionModeControllerId(parsedRef.id)
  ) {
    return AGENT_CONTROLLER_PERMISSION_MODE_FIELD_LABEL_BY_CONTROLLER_ID[
      parsedRef.id
    ];
  }
  return "Agent Controller permissions mode";
}

export function resolveAgentControllerPermissionModeForController(
  value: unknown,
  input?: {
    agentControllerRef?: string | null;
  }
): AgentControllerPermissionMode {
  const options = resolveControllerOptions(input?.agentControllerRef);
  const controllerDefault =
    options?.[0]?.value ?? DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE;
  const parsed = agentControllerPermissionModeSchema.safeParse(value);
  if (!parsed.success) {
    return controllerDefault;
  }
  if (!options) {
    return input?.agentControllerRef ? controllerDefault : parsed.data;
  }
  return options.some((option) => option.value === parsed.data)
    ? parsed.data
    : controllerDefault;
}

export function resolveNativeAgentControllerPermissionModeForController(
  value: unknown,
  input: {
    agentControllerRef?: string | null;
  }
): AgentControllerPermissionMode | undefined {
  const options = resolveControllerOptions(input.agentControllerRef);
  if (!options) {
    return undefined;
  }
  const parsed = agentControllerPermissionModeSchema.safeParse(value);
  if (!parsed.success) {
    return value === null || value === undefined
      ? options[0]?.value
      : undefined;
  }
  return options.some((option) => option.value === parsed.data)
    ? parsed.data
    : undefined;
}

export function listAgentControllerPermissionModeOptions(input?: {
  agentControllerRef?: string | null;
}): AgentControllerPermissionModeOption[] {
  const controllerOptions = resolveControllerOptions(input?.agentControllerRef);
  if (controllerOptions) {
    return controllerOptions.map((option) => ({ ...option }));
  }
  if (input) {
    return [];
  }
  return [
    ...CLAUDE_CODE_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
    ...CODEX_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
    ...CURSOR_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
    ...GROK_BUILD_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
  ].map((option) => ({ ...option }));
}

export function agentControllerPermissionModeRequiresExplicitConfirmation(
  value: unknown
): boolean {
  return getAgentControllerPermissionModeDisplayMetadata(value)
    .requiresExplicitConfirmation;
}

function resolveAgentControllerPermissionModeOption(
  policy: AgentControllerPermissionMode,
  input?: {
    agentControllerRef?: string | null;
  }
): AgentControllerPermissionModeOption {
  const options =
    resolveControllerOptions(input?.agentControllerRef) ??
    listAgentControllerPermissionModeOptions();
  return (
    options.find((option) => option.value === policy) ??
    CLAUDE_CODE_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS[0]
  );
}

function resolveControllerOptions(agentControllerRef?: string | null) {
  const parsedRef = parseAgentControllerRef(agentControllerRef);
  if (parsedRef?.kind !== "builtin") {
    return null;
  }
  if (!isAgentControllerPermissionModeControllerId(parsedRef.id)) {
    return null;
  }
  return (
    AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS_BY_CONTROLLER_ID[parsedRef.id] ??
    null
  );
}

function isAgentControllerPermissionModeControllerId(
  value: string
): value is AgentControllerPermissionModeControllerId {
  return Object.hasOwn(
    AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS_BY_CONTROLLER_ID,
    value
  );
}
