import { agentControllerPermissionModeSchema } from "@openmeld/schemas";
import type { AgentControllerPermissionMode } from "@openmeld/schemas/types";
import {
  getAgentControllerPermissionModeDisplayMetadata,
  listAgentControllerPermissionModeOptions,
  resolveNativeAgentControllerPermissionModeForController,
} from "./agent-controller-permission-mode";

/**
 * The permission-mode advisor suggests the harness's next less-interrupting
 * mode. Each entry is one step; a mode that needs explicit confirmation
 * (Bypass permissions, Full access) is never a suggestion. Modes without an
 * entry get no suggestion: Plan and the no-prompt modes are deliberate
 * owner choices, and `codex:customConfig` has an unknown native policy.
 */
const PERMISSION_MODE_ADVISOR_NEXT_MODE: Partial<
  Record<AgentControllerPermissionMode, AgentControllerPermissionMode>
> = {
  "claude-code:default": "claude-code:acceptEdits",
  "claude-code:acceptEdits": "claude-code:auto",
  "codex:askForApproval": "codex:approveForMe",
  "grok-build:default": "grok-build:acceptEdits",
};

export type PermissionModeAdvisorSuggestion = {
  currentPermissionMode: AgentControllerPermissionMode;
  currentPermissionModeLabel: string;
  suggestedPermissionMode: AgentControllerPermissionMode;
  suggestedPermissionModeLabel: string;
};

/**
 * Returns the next less-interrupting mode for the Binding's current mode, or
 * null when the advisor has nothing to suggest. A missing saved mode means
 * the controller's default mode.
 */
export function resolvePermissionModeAdvisorSuggestion(input: {
  agentControllerRef: string | null | undefined;
  savedPermissionMode: string | null | undefined;
}): PermissionModeAdvisorSuggestion | null {
  const currentPermissionMode =
    resolveNativeAgentControllerPermissionModeForController(
      input.savedPermissionMode,
      { agentControllerRef: input.agentControllerRef }
    );
  if (!currentPermissionMode) {
    return null;
  }
  const suggested = PERMISSION_MODE_ADVISOR_NEXT_MODE[currentPermissionMode];
  if (!suggested) {
    return null;
  }
  const parsed = agentControllerPermissionModeSchema.safeParse(suggested);
  const offered = listAgentControllerPermissionModeOptions({
    agentControllerRef: input.agentControllerRef,
  }).find((option) => option.value === suggested);
  if (!(parsed.success && offered) || offered.requiresExplicitConfirmation) {
    return null;
  }
  return {
    currentPermissionMode,
    currentPermissionModeLabel: getAgentControllerPermissionModeDisplayMetadata(
      currentPermissionMode,
      { agentControllerRef: input.agentControllerRef }
    ).label,
    suggestedPermissionMode: parsed.data,
    suggestedPermissionModeLabel: offered.label,
  };
}

/** Every advisor step, for guardrail tests and documentation. */
export function listPermissionModeAdvisorSteps(): {
  from: AgentControllerPermissionMode;
  to: AgentControllerPermissionMode;
}[] {
  return Object.entries(PERMISSION_MODE_ADVISOR_NEXT_MODE).map(
    ([from, to]) => ({
      from: from as AgentControllerPermissionMode,
      to: to as AgentControllerPermissionMode,
    })
  );
}

/**
 * The single line a new MemberAgent's welcome card shows about its
 * permission mode (MemberAgent program, permission-mode advisor).
 */
export const MEMBER_AGENT_WELCOME_PERMISSION_MODE_LINE =
  "Permission mode is Ask first, good for personal use; I can switch it later if colleagues use this Agent.";
