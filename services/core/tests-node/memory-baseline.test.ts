import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryBaselineCases } from "../evals/memory-baseline/cases";
import {
  buildProbeMessages,
  createOfflineAdapter,
  createReplay,
  projectVerifiedCandidates,
  REPLAY_TIME,
  scoreProbeAnswer,
} from "../evals/memory-baseline/replay";

describe("memory baseline evidence integrity (#340)", () => {
  afterEach(() => vi.useRealTimers());
  it("keeps capture, raw query, and three model interventions distinguishable", async () => {
    const seed = memoryBaselineCases.find(
      (item) => item.id === "terse-project-continuation"
    );
    if (!seed) {
      throw new Error("Missing continuation case");
    }
    const replay = createReplay("fixture-test", createOfflineAdapter());
    await replay.capture(seed);
    const envelope = await replay.attach(seed.query);
    expect(replay.writes).toHaveLength(seed.turns.length);
    expect(
      replay.writes.every((write) => write.input.ref.subject.kind === "space")
    ).toBe(true);
    expect(replay.queries).toEqual(["继续"]);
    expect(replay.searches).toHaveLength(1);
    const projected = await projectVerifiedCandidates([seed.verifiedContext]);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(REPLAY_TIME);
    const baseline = buildProbeMessages(seed, projected, "current_pipeline");
    const noMemory = buildProbeMessages(seed, projected, "no_memory");
    const verified = buildProbeMessages(seed, projected, "verified_context");
    expect(baseline[0]).toEqual(noMemory[0]);
    expect(baseline[0]).toEqual(verified[0]);
    expect(baseline[1]?.content).toContain("cedar/mail");
    expect(noMemory[1]?.content).not.toContain("cedar/mail");
    expect(verified[1]?.content).toContain(seed.verifiedContext);
    expect(envelope.memory).toBeUndefined();
  });

  it.each([
    [undefined, "not_run"],
    ["{}", "incorrect"],
    ['{"accepted":false}', "incorrect"],
    ['{"accepted":true}', "correct"],
    ["not JSON", "invalid_response"],
  ])("does not score missing or invalid model evidence as success: %s", (answer, status) => {
    expect(scoreProbeAnswer(answer, { accepted: true }).status).toBe(status);
  });
});
