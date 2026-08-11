import { CENTER_AGENT_ROUTINE_LIMIT } from "@openmeld/schemas";
import type { OrganizationUsageOverviewResponse } from "@openmeld/schemas/types";
import { resolveRemoteAgentDailyAdmissionLimit } from "../remote-agent/application/daily-admission-policy";
import { countRoutineRecords } from "../routines/routine-repository";
import { readOrganizationDailyAdmissionCount } from "./organization-usage-overview-repository";

export async function readOrganizationUsageOverview(input: {
  configuredDailyLimit: string | undefined;
  nowMs: number;
  organizationId: string;
  routineDb: D1Database;
  wakeEvidenceDb: D1Database;
}): Promise<OrganizationUsageOverviewResponse> {
  const now = new Date(input.nowMs);
  const dayUtc = now.toISOString().slice(0, 10);
  const resetsAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  ).toISOString();
  const [usedToday, routineCounts] = await Promise.all([
    readOrganizationDailyAdmissionCount({
      dayUtc,
      db: input.wakeEvidenceDb,
      organizationId: input.organizationId,
    }),
    countRoutineRecords({
      db: input.routineDb,
      organizationId: input.organizationId,
    }),
  ]);

  return {
    centerAgentWakes: {
      dailyLimit: resolveRemoteAgentDailyAdmissionLimit(
        input.configuredDailyLimit
      ),
      resetsAt,
      usedToday,
    },
    routines: {
      count: routineCounts.total,
      limit: CENTER_AGENT_ROUTINE_LIMIT,
    },
  };
}
