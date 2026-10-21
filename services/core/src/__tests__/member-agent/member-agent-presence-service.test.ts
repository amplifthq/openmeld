import type { RuntimeTransportAgentProfileOperationalContext } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  buildOnlineRuntimeKey,
  type MemberAgentPresenceDeps,
  readMemberAgentPresence,
} from "../../member-agent/application/member-agent-presence-service";
import { projectRuntimeHarnesses } from "../../member-agent/application/runtime-harness-catalog";
import type { RuntimeHarnessCatalogEntry } from "../../member-agent/infrastructure/postgresql/runtime-harness-presence-repo";
import {
  catalogEntry,
  listing,
  memberAgent,
  NOW_MS,
  presentFact,
} from "./member-agent-test-fixtures";

const CLAUDE_PROFILE = "agt_00000000-0000-4000-8000-0000000000c1";
const REVIEWER_PROFILE = "agt_00000000-0000-4000-8000-0000000000c2";

function presenceDeps(input: {
  contexts?: Record<string, RuntimeTransportAgentProfileOperationalContext>;
  entries: RuntimeHarnessCatalogEntry[];
  online?: string[] | null;
  wake?: Record<string, "available" | "checking" | "offline" | "unavailable">;
}): MemberAgentPresenceDeps {
  return {
    listOwnerMemberAgents: async () =>
      listing([
        {
          ...memberAgent({
            defaultProfileId: CLAUDE_PROFILE,
            harnessKind: "claude-code",
            id: "ma-claude",
          }),
          profiles: [
            {
              openMeldProfileId: CLAUDE_PROFILE,
              profileName: "Claude Code",
              isDefault: true,
            },
            {
              openMeldProfileId: REVIEWER_PROFILE,
              profileName: "PR Reviewer",
              isDefault: false,
            },
          ],
        },
      ]),
    listRuntimeHarnesses: async () =>
      projectRuntimeHarnesses({ entries: input.entries, nowMs: NOW_MS }),
    readOnlineRuntimeKeys: async () =>
      input.online === null
        ? null
        : new Set(
            (input.online ?? []).map((runtimeId) =>
              buildOnlineRuntimeKey({
                deviceId: `device-${runtimeId}`,
                lane: "prod",
              })
            )
          ),
    readOperationalContexts: async () =>
      new Map(
        Object.entries(
          input.contexts ?? {
            [CLAUDE_PROFILE]: { status: "idle", waitingCount: 0 },
            [REVIEWER_PROFILE]: { status: "idle", waitingCount: 0 },
          }
        )
      ),
    readWakeAvailability: async () =>
      new Map(Object.entries(input.wake ?? { [CLAUDE_PROFILE]: "available" })),
  };
}

const missedOnce = catalogEntry({
  agentControllerRef: "builtin:claude-code",
  fact: presentFact({
    firstUndetectedAtMs: NOW_MS - 20 * 60_000,
    undetectedReportCount: 1,
  }),
  openMeldServiceRuntimeId: "runtime-macbook",
  reasonCodes: ["local_agent_preparation.not_detected"],
  reportStatus: "unavailable",
});

describe("readMemberAgentPresence", () => {
  it("reads missing once the Harness is turned off on its only computer, keeping the Agent", async () => {
    const [presence] = await readMemberAgentPresence(
      presenceDeps({
        entries: [
          catalogEntry({
            agentControllerRef: "builtin:claude-code",
            fact: presentFact(),
            openMeldServiceRuntimeId: "runtime-macbook",
            reasonCodes: ["local_agent_preparation.not_enabled"],
            reportStatus: "disabled",
          }),
          catalogEntry({
            agentControllerRef: "builtin:claude-code",
            fact: presentFact(),
            openMeldServiceRuntimeId: "runtime-imac",
            reasonCodes: ["local_agent_preparation.not_enabled"],
            reportStatus: "disabled",
          }),
        ],
        online: ["runtime-macbook", "runtime-imac"],
      })
    );

    expect(presence).toMatchObject({
      computers: [],
      memberAgentId: "ma-claude",
      state: "missing",
    });
  });

  it("keeps an Agent available across one missing report during an upgrade", async () => {
    const [presence] = await readMemberAgentPresence(
      presenceDeps({ entries: [missedOnce], online: ["runtime-macbook"] })
    );

    expect(presence).toMatchObject({
      computers: [
        { online: true, openMeldServiceRuntimeId: "runtime-macbook" },
      ],
      memberAgentId: "ma-claude",
      state: "available",
    });
  });

  it("reads missing only after the debounce settles on every computer", async () => {
    const [presence] = await readMemberAgentPresence(
      presenceDeps({
        entries: [
          {
            ...missedOnce,
            fact: presentFact({
              firstUndetectedAtMs: NOW_MS - 60_000,
              undetectedReportCount: 3,
            }),
          },
        ],
        online: ["runtime-macbook"],
      })
    );

    expect(presence).toMatchObject({ computers: [], state: "missing" });
  });

  it("follows the remaining computer when one loses the Harness", async () => {
    const [presence] = await readMemberAgentPresence(
      presenceDeps({
        entries: [
          {
            ...missedOnce,
            fact: presentFact({
              firstUndetectedAtMs: NOW_MS - 60_000,
              undetectedReportCount: 3,
            }),
          },
          catalogEntry({
            agentControllerRef: "builtin:claude-code",
            openMeldServiceRuntimeId: "runtime-imac",
          }),
        ],
        online: ["runtime-imac"],
      })
    );

    expect(presence).toMatchObject({
      computers: [{ online: true, openMeldServiceRuntimeId: "runtime-imac" }],
      state: "available",
    });
  });

  it("reads all_offline when every computer with the Harness is offline", async () => {
    const [presence] = await readMemberAgentPresence(
      presenceDeps({
        entries: [
          catalogEntry({
            agentControllerRef: "builtin:claude-code",
            openMeldServiceRuntimeId: "runtime-macbook",
            reportAcceptedAtMs: NOW_MS - 11 * 60_000,
            reportExpiresAtMs: NOW_MS - 1,
          }),
        ],
        online: [],
      })
    );

    expect(presence?.state).toBe("all_offline");
  });

  it("reads checking when the connection lookup or Wakeability is unknown", async () => {
    const entries = [
      catalogEntry({
        agentControllerRef: "builtin:claude-code",
        openMeldServiceRuntimeId: "runtime-macbook",
      }),
    ];
    const [unknownOnline] = await readMemberAgentPresence(
      presenceDeps({ entries, online: null })
    );
    expect(unknownOnline?.state).toBe("checking");

    const [noAvailableProfile] = await readMemberAgentPresence(
      presenceDeps({
        entries,
        online: ["runtime-macbook"],
        wake: { [CLAUDE_PROFILE]: "unavailable" },
      })
    );
    expect(noAvailableProfile).toMatchObject({
      profiles: [
        { openMeldProfileId: CLAUDE_PROFILE, wakeAvailability: "unavailable" },
        { openMeldProfileId: REVIEWER_PROFILE, wakeAvailability: "checking" },
      ],
      state: "checking",
    });
  });

  it("aggregates running and queued work and never claims a partial total", async () => {
    const entries = [
      catalogEntry({
        agentControllerRef: "builtin:claude-code",
        openMeldServiceRuntimeId: "runtime-macbook",
      }),
    ];
    const [ready] = await readMemberAgentPresence(
      presenceDeps({
        contexts: {
          [CLAUDE_PROFILE]: { status: "working", waitingCount: 2 },
          [REVIEWER_PROFILE]: { status: "paused", waitingCount: 1 },
        },
        entries,
        online: ["runtime-macbook"],
      })
    );
    expect(ready?.workload).toEqual({
      queuedCount: 3,
      runningCount: 1,
      status: "ready",
    });

    const [partial] = await readMemberAgentPresence(
      presenceDeps({
        contexts: {
          [CLAUDE_PROFILE]: { status: "working", waitingCount: 2 },
          [REVIEWER_PROFILE]: {
            reasonCode: "runtime_coordinator.operational_context_unavailable",
            status: "checking",
          },
        },
        entries,
        online: ["runtime-macbook"],
      })
    );
    expect(partial?.workload).toEqual({ status: "unavailable" });
  });
});
