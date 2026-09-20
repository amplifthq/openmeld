import {
  createSpaceMemberAgentExecutionReadiness,
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { describe, expect, it } from "vitest";
import { buildSpaceMemberDirectory } from "../src";
import {
  createTestAgentAgentWakeAvailability,
  createTestAgentWakeRouteRegistration,
} from "./test-agent-public-presence";

describe("space member directory", () => {
  it("groups agents before humans and sorts live members first within each section", () => {
    const directory = buildSpaceMemberDirectory(
      createSpaceMembersSnapshot({
        agents: [
          createSpaceMemberAgentSnapshot({
            liveNow: false,
            profileId: "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            profileName: "Zeta Agent",
          }),
          createSpaceMemberAgentSnapshot({
            liveNow: true,
            profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            profileName: "Alpha Agent",
          }),
        ],
        humans: [
          createSpaceMemberHumanSnapshot({
            liveNow: false,
            profileId: "33333333-3333-4333-8333-333333333333",
            profileName: "Casey",
          }),
          createSpaceMemberHumanSnapshot({
            liveNow: true,
            profileId: "22222222-2222-4222-8222-222222222222",
            profileName: "Bailey",
          }),
        ],
      })
    );

    expect(directory.sections.map((section) => section.id)).toEqual([
      "agents",
      "humans",
    ]);
    expect(
      directory.sections[0]?.entries.map((entry) => entry.profileName)
    ).toEqual(["Alpha Agent", "Zeta Agent"]);
    expect(
      directory.sections[1]?.entries.map((entry) => entry.profileName)
    ).toEqual(["Bailey", "Casey"]);
  });

  it("keeps wake labels and manual participation hints for blocked agents", () => {
    const [agentEntry] =
      buildSpaceMemberDirectory(
        createSpaceMembersSnapshot({
          agents: [
            createSpaceMemberAgentSnapshot({
              agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness(
                {
                  displayState: "not_ready",
                  reasonCodes: ["agent_profile_binding.missing"],
                }
              ),
              liveNow: false,
              mentionAlias: "ops_alpha",
              profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              profileName: "Ops Alpha",
              wakeState: "offline",
              wakeabilityReasonCodes: ["profile.unbound"],
              wakeabilityStatus: "blocked",
            }),
          ],
        })
      ).sections[0]?.entries ?? [];

    expect(agentEntry).toEqual(
      expect.objectContaining({
        manualParticipationOnly: true,
        mentionLabel: "@Ops Alpha",
        presenceLabel: "reply route unavailable",
        presenceStatus: "unavailable",
      })
    );
  });

  it("carries agent model selection into the member directory", () => {
    const [agentEntry] =
      buildSpaceMemberDirectory(
        createSpaceMembersSnapshot({
          agents: [
            createSpaceMemberAgentSnapshot({
              modelSelection: {
                modelId: "gpt-5.5",
                reasoningLevel: "xhigh",
              },
              profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              profileName: "Ops Alpha",
            }),
          ],
        })
      ).sections[0]?.entries ?? [];

    expect(agentEntry).toEqual(
      expect.objectContaining({
        modelSelection: {
          modelId: "gpt-5.5",
          reasoningLevel: "xhigh",
        },
      })
    );
  });

  it("carries agent controller conversation and workspace details into the member directory", () => {
    const [agentEntry] =
      buildSpaceMemberDirectory(
        createSpaceMembersSnapshot({
          agents: [
            createSpaceMemberAgentSnapshot({
              agentControllerConversationId: "thread-ops-alpha",
              profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              profileName: "Ops Alpha",
              workingDirectory: " /Users/felix/Ops Alpha ",
            }),
          ],
        })
      ).sections[0]?.entries ?? [];

    expect(agentEntry).toEqual(
      expect.objectContaining({
        agentControllerConversationId: "thread-ops-alpha",
        workingDirectory: " /Users/felix/Ops Alpha ",
      })
    );
  });

  it("uses execution readiness for manual participation when legacy wakeability is stale", () => {
    const [agentEntry] =
      buildSpaceMemberDirectory(
        createSpaceMembersSnapshot({
          agents: [
            createSpaceMemberAgentSnapshot({
              agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness(
                {
                  displayState: "not_ready",
                  reasonCodes: ["agent_profile_binding.missing"],
                }
              ),
              liveNow: false,
              mentionAlias: "ops_alpha",
              profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              profileName: "Ops Alpha",
              wakeState: "wakeable",
              wakeabilityStatus: "ready",
            }),
          ],
        })
      ).sections[0]?.entries ?? [];

    expect(agentEntry).toEqual(
      expect.objectContaining({
        manualParticipationOnly: true,
        presenceLabel: "reply route unavailable",
        presenceStatus: "unavailable",
      })
    );
  });

  it("uses agent wake availability for the member list even when viewer recovery is stale", () => {
    const [agentEntry] =
      buildSpaceMemberDirectory(
        createSpaceMembersSnapshot({
          agents: [
            createSpaceMemberAgentSnapshot({
              liveNow: false,
              profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              profileName: "Ops Alpha",
              agentWakeAvailability:
                createTestAgentAgentWakeAvailability("available_for_wake"),
              ownerWakeDiagnostics: {
                state: "checking_wake_status",
                agentExecutionReadiness:
                  createSpaceMemberAgentExecutionReadiness({
                    displayState: "not_ready",
                    reasonCodes: ["route.not_registered"],
                  }),
                agentWakeRouteRegistration:
                  createTestAgentWakeRouteRegistration({
                    status: "pending",
                    reasonCode: "wake_route.registration_pending",
                    reportedAtMs: null,
                    daemonSessionId: null,
                    deviceId: null,
                    lane: null,
                    serviceVersion: null,
                  }),
                wakeRouteEvidence: {
                  observedAt: "2026-05-26T00:00:00.000Z",
                  reasonCode: "route.not_registered",
                  status: "offline",
                },
                wakeRouteStatus: { status: "offline" },
              },
            }),
          ],
        })
      ).sections[0]?.entries ?? [];

    expect(agentEntry).toEqual(
      expect.objectContaining({
        presenceLabel: "wakeable",
        presenceStatus: "wakeable",
      })
    );
  });

  it("does not promote owner diagnostics route evidence to public Wake availability", () => {
    const {
      agentWakeAvailability: _agentWakeAvailability,
      ...agentWithoutAgentWakeAvailability
    } = createSpaceMemberAgentSnapshot({
      agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
        displayState: "ready",
        reasonCodes: [],
      }),
      liveNow: false,
      profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      profileName: "Ops Alpha",
      wakeState: "wakeable",
      wakeabilityStatus: "ready",
    });
    const [agentEntry] =
      buildSpaceMemberDirectory(
        createSpaceMembersSnapshot({
          agents: [agentWithoutAgentWakeAvailability],
        })
      ).sections[0]?.entries ?? [];

    expect(agentEntry).toEqual(
      expect.objectContaining({
        availabilityBadgeLabel: "Checking",
        presenceLabel: "checking connection",
        presenceStatus: "checking_connection",
      })
    );
  });

  it("does not infer manual participation hints from legacy wakeability alone", () => {
    const [agentEntry] =
      buildSpaceMemberDirectory(
        createSpaceMembersSnapshot({
          agents: [
            createSpaceMemberAgentSnapshot({
              includeAgentExecutionReadiness: false,
              liveNow: false,
              mentionAlias: "ops_alpha",
              profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              profileName: "Ops Alpha",
              wakeState: "offline",
              wakeabilityReasonCodes: ["profile.unbound"],
              wakeabilityStatus: "blocked",
            }),
          ],
        })
      ).sections[0]?.entries ?? [];

    expect(agentEntry).toEqual(
      expect.objectContaining({
        manualParticipationOnly: false,
        mentionLabel: "@Ops Alpha",
        presenceLabel: "checking connection",
        presenceStatus: "checking_connection",
      })
    );
  });
});
