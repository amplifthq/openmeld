import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  createAgentControllerInterfaceDisplayRows,
  createAgentControllerInterfaceOperationalDisplayRows,
  formatAgentControllerInterfaceSummary,
  getAgentControllerVersionAdvisoryPresentation,
  resolveAgentControllerInterfaceDescription,
  shouldExpandAgentControllerInterface,
} from "../src/agent-controller-interface-display";

describe("agent controller interface display", () => {
  it("reuses operational detail rows without private owner fields", () => {
    const snapshot = agentControllerInterfaceSnapshot({
      message: "Private diagnostic message",
      skills: [{ displayName: "Private skill", id: "private-skill" }],
      versionAdvisory: {
        checkedAt: "2026-06-28T12:01:00.000Z",
        currentVersion: "0.38.0",
        latestVersion: "0.39.0",
        message: "Private update message",
        status: "behind_latest",
        updateCommand: "npm install -g @openai/codex@latest",
      },
    });

    const rows = createAgentControllerInterfaceOperationalDisplayRows({
      capabilities: snapshot.capabilities,
      checkedAt: snapshot.checkedAt,
      launch: {
        installChoiceCount: snapshot.launch.installChoiceCount,
        status: snapshot.launch.status,
      },
      models: snapshot.models.map((model) => ({
        displayName: model.displayName,
      })),
      nativeInterface: snapshot.nativeInterface,
      status: snapshot.status,
      version: snapshot.version,
      versionAdvisory: {
        checkedAt: snapshot.versionAdvisory?.checkedAt ?? null,
        currentVersion: snapshot.versionAdvisory?.currentVersion ?? null,
        latestVersion: snapshot.versionAdvisory?.latestVersion ?? null,
        status: snapshot.versionAdvisory?.status ?? "unknown",
      },
    });

    expect(rows).toContainEqual({
      label: "Launch check",
      value: "Can launch · 1 local install found",
    });
    expect(rows.map((row) => row.label)).toEqual([
      "Controller",
      "Native interface",
      "Version",
      "Version status",
      "Launch check",
      "Models",
      "Capabilities",
      "Last checked",
    ]);
    expect(JSON.stringify(rows)).not.toContain("felix@example.com");
    expect(JSON.stringify(rows)).not.toContain("/opt/homebrew/bin/codex");
    expect(JSON.stringify(rows)).not.toContain("npm install");
    expect(JSON.stringify(rows)).not.toContain("Private skill");
    expect(JSON.stringify(rows)).not.toContain("Private diagnostic message");
  });

  it("creates a stable summary and details for a ready controller", () => {
    const snapshot = agentControllerInterfaceSnapshot();

    expect(formatAgentControllerInterfaceSummary(snapshot)).toBe(
      "Authenticated · felix@example.com · v0.38.0"
    );
    expect(
      resolveAgentControllerInterfaceDescription({
        displayDescription: "Built-in local agent found on this computer.",
        snapshot,
      })
    ).toBe("OpenMeld can launch this controller on this computer.");
    expect(createAgentControllerInterfaceDisplayRows(snapshot)).toContainEqual({
      label: "Controller",
      value: "Enabled",
    });
    expect(createAgentControllerInterfaceDisplayRows(snapshot)).toContainEqual({
      label: "Native interface",
      value: "Codex App Server",
    });
    expect(createAgentControllerInterfaceDisplayRows(snapshot)).toContainEqual({
      label: "Launch check",
      value: "Can launch · /opt/homebrew/bin/codex · 1 local install found",
    });
    expect(createAgentControllerInterfaceDisplayRows(snapshot)).toContainEqual({
      label: "Version status",
      value: "Not checked",
    });
    expect(createAgentControllerInterfaceDisplayRows(snapshot)).toContainEqual({
      label: "Capabilities",
      value:
        "Approvals, Cancel, Model selection, Native event stream, Permission modes",
    });
    expect(shouldExpandAgentControllerInterface(snapshot)).toBe(false);
  });

  it("does not describe a privacy-redacted command path as missing", () => {
    const snapshot = agentControllerInterfaceSnapshot({
      launch: {
        argsPrefix: [],
        commandPath: null,
        installChoiceCount: 1,
        status: "ready",
      },
    });

    expect(createAgentControllerInterfaceDisplayRows(snapshot)).toContainEqual({
      label: "Launch check",
      value: "Can launch · 1 local install found",
    });
  });

  it("deduplicates generic authenticated labels from older controller snapshots", () => {
    expect(
      formatAgentControllerInterfaceSummary(
        agentControllerInterfaceSnapshot({
          auth: {
            label: "Signed in",
            status: "authenticated",
            type: "opencode",
          },
          version: "1.17.11",
        })
      )
    ).toBe("Authenticated · v1.17.11");
    expect(
      createAgentControllerInterfaceDisplayRows(
        agentControllerInterfaceSnapshot({
          auth: {
            label: "Authenticated",
            status: "authenticated",
            type: "opencode",
          },
        })
      )
    ).toContainEqual({
      label: "Account",
      value: "Authenticated",
    });
  });

  it("presents controller update advisories without changing readiness copy", () => {
    const snapshot = agentControllerInterfaceSnapshot({
      versionAdvisory: {
        checkedAt: "2026-06-28T12:01:00.000Z",
        currentVersion: "0.38.0",
        latestVersion: "0.39.0",
        message: "Update available.",
        status: "behind_latest",
        updateCommand: "npm install -g @openai/codex@latest",
      },
    });

    expect(getAgentControllerVersionAdvisoryPresentation(snapshot)).toEqual({
      detail: "Update available.",
      label: "Update",
      tone: "warning",
      updateCommand: "npm install -g @openai/codex@latest",
    });
    expect(createAgentControllerInterfaceDisplayRows(snapshot)).toContainEqual({
      label: "Version status",
      value: "Update available · v0.39.0",
    });
    expect(createAgentControllerInterfaceDisplayRows(snapshot)).toContainEqual({
      label: "Update command",
      value: "npm install -g @openai/codex@latest",
    });
    expect(
      resolveAgentControllerInterfaceDescription({
        displayDescription: "Built-in local agent found on this computer.",
        snapshot,
      })
    ).toBe("OpenMeld can launch this controller on this computer.");
    expect(shouldExpandAgentControllerInterface(snapshot)).toBe(false);
  });

  it("labels the Claude Agent SDK native interface explicitly", () => {
    const snapshot = agentControllerInterfaceSnapshot({
      nativeInterface: "claude-agent-sdk",
    });

    expect(createAgentControllerInterfaceDisplayRows(snapshot)).toContainEqual({
      label: "Native interface",
      value: "Claude Agent SDK",
    });
  });

  it("distinguishes a missing native model list from no model support", () => {
    const snapshot = agentControllerInterfaceSnapshot({
      controllerId: "claude-code",
      displayName: "Claude Code",
      models: [],
      nativeInterface: "claude-agent-sdk",
    });

    expect(createAgentControllerInterfaceDisplayRows(snapshot)).toContainEqual({
      label: "Models",
      value: "No native model list reported",
    });
  });

  it("defaults attention states to expanded", () => {
    expect(
      shouldExpandAgentControllerInterface(
        agentControllerInterfaceSnapshot({
          auth: { status: "unauthenticated" },
          status: "warning",
        })
      )
    ).toBe(true);
  });

  it("distinguishes a failed check from a broken controller", () => {
    const snapshot = agentControllerInterfaceSnapshot({
      auth: { status: "unknown" },
      check: {
        lastSucceededAt: "2026-06-28T11:55:00.000Z",
        status: "failed",
      },
      message: null,
      status: "unknown",
      version: "1.18.1",
    });

    expect(formatAgentControllerInterfaceSummary(snapshot)).toBe(
      "Couldn't check · v1.18.1"
    );
    expect(
      resolveAgentControllerInterfaceDescription({
        displayDescription: "Built-in local agent found on this computer.",
        snapshot,
      })
    ).toBe(
      "OpenMeld couldn't finish checking Codex. It will try again automatically."
    );
    expect(createAgentControllerInterfaceDisplayRows(snapshot)).toEqual(
      expect.arrayContaining([
        {
          label: "Controller",
          value: "Couldn't check",
        },
        {
          label: "Account",
          value: "Not checked",
        },
        expect.objectContaining({
          label: "Last successful check",
        }),
      ])
    );
    expect(shouldExpandAgentControllerInterface(snapshot)).toBe(true);
  });

  it("keeps controller-specific not-signed-in detail ahead of the generic fallback", () => {
    expect(
      resolveAgentControllerInterfaceDescription({
        displayDescription: "Built-in local agent found on this computer.",
        snapshot: agentControllerInterfaceSnapshot({
          auth: { status: "unauthenticated" },
          message:
            "Codex CLI is installed, but this computer is not signed in to Codex.",
          status: "error",
        }),
      })
    ).toBe(
      "Codex CLI is installed, but this computer is not signed in to Codex."
    );
  });

  it("keeps controller-specific not-signed-in detail when the resolver has no message", () => {
    expect(
      resolveAgentControllerInterfaceDescription({
        displayDescription: "Built-in local agent found on this computer.",
        snapshot: agentControllerInterfaceSnapshot({
          auth: { status: "unauthenticated" },
          message: null,
          status: "error",
        }),
      })
    ).toBe(
      "Codex CLI is installed, but this computer is not signed in to Codex."
    );
  });

  it("falls back to generic not-signed-in detail for an unnamed controller", () => {
    expect(
      resolveAgentControllerInterfaceDescription({
        displayDescription: "Local agent found on this computer.",
        snapshot: agentControllerInterfaceSnapshot({
          auth: { status: "unauthenticated" },
          controllerId: "custom-controller",
          message: null,
          status: "error",
        }),
      })
    ).toBe("Installed, but this controller is not signed in.");
  });
});

function agentControllerInterfaceSnapshot(
  overrides: Partial<AgentControllerInterfaceSnapshot> = {}
): AgentControllerInterfaceSnapshot {
  return {
    agentControllerRef: "builtin:codex",
    auth: {
      email: "felix@example.com",
      label: "OpenAI",
      status: "authenticated",
      type: "chatgpt",
    },
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: false,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: false,
    },
    checkedAt: "2026-06-28T12:00:00.000Z",
    controllerId: "codex",
    displayName: "Codex",
    launch: {
      argsPrefix: [],
      commandPath: "/opt/homebrew/bin/codex",
      installChoiceCount: 1,
      status: "ready",
    },
    message: null,
    models: [{ displayName: "GPT-5.5", id: "gpt-5.5" }],
    nativeInterface: "codex-app-server",
    schemaVersion: 1,
    skills: [],
    status: "ready",
    version: "0.38.0",
    ...overrides,
  };
}
