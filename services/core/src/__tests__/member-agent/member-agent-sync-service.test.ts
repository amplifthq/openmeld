import {
  type AssignAgentProfileMemberAgentOutcome,
  type DetectedHarnessKind,
  type EnsureDetectedMemberAgentRpcResult,
  ensureDetectedMemberAgentRpcResultSchema,
  type ListMemberAgentsResponse,
  MEMBER_AGENT_SYNC_HARNESS_NOT_DETECTED_REASON,
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
  harnessKind = "claude-code",
  options: { defaultProfileCandidateId?: string } = {}
): EnsureDetectedMemberAgentRpcResult {
  const candidate = options.defaultProfileCandidateId ?? null;
  return ensureDetectedMemberAgentRpcResultSchema.parse({
    ok: true,
    created,
    defaultProfileCandidateId: candidate,
    memberAgent: memberAgent({
      // Auth sets the default only after Core assigned the candidate.
      defaultProfileId: candidate ? null : DEFAULT_PROFILE_ID,
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
    assignBoundProfile: vi.fn(
      async (): Promise<AssignAgentProfileMemberAgentOutcome | null> =>
        "assigned"
    ),
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

    const { results } = await syncMemberAgents(deps, {
      createHarnessKinds: ["claude-code"],
    });

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

  it("creates every requested Harness the latest catalog reports, even when an auth check expired the report", async () => {
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

    const { results } = await syncMemberAgents(deps, {
      createHarnessKinds: harnesses as DetectedHarnessKind[],
    });

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

    await syncMemberAgents(deps, { createHarnessKinds: ["codex"] });

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
    expect(deps.assignBoundProfile).toHaveBeenCalledWith("agt-second-cursor");
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
      addableHarnessKinds: [],
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

    const { assignedProfileIds, results } = await syncMemberAgents(deps, {
      createHarnessKinds: ["codex"],
    });

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

    expect(
      await syncMemberAgents(deps, {
        createHarnessKinds: ["cursor", "opencode", "openclaw"],
      })
    ).toEqual({
      // Installed but turned off in Local agents: the member can add it by
      // turning it on.
      addableHarnessKinds: ["openclaw"],
      assignedProfileIds: [],
      results: ["cursor", "openclaw", "opencode"].map((harnessKind) => ({
        binding: "not_attempted",
        defaultProfileId: null,
        directMessage: "not_attempted",
        directMessageSpaceId: null,
        harnessKind,
        memberAgentId: null,
        outcome: "skipped",
        reasonCodes: [MEMBER_AGENT_SYNC_HARNESS_NOT_DETECTED_REASON],
      })),
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
      addableHarnessKinds,
      results: [result],
    } = await syncMemberAgents(deps, { createHarnessKinds: ["grok-bot"] });

    expect(deps.ensureDetectedMemberAgent).not.toHaveBeenCalled();
    // Unrequested, it is not offered either.
    expect((await syncMemberAgents(deps)).addableHarnessKinds).toEqual([]);
    expect(addableHarnessKinds).toEqual([]);
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
    expect(
      (await syncMemberAgents(refused, { createHarnessKinds: ["codex"] }))
        .results[0]
    ).toMatchObject({
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
    expect(
      (
        await syncMemberAgents(rejected, {
          createHarnessKinds: ["claude-code"],
        })
      ).results[0]
    ).toMatchObject({
      binding: "rejected",
      directMessage: "failed",
      outcome: "created",
      reasonCodes: [
        "agent_profile_binding.agent_controller_report_unavailable",
        "direct_message.target_not_found",
      ],
    });
  });
  it("creates only the Harnesses turned on in Local agents and offers the turned-off ones", async () => {
    // Smoke: setup with --local-agent claude-code codex opencode created
    // all six detected Harnesses, and each opened a Direct Message. Setup
    // turns on only the chosen Harnesses; the others stay off.
    const deps = createDeps({
      entries: [
        ...["claude-code", "codex", "grok-bot", "opencode"].map((harnessKind) =>
          catalogEntry({
            agentControllerRef: `builtin:${harnessKind}`,
            openMeldServiceRuntimeId: "runtime-1",
          })
        ),
        ...["antigravity", "cursor"].map((harnessKind) =>
          catalogEntry({
            agentControllerRef: `builtin:${harnessKind}`,
            openMeldServiceRuntimeId: "runtime-1",
            reasonCodes: ["local_agent_preparation.not_enabled"],
            reportStatus: "disabled",
          })
        ),
      ],
    });

    const report = await syncMemberAgents(deps);

    expect(report.results.map((result) => result.harnessKind)).toEqual([
      "claude-code",
      "codex",
      "opencode",
    ]);
    expect(deps.ensureDetectedMemberAgent).toHaveBeenCalledTimes(3);
    expect(deps.openDirectMessage).toHaveBeenCalledTimes(3);
    expect(report.addableHarnessKinds).toEqual(["antigravity", "cursor"]);
  });

  it("does not offer a shared-account Harness that is turned off", async () => {
    const deps = createDeps({
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:grok-bot",
          openMeldServiceRuntimeId: "runtime-1",
          reportStatus: "disabled",
        }),
      ],
    });

    expect(await syncMemberAgents(deps)).toEqual({
      addableHarnessKinds: [],
      assignedProfileIds: [],
      results: [],
    });
  });

  it("adds a turned-on Harness an existing member has no Profile for on the first surface open", async () => {
    // Production: Felix's Profiles were backfilled into MemberAgents, but
    // none was bound to Claude Code, which his computer has turned on.
    const codex = memberAgent({
      defaultProfileId: "agt_codex",
      harnessKind: "codex",
      id: "ma-codex",
      source: "migrated",
    });
    const entries = ["claude-code", "codex"].map((harnessKind) =>
      catalogEntry({
        agentControllerRef: `builtin:${harnessKind}`,
        openMeldServiceRuntimeId: "runtime-macbook",
      })
    );
    const deps = createDeps({ entries, existing: listing([codex]) });

    const first = await syncMemberAgents(deps);

    expect(first.results).toEqual([
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
      {
        binding: "not_attempted",
        defaultProfileId: "agt_codex",
        directMessage: "not_attempted",
        directMessageSpaceId: null,
        harnessKind: "codex",
        memberAgentId: "ma-codex",
        outcome: "unchanged",
        reasonCodes: [],
      },
    ]);
    expect(deps.ensureDetectedMemberAgent).toHaveBeenCalledTimes(1);
    expect(deps.ensureDetectedMemberAgent).toHaveBeenCalledWith("claude-code");

    // The next sync sees the new MemberAgent and its Binding: nothing is
    // created twice and no second Direct Message is opened.
    const again = createDeps({
      entries,
      existing: listing([
        codex,
        memberAgent({
          defaultProfileId: DEFAULT_PROFILE_ID,
          harnessKind: "claude-code",
          id: "ma-1",
        }),
      ]),
      hasBinding: true,
    });
    const second = await syncMemberAgents(again);
    expect(second.results.map((result) => result.outcome)).toEqual([
      "unchanged",
      "unchanged",
    ]);
    expect(again.ensureDetectedMemberAgent).not.toHaveBeenCalled();
    expect(again.writeDefaultBinding).not.toHaveBeenCalled();
    expect(again.openDirectMessage).not.toHaveBeenCalled();
  });

  it("neither creates nor offers a Harness turned off after its MemberAgent exists", async () => {
    const deps = createDeps({
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
          reportStatus: "disabled",
        }),
      ],
      existing: listing([
        memberAgent({
          defaultProfileId: "agt_codex",
          harnessKind: "codex",
          id: "ma-codex",
        }),
      ]),
    });

    expect(await syncMemberAgents(deps)).toEqual({
      addableHarnessKinds: [],
      assignedProfileIds: [],
      results: [],
    });
    expect(deps.ensureDetectedMemberAgent).not.toHaveBeenCalled();
  });

  it("binds the keyed Profile Auth hands back, then lets Auth set the default", async () => {
    const deps = createDeps({
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
        }),
      ],
    });
    deps.ensureDetectedMemberAgent
      .mockResolvedValueOnce(
        ensured(true, "codex", {
          defaultProfileCandidateId: DEFAULT_PROFILE_ID,
        })
      )
      .mockResolvedValueOnce(ensured(false, "codex"));

    const {
      results: [result],
    } = await syncMemberAgents(deps, { createHarnessKinds: ["codex"] });

    // The Binding write assigns the Profile under its assignment lock.
    expect(deps.writeDefaultBinding).toHaveBeenCalledTimes(1);
    expect(deps.writeDefaultBinding).toHaveBeenCalledWith(
      expect.objectContaining({ agentProfileId: DEFAULT_PROFILE_ID })
    );
    expect(deps.assignBoundProfile).not.toHaveBeenCalled();
    expect(deps.ensureDetectedMemberAgent).toHaveBeenCalledTimes(2);
    expect(deps.openDirectMessage).toHaveBeenCalledWith(DEFAULT_PROFILE_ID);
    expect(result).toMatchObject({
      binding: "succeeded",
      defaultProfileId: DEFAULT_PROFILE_ID,
      directMessage: "succeeded",
      outcome: "created",
    });
  });

  it("assigns an already bound keyed Profile through the locked path and opens the Direct Message", async () => {
    // An earlier sync wrote the Binding but stopped before Auth set the
    // default. The Binding may since have moved to another Harness, so the
    // assignment re-reads it under the lock instead of trusting the key.
    const deps = createDeps({
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
        }),
      ],
      existing: listing([memberAgent({ harnessKind: "codex", id: "ma-1" })]),
      hasBinding: true,
    });
    deps.ensureDetectedMemberAgent
      .mockResolvedValueOnce(
        ensured(false, "codex", {
          defaultProfileCandidateId: DEFAULT_PROFILE_ID,
        })
      )
      .mockResolvedValueOnce(ensured(false, "codex"));

    const {
      results: [result],
    } = await syncMemberAgents(deps);

    expect(deps.assignBoundProfile).toHaveBeenCalledWith(DEFAULT_PROFILE_ID);
    expect(deps.writeDefaultBinding).not.toHaveBeenCalled();
    expect(deps.openDirectMessage).toHaveBeenCalledWith(DEFAULT_PROFILE_ID);
    expect(result).toMatchObject({
      binding: "not_attempted",
      directMessage: "succeeded",
      outcome: "completed",
    });
  });

  it("leaves the creation unfinished when the keyed Profile went to another Harness", async () => {
    const deps = createDeps({
      entries: [
        catalogEntry({
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
        }),
      ],
      existing: listing([memberAgent({ harnessKind: "codex", id: "ma-1" })]),
      hasBinding: true,
    });
    deps.assignBoundProfile.mockResolvedValueOnce("assigned_elsewhere");
    const interrupted = ensured(false, "codex", {
      defaultProfileCandidateId: DEFAULT_PROFILE_ID,
    });
    deps.ensureDetectedMemberAgent
      .mockResolvedValueOnce(interrupted)
      .mockResolvedValueOnce(
        ensureDetectedMemberAgentRpcResultSchema.parse({
          ...interrupted,
          defaultProfileCandidateId: null,
        })
      );

    const {
      results: [result],
    } = await syncMemberAgents(deps);

    expect(deps.openDirectMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      defaultProfileId: null,
      directMessage: "not_attempted",
      outcome: "unchanged",
    });
  });
});
