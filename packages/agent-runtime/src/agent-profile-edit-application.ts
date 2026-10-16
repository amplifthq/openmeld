import type { AgentControllerPermissionMode } from "@openmeld/schemas/types";
import { parseAgentControllerRef } from "./agent-controller-ref";

export const AGENT_PROFILE_EDIT_APPLICATION_CAPABILITY_MATRIX_VERSION = 4;

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
  currentPermissionMode?: AgentControllerPermissionMode | null;
  nextPermissionMode?: AgentControllerPermissionMode | null;
}): AgentProfileEditApplicationTiming {
  const parsedRef = parseAgentControllerRef(input.agentControllerRef);
  if (parsedRef?.kind !== "builtin") {
    return "not_supported";
  }
  if (
    input.field === "permission_mode" &&
    (parsedRef.id === "codex" || parsedRef.id === "cursor")
  ) {
    const liveModes: readonly AgentControllerPermissionMode[] =
      parsedRef.id === "codex"
        ? ["codex:askForApproval", "codex:approveForMe"]
        : ["cursor:default", "cursor:ask", "cursor:plan"];
    // Codex Full access and Cursor Run Everything cannot change a running
    // session natively. Their adapters stop asking by answering later
    // permission requests with the controller's one-time allow.
    const noPromptMode: AgentControllerPermissionMode =
      parsedRef.id === "codex" ? "codex:fullAccess" : "cursor:force";
    return input.currentPermissionMode &&
      input.nextPermissionMode &&
      liveModes.includes(input.currentPermissionMode) &&
      (liveModes.includes(input.nextPermissionMode) ||
        input.nextPermissionMode === noPromptMode)
      ? "applies_now"
      : APPLIES_TO_NEXT_WAKE;
  }
  // Grok Build cannot switch a running session natively. Its adapter honors a
  // switch to Bypass permissions by answering later requests with Grok's own
  // one-time allow; every other change waits for the next Wake.
  if (input.field === "permission_mode" && parsedRef.id === "grok-build") {
    return input.nextPermissionMode === "grok-build:bypassPermissions"
      ? "applies_now"
      : APPLIES_TO_NEXT_WAKE;
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
