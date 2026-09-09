import { describe, expect, it } from "vitest";
import { buildDispatchPromptWithBootstrap } from "../src/local-service/carrier/service-runner";

describe("local service progressive context guidance", () => {
  it("classifies requested coordination before the candidate-silence exit", () => {
    const prompt = buildDispatchPromptWithBootstrap({
      dispatchTriggerSource: "activation_targets",
      prompt: "Please ask the other member to check the uploaded report.",
      shouldInjectBootstrap: false,
      spaceId: "space-a",
      targetProfileId: "agent-profile-a",
    });
    const assignedCoordination = prompt.indexOf(
      "Coordination is assigned work:"
    );
    expect(assignedCoordination).toBeGreaterThanOrEqual(0);
    expect(assignedCoordination).toBeLessThan(
      prompt.indexOf("If you are only a candidate")
    );
    expect(prompt).toContain(
      "Please ask the other member to check the uploaded report."
    );
  });

  it("includes the current identity in participant outcome reads", () => {
    const prompt = buildDispatchPromptWithBootstrap({
      dispatchTriggerSource: "activation_targets",
      prompt: "Coordinate with the other participant.",
      shouldInjectBootstrap: false,
      sourceSignalId: "signal-current",
      spaceId: "space-a",
      targetProfileId: "agent-profile-a",
      sourceMessageEnvelope: {
        text: "Coordinate with the other participant.",
        activationTargets: ["agent-profile-a", "agent-profile-b"],
        referenceTargets: [],
      },
    });
    expect(prompt).toContain(
      "openmeld space updates space-a --after-signal signal-current --profile agent-profile-a --view agent --json"
    );
  });

  it("uses an anchored bounded window before broader Space history", () => {
    const prompt = buildDispatchPromptWithBootstrap({
      continuitySnapshot: {
        higherAuthorityUpdates: true,
        messagesSinceThen: 2,
      },
      dispatchTriggerSource: "activation_targets",
      prompt: "Continue from the latest decision.",
      shouldInjectBootstrap: false,
      sourceSignalId: "signal-current",
      spaceId: "space-a",
      targetProfileId: "agent-profile-a",
    });

    expect(prompt).toContain(
      "openmeld space history space-a --around-signal signal-current --before 20 --after 0 --kind text --profile agent-profile-a --view agent"
    );
    expect(prompt).not.toContain(
      "openmeld space history space-a --kind text --limit 20"
    );
  });

  it("points thread work at the exact thread without loading Space history", () => {
    const prompt = buildDispatchPromptWithBootstrap({
      dispatchTriggerSource: "activation_targets",
      prompt: "Reply to the thread.",
      shouldInjectBootstrap: false,
      spaceId: "space-a",
      targetProfileId: "agent-profile-a",
      threadContext: {
        rootSignalId: "signal-root",
        threadId: "thr_11111111-1111-4111-8111-111111111111",
      },
    });

    expect(prompt).toContain(
      "openmeld space thread space-a thr_11111111-1111-4111-8111-111111111111 --profile agent-profile-a --view agent"
    );
    expect(prompt).not.toContain("openmeld space history");
  });
});
