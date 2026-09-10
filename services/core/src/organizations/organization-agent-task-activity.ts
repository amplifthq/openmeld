import type { OrganizationAgentRuntimeOverviewResponse } from "@openmeld/schemas/types";
import { readRemoteAgentTaskActivity } from "../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { readRuntimeCoordinatorTaskActivity } from "../runtime-transport/infrastructure/d1/runtime-coordinator-execution-repo";

// Match the existing Wake evidence retention, rather than inventing lifetime
// work history or a new persistent writer for directory ordering.
const TASK_ACTIVITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export async function withOrganizationAgentTaskActivity(input: {
  db: D1Database;
  overview: OrganizationAgentRuntimeOverviewResponse;
}): Promise<OrganizationAgentRuntimeOverviewResponse> {
  const sinceMs =
    Date.parse(input.overview.generatedAt) - TASK_ACTIVITY_WINDOW_MS;
  const authorizedProfileIds = input.overview.agentProfiles.map(
    (profile) => profile.profileId
  );
  const [local, remote] = await Promise.all([
    readRuntimeCoordinatorTaskActivity({
      db: input.db,
      authorizedProfileIds,
      sinceMs,
    }),
    readRemoteAgentTaskActivity({
      db: input.db,
      organizationId: input.overview.organizationId,
      authorizedProfileIds,
      sinceMs,
    }),
  ]);
  return {
    ...input.overview,
    taskActivitySince: new Date(sinceMs).toISOString(),
    agentProfiles: input.overview.agentProfiles.map((profile) => {
      const last = Math.max(
        local.get(profile.profileId) ?? 0,
        remote.get(profile.profileId) ?? 0
      );
      return {
        ...profile,
        lastTaskActivityAt: last ? new Date(last).toISOString() : null,
      };
    }),
  };
}
