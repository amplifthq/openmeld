import {
  AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "@openmeld/agent-runtime";
import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { AcceptedRuntimeAgentControllerReport } from "../runtime-registry/application/runtime-agent-controller-report-service";
import { notifyAgentProfileWorkUsageRecoveryAvailable } from "../runtime-transport/application/agent-profile-work-usage-recovery";

const NOW_MS = Date.parse("2026-08-30T00:10:00.000Z");
const PROFILE_1 = "agt_11111111-1111-4111-8111-111111111111";
const PROFILE_2 = "agt_22222222-2222-4222-8222-222222222222";

describe("Agent Profile work Usage recovery", () => {
  it("notifies the owner shard only for Profiles on the exact reported Runtime and Agent Controller", async () => {
    const listBindings = vi
      .fn()
      .mockResolvedValue([
        { agentProfileId: PROFILE_1 },
        { agentProfileId: PROFILE_2 },
      ]);
    const notifyUsageAvailable = vi.fn().mockResolvedValue({
      changedProfileIds: [PROFILE_2],
      continuationProfileIds: [PROFILE_2],
      status: "updated",
    });
    const resumeInterruptedWork = vi.fn().mockResolvedValue(undefined);
    const report = createReport("available");

    await notifyAgentProfileWorkUsageRecoveryAvailable({
      bindingStore: { listBindings },
      currentReport: report,
      notifyUsageAvailable,
      nowMs: NOW_MS,
      ownerUserId: "owner-1",
      resumeInterruptedWork,
    });

    expect(listBindings).toHaveBeenCalledWith({
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "runtime_1",
      owner: { id: "owner-1", kind: "owner_account" },
    });
    expect(notifyUsageAvailable).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      targetProfileIds: [PROFILE_1, PROFILE_2],
    });
    expect(resumeInterruptedWork).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      targetProfileIds: [PROFILE_2],
    });
    expect(notifyUsageAvailable.mock.invocationCallOrder[0]).toBeLessThan(
      resumeInterruptedWork.mock.invocationCallOrder[0] ?? 0
    );
  });

  it.each([
    "exhausted",
    "stale",
    "unavailable",
    "unsupported",
  ] as const)("does not wake the coordinator from %s Usage evidence", async (status) => {
    const listBindings = vi.fn();
    const notifyUsageAvailable = vi.fn();
    const resumeInterruptedWork = vi.fn();

    await notifyAgentProfileWorkUsageRecoveryAvailable({
      bindingStore: { listBindings },
      currentReport: createReport(status),
      notifyUsageAvailable,
      nowMs: NOW_MS,
      ownerUserId: "owner-1",
      resumeInterruptedWork,
    });

    expect(listBindings).not.toHaveBeenCalled();
    expect(notifyUsageAvailable).not.toHaveBeenCalled();
    expect(resumeInterruptedWork).not.toHaveBeenCalled();
  });

  it("does not call the owner shard when no Profile uses the reported controller", async () => {
    const notifyUsageAvailable = vi.fn();
    const resumeInterruptedWork = vi.fn();

    await notifyAgentProfileWorkUsageRecoveryAvailable({
      bindingStore: { listBindings: vi.fn().mockResolvedValue([]) },
      currentReport: createReport("available"),
      notifyUsageAvailable,
      nowMs: NOW_MS,
      ownerUserId: "owner-1",
      resumeInterruptedWork,
    });

    expect(notifyUsageAvailable).not.toHaveBeenCalled();
    expect(resumeInterruptedWork).not.toHaveBeenCalled();
  });

  it("recovers only Profiles using the OpenCode provider whose usage is available", async () => {
    const report = createReport("available");
    const agentControllerInterface = report.agentControllerInterface;
    if (!agentControllerInterface) {
      throw new Error("expected Agent Controller Interface fixture");
    }
    report.agentControllerRef = "builtin:opencode";
    report.agentControllerInterface = {
      ...agentControllerInterface,
      agentControllerRef: "builtin:opencode",
      controllerId: "opencode",
      displayName: "OpenCode",
      usageLimits: [
        {
          key: "opencode-go:rolling",
          label: "5-hour usage",
          observedAt: "2026-08-30T00:09:00.000Z",
          provider: { displayName: "OpenCode Go", id: "opencode-go" },
          resetsAt: "2026-08-30T01:00:00.000Z",
          status: "available",
          usedPercent: 42,
        },
        {
          key: "openai:provider",
          label: "Usage limits",
          observedAt: "2026-08-30T00:09:00.000Z",
          provider: { displayName: "OpenAI", id: "openai" },
          resetsAt: null,
          status: "unsupported",
          usedPercent: null,
        },
      ],
    };
    const notifyUsageAvailable = vi.fn().mockResolvedValue({
      changedProfileIds: [PROFILE_1],
      continuationProfileIds: [PROFILE_1],
      status: "updated",
    });

    await notifyAgentProfileWorkUsageRecoveryAvailable({
      bindingStore: {
        listBindings: vi.fn().mockResolvedValue([
          { agentProfileId: PROFILE_1, modelId: "opencode-go/qwen3-coder" },
          { agentProfileId: PROFILE_2, modelId: "openai/gpt-5.4" },
        ]),
      },
      currentReport: report,
      notifyUsageAvailable,
      nowMs: NOW_MS,
      ownerUserId: "owner-1",
      resumeInterruptedWork: vi.fn(),
    });

    expect(notifyUsageAvailable).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      targetProfileIds: [PROFILE_1],
    });
  });

  it("accepts an old owner shard response without continuation Profile ids", async () => {
    const resumeInterruptedWork = vi.fn();

    await notifyAgentProfileWorkUsageRecoveryAvailable({
      bindingStore: {
        listBindings: vi
          .fn()
          .mockResolvedValue([{ agentProfileId: PROFILE_1 }]),
      },
      currentReport: createReport("available"),
      notifyUsageAvailable: vi.fn().mockResolvedValue({
        changedProfileIds: [PROFILE_1],
        status: "updated",
      }),
      nowMs: NOW_MS,
      ownerUserId: "owner-1",
      resumeInterruptedWork,
    });

    expect(resumeInterruptedWork).not.toHaveBeenCalled();
  });

  it("notifies more than 100 matching Profiles in stable contract-sized batches", async () => {
    const profileIds = Array.from({ length: 101 }, (_, index) =>
      createProfileId(index + 1)
    );
    const continuationProfileIds = [profileIds[99], profileIds[100]];
    const notifyUsageAvailable = vi.fn(
      async (input: {
        ownerUserId: string;
        targetProfileIds: readonly string[];
      }) => ({
        changedProfileIds: [],
        continuationProfileIds: input.targetProfileIds.filter((profileId) =>
          continuationProfileIds.includes(profileId)
        ),
        status: "updated" as const,
      })
    );
    const resumeInterruptedWork = vi.fn().mockResolvedValue(undefined);

    await notifyAgentProfileWorkUsageRecoveryAvailable({
      bindingStore: {
        listBindings: vi
          .fn()
          .mockResolvedValue(
            profileIds.map((agentProfileId) => ({ agentProfileId }))
          ),
      },
      currentReport: createReport("available"),
      notifyUsageAvailable,
      nowMs: NOW_MS,
      ownerUserId: "owner-1",
      resumeInterruptedWork,
    });

    expect(notifyUsageAvailable).toHaveBeenCalledTimes(2);
    expect(notifyUsageAvailable).toHaveBeenNthCalledWith(1, {
      ownerUserId: "owner-1",
      targetProfileIds: profileIds.slice(0, 100),
    });
    expect(notifyUsageAvailable).toHaveBeenNthCalledWith(2, {
      ownerUserId: "owner-1",
      targetProfileIds: profileIds.slice(100),
    });
    expect(resumeInterruptedWork).toHaveBeenCalledOnce();
    expect(resumeInterruptedWork).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      targetProfileIds: continuationProfileIds,
    });
  });

  it("isolates one rejected Profile without blocking healthy Profiles in the same report", async () => {
    const notifyUsageAvailable = vi.fn(
      (input: { targetProfileIds: readonly string[] }) => {
        if (input.targetProfileIds.includes(PROFILE_1)) {
          return Promise.reject(new Error("broken Profile state"));
        }
        return Promise.resolve({
          changedProfileIds: [PROFILE_2],
          continuationProfileIds: [PROFILE_2],
          status: "updated" as const,
        });
      }
    );
    const resumeInterruptedWork = vi.fn().mockResolvedValue(undefined);

    await notifyAgentProfileWorkUsageRecoveryAvailable({
      bindingStore: {
        listBindings: vi
          .fn()
          .mockResolvedValue([
            { agentProfileId: PROFILE_1 },
            { agentProfileId: PROFILE_2 },
          ]),
      },
      currentReport: createReport("available"),
      notifyUsageAvailable,
      nowMs: NOW_MS,
      ownerUserId: "owner-1",
      resumeInterruptedWork,
    });

    expect(notifyUsageAvailable).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      targetProfileIds: [PROFILE_2],
    });
    expect(resumeInterruptedWork).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      targetProfileIds: [PROFILE_2],
    });
  });
});

function createProfileId(index: number): string {
  const suffix = index.toString(16).padStart(12, "0");
  return `agt_00000000-0000-4000-8000-${suffix}`;
}

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
    usageLimitsSupportMatrixVersion:
      AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
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
