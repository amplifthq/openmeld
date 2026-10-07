import type { InboxSourceCandidate } from "@openmeld/schemas/types";
import { ensureInboxItem } from "../../src/inbox/application/inbox-item-service";
import { createPostgresHarness } from "./postgresql-harness.test-support";

export async function createInboxFeedFixture() {
  const harness = await createPostgresHarness();

  await harness.query({
    text: "INSERT INTO \"openmeld\".\"organizations\" (id, name, slug, created_at) VALUES ('org', 'Design', 'design', 0), ('other-org', 'Other', 'other', 0)",
  });
  await harness.query({
    text: "INSERT INTO \"openmeld\".\"users\" (id, name, email) VALUES ('owner', 'Owner', 'owner@example.test'), ('other', 'Other', 'other@example.test')",
  });
  const identity = { organizationId: "org", recipientUserId: "owner" };
  const space = async (
    spaceId: string,
    organizationId = "org",
    owner = "owner"
  ) => {
    await harness.query({
      text: `INSERT INTO "openmeld"."space_index_spaces" (space_id, organization_id, organization_visibility, status, source_updated_at_ms, projected_at_ms, projection_event_id)
      VALUES ($1, $2, 'private', 'active', 0, 0, $3)`,
      values: [spaceId, organizationId, `space-${spaceId}`],
    });
    await member(spaceId, `${owner}-${spaceId}`, owner, "human");
  };
  const member = async (
    spaceId: string,
    profileId: string,
    owner: string,
    kind: "agent" | "human"
  ) => {
    await harness.query({
      text: `INSERT INTO "openmeld"."space_index_memberships"
      (space_id, profile_id, profile_kind_snapshot, profile_name_snapshot, owner_user_id_snapshot, status, member_source, added_at_ms, source_updated_at_ms, projected_at_ms, projection_event_id)
      VALUES ($1, $2, $3, $4, $5, 'active', 'joined_directly', 0, 0, 0, $6)`,
      values: [
        spaceId,
        profileId,
        kind,
        profileId,
        owner,
        `member-${spaceId}-${profileId}`,
      ],
    });
  };
  await space("space");
  await space("other-space", "other-org");
  const agent = async (profileId: string, managed = false) => {
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, source, profile_kind, organization_id, owner_user_id, managed_role) VALUES ($1, $1, $1, 'web_create', 'agent', 'org', $2, $3)",
      values: [
        profileId,
        managed ? null : "owner",
        managed ? "center_agent" : null,
      ],
    });
    await member(
      "space",
      profileId,
      managed ? "organization" : "owner",
      "agent"
    );
  };
  const item = (id: string, patch: Partial<InboxSourceCandidate> = {}) =>
    ensureInboxItem({
      db: harness.db,
      nowMs: 10_000,
      candidate: {
        ...identity,
        attention: "update",
        importance: "normal",
        kind: "space_message",
        contextLabel: "Design",
        title: id,
        preview: "A source-owned update.",
        occurredAtMs: 1000,
        sourceKind: "space_signal",
        sourceKey: id,
        sourceTarget: { kind: "space", spaceId: "space", signalId: id },
        ...patch,
      },
    });
  return { ...harness, identity, space, member, agent, item };
}
