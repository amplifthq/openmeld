import {
  inboxSourceCandidateSchema,
  isCenterAgentDirectMessageSpaceProjection,
} from "@openmeld/schemas";
import type { InboxSourceCandidate } from "@openmeld/schemas/types";

type CenterAgentDirectMessageRow = {
  agent_profile_id: string | null;
  direct_message_pair_key: string | null;
  organization_id: string;
  space_purpose: string | null;
};

export async function prepareSpaceInboxCandidateForCenterAgent(input: {
  candidate: InboxSourceCandidate;
  db: D1Database;
}): Promise<InboxSourceCandidate> {
  const { candidate } = input;
  if (
    candidate.sourceTarget.kind !== "space" ||
    !candidate.sourceTarget.signalId
  ) {
    return candidate;
  }

  const row = await input.db
    .prepare(
      `
        SELECT
          designation.agent_profile_id,
          space.direct_message_pair_key,
          space.organization_id,
          space.space_purpose
        FROM space_index_spaces AS space
        LEFT JOIN center_agent_designations AS designation
          ON designation.organization_id = space.organization_id
        WHERE space.space_id = ?
          AND space.organization_id = ?
          AND space.status = 'active'
        LIMIT 1
      `
    )
    .bind(candidate.sourceTarget.spaceId, candidate.organizationId)
    .first<CenterAgentDirectMessageRow>();
  if (!row) {
    throw new Error("space_inbox_projection.space_index_unavailable");
  }
  if (
    !isCenterAgentDirectMessageSpaceProjection({
      centerAgentProfileId: row.agent_profile_id,
      directMessagePairKey: row.direct_message_pair_key,
      spacePurpose: row.space_purpose,
    })
  ) {
    return candidate;
  }

  return inboxSourceCandidateSchema.parse({
    ...candidate,
    contextLabel: "Center Agent",
    sourceTarget: {
      kind: "center_agent",
      signalId: candidate.sourceTarget.signalId,
      spaceId: candidate.sourceTarget.spaceId,
    },
  });
}
