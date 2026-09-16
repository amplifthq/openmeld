import { createAuthorityOpenMeldServiceRuntimeId } from "@openmeld/agent-runtime";
import type {
  AgentControllerInterfaceSnapshot,
  AgentControllerUsageLimits,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { readAgentProfileUsage } from "../src/agent-execution/application/agent-profile-usage";
import type { AcceptedRuntimeAgentControllerReport } from "../src/runtime-registry/application/runtime-agent-controller-report-service";

const nowMs = Date.parse("2026-09-15T00:00:00Z");
const limits: AgentControllerUsageLimits = [
  {
    key: "weekly",
    label: "Weekly usage",
    status: "available",
    usedPercent: 92,
    observedAt: new Date(nowMs).toISOString(),
    resetsAt: new Date(nowMs + 3_600_000).toISOString(),
  },
];
const snapshot: AgentControllerInterfaceSnapshot = {
  schemaVersion: 1,
  agentControllerRef: "builtin:codex",
  controllerId: "codex",
  displayName: "Codex",
  nativeInterface: "codex-app-server",
  status: "ready",
  checkedAt: new Date(nowMs).toISOString(),
  auth: { status: "authenticated" },
  launch: {
    status: "ready",
    installChoiceCount: 1,
    commandPath: "/private/bin/codex",
    argsPrefix: [],
  },
  capabilities: {
    approvals: true,
    cancel: true,
    interrupt: true,
    modelSelection: true,
    nativeEventStream: true,
    permissionModes: true,
    structuredUserInput: true,
  },
  models: [],
  skills: [],
  message: null,
  version: "1.0.0",
  usageLimits: limits,
};
const report: AcceptedRuntimeAgentControllerReport = {
  openMeldServiceRuntimeId: createAuthorityOpenMeldServiceRuntimeId({
    openMeldServiceRuntimeId: "runtime-a",
    source: "runtime_registry_authority",
  }),
  agentControllerRef: "builtin:codex",
  status: "ready",
  observedAtMs: nowMs,
  expiresAtMs: nowMs + 60_000,
  reasonCodes: [],
  agentControllerInterface: snapshot,
};
const binding = {
  executionTarget: {
    openMeldServiceRuntimeId: "runtime-a",
    agentControllerRef: "builtin:codex",
  },
  modelSelection: { modelId: "gpt-5.6-sol" },
};

describe("Agent Profile shared usage", () => {
  it.each([
    0, 60_000,
  ])("reads the exact bound controller and preserves expired evidence as stale (%i ms)", async (age) => {
    const read = vi
      .fn<
        Parameters<
          typeof readAgentProfileUsage
        >[0]["reads"]["readCurrentRuntimeAgentControllerReports"]
      >()
      .mockResolvedValue([report]);
    const result = await readAgentProfileUsage({
      db: {} as D1Database,
      binding,
      reads: { readCurrentRuntimeAgentControllerReports: read },
      nowMs: nowMs + age,
    });
    expect(result).toEqual([
      { ...limits[0], status: age === 0 ? "available" : "stale" },
    ]);
    expect(JSON.stringify(result)).not.toContain("/private");
    expect(read.mock.calls[0]?.[0]).toMatchObject({
      agentControllerRefs: ["builtin:codex"],
      openMeldServiceRuntimeId: { value: "runtime-a" },
    });
  });
  it("does not borrow another controller or provider's quota", async () => {
    const read = vi.fn().mockResolvedValue([report]);
    const input = {
      db: {} as D1Database,
      binding: {
        ...binding,
        executionTarget: {
          ...binding.executionTarget,
          agentControllerRef: "builtin:opencode",
        },
        modelSelection: { modelId: "other/model" },
      },
      reads: { readCurrentRuntimeAgentControllerReports: read },
      nowMs,
    };
    expect(await readAgentProfileUsage(input)).toEqual([]);
    read.mockResolvedValue([
      {
        ...report,
        agentControllerRef: "builtin:opencode",
        agentControllerInterface: {
          ...snapshot,
          usageLimits: [
            {
              ...limits[0],
              provider: { id: "opencode-go", displayName: "OpenCode Go" },
            },
          ],
        },
      },
    ]);
    expect(await readAgentProfileUsage(input)).toEqual([]);
    expect(
      await readAgentProfileUsage({
        ...input,
        binding: {
          ...input.binding,
          modelSelection: { modelId: "opencode-go/model" },
        },
      })
    ).toEqual([
      {
        ...limits[0],
        provider: { id: "opencode-go", displayName: "OpenCode Go" },
      },
    ]);
    expect(await readAgentProfileUsage({ ...input, binding: null })).toEqual(
      []
    );
  });
});
