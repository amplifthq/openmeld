import { confirm, isCancel } from "@clack/prompts";
import {
  type AgentControllerPermissionModeOption,
  getAgentControllerPermissionModeDisplayMetadata,
  listAgentControllerPermissionModeOptions,
  resolveAgentProfileEditCapabilities,
} from "@openmeld/agent-runtime";
import type { AgentControllerPermissionMode } from "@openmeld/schemas/types";

export type NormalizedAgentControllerPermissionModeInput = {
  hasAnyAgentControllerPermissionModeInput: boolean;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
};

export async function resolveAgentControllerPermissionModeInput(input: {
  agentControllerRef?: string | null;
  allowPrompt: boolean;
  confirmDangerousAgentControllerPermissionMode?: boolean;
  agentControllerPermissionModeInput?: string;
  flagName: string;
}): Promise<NormalizedAgentControllerPermissionModeInput> {
  const agentControllerPermissionMode =
    normalizeAgentControllerPermissionModeCliInput({
      agentControllerRef: input.agentControllerRef,
      flagName: input.flagName,
      value: input.agentControllerPermissionModeInput,
    });
  if (!agentControllerPermissionMode) {
    return {
      hasAnyAgentControllerPermissionModeInput: false,
    };
  }
  const agentControllerRef = normalizeOptionalString(input.agentControllerRef);
  assertAgentControllerPermissionModeSupported({
    agentControllerPermissionMode,
    agentControllerRef,
    flagName: input.flagName,
  });
  const metadata = getAgentControllerPermissionModeDisplayMetadata(
    agentControllerPermissionMode,
    agentControllerRef ? { agentControllerRef } : undefined
  );

  if (
    metadata.requiresExplicitConfirmation &&
    input.confirmDangerousAgentControllerPermissionMode !== true
  ) {
    if (!input.allowPrompt) {
      throw new Error(
        `${input.flagName} ${formatAgentControllerPermissionModeForCli(agentControllerPermissionMode)} requires --confirm-dangerous-agent-controller-permission-mode.`
      );
    }
    const confirmed = await confirm({
      message: `${metadata.label} can let this Agent Controller run dangerous actions without asking. Continue?`,
      initialValue: false,
    });
    if (isCancel(confirmed) || confirmed !== true) {
      throw new Error(
        `${input.flagName} ${formatAgentControllerPermissionModeForCli(agentControllerPermissionMode)} requires confirmation.`
      );
    }
  }

  return {
    hasAnyAgentControllerPermissionModeInput: true,
    agentControllerPermissionMode,
  };
}

export function normalizeAgentControllerPermissionModeCliInput(input: {
  agentControllerRef?: string | null;
  flagName: string;
  value?: string;
}): AgentControllerPermissionMode | null {
  const raw = normalizeOptionalString(input.value);
  if (!raw) {
    return null;
  }
  const options = listAgentControllerPermissionModeOptions(
    input.agentControllerRef
      ? { agentControllerRef: input.agentControllerRef }
      : undefined
  );
  for (const option of options) {
    if (raw === option.value) {
      return option.value;
    }
  }
  const normalized = raw.toLowerCase().replaceAll("_", "-");
  for (const option of options) {
    if (
      normalized ===
      AGENT_CONTROLLER_PERMISSION_MODE_CLI_VALUE_BY_MODE[option.value]
    ) {
      return option.value;
    }
  }
  const value = AGENT_CONTROLLER_PERMISSION_MODE_BY_CLI_VALUE[normalized];
  if (value) {
    return value;
  }
  throw new Error(
    `${input.flagName} must be ${formatSupportedAgentControllerPermissionModeValues(input.agentControllerRef)}.`
  );
}

export function assertAgentControllerPermissionModeSupported(input: {
  agentControllerPermissionMode: AgentControllerPermissionMode;
  agentControllerRef?: string | null;
  flagName: string;
}): void {
  if (!input.agentControllerRef) {
    return;
  }
  const options = resolvePermissionModeOptions(input.agentControllerRef);
  if (
    options.some(
      (option) => option.value === input.agentControllerPermissionMode
    )
  ) {
    return;
  }
  const supportedValues =
    options.length > 0
      ? options
          .map((option) =>
            formatAgentControllerPermissionModeForCli(option.value)
          )
          .join("|")
      : "none";
  throw new Error(
    `${input.flagName} ${formatAgentControllerPermissionModeForCli(input.agentControllerPermissionMode)} is not supported by ${input.agentControllerRef}. Supported values: ${supportedValues}.`
  );
}

export function formatAgentControllerPermissionModeForCli(
  value: AgentControllerPermissionMode
): string {
  return AGENT_CONTROLLER_PERMISSION_MODE_CLI_VALUE_BY_MODE[value] ?? value;
}

export function formatAgentControllerPermissionModeHelp(): string {
  const controllerGroups = [
    {
      agentControllerRef: "builtin:claude-code",
      label: "Claude Code",
    },
    {
      agentControllerRef: "builtin:codex",
      label: "Codex",
    },
    {
      agentControllerRef: "builtin:cursor",
      label: "Cursor",
    },
  ] as const;
  return `Agent Controller Permission Mode. ${controllerGroups
    .map(
      ({ agentControllerRef, label }) =>
        `${label}: ${resolvePermissionModeOptions(agentControllerRef)
          .map((option) =>
            formatAgentControllerPermissionModeForCli(option.value)
          )
          .join("|")}.`
    )
    .join(" ")}`;
}

function formatSupportedAgentControllerPermissionModeValues(
  agentControllerRef?: string | null
): string {
  const options = agentControllerRef
    ? resolvePermissionModeOptions(agentControllerRef)
    : listAgentControllerPermissionModeOptions();
  if (options.length === 0) {
    return "none";
  }
  return options
    .map((option) => formatAgentControllerPermissionModeForCli(option.value))
    .join("|");
}

function resolvePermissionModeOptions(
  agentControllerRef: string
): AgentControllerPermissionModeOption[] {
  return resolveAgentProfileEditCapabilities({
    agentControllerRef,
    modelCatalog: null,
  }).permissionMode.options;
}

const AGENT_CONTROLLER_PERMISSION_MODE_CLI_VALUE_BY_MODE = {
  "claude-code:default": "ask-permissions",
  "claude-code:acceptEdits": "accept-edits",
  "claude-code:plan": "plan",
  "claude-code:auto": "auto",
  "claude-code:dontAsk": "dont-ask",
  "claude-code:bypassPermissions": "bypass-permissions",
  "codex:askForApproval": "ask-for-approval",
  "codex:approveForMe": "approve-for-me",
  "codex:fullAccess": "full-access",
  "codex:customConfig": "custom-config",
  "cursor:default": "default",
  "cursor:plan": "plan",
  "cursor:ask": "ask",
  "cursor:autoReview": "auto-review",
  "cursor:force": "run-everything",
} as const satisfies Record<AgentControllerPermissionMode, string>;

const AGENT_CONTROLLER_PERMISSION_MODE_BY_CLI_VALUE: Record<
  string,
  AgentControllerPermissionMode
> = {
  "ask-permissions": "claude-code:default",
  default: "claude-code:default",
  "accept-edits": "claude-code:acceptEdits",
  acceptedits: "claude-code:acceptEdits",
  plan: "claude-code:plan",
  "plan-mode": "claude-code:plan",
  auto: "claude-code:auto",
  "auto-mode": "claude-code:auto",
  "dont-ask": "claude-code:dontAsk",
  dontask: "claude-code:dontAsk",
  "bypass-permissions": "claude-code:bypassPermissions",
  bypasspermissions: "claude-code:bypassPermissions",
  "ask-for-approval": "codex:askForApproval",
  askforapproval: "codex:askForApproval",
  "approve-for-me": "codex:approveForMe",
  approveforme: "codex:approveForMe",
  "full-access": "codex:fullAccess",
  fullaccess: "codex:fullAccess",
  "custom-config": "codex:customConfig",
  custom: "codex:customConfig",
  customconfig: "codex:customConfig",
  "auto-review": "cursor:autoReview",
  autoreview: "cursor:autoReview",
  ask: "cursor:ask",
  force: "cursor:force",
  "run-everything": "cursor:force",
  runeverything: "cursor:force",
};

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
