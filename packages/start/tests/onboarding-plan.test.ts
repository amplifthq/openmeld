import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  onboardingFactsSchema,
  onboardingPlanSchema,
} from "@openmeld/schemas/schemas";
import type {
  OnboardingActionId,
  OnboardingDeviceStatus,
  OnboardingFacts,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";

import { buildOnboardingPlan } from "../src";
import {
  firstRunChooseSpaceOnboardingFacts,
  firstRunNameMissingOnboardingFacts,
  fullySetUpOnboardingFacts,
  joinedWithAddableAgentOnboardingFacts,
  joinedZeroAgentsOnboardingFacts,
  ONBOARDING_FIXTURE_AGENT_PROFILE_ID,
  ONBOARDING_FIXTURE_HUMAN_PROFILE_ID,
  ONBOARDING_FIXTURE_SECOND_AGENT_PROFILE_ID,
  ONBOARDING_FIXTURE_SPACE_ID,
  onboardingAgentProfileFixture,
  signedOutOnboardingFacts,
} from "../src/testing/onboarding-plan-fixtures";

const FORBIDDEN_IMPORT_PATTERN =
  /from\s+["'](react|react-dom|node:fs|node:net|node:http|node:https|undici|axios)["']/;

function decisionById(facts: OnboardingFacts, id: OnboardingActionId) {
  return buildOnboardingPlan(facts).decisions.find(
    (decision) => decision.id === id
  );
}

describe("buildOnboardingPlan — contract validity", () => {
  const scenarios: [string, OnboardingFacts][] = [
    ["signed out", signedOutOnboardingFacts()],
    ["first run choose space", firstRunChooseSpaceOnboardingFacts()],
    ["first run name missing", firstRunNameMissingOnboardingFacts()],
    ["joined zero agents", joinedZeroAgentsOnboardingFacts()],
    ["joined with addable agent", joinedWithAddableAgentOnboardingFacts()],
    ["fully set up", fullySetUpOnboardingFacts()],
  ];

  for (const [name, facts] of scenarios) {
    it(`accepts the ${name} fixture and emits a schema-valid plan`, () => {
      expect(onboardingFactsSchema.safeParse(facts).success).toBe(true);
      const plan = buildOnboardingPlan(facts);
      expect(onboardingPlanSchema.safeParse(plan).success).toBe(true);
    });
  }
});

describe("buildOnboardingPlan — deterministic", () => {
  it("returns a deep-equal plan for the same facts", () => {
    const facts = joinedWithAddableAgentOnboardingFacts();
    expect(buildOnboardingPlan(facts)).toEqual(buildOnboardingPlan(facts));
  });
});

describe("buildOnboardingPlan — idempotent and re-entrant", () => {
  it("yields the remaining actions in stable order after a subset completes", () => {
    // Brand new joined user: no agent (bring_agents blocked) and the computer
    // not connected.
    const before = buildOnboardingPlan(joinedZeroAgentsOnboardingFacts());
    expect(before.decisions.map((decision) => decision.id)).toEqual([
      "sign_in",
      "set_display_name",
      "enter_space",
      "bring_agents",
      "connect_this_computer",
    ]);
    expect(
      decisionById(joinedZeroAgentsOnboardingFacts(), "bring_agents")?.status
    ).toBe("blocked");
    expect(
      decisionById(joinedZeroAgentsOnboardingFacts(), "connect_this_computer")
        ?.status
    ).toBe("available");

    // Complete the connect step: the computer is now connected and setup
    // produced an agent that is not yet a Space member.
    const after = joinedZeroAgentsOnboardingFacts();
    const advanced: OnboardingFacts = {
      ...after,
      accountProfiles: [
        ...after.accountProfiles,
        onboardingAgentProfileFixture(),
      ],
      device: { status: "connected" },
    };
    const advancedPlan = buildOnboardingPlan(advanced);
    expect(advancedPlan.decisions.map((decision) => decision.id)).toEqual([
      "sign_in",
      "set_display_name",
      "enter_space",
      "bring_agents",
      "connect_this_computer",
    ]);
    expect(decisionById(advanced, "connect_this_computer")?.status).toBe(
      "done"
    );
    // Recomputing again is identical (re-entrant).
    expect(buildOnboardingPlan(advanced)).toEqual(advancedPlan);
  });
});

describe("buildOnboardingPlan — complete", () => {
  it("never returns an empty list and keeps summary consistent across a fact matrix", () => {
    const deviceStatuses: OnboardingDeviceStatus[] = [
      "connected",
      "connecting",
      "not_connected",
      "unknown",
    ];
    const baseScenarios = [
      signedOutOnboardingFacts,
      firstRunChooseSpaceOnboardingFacts,
      joinedZeroAgentsOnboardingFacts,
      joinedWithAddableAgentOnboardingFacts,
      fullySetUpOnboardingFacts,
    ];

    for (const makeFacts of baseScenarios) {
      for (const status of deviceStatuses) {
        const facts: OnboardingFacts = {
          ...makeFacts(),
          device: { status },
        };
        const plan = buildOnboardingPlan(facts);
        expect(plan.decisions.length).toBeGreaterThan(0);
        expect(onboardingPlanSchema.safeParse(plan).success).toBe(true);
        const hasPending = plan.decisions.some(
          (decision) =>
            decision.status === "available" || decision.status === "blocked"
        );
        expect(plan.summary).toBe(
          hasPending ? "actions_pending" : "nothing_to_do"
        );
      }
    }
  });

  it("marks the fully set up account as nothing_to_do", () => {
    const plan = buildOnboardingPlan(fullySetUpOnboardingFacts());
    expect(plan.summary).toBe("nothing_to_do");
    expect(plan.decisions.every((decision) => decision.status === "done")).toBe(
      true
    );
  });
});

describe("buildOnboardingPlan — honest", () => {
  it("emits only sign_in when signed out, never speculating downstream", () => {
    const plan = buildOnboardingPlan(signedOutOnboardingFacts());
    expect(plan.decisions).toEqual([
      {
        id: "sign_in",
        status: "available",
        blocking: true,
        reason: "auth.signed_out",
        run: null,
        afterRun: null,
      },
    ]);
  });

  it("blocks connect with a named reason when device evidence is unavailable", () => {
    const facts: OnboardingFacts = {
      ...joinedZeroAgentsOnboardingFacts(),
      device: { status: "unknown" },
    };
    const connect = decisionById(facts, "connect_this_computer");
    expect(connect?.status).toBe("blocked");
    expect(connect?.reason).toBe("computer.evidence_unavailable");
  });

  it("offers set_display_name only when the name is genuinely missing", () => {
    expect(
      decisionById(firstRunNameMissingOnboardingFacts(), "set_display_name")
        ?.status
    ).toBe("available");
    expect(
      decisionById(firstRunChooseSpaceOnboardingFacts(), "set_display_name")
        ?.status
    ).toBe("done");
  });
});

describe("buildOnboardingPlan — agent membership", () => {
  it("blocks bring_agents for a zero-agent account (a real gap, not silence)", () => {
    const decision = decisionById(
      joinedZeroAgentsOnboardingFacts(),
      "bring_agents"
    );
    expect(decision?.status).toBe("blocked");
    expect(decision?.reason).toBe("agents.none_yet");
  });

  it("emits bring_agents available with an executable command when none are members", () => {
    const decision = decisionById(
      joinedWithAddableAgentOnboardingFacts(),
      "bring_agents"
    );
    expect(decision?.status).toBe("available");
    expect(decision?.reason).toBe("agents.addable_present");
    expect(decision?.run).toBe(
      `openmeld space add-agents ${ONBOARDING_FIXTURE_SPACE_ID} --profile ${ONBOARDING_FIXTURE_HUMAN_PROFILE_ID} --all --view agent`
    );
  });

  it("marks bring_agents done once at least one agent is a member", () => {
    const decision = decisionById(fullySetUpOnboardingFacts(), "bring_agents");
    expect(decision?.status).toBe("done");
    expect(decision?.reason).toBe("agents.member_present");
  });

  it("marks bring_agents done for an Organization-managed agent member", () => {
    const facts: OnboardingFacts = {
      ...joinedZeroAgentsOnboardingFacts(),
      space: {
        spaceId: ONBOARDING_FIXTURE_SPACE_ID,
        actingProfileIsMember: true,
        memberAgentProfileIds: [ONBOARDING_FIXTURE_AGENT_PROFILE_ID],
      },
    };
    const decision = decisionById(facts, "bring_agents");
    expect(decision?.status).toBe("done");
    expect(decision?.reason).toBe("agents.member_present");
  });

  it("marks bring_agents done in partial membership (one in, one out)", () => {
    // One agent already a member, a second agent still outside the Space: the
    // onboarding goal is met, so the card is done (onboarding.md Version-1).
    const facts: OnboardingFacts = {
      ...fullySetUpOnboardingFacts(),
      accountProfiles: [
        ...fullySetUpOnboardingFacts().accountProfiles,
        onboardingAgentProfileFixture({
          profileId: ONBOARDING_FIXTURE_SECOND_AGENT_PROFILE_ID,
          name: "Felix's Codex",
        }),
      ],
    };
    const decision = decisionById(facts, "bring_agents");
    expect(decision?.status).toBe("done");
    expect(decision?.reason).toBe("agents.member_present");
  });

  it("treats inactive-only agent profiles as zero agents (blocked)", () => {
    const facts: OnboardingFacts = {
      ...joinedZeroAgentsOnboardingFacts(),
      accountProfiles: [
        ...joinedZeroAgentsOnboardingFacts().accountProfiles,
        onboardingAgentProfileFixture({ active: false }),
      ],
    };
    expect(decisionById(facts, "bring_agents")?.status).toBe("blocked");
  });
});

describe("buildOnboardingPlan — membership first", () => {
  it("places the joined fact before non-blocking setup decisions", () => {
    const plan = buildOnboardingPlan(joinedWithAddableAgentOnboardingFacts());
    const ids = plan.decisions.map((decision) => decision.id);
    const enterIndex = ids.indexOf("enter_space");
    expect(plan.decisions[enterIndex]?.status).toBe("done");
    for (const setupId of ["bring_agents", "connect_this_computer"] as const) {
      const setupIndex = ids.indexOf(setupId);
      expect(setupIndex).toBeGreaterThan(enterIndex);
      expect(plan.decisions[setupIndex]?.blocking).toBe(false);
    }
  });

  it("never gates the joined fact on local readiness", () => {
    // Joined with no computer and no agents at all: still joined (done).
    const enter = decisionById(
      joinedZeroAgentsOnboardingFacts(),
      "enter_space"
    );
    expect(enter?.status).toBe("done");
    expect(enter?.reason).toBe("space.joined");
  });
});

describe("buildOnboardingPlan — connect is the computer fact only", () => {
  it("is done when the OpenMeld Service is connected, regardless of agents", () => {
    const decision = decisionById(
      joinedWithAddableAgentOnboardingFacts(),
      "connect_this_computer"
    );
    expect(decision?.status).toBe("done");
    expect(decision?.reason).toBe("computer.connected");
  });

  it("never reports a zero-agent connected account as all set", () => {
    // Computer connected, but the account has no agent: the gap is on the
    // agent item (bring_agents blocked), not the computer item.
    const facts: OnboardingFacts = {
      ...joinedZeroAgentsOnboardingFacts(),
      device: { status: "connected" },
    };
    const plan = buildOnboardingPlan(facts);
    expect(decisionById(facts, "connect_this_computer")?.status).toBe("done");
    expect(decisionById(facts, "bring_agents")?.status).toBe("blocked");
    expect(plan.summary).toBe("actions_pending");
  });
});

describe("buildOnboardingPlan — run is an executable command", () => {
  it("carries the start-session token into the setup command on handoff", () => {
    const facts: OnboardingFacts = {
      ...joinedZeroAgentsOnboardingFacts(),
      context: {
        kind: "web_setup_handoff",
        startSessionToken: "handoff-token",
      },
    };
    const decision = decisionById(facts, "connect_this_computer");
    expect(decision?.run).toBe(
      "openmeld setup --start-session handoff-token --view agent"
    );
  });

  it("uses the plain setup command without a handoff token", () => {
    const decision = decisionById(
      joinedZeroAgentsOnboardingFacts(),
      "connect_this_computer"
    );
    expect(decision?.run).toBe("openmeld setup --view agent");
  });
});

describe("buildOnboardingPlan — blocking stops the list", () => {
  it("stops at a missing name and does not emit the Space decision", () => {
    const plan = buildOnboardingPlan(firstRunNameMissingOnboardingFacts());
    const ids = plan.decisions.map((decision) => decision.id);
    expect(ids).toEqual(["sign_in", "set_display_name"]);
    expect(
      decisionById(firstRunNameMissingOnboardingFacts(), "set_display_name")
        ?.blocking
    ).toBe(true);
  });
});

describe("packages/start purity", () => {
  const purityTargets = [
    "../src/planner/onboarding-plan.ts",
    "../src/testing/onboarding-plan-fixtures.ts",
  ];

  for (const relativePath of purityTargets) {
    it(`keeps ${relativePath} free of React / DOM / network / fs imports`, () => {
      const source = readFileSync(
        fileURLToPath(new URL(relativePath, import.meta.url)),
        "utf8"
      );
      expect(FORBIDDEN_IMPORT_PATTERN.test(source)).toBe(false);
    });
  }
});
