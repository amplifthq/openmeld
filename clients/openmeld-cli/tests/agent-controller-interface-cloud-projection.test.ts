import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { projectAgentControllerInterfaceForCloud } from "../src/local-service/reporting/agent-controller-interface-cloud-projection";

describe("Agent Controller Interface cloud projection", () => {
  it("preserves bounded check evidence without exposing local diagnostics", () => {
    const snapshot: AgentControllerInterfaceSnapshot = {
      agentControllerRef: "builtin:opencode",
      auth: {
        email: "felix@example.com",
        label: "2 providers connected",
        status: "unknown",
        type: "opencode",
      },
      capabilities: {
        approvals: false,
        cancel: false,
        interrupt: true,
        modelSelection: true,
        nativeEventStream: false,
        permissionModes: false,
        structuredUserInput: false,
      },
      check: {
        lastSucceededAt: "2026-07-19T07:05:00.000Z",
        status: "failed",
      },
      checkedAt: "2026-07-19T07:10:00.000Z",
      controllerId: "opencode",
      displayName: "OpenCode",
      launch: {
        argsPrefix: ["serve"],
        commandPath: "/opt/homebrew/bin/opencode",
        installChoiceCount: 1,
        status: "ready",
      },
      message:
        "OpenCode is installed, but OpenMeld could not confirm a connected provider.",
      models: [{ displayName: "GPT-5.4", id: "openai/gpt-5.4" }],
      nativeInterface: "local-cli",
      schemaVersion: 1,
      skills: [{ id: "review" }],
      status: "unknown",
      usageLimits: [
        {
          key: "opencode:provider",
          label: "Usage limits",
          observedAt: "2026-07-19T07:10:00.000Z",
          resetsAt: null,
          status: "unsupported",
          usedPercent: null,
        },
      ],
      version: "1.18.1",
    };

    expect(projectAgentControllerInterfaceForCloud(snapshot)).toEqual({
      ...snapshot,
      auth: {
        email: "felix@example.com",
        label: "2 providers connected",
        status: "unknown",
      },
      launch: {
        argsPrefix: [],
        commandPath: null,
        installChoiceCount: 1,
        status: "ready",
      },
      message: null,
      models: [],
      skills: [],
    });
  });
});
