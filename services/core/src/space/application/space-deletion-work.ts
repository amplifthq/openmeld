import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { hasUnsettledSpaceTaskContinuation } from "../../agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import { hasUnsettledSpaceNativeDelivery } from "../../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { hasUnsettledSpaceRoutineRun } from "../../routines/routine-repository";
import { listActiveRuntimeCoordinatorExecutionWakeProgressSelectorsBySpace } from "../../runtime-transport/infrastructure/postgresql/runtime-coordinator-execution-repo";

/** The caller holds the Space gate through this check and deletion. */
export async function readSpaceDeletionPendingWork(input: {
  db: Pick<PostgresDatabase, "transaction">;
  spaceId: string;
}) {
  return await input.db.transaction(async (client) => {
    // A continuation can become a delivery between reads. One snapshot must
    // see at least one side of that handoff; separate snapshots can miss both.
    await client.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
    );
    const executions =
      await listActiveRuntimeCoordinatorExecutionWakeProgressSelectorsBySpace({
        db: client,
        spaceId: input.spaceId,
        limit: 1,
      });
    const nativeDelivery = await hasUnsettledSpaceNativeDelivery({
      db: client,
      spaceId: input.spaceId,
    });
    const routineRun = await hasUnsettledSpaceRoutineRun({
      db: client,
      spaceId: input.spaceId,
    });
    const continuation = await hasUnsettledSpaceTaskContinuation({
      db: client,
      spaceId: input.spaceId,
    });
    return {
      execution: executions.length > 0,
      nativeDelivery,
      routineRun,
      continuation,
    };
  });
}
