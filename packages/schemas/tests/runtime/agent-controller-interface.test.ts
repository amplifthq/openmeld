import { describe, expect, it } from "vitest";
import { agentControllerInterfaceSnapshotSchema } from "../../src/index";

function createValidAgentControllerInterfaceSnapshot() {
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
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: false,
    },
    checkedAt: "2026-06-29T12:00:00.000Z",
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
    version: "0.142.2",
  } as const;
}

describe("agent controller interface schema", () => {
  it("accepts legacy snapshots without check evidence or version advisory", () => {
    const result = agentControllerInterfaceSnapshotSchema.safeParse(
      createValidAgentControllerInterfaceSnapshot()
    );

    expect(result.success).toBe(true);
  });

  it("accepts a versioned Usage Limits support declaration", () => {
    const result = agentControllerInterfaceSnapshotSchema.safeParse({
      ...createValidAgentControllerInterfaceSnapshot(),
      usageLimitsSupportMatrixVersion: 1,
    });

    expect(result.success).toBe(true);
  });

  it("accepts explicit controller check evidence", () => {
    const result = agentControllerInterfaceSnapshotSchema.safeParse({
      ...createValidAgentControllerInterfaceSnapshot(),
      check: {
        lastSucceededAt: "2026-06-29T11:55:00.000Z",
        status: "failed",
      },
    });

    expect(result.success).toBe(true);
  });

  it.each([
    {
      check: {
        lastSucceededAt: null,
        status: "succeeded",
      },
      name: "a successful check without its success timestamp",
    },
    {
      check: {
        lastSucceededAt: "2026-06-29T11:55:00.000Z",
        status: "not_run",
      },
      name: "a not-run check with historical success evidence",
    },
  ])("rejects $name", ({ check }) => {
    const result = agentControllerInterfaceSnapshotSchema.safeParse({
      ...createValidAgentControllerInterfaceSnapshot(),
      check,
    });

    expect(result.success).toBe(false);
  });

  it("accepts controller version advisories with a manual update command", () => {
    const result = agentControllerInterfaceSnapshotSchema.safeParse({
      ...createValidAgentControllerInterfaceSnapshot(),
      versionAdvisory: {
        checkedAt: "2026-06-29T12:01:00.000Z",
        currentVersion: "0.142.2",
        latestVersion: "0.143.0",
        message: "Update available.",
        status: "behind_latest",
        updateCommand: "npm install -g @openai/codex@latest",
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts the Claude Agent SDK native interface", () => {
    const result = agentControllerInterfaceSnapshotSchema.safeParse({
      ...createValidAgentControllerInterfaceSnapshot(),
      nativeInterface: "claude-agent-sdk",
    });

    expect(result.success).toBe(true);
  });

  it("accepts multiple honest usage-limit windows", () => {
    const result = agentControllerInterfaceSnapshotSchema.safeParse({
      ...createValidAgentControllerInterfaceSnapshot(),
      usageLimits: [
        {
          key: "codex:primary",
          label: "5-hour usage",
          observedAt: "2026-06-29T12:00:00.000Z",
          resetsAt: "2026-06-29T15:00:00.000Z",
          status: "available",
          usedPercent: 82,
        },
        {
          key: "codex:secondary",
          label: "Weekly usage",
          observedAt: "2026-06-29T12:00:00.000Z",
          resetsAt: null,
          status: "stale",
          usedPercent: 96,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it.each([
    "unsupported",
    "unavailable",
  ] as const)("accepts %s evidence without invented usage facts", (status) => {
    const result = agentControllerInterfaceSnapshotSchema.safeParse({
      ...createValidAgentControllerInterfaceSnapshot(),
      usageLimits: [
        {
          key: "provider",
          label: "Usage limits",
          observedAt: "2026-06-29T12:00:00.000Z",
          resetsAt: null,
          status,
          usedPercent: null,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it.each([
    {
      name: "a percentage above 100",
      usageLimit: {
        key: "codex:primary",
        label: "5-hour usage",
        observedAt: "2026-06-29T12:00:00.000Z",
        resetsAt: null,
        status: "available",
        usedPercent: 101,
      },
    },
    {
      name: "an exhausted limit below 100 percent",
      usageLimit: {
        key: "codex:primary",
        label: "5-hour usage",
        observedAt: "2026-06-29T12:00:00.000Z",
        resetsAt: null,
        status: "exhausted",
        usedPercent: 99,
      },
    },
    {
      name: "an available limit at 100 percent",
      usageLimit: {
        key: "codex:primary",
        label: "5-hour usage",
        observedAt: "2026-06-29T12:00:00.000Z",
        resetsAt: null,
        status: "available",
        usedPercent: 100,
      },
    },
    {
      name: "an unavailable limit with fabricated usage",
      usageLimit: {
        key: "provider",
        label: "Usage limits",
        observedAt: "2026-06-29T12:00:00.000Z",
        resetsAt: null,
        status: "unavailable",
        usedPercent: 0,
      },
    },
    {
      name: "stale evidence without a last-known percentage",
      usageLimit: {
        key: "codex:primary",
        label: "5-hour usage",
        observedAt: "2026-06-29T12:00:00.000Z",
        resetsAt: null,
        status: "stale",
        usedPercent: null,
      },
    },
  ])("rejects $name", ({ usageLimit }) => {
    const result = agentControllerInterfaceSnapshotSchema.safeParse({
      ...createValidAgentControllerInterfaceSnapshot(),
      usageLimits: [usageLimit],
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate usage-limit keys", () => {
    const usageLimit = {
      key: "codex:primary",
      label: "5-hour usage",
      observedAt: "2026-06-29T12:00:00.000Z",
      resetsAt: null,
      status: "available",
      usedPercent: 42,
    } as const;
    const result = agentControllerInterfaceSnapshotSchema.safeParse({
      ...createValidAgentControllerInterfaceSnapshot(),
      usageLimits: [usageLimit, usageLimit],
    });

    expect(result.success).toBe(false);
  });
});
