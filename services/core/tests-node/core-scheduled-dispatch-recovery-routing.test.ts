import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  ROUTINE_TICK_CRON,
  runCoreScheduledTasks,
} from "../src/scheduled/core-scheduled-tasks";

type ScheduledInput = Parameters<typeof runCoreScheduledTasks>[0];

const asScheduledDependency = <Key extends keyof ScheduledInput>(
  value: unknown
): NonNullable<ScheduledInput[Key]> =>
  value as NonNullable<ScheduledInput[Key]>;

describe("Core scheduled dispatch recovery routing", () => {
  it("keeps pre-head failure publication recovery on the authoritative Core database", async () => {
    const recoveryDb = {} as D1Database;
    const wakeEvidenceDb = {} as D1Database;
    const retryPreHeadFailurePublications = vi.fn().mockResolvedValue({
      enqueued: 0,
      errors: 0,
      scanned: 1,
    });
    const retryAcceptedDeliveryProbes = vi.fn().mockResolvedValue({
      enqueued: 1,
      errors: 0,
      scanned: 1,
    });

    await runCoreScheduledTasks({
      countStrandedSlackIngress:
        asScheduledDependency<"countStrandedSlackIngress">(
          vi.fn().mockResolvedValue(0)
        ),
      cron: ROUTINE_TICK_CRON,
      env: {
        OPENMELD_DB: recoveryDb,
        OPENMELD_LOCAL_STATE_DB: recoveryDb,
        OPENMELD_ROUTINE_ENGINE_DEFAULT: "legacy",
        OPENMELD_SPACES: {} as CoreBindings["OPENMELD_SPACES"],
        OPENMELD_WAKE_EVIDENCE_DB: wakeEvidenceDb,
      },
      nowMs: 1000,
      retryAgentTaskContinuations:
        asScheduledDependency<"retryAgentTaskContinuations">(
          vi.fn().mockResolvedValue(undefined)
        ),
      retryAcceptedDeliveryProbes,
      retryCenterAgentWakePublications:
        asScheduledDependency<"retryCenterAgentWakePublications">(
          vi.fn().mockResolvedValue({
            completed: 0,
            deferred: 0,
            failed: 0,
            rescheduled: 0,
          })
        ),
      retryPreHeadFailurePublications:
        asScheduledDependency<"retryPreHeadFailurePublications">(
          retryPreHeadFailurePublications
        ),
      retryRoutineFailurePublications:
        asScheduledDependency<"retryRoutineFailurePublications">(
          vi.fn().mockResolvedValue(undefined)
        ),
      retryRoutineSubmissions: asScheduledDependency<"retryRoutineSubmissions">(
        vi.fn().mockResolvedValue(undefined)
      ),
      retryRoutineWorkflowStarts:
        asScheduledDependency<"retryRoutineWorkflowStarts">(
          vi.fn().mockResolvedValue(undefined)
        ),
      runLarkPlatformRegistrationTick:
        asScheduledDependency<"runLarkPlatformRegistrationTick">(
          vi.fn().mockResolvedValue({ scanned: 0 })
        ),
      runMemberResearchTick: asScheduledDependency<"runMemberResearchTick">(
        vi.fn().mockResolvedValue(undefined)
      ),
      runRoutineTick: asScheduledDependency<"runRoutineTick">(
        vi.fn().mockResolvedValue(undefined)
      ),
    });

    expect(retryPreHeadFailurePublications).toHaveBeenCalledOnce();
    const [retryInput] = retryPreHeadFailurePublications.mock.calls[0] ?? [];
    expect(retryInput?.db).toBe(recoveryDb);
    expect(retryInput?.db).not.toBe(wakeEvidenceDb);
    expect(retryAcceptedDeliveryProbes).toHaveBeenCalledWith({
      db: wakeEvidenceDb,
      env: expect.any(Object),
      nowMs: 1000,
    });
  });
});
