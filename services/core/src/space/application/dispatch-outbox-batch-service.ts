export const DISPATCH_OUTBOX_REDRIVE_BATCH_SIZE = 20;
export const DISPATCH_OUTBOX_TARGET_CONCURRENCY = 5;

type ProcessDispatchOutboxCandidatesInput<Candidate> = {
  candidates: readonly Candidate[];
  onCandidateFailure?: (
    candidate: Candidate,
    error: unknown
  ) => Promise<void> | void;
  processCandidate: (candidate: Candidate) => Promise<void>;
  resolveTargetProfileId: (candidate: Candidate) => string;
};

export const processDispatchOutboxCandidates = async <Candidate>(
  input: ProcessDispatchOutboxCandidatesInput<Candidate>
): Promise<void> => {
  const targetQueues = groupCandidatesByTarget({
    candidates: input.candidates.slice(0, DISPATCH_OUTBOX_REDRIVE_BATCH_SIZE),
    resolveTargetProfileId: input.resolveTargetProfileId,
  });
  let nextQueueIndex = 0;
  const workerCount = Math.min(
    DISPATCH_OUTBOX_TARGET_CONCURRENCY,
    targetQueues.length
  );

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const targetQueue = targetQueues[nextQueueIndex];
        nextQueueIndex += 1;
        if (!targetQueue) {
          return;
        }
        for (const candidate of targetQueue) {
          try {
            await input.processCandidate(candidate);
          } catch (error) {
            await input.onCandidateFailure?.(candidate, error);
          }
        }
      }
    })
  );
};

const groupCandidatesByTarget = <Candidate>(
  input: Pick<
    ProcessDispatchOutboxCandidatesInput<Candidate>,
    "candidates" | "resolveTargetProfileId"
  >
): Candidate[][] => {
  const queuesByTarget = new Map<string, Candidate[]>();
  for (const candidate of input.candidates) {
    const targetProfileId = input.resolveTargetProfileId(candidate);
    const targetQueue = queuesByTarget.get(targetProfileId);
    if (targetQueue) {
      targetQueue.push(candidate);
      continue;
    }
    queuesByTarget.set(targetProfileId, [candidate]);
  }
  return [...queuesByTarget.values()];
};
