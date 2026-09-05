import { AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION } from "@openmeld/agent-runtime";
import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";

export function createAvailableCodexAgentControllerInterface(input: {
  observedAt: string;
}): AgentControllerInterfaceSnapshot {
  return {
    agentControllerRef: "builtin:codex",
    auth: { label: "Signed in", status: "authenticated" },
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: false,
    },
    checkedAt: input.observedAt,
    controllerId: "codex",
    displayName: "Codex",
    launch: {
      argsPrefix: [],
      commandPath: "/usr/local/bin/codex",
      installChoiceCount: 1,
      status: "ready",
    },
    message: null,
    models: [],
    nativeInterface: "codex-app-server",
    schemaVersion: 1,
    skills: [],
    status: "ready",
    usageLimits: [
      {
        key: "codex:primary",
        label: "5-hour usage",
        observedAt: input.observedAt,
        resetsAt: null,
        status: "available",
        usedPercent: 42,
      },
    ],
    usageLimitsSupportMatrixVersion:
      AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
    version: "1.0.0",
  };
}
