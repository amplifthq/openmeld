import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "@openmeld/agent-runtime";
import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { AcceptedRuntimeAgentControllerReport } from "../runtime-registry/application/runtime-agent-controller-report-service";
import { notifyAgentProfileWorkUsageRecoveryAvailable } from "../runtime-transport/application/agent-profile-work-usage-recovery";

const NOW_MS = Date.parse("2026-08-30T00:10:00.000Z");

describe("Agent Profile work Usage recovery", () => {
  it("notifies the owner shard only for Profiles on the exact reported Runtime and Agent Controller", async () => {
    const listBindings = vi
      .fn()
      .mockResolvedValue([
        { agentProfileId: "agt_profile_1" },
        { agentProfileId: "agt_profile_2" },
      ]);
    const notifyUsageAvailable = vi.fn().mockResolvedValue(undefined);
    const report = createReport("available");

    await notifyAgentProfileWorkUsageRecoveryAvailable({
      bindingStore: { listBindings },
      currentReport: report,
      notifyUsageAvailable,
      nowMs: NOW_MS,
      ownerUserId: "owner-1",
    });

    expect(listBindings).toHaveBeenCalledWith({
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "runtime_1",
      owner: { id: "owner-1", kind: "owner_account" },
    });
    expect(notifyUsageAvailable).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      targetProfileIds: ["agt_profile_1", "agt_profile_2"],
    });
  });

  it.each([
    "exhausted",
    "stale",
    "unavailable",
    "unsupported",
  ] as const)("does not wake the coordinator from %s Usage evidence", async (status) => {
    const listBindings = vi.fn();
    const notifyUsageAvailable = vi.fn();

    await notifyAgentProfileWorkUsageRecoveryAvailable({
      bindingStore: { listBindings },
      currentReport: createReport(status),
      notifyUsageAvailable,
      nowMs: NOW_MS,
      ownerUserId: "owner-1",
    });

    expect(listBindings).not.toHaveBeenCalled();
    expect(notifyUsageAvailable).not.toHaveBeenCalled();
  });

  it("does not call the owner shard when no Profile uses the reported controller", async () => {
    const notifyUsageAvailable = vi.fn();

    await notifyAgentProfileWorkUsageRecoveryAvailable({
      bindingStore: { listBindings: vi.fn().mockResolvedValue([]) },
      currentReport: createReport("available"),
      notifyUsageAvailable,
      nowMs: NOW_MS,
      ownerUserId: "owner-1",
    });

    expect(notifyUsageAvailable).not.toHaveBeenCalled();
  });
});

function createReport(
  usageStatus:
    | "available"
    | "exhausted"
    | "stale"
    | "unavailable"
    | "unsupported"
): AcceptedRuntimeAgentControllerReport {
  const usageKnown =
    usageStatus === "available" ||
    usageStatus === "exhausted" ||
    usageStatus === "stale";
  const usedPercent = usageStatus === "exhausted" ? 100 : null;
  const observedUsedPercent = usedPercent ?? (usageKnown ? 42 : null);
  const agentControllerInterface = {
    agentControllerRef: "builtin:codex",
    auth: { status: "authenticated" },
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: true,
    },
    checkedAt: "2026-08-30T00:10:00.000Z",
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
        key: "five_hour",
        label: "5-hour Usage Limit",
        observedAt: "2026-08-30T00:09:00.000Z",
        resetsAt: usageKnown ? "2026-08-30T01:00:00.000Z" : null,
        status: usageStatus,
        usedPercent: observedUsedPercent,
      },
    ],
    version: "1.0.0",
  } satisfies AgentControllerInterfaceSnapshot;
  const lookupInput = createRuntimeLookupInput({
    deviceId: "device-1",
    lane: "openmeld-dev",
    owner: { id: "owner-1", kind: "owner_account" },
  });
  return {
    agentControllerInterface,
    agentControllerRef: "builtin:codex",
    expiresAtMs: NOW_MS + 60_000,
    observedAtMs: NOW_MS,
    openMeldServiceRuntimeId: createAuthorityOpenMeldServiceRuntimeId({
      lookupInput,
      openMeldServiceRuntimeId: "runtime_1",
      source: "runtime_registry_authority",
    }),
    reasonCodes: [],
    status: "ready",
  };
}
