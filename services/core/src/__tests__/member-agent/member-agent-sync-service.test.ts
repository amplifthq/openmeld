import {
  type DetectedHarnessKind,
  type EnsureDetectedMemberAgentRpcResult,
  ensureDetectedMemberAgentRpcResultSchema,
  type ListMemberAgentsResponse,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  MEMBER_AGENT_SYNC_CONVERSATION_REQUIRED_REASON,
  type MemberAgentSyncDeps,
  syncMemberAgents,
} from "../../member-agent/application/member-agent-sync-service";
import { projectRuntimeHarnesses } from "../../member-agent/application/runtime-harness-catalog";
import type { RuntimeHarnessCatalogEntry } from "../../member-agent/infrastructure/postgresql/runtime-harness-presence-repo";
import {
  catalogEntry,
  listing,
  memberAgent,
  NOW_MS,
} from "./member-agent-test-fixtures";

const DEFAULT_PROFILE_ID = "agt_00000000-0000-4000-8000-000000000001";

function ensured(
  created: boolean,
  harnessKind = "claude-code"
): EnsureDetectedMemberAgentRpcResult {
  return ensureDetectedMemberAgentRpcResultSchema.parse({
    ok: true,
    created,
    memberAgent: memberAgent({
      defaultProfileId: DEFAULT_PROFILE_ID,
      harnessKind: harnessKind as "claude-code",
      id: "ma-1",
    }),
  });
}

function createDeps(input: {
  entries: RuntimeHarnessCatalogEntry[];
  controllerRefs?: Record<string, string>;
  existing?: ListMemberAgentsResponse;
  hasBinding?: boolean;
}) {
  const deps = {
    assignBoundProfile: vi.fn(async () => "assigned" as const),
    ensureDetectedMemberAgent: vi.fn(async (harnessKind: DetectedHarnessKind) =>
      ensured(true, harnessKind)
    ),
    hasAnyBinding: vi.fn(async () => input.hasBinding ?? false),
    listOwnerMemberAgents: vi.fn(async () => input.existing ?? listing([])),
    listRuntimeHarnesses: vi.fn(async () =>
      projectRuntimeHarnesses({ entries: input.entries, nowMs: NOW_MS })
    ),
    openDirectMessage: vi.fn(async () => ({ spaceId: "space-dm" })),
    readGroupingControllerRef: vi.fn(
      async (agentProfileId: string) =>
        input.controllerRefs?.[agentProfileId] ?? null
    ),
    writeDefaultBinding: vi.fn(
      async (): Promise<{
        reasonCodes: string[];
        status: "accepted" | "rejected";
      }> => ({ reasonCodes: [], status: "accepted" })
    ),
  } satisfies MemberAgentSyncDeps;
  return deps;
}

describe("syncMemberAgents", () => {
  it("creates one MemberAgent for a Harness on two computers and binds it to one", async () => {
    const deps = createDeps({
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:claude-code",
          openMeldServiceRuntimeId: "runtime-imac",
          reportObservedAtMs: NOW_MS - 500,
          reportStatus: "unavailable",
          reasonCodes: ["controller.auth.unauthenticated"],
        }),
        catalogEntry({
          agentControllerRef: "builtin:claude-code",
          openMeldServiceRuntimeId: "runtime-macbook",
          reportObservedAtMs: NOW_MS - 5000,
        }),
      ],
    });

    const { results } = await syncMemberAgents(deps);

    expect(deps.ensureDetectedMemberAgent).toHaveBeenCalledTimes(1);
    expect(deps.ensureDetectedMemberAgent).toHaveBeenCalledWith("claude-code");
    expect(deps.writeDefaultBinding).toHaveBeenCalledTimes(1);
    // The ready computer wins over the newer but signed-out one.
    expect(deps.writeDefaultBinding).toHaveBeenCalledWith({
      agentProfileId: DEFAULT_PROFILE_ID,
      target: expect.objectContaining({
        agentControllerRef: "builtin:claude-code",
        openMeldServiceRuntimeId: "runtime-macbook",
      }),
    });
    expect(deps.openDirectMessage).toHaveBeenCalledWith(DEFAULT_PROFILE_ID);
    expect(results).toEqual([
      {
        binding: "succeeded",
        defaultProfileId: DEFAULT_PROFILE_ID,
        directMessage: "succeeded",
        directMessageSpaceId: "space-dm",
        harnessKind: "claude-code",
        memberAgentId: "ma-1",
        outcome: "created",
        reasonCodes: [],
      },
    ]);
  });

  it("creates every Harness the latest catalog reports, even when an auth check expired the report", async () => {
    // Smoke R2B-05: Codex and Claude Code carry auth snapshots, so Core
    // shortens their report expiry to the two-minute auth freshness. Between
    // checks the reports read expired while the computer keeps reporting.
    const harnesses = [
      "antigravity",
      "claude-code",
      "codex",
      "cursor",
      "grok-build",
      "opencode",
    ];
    const deps = createDeps({
      entries: harnesses.map((harnessKind) =>
        catalogEntry({
          agentControllerRef: `builtin:${harnessKind}`,
          openMeldServiceRuntimeId: "runtime-macbook",
          ...(harnessKind === "codex" || harnessKind === "claude-code"
            ? {
                reportAcceptedAtMs: NOW_MS - 40_000,
                reportExpiresAtMs: NOW_MS - 30_000,
              }
            : {}),
        })
      ),
    });

    const { results } = await syncMemberAgents(deps);

    expect(results.map((result) => result.harnessKind)).toEqual(harnesses);
    expect(results.every((result) => result.outcome === "created")).toBe(true);
    expect(deps.ensureDetectedMemberAgent).toHaveBeenCalledTimes(6);
  });

  it("binds to a computer with an unexpired report before a newer expired one", async () => {
    const deps = createDeps({
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-expired",
          reportExpiresAtMs: NOW_MS - 1,
          reportObservedAtMs: NOW_MS - 500,
          reportStatus: "unavailable",
        }),
        catalogEntry({
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-current",
          reportObservedAtMs: NOW_MS - 5000,
          reportStatus: "unavailable",
        }),
      ],
    });

    await syncMemberAgents(deps);

    expect(deps.writeDefaultBinding).toHaveBeenCalledWith({
      agentProfileId: DEFAULT_PROFILE_ID,
      target: expect.objectContaining({
        openMeldServiceRuntimeId: "runtime-current",
      }),
    });
  });

  it("adds nothing for a second computer once the MemberAgent is bound", async () => {
    const deps = createDeps({
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-imac",
        }),
      ],
      existing: listing([
        memberAgent({
          defaultProfileId: DEFAULT_PROFILE_ID,
          harnessKind: "codex",
          id: "ma-codex",
        }),
      ]),
      hasBinding: true,
    });

    const { results } = await syncMemberAgents(deps);

    expect(deps.ensureDetectedMemberAgent).not.toHaveBeenCalled();
    expect(deps.writeDefaultBinding).not.toHaveBeenCalled();
    expect(deps.openDirectMessage).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      memberAgentId: "ma-codex",
      outcome: "unchanged",
    });
  });

  it("assigns an unassigned Profile bound to a Harness that has a MemberAgent", async () => {
    // Smoke: "Cursor (folder moved)" was created from the web and bound to
    // builtin:cursor, but stayed outside the existing Cursor MemberAgent.
    const existing = {
      ...listing([
        memberAgent({
          defaultProfileId: DEFAULT_PROFILE_ID,
          harnessKind: "cursor",
          id: "ma-cursor",
        }),
      ]),
      unassignedProfiles: [
        { openMeldProfileId: "agt-second-cursor", profileName: "Second" },
        { openMeldProfileId: "agt-custom", profileName: "Custom" },
        { openMeldProfileId: "agt-codex", profileName: "Codex Helper" },
        { openMeldProfileId: "agt-never-bound", profileName: "Draft" },
      ],
    };
    const deps = createDeps({
      controllerRefs: {
        "agt-codex": "builtin:codex",
        "agt-custom": "custom:my-runner",
        "agt-second-cursor": "builtin:cursor",
      },
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:cursor",
          openMeldServiceRuntimeId: "runtime-1",
        }),
      ],
      existing,
      hasBinding: true,
    });

    const { assignedProfileIds } = await syncMemberAgents(deps);

    expect(assignedProfileIds).toEqual(["agt-second-cursor"]);
    // Custom controllers, never-bound Profiles, and Harnesses without a
    // MemberAgent stay unassigned.
    expect(deps.assignBoundProfile).toHaveBeenCalledTimes(1);
    expect(deps.assignBoundProfile).toHaveBeenCalledWith({
      agentControllerRef: "builtin:cursor",
      agentProfileId: "agt-second-cursor",
    });
  });

  it("assigns bound Profiles while no Harness is detected", async () => {
    // The computer is offline: the Binding and the MemberAgent still decide.
    const deps = createDeps({
      controllerRefs: { "agt-second-cursor": "builtin:cursor" },
      entries: [],
      existing: {
        ...listing([
          memberAgent({
            defaultProfileId: DEFAULT_PROFILE_ID,
            harnessKind: "cursor",
            id: "ma-cursor",
          }),
        ]),
        unassignedProfiles: [
          { openMeldProfileId: "agt-second-cursor", profileName: "Second" },
        ],
      },
    });

    expect(await syncMemberAgents(deps)).toEqual({
      assignedProfileIds: ["agt-second-cursor"],
      results: [],
    });
  });

  it("assigns a bound Profile to the MemberAgent this sync created", async () => {
    const before = {
      ...listing([]),
      unassignedProfiles: [
        { openMeldProfileId: "agt-codex-helper", profileName: "Helper" },
      ],
    };
    const after = {
      ...listing([
        memberAgent({
          defaultProfileId: DEFAULT_PROFILE_ID,
          harnessKind: "codex",
          id: "ma-1",
        }),
      ]),
      unassignedProfiles: before.unassignedProfiles,
    };
    const deps = createDeps({
      controllerRefs: { "agt-codex-helper": "builtin:codex" },
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
        }),
      ],
    });
    deps.listOwnerMemberAgents
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

    const { assignedProfileIds, results } = await syncMemberAgents(deps);

    expect(results[0]?.outcome).toBe("created");
    expect(assignedProfileIds).toEqual(["agt-codex-helper"]);
  });

  it("finishes the Binding of a detected MemberAgent that has none", async () => {
    const deps = createDeps({
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
        }),
      ],
      existing: listing([
        memberAgent({
          defaultProfileId: DEFAULT_PROFILE_ID,
          harnessKind: "codex",
          id: "ma-codex",
        }),
      ]),
    });

    const {
      results: [result],
    } = await syncMemberAgents(deps);

    expect(deps.ensureDetectedMemberAgent).not.toHaveBeenCalled();
    expect(deps.writeDefaultBinding).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      binding: "succeeded",
      outcome: "completed",
    });
  });

  it("never sets up a migrated MemberAgent's Profiles", async () => {
    const deps = createDeps({
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
        }),
      ],
      existing: listing([
        memberAgent({
          defaultProfileId: DEFAULT_PROFILE_ID,
          harnessKind: "codex",
          id: "ma-codex",
          source: "migrated",
        }),
      ]),
    });

    const {
      results: [result],
    } = await syncMemberAgents(deps);

    expect(deps.hasAnyBinding).not.toHaveBeenCalled();
    expect(deps.writeDefaultBinding).not.toHaveBeenCalled();
    expect(result?.outcome).toBe("unchanged");
  });

  it("resumes an interrupted detected creation through Auth", async () => {
    const deps = createDeps({
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:claude-code",
          openMeldServiceRuntimeId: "runtime-1",
        }),
      ],
      existing: listing([
        memberAgent({ harnessKind: "claude-code", id: "ma-1" }),
      ]),
    });
    deps.ensureDetectedMemberAgent.mockResolvedValueOnce(ensured(false));

    const {
      results: [result],
    } = await syncMemberAgents(deps);

    expect(deps.ensureDetectedMemberAgent).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ outcome: "completed" });
  });

  it("skips hosted, custom, stale, undetected, and turned-off controllers", async () => {
    const deps = createDeps({
      entries: [
        catalogEntry({
          agentControllerRef: "custom:my-agent",
          openMeldServiceRuntimeId: "runtime-1",
        }),
        catalogEntry({
          agentControllerRef: "hosted:remote-agent",
          openMeldServiceRuntimeId: "runtime-1",
        }),
        catalogEntry({
          agentControllerRef: "builtin:cursor",
          openMeldServiceRuntimeId: "runtime-1",
          // The computer stopped reporting more than ten minutes ago.
          reportAcceptedAtMs: NOW_MS - 11 * 60_000,
          reportExpiresAtMs: NOW_MS - 1,
        }),
        catalogEntry({
          agentControllerRef: "builtin:opencode",
          openMeldServiceRuntimeId: "runtime-1",
          reasonCodes: ["local_agent_preparation.not_detected"],
          reportStatus: "unavailable",
        }),
        catalogEntry({
          agentControllerRef: "builtin:openclaw",
          openMeldServiceRuntimeId: "runtime-1",
          reportStatus: "disabled",
        }),
      ],
    });

    expect(await syncMemberAgents(deps)).toEqual({
      assignedProfileIds: [],
      results: [],
    });
    expect(deps.ensureDetectedMemberAgent).not.toHaveBeenCalled();
  });

  it("does not create a shared-account Harness without a chosen conversation", async () => {
    const deps = createDeps({
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:grok-bot",
          openMeldServiceRuntimeId: "runtime-1",
        }),
      ],
    });

    const {
      results: [result],
    } = await syncMemberAgents(deps);

    expect(deps.ensureDetectedMemberAgent).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      harnessKind: "grok-bot",
      outcome: "skipped",
      reasonCodes: [MEMBER_AGENT_SYNC_CONVERSATION_REQUIRED_REASON],
    });
  });

  it("reports an Auth refusal and a rejected Binding without throwing", async () => {
    const refused = createDeps({
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
        }),
      ],
    });
    refused.ensureDetectedMemberAgent.mockResolvedValueOnce({
      ok: false,
      code: "organization.membership_required",
      message: "not a member",
    });
    expect((await syncMemberAgents(refused)).results[0]).toMatchObject({
      outcome: "skipped",
      reasonCodes: ["organization.membership_required"],
    });
    expect(refused.writeDefaultBinding).not.toHaveBeenCalled();

    const rejected = createDeps({
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:claude-code",
          openMeldServiceRuntimeId: "runtime-1",
        }),
      ],
    });
    rejected.writeDefaultBinding.mockResolvedValueOnce({
      reasonCodes: [
        "agent_profile_binding.agent_controller_report_unavailable",
      ],
      status: "rejected",
    });
    rejected.openDirectMessage.mockRejectedValueOnce(
      Object.assign(new Error("dm"), {
        code: "direct_message.target_not_found",
      })
    );
    expect((await syncMemberAgents(rejected)).results[0]).toMatchObject({
      binding: "rejected",
      directMessage: "failed",
      outcome: "created",
      reasonCodes: [
        "agent_profile_binding.agent_controller_report_unavailable",
        "direct_message.target_not_found",
      ],
    });
  });
});
