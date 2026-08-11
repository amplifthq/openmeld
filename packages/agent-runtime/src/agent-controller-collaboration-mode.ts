import { agentControllerCollaborationModeSchema } from "@openmeld/schemas";
import type { AgentControllerCollaborationMode } from "@openmeld/schemas/types";
import { parseAgentControllerRef } from "./agent-controller-ref";

export type AgentControllerCollaborationModeOption = {
  description: string;
  label: string;
  value: AgentControllerCollaborationMode;
};

export const CODEX_DEFAULT_AGENT_CONTROLLER_COLLABORATION_MODE =
  "codex:default" satisfies AgentControllerCollaborationMode;

const CODEX_AGENT_CONTROLLER_COLLABORATION_MODE_OPTIONS = [
  {
    description:
      "Work directly on tasks. Codex may ask for approval when an action needs it.",
    label: "Default",
    value: "codex:default",
  },
  {
    description:
      "Plan before implementation. Codex can ask structured questions in the Space and will not make changes until you switch back to Default.",
    label: "Plan",
    value: "codex:plan",
  },
] as const satisfies readonly AgentControllerCollaborationModeOption[];

export function listAgentControllerCollaborationModeOptions(input: {
  agentControllerRef?: string | null;
}): AgentControllerCollaborationModeOption[] {
  return isCodexController(input.agentControllerRef)
    ? CODEX_AGENT_CONTROLLER_COLLABORATION_MODE_OPTIONS.map((option) => ({
        ...option,
      }))
    : [];
}

export function resolveNativeAgentControllerCollaborationModeForController(
  value: unknown,
  input: {
    agentControllerRef?: string | null;
  }
): AgentControllerCollaborationMode | undefined {
  if (!isCodexController(input.agentControllerRef)) {
    return undefined;
  }
  if (value === null || value === undefined) {
    return CODEX_DEFAULT_AGENT_CONTROLLER_COLLABORATION_MODE;
  }
  const parsed = agentControllerCollaborationModeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function isCodexController(agentControllerRef?: string | null): boolean {
  const parsedRef = parseAgentControllerRef(agentControllerRef);
  return parsedRef?.kind === "builtin" && parsedRef.id === "codex";
}
