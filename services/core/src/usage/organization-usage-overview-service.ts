import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { CENTER_AGENT_ROUTINE_LIMIT } from "@openmeld/schemas";
import type { OrganizationUsageOverviewResponse } from "@openmeld/schemas/types";
import { countRoutineRecords } from "../routines/routine-repository";
import { readAiUsageAllowance } from "./ai-usage-policy";
export async function readOrganizationUsageOverview(input: {
  nowMs: number;
  organizationId: string;
  routineDb: PostgresDatabase;
  wakeEvidenceDb: PostgresDatabase;
}): Promise<OrganizationUsageOverviewResponse> {
  const [aiSpend, routineCounts] = await Promise.all([
    readAiUsageAllowance({
      nowMs: input.nowMs,
      db: input.wakeEvidenceDb,
      organizationId: input.organizationId,
    }),
    countRoutineRecords({
      db: input.routineDb,
      organizationId: input.organizationId,
    }),
  ]);
  return {
    aiSpend,
    routines: {
      count: routineCounts.total,
      limit: CENTER_AGENT_ROUTINE_LIMIT,
    },
  };
}
