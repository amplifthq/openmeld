import { agentControllerPermissionModeSchema } from "@openmeld/schemas";
import type { AgentControllerPermissionMode } from "@openmeld/schemas/types";
import { parseAgentControllerRef } from "./agent-controller-ref";

export type AgentControllerPermissionModeTone = "neutral" | "warning";

export type AgentControllerPermissionModeDisplayMetadata = {
  description: string;
  fieldLabel: string;
  label: string;
  requiresExplicitConfirmation: boolean;
  technicalDetail: string | null;
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

const ASK_FIRST_AGENT_CONTROLLER_PERMISSION_MODES: ReadonlySet<string> =
  new Set([
    CLAUDE_CODE_DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE,
    CODEX_DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE,
    CURSOR_DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE,
    GROK_BUILD_DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE,
  ]);

/**
 * True for each harness's default mode, which asks the owner before actions
 * that need permission ("Ask first").
 */
export function isAskFirstAgentControllerPermissionMode(
  value: string | null | undefined
): boolean {
  return value ? ASK_FIRST_AGENT_CONTROLLER_PERMISSION_MODES.has(value) : false;
}

const CLAUDE_CODE_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS = [
  {
    description:
      "Claude Code asks you in the Space before actions that need permission.",
    label: "Ask permissions",
    requiresExplicitConfirmation: false,
    technicalDetail:
      'claude --permission-mode default --allowedTools "Bash(openmeld)" "Bash(openmeld *)"',
    tone: "neutral",
    value: "claude-code:default",
  },
  {
    description:
      "Claude Code accepts file edits automatically. Other restricted actions may still ask you in the Space.",
    label: "Accept edits",
    requiresExplicitConfirmation: false,
    technicalDetail:
      'claude --permission-mode acceptEdits --allowedTools "Bash(openmeld)" "Bash(openmeld *)"',
    tone: "neutral",
    value: "claude-code:acceptEdits",
  },
  {
    description:
      "Claude Code focuses on planning before it makes changes. Its other permission rules still apply.",
    label: "Plan mode",
    requiresExplicitConfirmation: false,
    technicalDetail:
      'claude --permission-mode plan --allowedTools "Bash(openmeld)" "Bash(openmeld *)"',
    tone: "neutral",
    value: "claude-code:plan",
  },
  {
    description:
      "Claude Code automatically continues on eligible actions and asks when it still needs approval.",
    label: "Auto mode",
    requiresExplicitConfirmation: false,
    technicalDetail:
      'claude --permission-mode auto --allowedTools "Bash(openmeld)" "Bash(openmeld *)"',
    tone: "neutral",
    value: "claude-code:auto",
  },
  {
    description:
      "Claude Code rejects permission requests that are not already allowed instead of waiting for your approval.",
    label: "Don't ask",
    requiresExplicitConfirmation: false,
    technicalDetail:
      'claude --permission-mode dontAsk --allowedTools "Bash(openmeld)" "Bash(openmeld *)"',
    tone: "neutral",
    value: "claude-code:dontAsk",
  },
  {
    description:
      "Claude Code bypasses its permission prompts for this Agent. Separate file-access limits on this Computer still apply.",
    label: "Bypass permissions",
    requiresExplicitConfirmation: true,
    technicalDetail: "claude --permission-mode bypassPermissions",
    tone: "warning",
    value: "claude-code:bypassPermissions",
  },
] as const satisfies readonly AgentControllerPermissionModeOption[];

const CODEX_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS = [
  {
    description:
      "Codex asks before editing files outside its working folder or using the internet.",
    label: "Ask for approval",
    requiresExplicitConfirmation: false,
    technicalDetail:
      'codex -s workspace-write -a on-request -c approvals_reviewer="user"',
    tone: "neutral",
    value: "codex:askForApproval",
  },
  {
    description:
      "Automatically review actions that need approval. Potentially unsafe actions may be blocked.",
    label: "Approve for me",
    requiresExplicitConfirmation: false,
    technicalDetail:
      'codex -s workspace-write -a on-request -c approvals_reviewer="auto_review"',
    tone: "neutral",
    value: "codex:approveForMe",
  },
  {
    description:
      "Allow internet and file access without Codex approval prompts. This Computer's file-access limits still apply.",
    label: "Full access",
    requiresExplicitConfirmation: true,
    technicalDetail: "codex --dangerously-bypass-approvals-and-sandbox",
    tone: "warning",
    value: "codex:fullAccess",
  },
  {
    description:
      "This Agent keeps its previous permission settings until you choose a mode.",
    label: "Previous settings",
    requiresExplicitConfirmation: false,
    technicalDetail: "codex (no OpenMeld permission overrides)",
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
    technicalDetail: null,
    tone: "neutral",
    value: "cursor:default",
  },
  {
    description:
      "Cursor uses its read-only planning mode for analysis and design.",
    label: "Plan",
    requiresExplicitConfirmation: false,
    technicalDetail: null,
    tone: "neutral",
    value: "cursor:plan",
  },
  {
    description:
      "Cursor answers questions without editing files or running commands.",
    label: "Ask",
    requiresExplicitConfirmation: false,
    technicalDetail: null,
    tone: "neutral",
    value: "cursor:ask",
  },
  {
    description:
      "Use Cursor’s Auto-review (Smart Auto) to automatically run safe actions. If Cursor still needs approval, OpenMeld asks you in the Space.",
    label: "Auto-review (Smart Auto)",
    requiresExplicitConfirmation: false,
    technicalDetail: "cursor-agent --auto-review acp",
    tone: "neutral",
    value: "cursor:autoReview",
  },
  {
    description:
      "Cursor allows commands unless an explicit Cursor deny rule blocks them.",
    label: "Run Everything",
    requiresExplicitConfirmation: true,
    technicalDetail: "cursor-agent --force acp",
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
    technicalDetail: null,
    tone: "neutral",
    value: "grok-build:default",
  },
  {
    description:
      "Accept file edits automatically. Grok may still ask before running commands or using other tools.",
    label: "Accept edits",
    requiresExplicitConfirmation: false,
    technicalDetail: null,
    tone: "neutral",
    value: "grok-build:acceptEdits",
  },
  {
    description:
      "Use Grok Build’s plan permission mode. Reads, commands, and MCP tools still follow Grok’s permission rules.",
    label: "Plan mode",
    requiresExplicitConfirmation: false,
    technicalDetail: null,
    tone: "neutral",
    value: "grok-build:plan",
  },
  {
    description:
      "Grok Build automatically continues on eligible actions and asks when it still needs approval.",
    label: "Auto mode",
    requiresExplicitConfirmation: false,
    technicalDetail: null,
    tone: "neutral",
    value: "grok-build:auto",
  },
  {
    description:
      "Automatically reject actions that are not already allowed instead of waiting for approval.",
    label: "Don't ask",
    requiresExplicitConfirmation: false,
    technicalDetail: null,
    tone: "neutral",
    value: "grok-build:dontAsk",
  },
  {
    description:
      "Bypass Grok Build permission prompts. Explicit deny rules and safety hooks may still block an action.",
    label: "Bypass permissions",
    requiresExplicitConfirmation: true,
    technicalDetail: null,
    tone: "warning",
    value: "grok-build:bypassPermissions",
  },
] as const satisfies readonly AgentControllerPermissionModeOption[];

const ANTIGRAVITY_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS = [
  {
    description:
      "Use Antigravity's configured tool permissions. Actions that need approval are blocked during unattended runs.",
    label: "Default",
    requiresExplicitConfirmation: false,
    technicalDetail: "agy (no OpenMeld permission overrides)",
    tone: "neutral",
    value: "antigravity:default",
  },
  {
    description:
      "Automatically accept file edits. Shell commands still follow Antigravity's configured tool permissions.",
    label: "Accept edits",
    requiresExplicitConfirmation: false,
    technicalDetail: "agy --mode accept-edits",
    tone: "neutral",
    value: "antigravity:acceptEdits",
  },
  {
    description:
      "Ask Antigravity to investigate and propose a plan before making changes. This is not a read-only sandbox.",
    label: "Plan",
    requiresExplicitConfirmation: false,
    technicalDetail: "agy --mode plan",
    tone: "neutral",
    value: "antigravity:plan",
  },
  {
    description:
      "Automatically approve all tool requests, including file changes and shell commands.",
    label: "Bypass permissions",
    requiresExplicitConfirmation: true,
    technicalDetail: "agy --dangerously-skip-permissions",
    tone: "warning",
    value: "antigravity:bypassPermissions",
  },
] as const satisfies readonly AgentControllerPermissionModeOption[];

const AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS_BY_CONTROLLER_ID = {
  antigravity: ANTIGRAVITY_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
  "claude-code": CLAUDE_CODE_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
  codex: CODEX_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
  cursor: CURSOR_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
  "grok-build": GROK_BUILD_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
} as const satisfies Record<
  string,
  readonly AgentControllerPermissionModeOption[]
>;

const AGENT_CONTROLLER_PERMISSION_MODE_FIELD_LABEL_BY_CONTROLLER_ID = {
  antigravity: "Antigravity permissions mode",
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
    return controllerOptions
      .filter((option) => option.value !== "codex:customConfig")
      .map((option) => ({ ...option }));
  }
  if (input) {
    return [];
  }
  return [
    ...ANTIGRAVITY_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
    ...CLAUDE_CODE_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
    ...CODEX_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
    ...CURSOR_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
    ...GROK_BUILD_AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS,
  ]
    .filter((option) => option.value !== "codex:customConfig")
    .map((option) => ({ ...option }));
}

/** Local agent controllers whose permission is an Agent Controller Permission Mode. */
export const PERMISSION_MODE_AGENT_CONTROLLER_REFS = [
  "builtin:antigravity",
  "builtin:claude-code",
  "builtin:codex",
  "builtin:cursor",
  "builtin:grok-build",
] as const;

export type PermissionModeAgentControllerRef =
  (typeof PERMISSION_MODE_AGENT_CONTROLLER_REFS)[number];

/** Every selectable permission mode, grouped by the controller that offers it. */
export function listAgentControllerPermissionModeCatalog(input?: {
  agentControllerRef?: string | null;
}): {
  agentControllerRef: PermissionModeAgentControllerRef;
  modes: AgentControllerPermissionModeOption[];
}[] {
  return PERMISSION_MODE_AGENT_CONTROLLER_REFS.filter(
    (agentControllerRef) =>
      !input?.agentControllerRef ||
      input.agentControllerRef === agentControllerRef
  ).map((agentControllerRef) => ({
    agentControllerRef,
    modes: listAgentControllerPermissionModeOptions({ agentControllerRef }),
  }));
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
    Object.values(
      AGENT_CONTROLLER_PERMISSION_MODE_OPTIONS_BY_CONTROLLER_ID
    ).flat();
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
