import { parseAgentControllerRef } from "./agent-controller-ref";

export const AGENT_PROFILE_EDIT_APPLICATION_CAPABILITY_MATRIX_VERSION = 1;

export type AgentProfileEditApplicationTiming =
  | "applies_now"
  | "applies_next_turn"
  | "applies_next_wake"
  | "not_supported";

export type AgentProfileRuntimeEditField =
  | "collaboration_mode"
  | "controller"
  | "model"
  | "opencode_permissions"
  | "permission_mode"
  | "reasoning_effort";

type AgentProfileEditApplicationCapability = Partial<
  Record<AgentProfileRuntimeEditField, AgentProfileEditApplicationTiming>
>;

const APPLIES_TO_NEXT_WAKE = "applies_next_wake" as const;

const AGENT_PROFILE_EDIT_APPLICATION_CAPABILITY_MATRIX = {
  "claude-code": {
    controller: APPLIES_TO_NEXT_WAKE,
    model: APPLIES_TO_NEXT_WAKE,
    permission_mode: "applies_now",
    reasoning_effort: APPLIES_TO_NEXT_WAKE,
  },
  codex: {
    collaboration_mode: APPLIES_TO_NEXT_WAKE,
    controller: APPLIES_TO_NEXT_WAKE,
    model: APPLIES_TO_NEXT_WAKE,
    permission_mode: APPLIES_TO_NEXT_WAKE,
    reasoning_effort: APPLIES_TO_NEXT_WAKE,
  },
  cursor: {
    controller: APPLIES_TO_NEXT_WAKE,
    model: APPLIES_TO_NEXT_WAKE,
    permission_mode: "applies_now",
    reasoning_effort: APPLIES_TO_NEXT_WAKE,
  },
  "grok-build": {
    controller: APPLIES_TO_NEXT_WAKE,
    model: APPLIES_TO_NEXT_WAKE,
    permission_mode: APPLIES_TO_NEXT_WAKE,
    reasoning_effort: APPLIES_TO_NEXT_WAKE,
  },
  opencode: {
    controller: APPLIES_TO_NEXT_WAKE,
    model: APPLIES_TO_NEXT_WAKE,
    opencode_permissions: APPLIES_TO_NEXT_WAKE,
    reasoning_effort: APPLIES_TO_NEXT_WAKE,
  },
  openclaw: {
    controller: APPLIES_TO_NEXT_WAKE,
    model: APPLIES_TO_NEXT_WAKE,
    reasoning_effort: APPLIES_TO_NEXT_WAKE,
  },
} as const satisfies Record<string, AgentProfileEditApplicationCapability>;

export function resolveAgentProfileEditApplicationTiming(input: {
  agentControllerRef: string;
  field: AgentProfileRuntimeEditField;
}): AgentProfileEditApplicationTiming {
  const parsedRef = parseAgentControllerRef(input.agentControllerRef);
  if (parsedRef?.kind !== "builtin") {
    return "not_supported";
  }
  const controllerCapabilities =
    AGENT_PROFILE_EDIT_APPLICATION_CAPABILITY_MATRIX[
      parsedRef.id as keyof typeof AGENT_PROFILE_EDIT_APPLICATION_CAPABILITY_MATRIX
    ];
  return (
    controllerCapabilities?.[
      input.field as keyof typeof controllerCapabilities
    ] ?? "not_supported"
  );
}
