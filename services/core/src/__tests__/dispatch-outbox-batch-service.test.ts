import { describe, expect, it } from "vitest";

import {
  DISPATCH_OUTBOX_REDRIVE_BATCH_SIZE,
  DISPATCH_OUTBOX_TARGET_CONCURRENCY,
  processDispatchOutboxCandidates,
} from "../space/application/dispatch-outbox-batch-service";

type Candidate = {
  dispatchId: string;
  targetProfileId: string;
};

describe("dispatch outbox batch service", () => {
  it.each([
    1, 4, 10, 20,
  ])("processes a %i-target workerd burst through the fake Agent seam", async (targetCount) => {
    const candidates = Array.from({ length: targetCount }, (_, index) => ({
      dispatchId: `load-dispatch-${index + 1}`,
      targetProfileId: `load-profile-${index + 1}`,
    }));
    const processed = new Set<string>();
    let activeTargetCount = 0;
    let maximumActiveTargetCount = 0;

    await processDispatchOutboxCandidates({
      candidates,
      processCandidate: async (candidate) => {
        activeTargetCount += 1;
        maximumActiveTargetCount = Math.max(
          maximumActiveTargetCount,
          activeTargetCount
        );
        await Promise.resolve();
        processed.add(candidate.dispatchId);
        activeTargetCount -= 1;
      },
      resolveTargetProfileId: (candidate) => candidate.targetProfileId,
    });

    expect(processed.size).toBe(targetCount);
    expect(maximumActiveTargetCount).toBe(Math.min(targetCount, 5));
  });

  it("admits at most 20 candidates with at most five target profiles in parallel", async () => {
    expect(DISPATCH_OUTBOX_REDRIVE_BATCH_SIZE).toBe(20);
    expect(DISPATCH_OUTBOX_TARGET_CONCURRENCY).toBe(5);

    const candidates = Array.from({ length: 21 }, (_, index) => ({
      dispatchId: `dispatch-${index + 1}`,
      targetProfileId: `profile-${(index % 10) + 1}`,
    }));
    const activeProfiles = new Set<string>();
    let maximumParallelProfiles = 0;
    const processed: string[] = [];

    await processDispatchOutboxCandidates({
      candidates,
      processCandidate: async (candidate) => {
        expect(activeProfiles.has(candidate.targetProfileId)).toBe(false);
        activeProfiles.add(candidate.targetProfileId);
        maximumParallelProfiles = Math.max(
          maximumParallelProfiles,
          activeProfiles.size
        );
        await Promise.resolve();
        processed.push(candidate.dispatchId);
        activeProfiles.delete(candidate.targetProfileId);
      },
      resolveTargetProfileId: (candidate) => candidate.targetProfileId,
    });

    expect(processed).toHaveLength(20);
    expect(processed).not.toContain("dispatch-21");
    expect(maximumParallelProfiles).toBe(5);
  });

  it("preserves FIFO order within one target while isolating candidate failures", async () => {
    const candidates: Candidate[] = [
      { dispatchId: "a-1", targetProfileId: "profile-a" },
      { dispatchId: "b-1", targetProfileId: "profile-b" },
      { dispatchId: "a-2", targetProfileId: "profile-a" },
      { dispatchId: "a-3", targetProfileId: "profile-a" },
    ];
    const processed: string[] = [];
    const failures: string[] = [];

    await processDispatchOutboxCandidates({
      candidates,
      onCandidateFailure: (candidate) => {
        failures.push(candidate.dispatchId);
      },
      processCandidate: (candidate) => {
        processed.push(candidate.dispatchId);
        if (candidate.dispatchId === "a-2") {
          return Promise.reject(new Error("poison candidate"));
        }
        return Promise.resolve();
      },
      resolveTargetProfileId: (candidate) => candidate.targetProfileId,
    });

    expect(processed.filter((id) => id.startsWith("a-"))).toEqual([
      "a-1",
      "a-2",
      "a-3",
    ]);
    expect(failures).toEqual(["a-2"]);
  });
});
