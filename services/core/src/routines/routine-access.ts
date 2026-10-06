import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { createCoreRpcHttpError } from "../rpc/errors";
import { readRoutineTargetSpaceEligibilityFromSpaceIndex } from "../space-index/space-index-repository";
import { listRoutineRunRecords } from "./routine-repository";

export async function listAccessibleRoutineRuns(input: {
  allowPersonal?: boolean;
  db: PostgresDatabase;
  organizationId: string;
  routineId: string;
  userId: string;
  humanProfileId: string;
  limit: number;
  beforeScheduledFor?: number;
}) {
  const history = await requireRoutineHistoryAccess(input);
  const targets = await input.db.query<{ target_space_id: string }>({
    text: `SELECT DISTINCT target_space_id_snapshot AS target_space_id FROM openmeld.routine_runs
   WHERE organization_id=$1 AND routine_id=$2 AND target_space_id_snapshot IS NOT NULL`,
    values: [input.organizationId, input.routineId],
  });
  const readable = await Promise.all(
    targets.rows.map(async (row) => {
      const access = await readRoutineTargetSpaceEligibilityFromSpaceIndex({
        db: input.db,
        organizationId: input.organizationId,
        representedHumanUserId: input.userId,
        representedHumanProfileId: input.humanProfileId,
        targetSpaceId: row.target_space_id,
        centerAgentDirectMessagePairKey: null,
        centerAgentProfileId: null,
      });
      return access?.active &&
        access.sameOrganization &&
        access.representedHumanVisible
        ? row.target_space_id
        : null;
    })
  );
  return await listRoutineRunRecords({
    ...input,
    agentProfileId: history.agentProfileId ?? undefined,
    visibility: {
      allowPersonal: input.allowPersonal,
      userId: input.userId,
      spaceIds: readable.filter((id): id is string => id !== null),
    },
  });
}

/** One privacy check for retained history, Web/CLI reads and Agent evidence. */
export async function requireRoutineHistoryAccess(input: {
  allowPersonal?: boolean;
  db: PostgresDatabase;
  organizationId: string;
  routineId: string;
  userId: string;
  humanProfileId: string;
  runId?: string;
}): Promise<{ agentProfileId: string | null }> {
  const rows = await input.db.query<{
    agent_profile_id: string | null;
    scope: string | null;
    created_by_user_id: string | null;
    target_space_id: string | null;
  }>({
    text: input.runId
      ? `SELECT agent_profile_id_snapshot AS agent_profile_id, scope_snapshot AS scope,
   created_by_user_id_snapshot AS created_by_user_id, target_space_id_snapshot AS target_space_id
   FROM openmeld.routine_runs WHERE organization_id=$1 AND routine_id=$2 AND id=$3`
      : `SELECT agent_profile_id, scope, created_by_user_id, target_space_id FROM openmeld.routines WHERE organization_id=$1 AND id=$2
   UNION ALL SELECT agent_profile_id_snapshot, scope_snapshot, created_by_user_id_snapshot, target_space_id_snapshot
   FROM openmeld.routine_runs WHERE organization_id=$1 AND routine_id=$2
   AND NOT EXISTS (SELECT 1 FROM openmeld.routines WHERE organization_id=$1 AND id=$2)
   ORDER BY created_by_user_id NULLS LAST LIMIT 1`,
    values: input.runId
      ? [input.organizationId, input.routineId, input.runId]
      : [input.organizationId, input.routineId],
  });
  const row = rows.rows[0];
  if (!row) {
    throw notFound();
  }
  if (row.scope === "personal" && input.allowPersonal === false) {
    throw notFound();
  }
  if (row.created_by_user_id === input.userId) {
    return { agentProfileId: row.agent_profile_id };
  }
  // Unknown historical ownership is never evidence of personal access.
  if (
    row.scope === "personal" ||
    (!row.scope && row.agent_profile_id) ||
    !row.target_space_id
  ) {
    throw notFound();
  }
  const eligibility = await readRoutineTargetSpaceEligibilityFromSpaceIndex({
    db: input.db,
    organizationId: input.organizationId,
    representedHumanUserId: input.userId,
    representedHumanProfileId: input.humanProfileId,
    targetSpaceId: row.target_space_id,
    centerAgentDirectMessagePairKey: null,
    centerAgentProfileId: null,
  });
  if (
    !(
      eligibility?.active &&
      eligibility.sameOrganization &&
      eligibility.representedHumanVisible
    )
  ) {
    throw notFound();
  }
  return { agentProfileId: row.agent_profile_id };
}
function notFound() {
  return createCoreRpcHttpError({
    status: 404,
    code: "routine.not_found",
    reason: "Routine was not found.",
  });
}
