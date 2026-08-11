import { describe, expect, it } from "vitest";
import {
  type ActionParticipationCandidate,
  assessActionParticipationCandidate,
  planActionParticipation,
} from "../src/system/action-participation-planner";

function createCandidate(
  overrides: Partial<ActionParticipationCandidate> = {}
): ActionParticipationCandidate {
  return {
    profileId: "agt-candidate",
    profileName: "Codex",
    profileKind: "agent",
    localTargetSelectable: true,
    localTargetLaunchStatus: "ready",
    localParticipationReadiness: "ready",
    localParticipationReasonCodes: [],
    ...overrides,
  };
}

describe("action participation planner", () => {
  it("treats human-only participation as not needed", () => {
    const plan = planActionParticipation({
      intent: "space_join",
      candidates: [
        {
          profileId: "hum-1",
          profileName: "Felix",
          profileKind: "human",
          localParticipationReasonCodes: [],
        },
      ],
    });

    expect(plan.shouldOfferServiceGate).toBe(false);
    expect(plan.assessments[0]?.localParticipationState).toBe("not_needed");
  });

  it("keeps an unbound agent membership-only instead of prompting Prepare", () => {
    const assessment = assessActionParticipationCandidate(
      createCandidate({
        localParticipationReasonCodes: ["profile.unbound"],
      })
    );

    expect(assessment.localParticipationState).toBe("membership_only");
    expect(assessment.rootCause).toBe("profile_unbound");
  });

  it("keeps disabled binding membership-only instead of prompting Prepare", () => {
    const assessment = assessActionParticipationCandidate(
      createCandidate({
        localParticipationReasonCodes: ["controller.binding.disabled"],
      })
    );

    expect(assessment.localParticipationState).toBe("membership_only");
    expect(assessment.rootCause).toBe("controller_disabled");
  });

  it("routes offline route evidence to OpenMeld Service guidance instead of Prepare", () => {
    const plan = planActionParticipation({
      intent: "space_join",
      candidates: [
        createCandidate({
          localParticipationReadiness: "unknown",
          localParticipationReasonCodes: ["route.offline"],
        }),
      ],
    });

    expect(plan.hasAgentPreparationWork).toBe(false);
    expect(plan.shouldOfferServiceGate).toBe(true);
    expect(plan.assessments[0]?.localParticipationState).toBe(
      "needs_openmeld_service"
    );
  });

  it("routes a repair-needed agent to local agent preparation instead of OpenMeld Service", () => {
    const assessment = assessActionParticipationCandidate(
      createCandidate({
        localTargetLaunchStatus: "needs_repair",
        localParticipationReadiness: "needs_repair",
        localParticipationReasonCodes: ["controller.launch.needs_repair"],
      })
    );

    expect(assessment.localParticipationState).toBe("needs_agent_prepare");
  });

  it("routes a workspace-missing agent to local agent preparation", () => {
    const assessment = assessActionParticipationCandidate(
      createCandidate({
        localParticipationReadiness: "needs_repair",
        localParticipationReasonCodes: ["workspace.missing"],
      })
    );

    expect(assessment.localParticipationState).toBe("needs_agent_prepare");
  });

  it("offers OpenMeld Service only when local agent readiness is already runnable", () => {
    const assessment = assessActionParticipationCandidate(
      createCandidate({
        localParticipationReadiness: "not_running",
        localParticipationReasonCodes: ["service.not_running"],
      })
    );

    expect(assessment.localParticipationState).toBe("needs_openmeld_service");
  });

  it("marks a fully aligned local agent as ready", () => {
    const assessment = assessActionParticipationCandidate(createCandidate());

    expect(assessment.localParticipationState).toBe("ready");
  });

  it("does not promote missing readiness evidence to ready", () => {
    const assessment = assessActionParticipationCandidate(
      createCandidate({
        localParticipationReadiness: null,
        localParticipationReasonCodes: [],
      })
    );

    expect(assessment.localParticipationState).toBe("membership_only");
    expect(assessment.membershipAllowed).toBe(true);
    expect(assessment.reasonCodes).toEqual([]);
  });

  it("aggregates mixed selections without letting unbound agents trigger Prepare", () => {
    const plan = planActionParticipation({
      intent: "space_add_members",
      candidates: [
        {
          profileId: "hum-1",
          profileName: "Felix",
          profileKind: "human",
          localParticipationReasonCodes: [],
        },
        createCandidate({
          profileId: "agt-unbound",
          profileName: "Unbound Agent",
          localParticipationReasonCodes: ["profile.unbound"],
        }),
        createCandidate({
          profileId: "agt-repair",
          profileName: "Repair Agent",
          localTargetLaunchStatus: "needs_repair",
          localParticipationReadiness: "needs_repair",
          localParticipationReasonCodes: ["controller.launch.needs_repair"],
        }),
        createCandidate({
          profileId: "agt-service",
          profileName: "Runnable Agent",
          localParticipationReadiness: "not_running",
          localParticipationReasonCodes: ["service.not_running"],
        }),
      ],
    });

    expect(
      plan.assessments.map((assessment) => assessment.localParticipationState)
    ).toEqual([
      "not_needed",
      "membership_only",
      "needs_agent_prepare",
      "needs_openmeld_service",
    ]);
    expect(plan.shouldOfferServiceGate).toBe(true);
    expect(plan.hasAgentPreparationWork).toBe(true);
  });
});
