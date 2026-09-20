import type { InboxSourceCandidate } from "@openmeld/schemas/types";
import { ensureInboxItem } from "../../src/inbox/application/inbox-item-service";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./sqlite-d1-harness.test-support";

export function createInboxFeedFixture() {
  const harness = createSqliteD1Harness();
  harness.run({
    sql: "CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT, slug TEXT, created_at INTEGER)",
  });
  harness.run({
    sql: "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT)",
  });
  harness.run({
    sql: "CREATE TABLE openmeld_profiles (profile_id TEXT PRIMARY KEY, profile_kind TEXT, organization_id TEXT, owner_user_id TEXT, managed_role TEXT)",
  });
  harness.run({
    sql: "CREATE TABLE center_agent_designations (organization_id TEXT PRIMARY KEY, agent_profile_id TEXT)",
  });
  applyDrizzleMigrationsForTables(harness, [
    "inbox_items",
    "inbox_email_deliveries",
    "inbox_feed_snapshots",
    "inbox_feed_snapshot_members",
    "inbox_notification_preferences",
    "inbox_message_notification_defaults",
    "inbox_conversation_notification_preferences",
    "inbox_center_agent_read_watermarks",
    "inbox_space_thread_read_watermarks",
    "space_index_spaces",
    "space_index_memberships",
  ]);
  harness.run({
    sql: "INSERT INTO organizations VALUES ('org', 'Design', 'design', 0), ('other-org', 'Other', 'other', 0)",
  });
  harness.run({
    sql: "INSERT INTO users VALUES ('owner', 'Owner', 'owner@example.test'), ('other', 'Other', 'other@example.test')",
  });
  const identity = { organizationId: "org", recipientUserId: "owner" };
  const space = (spaceId: string, organizationId = "org", owner = "owner") => {
    harness.run({
      sql: `INSERT INTO space_index_spaces (space_id, organization_id, organization_visibility, status, source_updated_at_ms, projected_at_ms, projection_event_id)
      VALUES (?, ?, 'private', 'active', 0, 0, ?)`,
      params: [spaceId, organizationId, `space-${spaceId}`],
    });
    member(spaceId, `${owner}-${spaceId}`, owner, "human");
  };
  const member = (
    spaceId: string,
    profileId: string,
    owner: string,
    kind: "agent" | "human"
  ) => {
    harness.run({
      sql: `INSERT INTO space_index_memberships
      (space_id, profile_id, profile_kind_snapshot, profile_name_snapshot, owner_user_id_snapshot, status, member_source, added_at_ms, source_updated_at_ms, projected_at_ms, projection_event_id)
      VALUES (?, ?, ?, ?, ?, 'active', 'joined_directly', 0, 0, 0, ?)`,
      params: [
        spaceId,
        profileId,
        kind,
        profileId,
        owner,
        `member-${spaceId}-${profileId}`,
      ],
    });
  };
  space("space");
  space("other-space", "other-org");
  const agent = (profileId: string, managed = false) => {
    harness.run({
      sql: "INSERT INTO openmeld_profiles VALUES (?, 'agent', 'org', ?, ?)",
      params: [
        profileId,
        managed ? null : "owner",
        managed ? "center_agent" : null,
      ],
    });
    member("space", profileId, managed ? "organization" : "owner", "agent");
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
