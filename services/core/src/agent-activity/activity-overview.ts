import {
  AGENT_ACTIVITY_SNAPSHOT_PROJECT_LIMIT,
  agentActivityOverviewResponseSchema,
} from "@openmeld/schemas";
import type {
  AgentActivityOverviewResponse,
  AgentActivitySnapshotQuery,
  AgentActivitySnapshotResponse,
} from "@openmeld/schemas/types";

// Reserve room for Code Mode's JSON/string envelopes below the 128 KiB boundary.
export const AGENT_ACTIVITY_OVERVIEW_MAX_BYTES = 32 * 1024;
const encoder = new TextEncoder();

/** Bound structured records before serialization; never modify identifiers. */
export function projectAgentActivityOverview(
  snapshot: AgentActivitySnapshotResponse,
  query: AgentActivitySnapshotQuery = {}
): AgentActivityOverviewResponse {
  let textShortened = false;
  function short(value: string, limit = 160): string {
    const points = Array.from(value);
    if (points.length <= limit) {
      return value;
    }
    textShortened = true;
    return `${points.slice(0, limit - 1).join("")}…`;
  }
  function nullableShort(value: string | null, limit = 160): string | null {
    return value === null ? null : short(value, limit);
  }
  const sessions = snapshot.sessions
    .slice(0, 16)
    .map(({ providerMetadata: _metadata, ...row }) => ({
      ...row,
      title: nullableShort(row.title),
      memberName: short(row.memberName, 80),
      model: nullableShort(row.model, 80),
      gitBranch: nullableShort(row.gitBranch),
    }));
  const digests = snapshot.digests.slice(0, 8).map((row) => ({
    ...row,
    summary: nullableShort(row.summary, 600),
    failureReason: nullableShort(row.failureReason),
  }));
  const recentEvents = snapshot.recentEvents.slice(0, 16).map((row) => ({
    ...row,
    title: nullableShort(row.title),
    memberName: short(row.memberName, 80),
  }));
  const selectedProjectIds = new Set([
    ...sessions.map((row) => row.projectId),
    ...digests.map((row) => row.projectId),
    ...recentEvents.map((row) => row.projectId),
    ...(query.projectId ? [query.projectId] : []),
  ]);
  const projects = [...snapshot.projects]
    .sort(
      (a, b) =>
        Number(selectedProjectIds.has(b.id)) -
        Number(selectedProjectIds.has(a.id))
    )
    .slice(0, 12)
    .map((row) => ({
      id: row.id,
      name: short(row.name, 80),
      archivedAtMs: row.archivedAtMs,
      updatedAtMs: row.updatedAtMs,
    }));
  const response: AgentActivityOverviewResponse = {
    asOfMs: snapshot.asOfMs,
    organizationId: snapshot.organizationId,
    stalenessThresholdMs: snapshot.stalenessThresholdMs,
    projects,
    sessions,
    digests,
    recentEvents,
    digestsTruncated: snapshot.digestsTruncated,
    sessionsTruncated: snapshot.sessionsTruncated,
    coverage: {
      kind: "bounded_current_snapshot",
      history: "not_included",
      providerMetadata: "not_included",
      textShortened,
      omittedFromSnapshot: {
        projects: 0,
        sessions: 0,
        digests: 0,
        recentEvents: 0,
      },
      sourceLimitReached: {
        projects:
          snapshot.projects.length >= AGENT_ACTIVITY_SNAPSHOT_PROJECT_LIMIT,
        sessions: snapshot.sessionsTruncated,
        digests: snapshot.digestsTruncated,
        recentEvents: snapshot.recentEvents.length >= 100,
      },
      digestsExcludedBySessionFilters: Boolean(
        query.memberUserId || query.provider || query.status
      ),
      continuation: "openmeld_list_agent_activity_sessions",
      continuationScope: "live_session_inventory_not_snapshot_or_history",
    },
  };
  const collections = [
    "projects",
    "sessions",
    "digests",
    "recentEvents",
  ] as const;
  function updateCoverage() {
    for (const collection of collections) {
      response.coverage.omittedFromSnapshot[collection] =
        snapshot[collection].length - response[collection].length;
    }
    response.digestsTruncated =
      snapshot.digestsTruncated ||
      response.coverage.omittedFromSnapshot.digests > 0;
    response.sessionsTruncated =
      snapshot.sessionsTruncated ||
      response.coverage.omittedFromSnapshot.sessions > 0;
  }
  updateCoverage();
  while (serializedBytes(response) > AGENT_ACTIVITY_OVERVIEW_MAX_BYTES) {
    const largest = [...collections].sort(
      (a, b) => serializedBytes(response[b]) - serializedBytes(response[a])
    )[0];
    if (!largest || response[largest].length === 0) {
      throw new Error(
        "Agent Activity overview metadata exceeds its bounded contract."
      );
    }
    response[largest].pop();
    updateCoverage();
  }
  return agentActivityOverviewResponseSchema.parse(response);
}

function serializedBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}
