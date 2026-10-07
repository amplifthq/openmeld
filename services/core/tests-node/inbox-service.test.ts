import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { INBOX_SPACE_SUMMARY_MAX_SPACES } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { canReceivePersonalAgentActivity } from "../src/inbox/application/inbox-agent-owner-access";
import { ensureInboxItem } from "../src/inbox/application/inbox-item-service";
import { createInboxMessageNotificationPreferencesService } from "../src/inbox/application/inbox-message-notification-preferences";
import { observeInboxNotifications } from "../src/inbox/application/inbox-notification-observations";
import { createInboxService } from "../src/inbox/application/inbox-service";
import { reconcileInvitationInbox } from "../src/organizations/invitation-inbox-projection";
import { createProjectionPostgresDatabase } from "../test-support/postgresql-query.test-support";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("Inbox service", () => {
  it("opens and dismisses a historical continuation reminder without replaying or resolving the task", async () => {
    const harness = await createInboxHarness();
    try {
      const identity = {
        organizationId: "org_one",
        recipientUserId: "user_one",
      };
      const candidate = {
        ...identity,
        contextLabel: "Center Agent",
        attention: "action_required" as const,
        importance: "urgent" as const,
        kind: "system_issue" as const,
        occurredAtMs: 1000,
        sourceKind: "remote_agent_native_delivery" as const,
        sourceKey: "old-delivery:admission_retry_exhausted",
        sourceTarget: {
          kind: "space" as const,
          spaceId: "space_one",
          signalId: "child-result-from-another-space",
          threadRootSignalId: "parent-thread",
        },
        sourceFacts: {
          version: 1 as const,
          recipientReasons: ["requester" as const],
          requestCategory: "action" as const,
        },
        title: "Center Agent could not continue a task",
        preview:
          "Open the linked original result in its Space thread and retry from there.",
      };
      const item = await ensureInboxItem({
        db: harness.db,
        candidate,
        nowMs: 2000,
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      const read = await service.get({ ...identity, itemId: item.itemId });
      expect(read.item.sourceTarget).toEqual({
        kind: "space",
        spaceId: "space_one",
        threadRootSignalId: "parent-thread",
      });
      expect(read.item.preview).not.toContain("retry");
      expect(read.item.preview).toContain("remove this reminder from Inbox");
      expect(
        (await service.list({ ...identity, view: "all" })).items[0]
          ?.sourceTarget
      ).toEqual(read.item.sourceTarget);
      await service.markRead({ ...identity, itemId: item.itemId, read: true });
      expect(await service.summary(identity)).toMatchObject({
        totalUnreadCount: 0,
        unresolvedActionCount: 1,
      });
      await service.dismiss({ ...identity, itemId: item.itemId });
      await ensureInboxItem({ db: harness.db, candidate, nowMs: 5000 });
      expect(await service.summary(identity)).toMatchObject({
        totalUnreadCount: 0,
        unresolvedActionCount: 0,
      });
      expect((await service.list({ ...identity, view: "all" })).items).toEqual(
        []
      );
      const stored = await harness.queryFirst<{
        resolution_status: string;
        source_target_json: string;
      }>({
        text: 'SELECT resolution_status, source_target_json FROM "openmeld"."inbox_items" WHERE id = $1',
        values: [item.itemId],
      });
      expect(stored?.resolution_status).toBe("open");
      expect(JSON.parse(stored?.source_target_json ?? "null")).toEqual(
        candidate.sourceTarget
      );
    } finally {
      await harness.close();
    }
  });
  it("reads only the insertion watermark when the notification cursor has not moved", async () => {
    const harness = await createInboxHarness();
    try {
      const input = {
        db: harness.db,
        organizationId: "org_one",
        recipientUserId: "user_one",
      };
      const baseline = await observeInboxNotifications(input);
      const prepare = vi.spyOn(harness.db, "query");
      const unchanged = await observeInboxNotifications({
        ...input,
        cursor: baseline.cursor,
      });
      expect(unchanged).toEqual(baseline);
      expect(prepare).toHaveBeenCalledTimes(1);
    } finally {
      await harness.close();
    }
  });
  it("observes every new insertion across pages without replaying history or losing delayed source events", async () => {
    const harness = await createInboxHarness();
    try {
      const identity = {
        organizationId: "org_one",
        recipientUserId: "user_one",
      };
      const observe = (cursor?: string) =>
        observeInboxNotifications({
          db: harness.db,
          ...identity,
          cursor,
          limit: 50,
        });
      await seedSpaceItem(harness.db, {
        recipientUserId: "user_one",
        spaceId: "space_one",
        sourceKey: "history",
        occurredAtMs: 9000,
      });
      const baseline = await observe();
      expect(baseline.items).toEqual([]);
      const expected: string[] = [];
      for (let index = 0; index < 101; index += 1) {
        const saved = await seedSpaceItem(harness.db, {
          recipientUserId: "user_one",
          spaceId: "space_one",
          sourceKey: `burst-${index}`,
          occurredAtMs: 1000,
        });
        expected.push(saved.itemId);
      }
      const first = await observe(baseline.cursor);
      expect(first.items.map((item) => item.id)).toEqual(expected.slice(0, 50));
      expect(first.hasMore).toBe(true);
      const late = await seedSpaceItem(harness.db, {
        recipientUserId: "user_one",
        spaceId: "space_one",
        sourceKey: "later-insertion",
        occurredAtMs: 500,
      });
      const second = await observe(first.cursor);
      const third = await observe(second.cursor);
      expect(
        [...first.items, ...second.items, ...third.items].map((item) => item.id)
      ).toEqual(expected);
      expect(third.hasMore).toBe(false);
      expect(third.items.every((item) => item.readAt === null)).toBe(true);
      const next = await observe(third.cursor);
      expect(next.items.map((item) => item.id)).toEqual([late.itemId]);
      expect((await observe(next.cursor)).items).toEqual([]);
      await expect(
        observeInboxNotifications({
          db: harness.db,
          organizationId: "org_one",
          recipientUserId: "user_two",
          cursor: next.cursor,
        })
      ).rejects.toMatchObject({ status: 400 });
      await expect(observe("invalid-cursor")).rejects.toMatchObject({
        status: 400,
      });
    } finally {
      await harness.close();
    }
  });
  it("filters inaccessible and cleared observations before advancing the observation cursor", async () => {
    const harness = await createInboxHarness();
    try {
      const input = {
        db: harness.db,
        organizationId: "org_one",
        recipientUserId: "user_one",
      };
      const baseline = await observeInboxNotifications(input);
      await seedSpaceIndex(harness, {
        organizationId: "org_one",
        spaceId: "no-access",
      });
      await seedSpaceItem(harness.db, {
        recipientUserId: "user_one",
        spaceId: "no-access",
        sourceKey: "private",
      });
      const cleared = await seedSpaceItem(harness.db, {
        recipientUserId: "user_one",
        spaceId: "space_one",
        sourceKey: "cleared",
      });
      await harness.query({
        text: 'UPDATE "openmeld"."inbox_items" SET cleared_at_ms = 3000 WHERE id = $1',
        values: [cleared.itemId],
      });
      const result = await observeInboxNotifications({
        ...input,
        cursor: baseline.cursor,
      });
      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
      const next = await seedSpaceItem(harness.db, {
        recipientUserId: "user_one",
        spaceId: "space_one",
        sourceKey: "accessible",
      });
      expect(
        (
          await observeInboxNotifications({ ...input, cursor: result.cursor })
        ).items.map((item) => item.id)
      ).toEqual([next.itemId]);
    } finally {
      await harness.close();
    }
  });
  it.each([
    "mentions_and_replies",
    "all_messages",
  ] as const)("includes a canonical Space mention in %s notification mode", async (mode) => {
    const harness = await createInboxHarness();
    try {
      if (mode === "all_messages") {
        await harness.query({
          values: ["user_one", mode],
          text: 'INSERT INTO "openmeld"."inbox_message_notification_defaults" (user_id, mode) VALUES ($1, $2)',
        });
      }
      const mention = await seedSpaceItem(harness.db, {
        kind: "space_mention",
        recipientUserId: "user_one",
        sourceKey: `canonical_mention_${mode}`,
        spaceId: "space_one",
      });
      await expect(
        createInboxService({ db: harness.db }).list({
          limit: 1,
          notificationPreview: true,
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "unread",
        })
      ).resolves.toMatchObject({
        items: [{ id: mention.itemId, kind: "space_mention" }],
      });
    } finally {
      await harness.close();
    }
  });
  it("prefers a newer canonical mention over an older eligible reply", async () => {
    const harness = await createInboxHarness();
    try {
      await seedSpaceItem(harness.db, {
        kind: "agent_reply",
        occurredAtMs: 1000,
        recipientUserId: "user_one",
        sourceKey: "older_eligible_reply",
        spaceId: "space_one",
      });
      const mention = await seedSpaceItem(harness.db, {
        kind: "space_mention",
        occurredAtMs: 2000,
        recipientUserId: "user_one",
        sourceKey: "newer_canonical_mention",
        spaceId: "space_one",
      });
      await expect(
        createInboxService({ db: harness.db }).list({
          limit: 1,
          notificationPreview: true,
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "unread",
        })
      ).resolves.toMatchObject({
        items: [{ id: mention.itemId, kind: "space_mention" }],
      });
    } finally {
      await harness.close();
    }
  });
  it("excludes read, resolved, and inaccessible canonical mentions", async () => {
    const harness = await createInboxHarness();
    try {
      await seedSpaceIndex(harness, {
        organizationId: "org_one",
        spaceId: "space_without_access",
      });
      const eligible = await seedSpaceItem(harness.db, {
        kind: "space_mention",
        occurredAtMs: 1000,
        recipientUserId: "user_one",
        sourceKey: "eligible_canonical_mention",
        spaceId: "space_one",
      });
      const read = await seedSpaceItem(harness.db, {
        kind: "space_mention",
        occurredAtMs: 4000,
        recipientUserId: "user_one",
        sourceKey: "read_canonical_mention",
        spaceId: "space_one",
      });
      const resolved = await seedSpaceItem(harness.db, {
        kind: "space_mention",
        occurredAtMs: 3000,
        recipientUserId: "user_one",
        sourceKey: "resolved_canonical_mention",
        spaceId: "space_one",
      });
      await seedSpaceItem(harness.db, {
        kind: "space_mention",
        occurredAtMs: 2000,
        recipientUserId: "user_one",
        sourceKey: "inaccessible_canonical_mention",
        spaceId: "space_without_access",
      });
      await harness.query({
        values: [read.itemId],
        text: 'UPDATE "openmeld"."inbox_items" SET read_at_ms = 5000 WHERE id = $1',
      });
      await harness.query({
        values: [resolved.itemId],
        text: "UPDATE \"openmeld\".\"inbox_items\" SET attention = 'action_required', resolution_status = 'resolved', resolved_at_ms = 5000 WHERE id = $1",
      });
      await expect(
        createInboxService({ db: harness.db }).list({
          notificationPreview: true,
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "unread",
        })
      ).resolves.toMatchObject({
        items: [{ id: eligible.itemId, kind: "space_mention" }],
        nextCursor: null,
      });
    } finally {
      await harness.close();
    }
  });
  it("selects the latest notification-eligible unread before pagination", async () => {
    const harness = await createInboxHarness();
    try {
      await seedSpaceIndex(harness, {
        organizationId: "org_one",
        spaceId: "space_two",
      });
      await seedActiveSpaceMembership(harness, {
        profileId: "agt_11111111-1111-4111-8111-111111111111_space_two",
        recipientUserId: "user_one",
        spaceId: "space_two",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 2000,
        recipientUserId: "user_one",
        sourceKey: "newer_muted_message",
        spaceId: "space_one",
      });
      const eligible = await seedSpaceItem(harness.db, {
        occurredAtMs: 1000,
        recipientUserId: "user_one",
        sourceKey: "older_eligible_message",
        spaceId: "space_two",
      });
      await harness.query({
        values: ["user_one", "org_one", "space_one", "muted"],
        text: 'INSERT INTO "openmeld"."inbox_conversation_notification_preferences" (user_id, organization_id, space_id, mode) VALUES ($1, $2, $3, $4)',
      });
      await harness.query({
        values: ["user_one", "org_one", "space_two", "all_messages"],
        text: 'INSERT INTO "openmeld"."inbox_conversation_notification_preferences" (user_id, organization_id, space_id, mode) VALUES ($1, $2, $3, $4)',
      });
      await expect(
        createInboxService({ db: harness.db }).list({
          limit: 1,
          notificationPreview: true,
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "unread",
        })
      ).resolves.toMatchObject({
        items: [{ id: eligible.itemId }],
        nextCursor: null,
      });
    } finally {
      await harness.close();
    }
  });
  it("persists account defaults and personal conversation overrides without changing email or unread state", async () => {
    const harness = await createInboxHarness();
    try {
      const service = createInboxMessageNotificationPreferencesService(
        harness.db
      );
      const inbox = createInboxService({ db: harness.db });
      const identity = { userId: "user_one", organizationId: "org_one" };
      const conversation = { ...identity, spaceId: "space_one" };
      await seedSpaceItem(harness.db, {
        recipientUserId: identity.userId,
        sourceKey: "notification-preference-message",
        spaceId: "space_one",
      });
      await inbox.updatePreferences({
        userId: identity.userId,
        urgentEmailEnabled: false,
      });
      const before = await inbox.summary({
        organizationId: identity.organizationId,
        recipientUserId: identity.userId,
      });
      expect(before.totalUnreadCount).toBe(1);
      expect(await service.get(conversation)).toMatchObject({
        defaultMode: "mentions_and_replies",
        overrideMode: null,
        effectiveMode: "mentions_and_replies",
      });
      await service.update({
        ...identity,
        preference: {
          scope: "conversation",
          spaceId: "space_one",
          mode: "all_messages",
        },
      });
      await service.update({
        ...identity,
        preference: { scope: "account", mode: "all_messages" },
      });
      await service.update({
        ...identity,
        preference: { scope: "account", mode: "mentions_and_replies" },
      });
      expect(await service.get(conversation)).toMatchObject({
        defaultMode: "mentions_and_replies",
        overrideMode: "all_messages",
        effectiveMode: "all_messages",
      });
      expect(
        await service.get({ ...conversation, userId: "user_two" })
      ).toMatchObject({
        overrideMode: null,
        effectiveMode: "mentions_and_replies",
      });
      await service.update({
        ...identity,
        preference: {
          scope: "conversation",
          spaceId: "space_one",
          mode: "muted",
        },
      });
      expect(await service.get(conversation)).toMatchObject({
        effectiveMode: "muted",
      });
      expect(
        await inbox.getPreferences({ userId: identity.userId })
      ).toMatchObject({ urgentEmailEnabled: false });
      await inbox.updatePreferences({
        userId: identity.userId,
        urgentEmailEnabled: true,
      });
      expect(await service.get(conversation)).toMatchObject({
        effectiveMode: "muted",
      });
      await service.update({
        ...identity,
        preference: { scope: "conversation", spaceId: "space_one", mode: null },
      });
      await service.update({
        ...identity,
        preference: { scope: "account", mode: "all_messages" },
      });
      expect(await service.get(conversation)).toMatchObject({
        overrideMode: null,
        effectiveMode: "all_messages",
      });
      expect(
        await service.get({ ...identity, organizationId: "org_two" })
      ).toMatchObject({ defaultMode: "all_messages" });
      await expect(
        service.get({ ...conversation, organizationId: "org_two" })
      ).rejects.toMatchObject({ status: 404 });
      expect(
        await inbox.summary({
          organizationId: identity.organizationId,
          recipientUserId: identity.userId,
        })
      ).toEqual(before);
      await harness.query({
        text: "UPDATE \"openmeld\".\"space_index_memberships\" SET status = 'left' WHERE owner_user_id_snapshot = 'user_one'",
      });
      await expect(
        service.update({
          ...identity,
          preference: {
            scope: "conversation",
            spaceId: "space_one",
            mode: "muted",
          },
        })
      ).rejects.toMatchObject({ status: 404 });
      await expect(service.get(conversation)).rejects.toMatchObject({
        status: 404,
      });
    } finally {
      await harness.close();
    }
  });
  it("separates shared reviews from fulfillment, preserves personal reading, and revokes reviewer access", async () => {
    const harness = await createInboxHarness();
    try {
      await harness.query({
        text: "INSERT INTO \"openmeld\".\"organization_join_requests\" (id, organization_id, requested_by_user_id, email, status, created_at) VALUES ('request-1', 'org_one', 'user_one', 'invitee@example.com', 'pending', 1000)",
      });
      const ids: string[] = [];
      for (const userId of ["user_one", "user_two"]) {
        const item = await ensureInboxItem({
          db: harness.db,
          nowMs: 2000,
          candidate: {
            organizationId: "org_one",
            recipientUserId: userId,
            attention: "action_required",
            importance: "urgent",
            kind: "organization_request",
            contextLabel: null,
            occurredAtMs: 1000,
            preview: "Review the invitation",
            title: "Review invitation",
            sourceKind: "organization_member_request",
            sourceKey: "invitation:request-1",
            sourceTarget: {
              kind: "organization_join_request",
              requestId: "request-1",
            },
          },
        });
        ids.push(item.itemId);
      }
      const manager = createInboxService({
        db: harness.db,
        canManageOrganization: true,
        nowMs: () => 8000,
      });
      const identity = {
        organizationId: "org_one",
        recipientUserId: "user_one",
      };
      await reconcileInvitationInbox(harness.db, "org_one");
      expect(
        (await manager.list({ ...identity, view: "needs_review" })).items.map(
          (item) => item.id
        )
      ).toEqual([ids[0]]);
      expect(
        (await manager.list({ ...identity, view: "needs_action" })).items
      ).toEqual([]);
      expect(
        (await manager.get({ ...identity, itemId: ids[0] as string })).item
          .importance
      ).toBe("normal");
      await manager.markRead({
        ...identity,
        itemId: ids[0] as string,
        read: true,
      });
      await harness.query({
        text: "UPDATE \"openmeld\".\"organization_join_requests\" SET status = 'approved', reviewed_by_user_id = 'user_two', reviewed_at = 3000 WHERE id = 'request-1'",
      });
      await reconcileInvitationInbox(harness.db, "org_one");
      for (const userId of ["user_one", "user_two"]) {
        const scope = { ...identity, recipientUserId: userId };
        expect(
          (await manager.list({ ...scope, view: "needs_review" })).items
        ).toEqual([]);
        expect(
          (await manager.list({ ...scope, view: "needs_action" })).items
        ).toHaveLength(1);
      }
      expect(
        (await manager.get({ ...identity, itemId: ids[0] as string })).item
          .readAt
      ).not.toBeNull();
      expect(
        (
          await manager.get({
            ...identity,
            recipientUserId: "user_two",
            itemId: ids[1] as string,
          })
        ).item.readAt
      ).toBeNull();
      await harness.query({
        text: 'UPDATE "openmeld"."organization_join_requests" SET invitation_sent_at = 4000 WHERE id = \'request-1\'',
      });
      await reconcileInvitationInbox(harness.db, "org_one");
      for (const userId of ["user_one", "user_two"]) {
        const scope = { ...identity, recipientUserId: userId };
        expect(
          (await manager.list({ ...scope, view: "needs_action" })).items
        ).toEqual([]);
        expect((await manager.summary(scope)).unresolvedActionCount).toBe(0);
      }
      await expect(
        createInboxService({ db: harness.db }).get({
          ...identity,
          itemId: ids[0] as string,
        })
      ).rejects.toMatchObject({ status: 404 });
      expect(
        await harness.queryAll({
          text: 'SELECT reviewed_by_user_id, reviewed_at FROM "openmeld"."organization_join_requests"',
        })
      ).toEqual([{ reviewed_by_user_id: "user_two", reviewed_at: 3000 }]);
    } finally {
      await harness.close();
    }
  });
  it("rechecks current owner/admin access for authorization updates", async () => {
    const harness = await createInboxHarness();
    try {
      const identity = {
        organizationId: "org_one",
        recipientUserId: "user_one",
      };
      const created = await ensureInboxItem({
        db: harness.db,
        nowMs: 2000,
        candidate: {
          ...identity,
          attention: "action_required",
          importance: "urgent",
          kind: "system_issue",
          contextLabel: "Authorization update",
          occurredAtMs: 1000,
          preview: "Reconnect Slack to update permissions.",
          title: "Update Slack permissions",
          sourceKind: "system_attention_event",
          sourceKey: "authorization-update:channel.slack.T1:v2",
          sourceTarget: { kind: "settings", section: "channels" },
        },
      });
      await expect(
        createInboxService({ db: harness.db }).get({
          ...identity,
          itemId: created.itemId,
        })
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        createInboxService({
          db: harness.db,
          canManageOrganization: true,
        }).get({ ...identity, itemId: created.itemId })
      ).resolves.toMatchObject({ item: { id: created.itemId } });
      await expect(
        createInboxService({ db: harness.db }).markRead({
          ...identity,
          itemId: created.itemId,
          read: true,
        })
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await harness.close();
    }
  });
  it.each([
    {
      kind: "space_message" as const,
      importance: "normal" as const,
      urgentCount: 0,
    },
    {
      kind: "agent_reply" as const,
      importance: "normal" as const,
      urgentCount: 0,
    },
  ])("keeps an exact personal Agent owner $kind unread and revokes stale ownership", async ({
    kind,
    importance,
    urgentCount,
  }) => {
    const harness = await createInboxHarness();
    try {
      await harness.query({
        text: "UPDATE \"openmeld\".\"space_index_memberships\" SET profile_kind_snapshot = 'agent' WHERE profile_id = 'agt_11111111-1111-4111-8111-111111111111'",
      });
      await harness.query({
        text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, managed_role, source) VALUES ('agt_11111111-1111-4111-8111-111111111111', 'Personal Agent', 'personal-agent', 'agent', 'org_one', 'user_one', NULL, 'migration')",
      });
      const identity = {
        organizationId: "org_one",
        recipientUserId: "user_one",
      };
      await ensureInboxItem({
        // The Space passes canonical active Agent IDs, independent of index timing.
        db: harness.db,
        nowMs: 2000,
        candidate: {
          ...identity,
          attention: "update",
          importance,
          kind,
          contextLabel: "Agent chat",
          occurredAtMs: 1000,
          preview: "Hello",
          title: "Someone messaged your agent",
          sourceKind: "space_signal",
          sourceKey: "owner-message",
          sourceFacts: {
            version: 1,
            recipientReasons: ["agent_owner"],
            agentProfileIds: ["agt_11111111-1111-4111-8111-111111111111"],
            personalAgentProfileIds: [
              "agt_11111111-1111-4111-8111-111111111111",
            ],
          },
          sourceTarget: {
            kind: "space",
            agentOwnerActivity: true,
            spaceId: "space_one",
            signalId: "owner-message",
          },
        },
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      const ownerEligibility = {
        db: harness.db,
        organizationId: "org_one",
        userId: "user_one",
        agentProfileIds: ["agt_11111111-1111-4111-8111-111111111111"],
      };
      expect(await canReceivePersonalAgentActivity(ownerEligibility)).toBe(
        true
      );
      expect(
        await canReceivePersonalAgentActivity({
          ...ownerEligibility,
          organizationId: "org_two",
        })
      ).toBe(false);
      expect(await service.summary(identity)).toMatchObject({
        unreadUrgentUpdateCount: urgentCount,
      });
      expect(await service.spaceSummary(identity)).toMatchObject({
        ordinarySpaceUnreadCount: 1,
      });
      await harness.query({
        text: "UPDATE \"openmeld\".\"space_index_spaces\" SET space_purpose = 'openmeld_dm_space', active_member_count = 2 WHERE space_id = 'space_one'",
      });
      expect(await service.spaceSummary(identity)).toMatchObject({
        chatUnreadCount: 1,
        chatUnreadUrgentUpdateCount: 0,
      });
      await harness.query({
        text: 'UPDATE "openmeld"."openmeld_profiles" SET managed_role = \'center_agent\', owner_user_id = NULL',
      });
      expect(await canReceivePersonalAgentActivity(ownerEligibility)).toBe(
        false
      );
      expect(await service.summary(identity)).toMatchObject({
        unreadUrgentUpdateCount: 0,
      });
      expect(await service.spaceSummary(identity)).toMatchObject({
        chatUnreadCount: 0,
      });
      await harness.query({
        text: 'UPDATE "openmeld"."openmeld_profiles" SET managed_role = NULL, owner_user_id = \'user_two\'',
      });
      expect(await service.summary(identity)).toMatchObject({
        unreadUrgentUpdateCount: 0,
      });
      expect(await service.spaceSummary(identity)).toMatchObject({
        chatUnreadCount: 0,
      });
      await harness.query({
        text: 'UPDATE "openmeld"."openmeld_profiles" SET owner_user_id = \'user_one\'',
      });
      await expect(
        service.markSpaceReadThrough({
          ...identity,
          spaceId: "space_one",
          throughOccurredAtMs: 1000,
        })
      ).resolves.toMatchObject({ markedReadCount: 1 });
      expect(await service.spaceSummary(identity)).toMatchObject({
        chatUnreadCount: 0,
      });
      expect(await service.summary(identity)).toMatchObject({
        unreadUrgentUpdateCount: 0,
      });
      expect(
        await harness.queryAll({
          text: 'SELECT * FROM "openmeld"."inbox_email_deliveries"',
        })
      ).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });
  it("keeps complete Chat counts and read action requests distinct", async () => {
    const harness = await createInboxHarness();
    try {
      await seedCenterAgentDirectMessageSpace(harness, {
        recipientProfileId: "agt_11111111-1111-4111-8111-111111111111",
        spaceId: "space_one",
      });
      const identity = {
        organizationId: "org_one",
        recipientUserId: "user_one",
      };
      const action = await seedSpaceItem(harness.db, {
        recipientUserId: "user_one",
        spaceId: "space_one",
        sourceKey: "dm-action",
      });
      await harness.db.query({
        ...{
          text: "UPDATE \"openmeld\".\"inbox_items\" SET attention = 'action_required', resolution_status = 'open', importance = 'urgent', read_at_ms = 1500 WHERE id = $1",
          values: [],
        },
        values: [action.itemId],
      });
      const urgent = await seedSpaceItem(harness.db, {
        recipientUserId: "user_one",
        spaceId: "space_one",
        sourceKey: "dm-urgent",
      });
      await harness.db.query({
        ...{
          text: 'UPDATE "openmeld"."inbox_items" SET importance = \'urgent\' WHERE id = $1',
          values: [],
        },
        values: [urgent.itemId],
      });
      for (let i = 0; i < 105; i++) {
        await seedSpaceItem(harness.db, {
          recipientUserId: "user_one",
          spaceId: "space_one",
          sourceKey: `dm-message-${i}`,
        });
      }
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      expect(await service.spaceSummary(identity)).toMatchObject({
        chatUnreadCount: 106,
        chatUnresolvedActionCount: 1,
        chatUnreadUrgentUpdateCount: 1,
        attention: [
          {
            spaceId: "space_one",
            unresolvedActionCount: 1,
            unreadUrgentUpdateCount: 1,
          },
        ],
      });
      await service.markRead({
        ...identity,
        itemId: urgent.itemId,
        read: true,
      });
      expect(await service.spaceSummary(identity)).toMatchObject({
        chatUnreadCount: 105,
        chatUnresolvedActionCount: 1,
        chatUnreadUrgentUpdateCount: 0,
      });
    } finally {
      await harness.close();
    }
  });
  it("counts urgent updates and open actions once across the full recipient Inbox", async () => {
    const harness = await createInboxHarness();
    try {
      const identity = {
        organizationId: "org_one",
        recipientUserId: "user_one",
      };
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      const action = await seedItem(harness.db, {
        ...identity,
        sourceKey: "urgent_action",
      });
      const urgent = await seedItem(harness.db, {
        ...identity,
        sourceKey: "urgent_update",
      });
      await harness.db.query({
        ...{
          text: "UPDATE \"openmeld\".\"inbox_items\" SET attention = 'update', resolution_status = 'not_applicable' WHERE id = $1",
          values: [],
        },
        values: [urgent.itemId],
      });
      for (let i = 0; i < 105; i++) {
        await seedSpaceItem(harness.db, {
          recipientUserId: "user_one",
          spaceId: "space_one",
          sourceKey: `ordinary_${i}`,
          occurredAtMs: 3000 + i,
        });
      }
      await expect(service.summary(identity)).resolves.toMatchObject({
        totalUnreadCount: 107,
        unresolvedActionCount: 1,
        unreadUrgentUpdateCount: 1,
      });
      const urgentList = await service.list({
        ...identity,
        view: "urgent_updates",
        limit: 1,
      });
      expect(urgentList.items.map((item) => item.id)).toEqual([urgent.itemId]);
      const recentList = await service.list({
        ...identity,
        view: "recent_updates",
        limit: 100,
      });
      expect(recentList.items).toHaveLength(100);
      expect(
        recentList.items.every(
          (item) => item.importance === "normal" && item.attention === "update"
        )
      ).toBe(true);
      await service.markRead({
        ...identity,
        itemId: action.itemId,
        read: true,
      });
      await expect(service.summary(identity)).resolves.toMatchObject({
        unresolvedActionCount: 1,
        unreadUrgentUpdateCount: 1,
      });
      await service.markAllRead(identity);
      await expect(service.summary(identity)).resolves.toMatchObject({
        totalUnreadCount: 0,
        unresolvedActionCount: 1,
        unreadUrgentUpdateCount: 0,
      });
      await service.markRead({
        ...identity,
        itemId: urgent.itemId,
        read: false,
      });
      await expect(service.summary(identity)).resolves.toMatchObject({
        unreadUrgentUpdateCount: 1,
      });
      await service.dismiss({ ...identity, itemId: urgent.itemId });
      await expect(service.summary(identity)).resolves.toMatchObject({
        unreadUrgentUpdateCount: 0,
      });
      await harness.db.query({
        ...{
          text: 'UPDATE "openmeld"."inbox_items" SET resolution_status = \'resolved\', resolved_at_ms = 4000 WHERE id = $1',
          values: [],
        },
        values: [action.itemId],
      });
      await expect(service.summary(identity)).resolves.toMatchObject({
        unresolvedActionCount: 0,
        unreadUrgentUpdateCount: 0,
      });
    } finally {
      await harness.close();
    }
  });
  it("filters muted ordinary updates only from the attention presentation", async () => {
    const harness = await createInboxHarness();
    try {
      const identity = {
        organizationId: "org_one",
        recipientUserId: "user_one",
      };
      const service = createInboxService({ db: harness.db, nowMs: () => 5000 });
      const preferences = createInboxMessageNotificationPreferencesService(
        harness.db
      );
      const ordinary = await seedSpaceItem(harness.db, {
        recipientUserId: "user_one",
        sourceKey: "muted-ordinary",
        spaceId: "space_one",
      });
      const mention = await seedSpaceItem(harness.db, {
        recipientUserId: "user_one",
        sourceKey: "muted-mention",
        spaceId: "space_one",
      });
      await harness.db.query({
        ...{
          text: 'UPDATE "openmeld"."inbox_items" SET kind = \'space_mention\' WHERE id = $1',
          values: [],
        },
        values: [mention.itemId],
      });
      const urgent = await seedSpaceItem(harness.db, {
        recipientUserId: "user_one",
        sourceKey: "muted-urgent",
        spaceId: "space_one",
      });
      await harness.db.query({
        ...{
          text: 'UPDATE "openmeld"."inbox_items" SET importance = \'urgent\' WHERE id = $1',
          values: [],
        },
        values: [urgent.itemId],
      });
      const action = await seedItem(harness.db, {
        ...identity,
        sourceKey: "muted-action",
      });
      await service.markRead({
        ...identity,
        itemId: action.itemId,
        read: true,
      });
      await preferences.update({
        organizationId: identity.organizationId,
        userId: identity.recipientUserId,
        preference: {
          scope: "conversation",
          spaceId: "space_one",
          mode: "muted",
        },
      });
      expect((await service.list(identity)).items).toHaveLength(4);
      expect(
        (
          await service.list({ ...identity, presentation: "attention" })
        ).items.map((item) => item.id)
      ).toEqual(
        expect.arrayContaining([mention.itemId, urgent.itemId, action.itemId])
      );
      expect(
        (await service.list({ ...identity, presentation: "attention" })).items
      ).toHaveLength(3);
      expect(
        (
          await service.list({
            ...identity,
            presentation: "attention",
            view: "mentions",
          })
        ).items.map((item) => item.id)
      ).toEqual([mention.itemId]);
      expect(
        (
          await service.list({
            ...identity,
            view: "recent_updates",
          })
        ).items.map((item) => item.id)
      ).toEqual(expect.arrayContaining([ordinary.itemId, mention.itemId]));
      expect(
        (
          await service.list({
            ...identity,
            presentation: "attention",
            view: "recent_updates",
          })
        ).items.map((item) => item.id)
      ).toEqual([]);
      await expect(service.summary(identity)).resolves.toMatchObject({
        totalUnreadCount: 3,
      });
      await expect(
        service.summary({ ...identity, presentation: "attention" })
      ).resolves.toMatchObject({
        ordinaryUnreadCount: 0,
        totalUnreadCount: 2,
        unreadMentionCount: 1,
        unreadUrgentUpdateCount: 1,
        unresolvedActionCount: 1,
      });
      await expect(
        service.markAllRead({ ...identity, presentation: "attention" })
      ).resolves.toEqual({ markedReadCount: 2 });
      expect(
        (await service.get({ ...identity, itemId: ordinary.itemId })).item
          .readAt
      ).toBeNull();
      expect(
        (await service.get({ ...identity, itemId: action.itemId })).item.readAt
      ).not.toBeNull();
      await preferences.update({
        organizationId: identity.organizationId,
        userId: identity.recipientUserId,
        preference: {
          scope: "conversation",
          spaceId: "space_one",
          mode: null,
        },
      });
      await expect(
        service.summary({ ...identity, presentation: "attention" })
      ).resolves.toMatchObject({
        ordinaryUnreadCount: 1,
        unreadMentionCount: 0,
        totalUnreadCount: 1,
      });
    } finally {
      await harness.close();
    }
  });
  it.each([
    {
      itemKind: "center_agent_task",
      sourceKind: "center_agent_task_event",
      target: { kind: "center_agent_task", taskId: "retired" },
    },
    {
      itemKind: "agent_interaction",
      sourceKind: "system_attention_event",
      target: { kind: "agent_profile_creation_request", requestId: "held" },
    },
  ])("excludes unavailable $target.kind rows from reads and counts without deleting other Inbox items", async ({
    itemKind,
    sourceKind,
    target,
  }) => {
    const harness = await createInboxHarness();
    try {
      const retired = await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_one",
        sourceKey: "retired",
      });
      const current = await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_one",
        sourceKey: "current",
      });
      await harness.db.query({
        ...{
          text: 'UPDATE "openmeld"."inbox_items" SET kind = $1, source_kind = $2, source_target_json = $3 WHERE id = $4',
          values: [],
        },
        values: [itemKind, sourceKind, JSON.stringify(target), retired.itemId],
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      const identity = {
        organizationId: "org_one",
        recipientUserId: "user_one",
      };
      await expect(
        service.get({ ...identity, itemId: retired.itemId })
      ).rejects.toMatchObject({ code: "inbox.item_not_found" });
      const response = await service.list({ ...identity, view: "all" });
      expect(response.items.map((item) => item.id)).toEqual([current.itemId]);
      await expect(service.summary(identity)).resolves.toMatchObject({
        totalUnreadCount: 1,
        unresolvedActionCount: 1,
      });
    } finally {
      await harness.close();
    }
  });
  it("isolates list and summary state by organization and recipient", async () => {
    const harness = await createInboxHarness();
    try {
      const item = await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_one",
        sourceKey: "interaction_one",
      });
      await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_two",
        sourceKey: "interaction_two",
      });
      await seedItem(harness.db, {
        organizationId: "org_two",
        recipientUserId: "user_one",
        sourceKey: "interaction_three",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      await expect(
        service.get({
          itemId: item.itemId,
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toMatchObject({ item: { id: item.itemId } });
      await expect(
        service.list({
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "all",
        })
      ).resolves.toMatchObject({
        organizationId: "org_one",
        items: [
          {
            organizationId: "org_one",
            recipientUserId: "user_one",
          },
        ],
      });
      await expect(
        service.summary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({
        organizationId: "org_one",
        totalUnreadCount: 1,
        unresolvedActionCount: 1,
        unreadUrgentUpdateCount: 0,
      });
    } finally {
      await harness.close();
    }
  });
  it("marks only the authenticated recipient item read and keeps action unresolved", async () => {
    const harness = await createInboxHarness();
    try {
      const item = await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_one",
        sourceKey: "interaction_one",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      await expect(
        service.markRead({
          itemId: item.itemId,
          organizationId: "org_one",
          read: true,
          recipientUserId: "user_two",
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found" });
      const response = await service.markRead({
        itemId: item.itemId,
        organizationId: "org_one",
        read: true,
        recipientUserId: "user_one",
      });
      expect(response.item).toMatchObject({
        readAt: "1970-01-01T00:00:04.000Z",
        resolutionStatus: "open",
      });
      await expect(
        service.summary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toMatchObject({
        totalUnreadCount: 0,
        unresolvedActionCount: 1,
      });
    } finally {
      await harness.close();
    }
  });
  it("dismisses only the recipient projection without resolving its source action", async () => {
    const harness = await createInboxHarness();
    try {
      const item = await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_one",
        sourceKey: "interaction_to_dismiss",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      await expect(
        service.dismiss({
          itemId: item.itemId,
          organizationId: "org_one",
          recipientUserId: "user_two",
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found" });
      await expect(
        service.dismiss({
          itemId: item.itemId,
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({ dismissedItemId: item.itemId });
      await expect(
        service.dismiss({
          itemId: item.itemId,
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({ dismissedItemId: item.itemId });
      await expect(
        service.list({
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "all",
        })
      ).resolves.toMatchObject({ items: [] });
      await expect(
        service.summary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({
        organizationId: "org_one",
        totalUnreadCount: 0,
        unresolvedActionCount: 0,
        unreadUrgentUpdateCount: 0,
      });
      await expect(
        service.get({
          itemId: item.itemId,
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found" });
      const stored = await harness.queryFirst<{
        cleared_at_ms: number | null;
        resolution_status: string;
      }>({
        values: [item.itemId],
        text: 'SELECT cleared_at_ms, resolution_status FROM "openmeld"."inbox_items" WHERE id = $1',
      });
      expect(stored).toEqual({
        cleared_at_ms: 4000,
        resolution_status: "open",
      });
      const delivery = await harness.queryFirst<{
        state: string;
        suppressed_reason: string | null;
      }>({
        values: [item.itemId],
        text: 'SELECT state, suppressed_reason FROM "openmeld"."inbox_email_deliveries" WHERE inbox_item_id = $1',
      });
      expect(delivery).toEqual({
        state: "suppressed",
        suppressed_reason: "item_cleared",
      });
    } finally {
      await harness.close();
    }
  });
  it("fails closed for Space items after the recipient membership is removed", async () => {
    const harness = await createInboxHarness();
    try {
      const item = await seedSpaceItem(harness.db, {
        recipientUserId: "user_one",
        sourceKey: "signal_one",
        spaceId: "space_one",
      });
      const centerAgentItem = await seedCenterAgentSpaceItem(harness.db, {
        recipientUserId: "user_one",
        sourceKey: "center_agent_signal_one",
        spaceId: "space_one",
      });
      const interaction = await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_one",
        sourceKey: "interaction_after_membership",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      await expect(
        service.list({
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "all",
        })
      ).resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ id: item.itemId }),
          expect.objectContaining({ id: centerAgentItem.itemId }),
          expect.objectContaining({ id: interaction.itemId }),
        ]),
      });
      await harness.query({
        values: [
          5000,
          5000,
          "space_one",
          "agt_11111111-1111-4111-8111-111111111111",
        ],
        text: `
          UPDATE "openmeld"."space_index_memberships"
          SET status = 'removed', removed_at_ms = $1, source_updated_at_ms = $2
          WHERE space_id = $3 AND profile_id = $4
        `,
      });
      await expect(
        service.list({
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "all",
        })
      ).resolves.toMatchObject({ items: [] });
      await expect(
        service.get({
          itemId: item.itemId,
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found" });
      await expect(
        service.get({
          itemId: centerAgentItem.itemId,
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found" });
      await expect(
        service.summary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({
        organizationId: "org_one",
        totalUnreadCount: 0,
        unresolvedActionCount: 0,
        unreadUrgentUpdateCount: 0,
      });
      await expect(
        service.markRead({
          itemId: item.itemId,
          organizationId: "org_one",
          read: true,
          recipientUserId: "user_one",
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found" });
      await expect(
        service.markRead({
          itemId: interaction.itemId,
          organizationId: "org_one",
          read: true,
          recipientUserId: "user_one",
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found" });
      await expect(
        service.markAllRead({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({ markedReadCount: 0 });
    } finally {
      await harness.close();
    }
  });
  it("defaults a missing account preference on and propagates read failures", async () => {
    const harness = await createInboxHarness();
    try {
      const service = createInboxService({ db: harness.db });
      await expect(
        service.getPreferences({ userId: "user_one" })
      ).resolves.toEqual({ urgentEmailEnabled: true, updatedAt: null });
    } finally {
      await harness.close();
    }
    const storageError = new Error("PostgreSQL unavailable");
    const failingDb = createProjectionPostgresDatabase(() => {
      throw storageError;
    });
    await expect(
      createInboxService({ db: failingDb }).getPreferences({
        userId: "user_one",
      })
    ).rejects.toBe(storageError);
  });
  it("persists an account preference independently of organization", async () => {
    const harness = await createInboxHarness();
    try {
      const service = createInboxService({ db: harness.db, nowMs: () => 5000 });
      await expect(
        service.updatePreferences({
          urgentEmailEnabled: false,
          userId: "user_one",
        })
      ).resolves.toEqual({
        urgentEmailEnabled: false,
        updatedAt: "1970-01-01T00:00:05.000Z",
      });
    } finally {
      await harness.close();
    }
  });
  it("tracks Center Agent unread replies with a monotonic visible-through watermark", async () => {
    const harness = await createInboxHarness();
    try {
      await seedCenterAgentDirectMessageSpace(harness, {
        recipientProfileId: "agt_11111111-1111-4111-8111-111111111111",
        spaceId: "space_one",
      });
      await seedCenterAgentSpaceItem(harness.db, {
        occurredAtMs: 1000,
        recipientUserId: "user_one",
        sourceKey: "center_agent_visible_reply",
        spaceId: "space_one",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      await expect(
        service.centerAgentSummary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({ organizationId: "org_one", unreadCount: 1 });
      await expect(
        service.markCenterAgentReadThrough({
          organizationId: "org_one",
          recipientUserId: "user_one",
          spaceId: "space_one",
          throughOccurredAtMs: 1000,
        })
      ).resolves.toEqual({
        markedReadCount: 1,
        readThroughAt: "1970-01-01T00:00:04.000Z",
      });
      await seedCenterAgentSpaceItem(harness.db, {
        occurredAtMs: 900,
        recipientUserId: "user_one",
        sourceKey: "center_agent_late_old_reply",
        spaceId: "space_one",
      });
      await seedCenterAgentSpaceItem(harness.db, {
        occurredAtMs: 1100,
        recipientUserId: "user_one",
        sourceKey: "center_agent_new_reply",
        spaceId: "space_one",
      });
      await expect(
        service.centerAgentSummary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({ organizationId: "org_one", unreadCount: 1 });
      expect(
        await harness.queryAll<{
          read_at_ms: number | null;
          source_key: string;
        }>({
          values: ["center_agent_late_old_reply", "center_agent_new_reply"],
          text: `
            SELECT source_key, read_at_ms
            FROM "openmeld"."inbox_items"
            WHERE source_key IN ($1, $2)
            ORDER BY source_key
          `,
        })
      ).toEqual([
        { read_at_ms: 4000, source_key: "center_agent_late_old_reply" },
        { read_at_ms: null, source_key: "center_agent_new_reply" },
      ]);
    } finally {
      await harness.close();
    }
  });
  it("summarizes unread Inbox updates by accessible Space", async () => {
    const harness = await createInboxHarness();
    try {
      await seedSpaceIndex(harness, {
        organizationId: "org_one",
        spaceId: "space_two",
      });
      await seedActiveSpaceMembership(harness, {
        profileId: "agt_11111111-1111-4111-8111-111111111111_space_two",
        recipientUserId: "user_one",
        spaceId: "space_two",
      });
      await seedSpaceIndex(harness, {
        organizationId: "org_one",
        spaceId: "space_hidden",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 1000,
        recipientUserId: "user_one",
        sourceKey: "space_one_message_one",
        spaceId: "space_one",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 1100,
        recipientUserId: "user_one",
        sourceKey: "space_one_message_two",
        spaceId: "space_one",
      });
      await seedCenterAgentSpaceItem(harness.db, {
        occurredAtMs: 1050,
        recipientUserId: "user_one",
        sourceKey: "space_one_center_agent_reply",
        spaceId: "space_one",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 2000,
        recipientUserId: "user_one",
        sourceKey: "space_two_message",
        spaceId: "space_two",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 3000,
        recipientUserId: "user_one",
        sourceKey: "space_hidden_message",
        spaceId: "space_hidden",
      });
      await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_one",
        sourceKey: "space_action_not_a_message",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      await expect(
        service.spaceSummary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({
        ordinarySpaceUnreadCount: 4,
        chatUnreadCount: 0,
        chatUnresolvedActionCount: 0,
        chatUnreadUrgentUpdateCount: 0,
        attention: [
          {
            spaceId: "space_one",
            unresolvedActionCount: 1,
            unreadUrgentUpdateCount: 0,
          },
        ],
        organizationId: "org_one",
        spaces: [
          {
            latestUnreadOccurredAtMs: 2000,
            spaceId: "space_two",
            unreadCount: 1,
          },
          {
            latestUnreadOccurredAtMs: 1100,
            spaceId: "space_one",
            unreadCount: 3,
          },
        ],
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps the ordinary Space unread total complete beyond the grouped summary limit", async () => {
    const harness = await createInboxHarness();
    try {
      const unreadSpaceCount = INBOX_SPACE_SUMMARY_MAX_SPACES + 1;
      await seedBulkUnreadOrdinarySpaces(harness, unreadSpaceCount);
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      const summary = await service.spaceSummary({
        organizationId: "org_one",
        recipientUserId: "user_one",
      });
      expect(summary.ordinarySpaceUnreadCount).toBe(unreadSpaceCount);
      expect(summary.spaces).toHaveLength(INBOX_SPACE_SUMMARY_MAX_SPACES);
    } finally {
      await harness.close();
    }
  });
  it("moves a converted Center Agent Direct Message unread update to only the Spaces destination", async () => {
    const harness = await createInboxHarness();
    try {
      await seedCenterAgentDirectMessageSpace(harness, {
        recipientProfileId: "agt_11111111-1111-4111-8111-111111111111",
        spaceId: "space_one",
      });
      await seedCenterAgentSpaceItem(harness.db, {
        occurredAtMs: 1000,
        recipientUserId: "user_one",
        sourceKey: "center_agent_direct_message_update",
        spaceId: "space_one",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      await expect(
        service.spaceSummary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toMatchObject({ ordinarySpaceUnreadCount: 0 });
      await expect(
        service.centerAgentSummary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({ organizationId: "org_one", unreadCount: 1 });
      await harness.query({
        values: [3000, "space_one"],
        text: `
          UPDATE "openmeld"."space_index_spaces"
          SET direct_message_converted_at_ms = $1
          WHERE space_id = $2
        `,
      });
      await expect(
        service.spaceSummary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toMatchObject({ ordinarySpaceUnreadCount: 1 });
      await expect(
        service.centerAgentSummary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({ organizationId: "org_one", unreadCount: 0 });
    } finally {
      await harness.close();
    }
  });
  it("marks viewed Space messages without hiding unresolved work", async () => {
    const harness = await createInboxHarness();
    try {
      await seedSpaceItem(harness.db, {
        occurredAtMs: 900,
        recipientUserId: "user_one",
        sourceKey: "space_old_message",
        spaceId: "space_one",
      });
      await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_one",
        sourceKey: "space_action_required",
      });
      await ensureInboxItem({
        candidate: {
          attention: "action_required",
          contextLabel: "Center Agent",
          importance: "normal",
          kind: "agent_interaction",
          occurredAtMs: 950,
          organizationId: "org_one",
          preview: "The Center Agent needs a decision.",
          recipientUserId: "user_one",
          sourceKey: "space_target_action_required",
          sourceKind: "runtime_coordinator_interaction",
          sourceTarget: {
            kind: "space",
            signalId: "space_target_action_required",
            spaceId: "space_one",
          },
          title: "Decision needed",
        },
        db: harness.db,
        nowMs: 2000,
      });
      await seedCenterAgentSpaceItem(harness.db, {
        occurredAtMs: 1000,
        recipientUserId: "user_one",
        sourceKey: "space_center_agent_reply",
        spaceId: "space_one",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 1100,
        recipientUserId: "user_one",
        sourceKey: "space_new_message",
        spaceId: "space_one",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      await expect(
        service.markSpaceReadThrough({
          organizationId: "org_one",
          recipientUserId: "user_one",
          spaceId: "space_one",
          throughOccurredAtMs: 1000,
        })
      ).resolves.toEqual({
        markedReadCount: 2,
        readThroughAt: "1970-01-01T00:00:04.000Z",
      });
      expect(
        await harness.queryFirst<{
          read_at_ms: number | null;
        }>({
          values: ["space_target_action_required"],
          text: 'SELECT read_at_ms FROM "openmeld"."inbox_items" WHERE source_key = $1',
        })
      ).toEqual({ read_at_ms: null });
      await expect(
        service.spaceSummary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({
        ordinarySpaceUnreadCount: 1,
        chatUnreadCount: 0,
        chatUnresolvedActionCount: 0,
        chatUnreadUrgentUpdateCount: 0,
        attention: [
          {
            spaceId: "space_one",
            unresolvedActionCount: 2,
            unreadUrgentUpdateCount: 0,
          },
        ],
        organizationId: "org_one",
        spaces: [
          {
            latestUnreadOccurredAtMs: 1100,
            spaceId: "space_one",
            unreadCount: 1,
          },
        ],
      });
      await expect(
        service.list({
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "needs_action",
        })
      ).resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            readAt: null,
            resolutionStatus: "open",
            sourceTarget: expect.objectContaining({
              kind: "agent_interaction",
              spaceId: "space_one",
            }),
          }),
          expect.objectContaining({
            readAt: null,
            resolutionStatus: "open",
            sourceTarget: expect.objectContaining({
              kind: "space",
              spaceId: "space_one",
            }),
          }),
        ]),
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 800,
        recipientUserId: "user_one",
        sourceKey: "space_delayed_old_message",
        spaceId: "space_one",
      });
      await expect(
        service.spaceSummary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({
        ordinarySpaceUnreadCount: 1,
        organizationId: "org_one",
        chatUnreadCount: 0,
        chatUnresolvedActionCount: 0,
        chatUnreadUrgentUpdateCount: 0,
        attention: [
          {
            spaceId: "space_one",
            unresolvedActionCount: 2,
            unreadUrgentUpdateCount: 0,
          },
        ],
        spaces: [
          {
            latestUnreadOccurredAtMs: 1100,
            spaceId: "space_one",
            unreadCount: 1,
          },
        ],
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps thread messages unread when the main Space timeline is viewed", async () => {
    const harness = await createInboxHarness();
    try {
      await seedSpaceItem(harness.db, {
        occurredAtMs: 900,
        recipientUserId: "user_one",
        sourceKey: "space_main_message",
        spaceId: "space_one",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 950,
        recipientUserId: "user_one",
        sourceKey: "space_thread_message",
        spaceId: "space_one",
        threadRootSignalId: "space_thread_root",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      await expect(
        service.markSpaceReadThrough({
          organizationId: "org_one",
          recipientUserId: "user_one",
          spaceId: "space_one",
          throughOccurredAtMs: 1000,
        })
      ).resolves.toMatchObject({ markedReadCount: 1 });
      expect(
        await harness.queryFirst<{
          read_at_ms: number | null;
        }>({
          values: ["space_thread_message"],
          text: 'SELECT read_at_ms FROM "openmeld"."inbox_items" WHERE source_key = $1',
        })
      ).toEqual({ read_at_ms: null });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 800,
        recipientUserId: "user_one",
        sourceKey: "space_delayed_thread_message",
        spaceId: "space_one",
        threadRootSignalId: "space_thread_root",
      });
      expect(
        await harness.queryFirst<{
          read_at_ms: number | null;
        }>({
          values: ["space_delayed_thread_message"],
          text: 'SELECT read_at_ms FROM "openmeld"."inbox_items" WHERE source_key = $1',
        })
      ).toEqual({ read_at_ms: null });
    } finally {
      await harness.close();
    }
  });
  it("returns exact unread targets for the active Space", async () => {
    const harness = await createInboxHarness();
    try {
      await seedSpaceItem(harness.db, {
        occurredAtMs: 900,
        recipientUserId: "user_one",
        sourceKey: "space_main_message",
        spaceId: "space_one",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 950,
        recipientUserId: "user_one",
        sourceKey: "space_thread_message",
        spaceId: "space_one",
        threadRootSignalId: "space_thread_root",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 1000,
        recipientUserId: "user_two",
        sourceKey: "other_user_message",
        spaceId: "space_one",
      });
      await expect(
        createInboxService({ db: harness.db }).spaceUnreadTargets({
          organizationId: "org_one",
          recipientUserId: "user_one",
          spaceId: "space_one",
        })
      ).resolves.toEqual({
        hasMoreTargets: false,
        organizationId: "org_one",
        spaceId: "space_one",
        targets: [
          {
            occurredAtMs: 900,
            signalId: "space_main_message",
            threadRootSignalId: null,
          },
          {
            occurredAtMs: 950,
            signalId: "space_thread_message",
            threadRootSignalId: "space_thread_root",
          },
        ],
        totalUnreadCount: 2,
      });
    } finally {
      await harness.close();
    }
  });
  it("reads through one thread without clearing main or another thread", async () => {
    const harness = await createInboxHarness();
    try {
      await seedSpaceItem(harness.db, {
        occurredAtMs: 900,
        recipientUserId: "user_one",
        sourceKey: "space_main_message",
        spaceId: "space_one",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 950,
        recipientUserId: "user_one",
        sourceKey: "thread_one_message",
        spaceId: "space_one",
        threadRootSignalId: "thread_one",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 975,
        recipientUserId: "user_one",
        sourceKey: "thread_two_message",
        spaceId: "space_one",
        threadRootSignalId: "thread_two",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      await expect(
        service.markSpaceReadThrough({
          organizationId: "org_one",
          recipientUserId: "user_one",
          spaceId: "space_one",
          threadRootSignalId: "thread_one",
          throughOccurredAtMs: 1000,
        })
      ).resolves.toMatchObject({ markedReadCount: 1 });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 925,
        recipientUserId: "user_one",
        sourceKey: "thread_one_delayed_message",
        spaceId: "space_one",
        threadRootSignalId: "thread_one",
      });
      expect(
        await harness.queryFirst<{
          read_at_ms: number | null;
        }>({
          values: ["thread_one_delayed_message"],
          text: 'SELECT read_at_ms FROM "openmeld"."inbox_items" WHERE source_key = $1',
        })
      ).toEqual({ read_at_ms: 4000 });
      expect(
        await harness.queryFirst<{
          unread_count: number;
        }>({
          text: 'SELECT count(*) AS unread_count FROM "openmeld"."inbox_items" WHERE read_at_ms IS NULL',
        })
      ).toEqual({ unread_count: 2 });
    } finally {
      await harness.close();
    }
  });
  it("rejects a Space read watermark far in the future", async () => {
    const harness = await createInboxHarness();
    try {
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      await expect(
        service.markSpaceReadThrough({
          organizationId: "org_one",
          recipientUserId: "user_one",
          spaceId: "space_one",
          throughOccurredAtMs: 304_001,
        })
      ).rejects.toMatchObject({
        code: "inbox.invalid_input",
        status: 400,
      });
    } finally {
      await harness.close();
    }
  });
  it("rejects the legacy Center Agent read endpoint for an ordinary Space", async () => {
    const harness = await createInboxHarness();
    try {
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });
      await expect(
        service.markCenterAgentReadThrough({
          organizationId: "org_one",
          recipientUserId: "user_one",
          spaceId: "space_one",
          throughOccurredAtMs: 9000,
        })
      ).rejects.toMatchObject({
        code: "inbox.center_agent_space_unavailable",
        status: 404,
      });
      expect(
        await harness.queryFirst({
          values: ["org_one", "user_one", "space_one"],
          text: `
            SELECT through_occurred_at_ms
            FROM "openmeld"."inbox_center_agent_read_watermarks"
            WHERE organization_id = $1
              AND recipient_user_id = $2
              AND space_id = $3
          `,
        })
      ).toBeNull();
    } finally {
      await harness.close();
    }
  });
});
async function seedItem(
  db: PostgresDatabase,
  identity: {
    organizationId: string;
    recipientUserId: string;
    sourceKey: string;
  }
) {
  return await ensureInboxItem({
    candidate: {
      attention: "action_required",
      contextLabel: "Build failures",
      importance: "urgent",
      kind: "agent_interaction",
      occurredAtMs: 1000,
      organizationId: identity.organizationId,
      preview: "The agent needs approval to continue.",
      recipientUserId: identity.recipientUserId,
      sourceKey: identity.sourceKey,
      sourceKind: "runtime_coordinator_interaction",
      sourceTarget: {
        interactionId: identity.sourceKey,
        kind: "agent_interaction",
        runtimeCoordinatorExecutionId: `runtime_${identity.sourceKey}`,
        spaceId: "space_one",
      },
      title: "Approval required",
    },
    db,
    nowMs: 2000,
  });
}
async function seedSpaceItem(
  db: PostgresDatabase,
  identity: {
    kind?: "agent_reply" | "space_mention" | "space_message";
    occurredAtMs?: number;
    recipientUserId: string;
    sourceKey: string;
    spaceId: string;
    threadRootSignalId?: string;
  }
) {
  return await ensureInboxItem({
    candidate: {
      attention: "update",
      contextLabel: "Launch Room",
      importance: "normal",
      kind: identity.kind ?? "space_message",
      occurredAtMs: identity.occurredAtMs ?? 1000,
      organizationId: "org_one",
      preview: "A private Space update.",
      recipientUserId: identity.recipientUserId,
      sourceKey: identity.sourceKey,
      sourceKind: "space_signal",
      sourceTarget: {
        kind: "space",
        signalId: identity.sourceKey,
        spaceId: identity.spaceId,
        ...(identity.threadRootSignalId
          ? { threadRootSignalId: identity.threadRootSignalId }
          : {}),
      },
      title: "New message in Launch Room",
    },
    db,
    nowMs: 2000,
  });
}
async function seedCenterAgentSpaceItem(
  db: PostgresDatabase,
  identity: {
    occurredAtMs?: number;
    recipientUserId: string;
    sourceKey: string;
    spaceId: string;
  }
) {
  return await ensureInboxItem({
    candidate: {
      attention: "update",
      contextLabel: "Center Agent",
      importance: "normal",
      kind: "agent_reply",
      occurredAtMs: identity.occurredAtMs ?? 1000,
      organizationId: "org_one",
      preview: "A private Center Agent reply.",
      recipientUserId: identity.recipientUserId,
      sourceKey: identity.sourceKey,
      sourceKind: "space_signal",
      sourceTarget: {
        kind: "center_agent",
        signalId: identity.sourceKey,
        spaceId: identity.spaceId,
      },
      title: "Center Agent replied",
    },
    db,
    nowMs: 2000,
  });
}
async function seedBulkUnreadOrdinarySpaces(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  count: number
): Promise<void> {
  await harness.query({
    values: [count],
    text: `
      WITH RECURSIVE sequence(value) AS (
        SELECT 0
        UNION ALL
        SELECT value + 1 FROM sequence WHERE value + 1 < $1
      )
      INSERT INTO "openmeld"."space_index_spaces" (
        space_id,
        organization_id,
        organization_visibility,
        status,
        active_member_count,
        source_updated_at_ms,
        projected_at_ms,
        projection_event_id
      )
      SELECT
        'bulk_space_' || value,
        'org_one',
        'private',
        'active',
        1,
        value + 1,
        value + 1,
        'bulk_space_projection_' || value
      FROM sequence
    `,
  });
  await harness.query({
    values: [count],
    text: `
      WITH RECURSIVE sequence(value) AS (
        SELECT 0
        UNION ALL
        SELECT value + 1 FROM sequence WHERE value + 1 < $1
      )
      INSERT INTO "openmeld"."space_index_memberships" (
        space_id,
        profile_id,
        profile_kind_snapshot,
        profile_name_snapshot,
        owner_user_id_snapshot,
        status,
        member_source,
        added_at_ms,
        source_updated_at_ms,
        projected_at_ms,
        projection_event_id
      )
      SELECT
        'bulk_space_' || value,
        'bulk_profile_' || value,
        'human',
        'Bulk member',
        'user_one',
        'active',
        'space',
        value + 1,
        value + 1,
        value + 1,
        'bulk_membership_projection_' || value
      FROM sequence
    `,
  });
  await harness.query({
    values: [count],
    text: `
      WITH RECURSIVE sequence(value) AS (
        SELECT 0
        UNION ALL
        SELECT value + 1 FROM sequence WHERE value + 1 < $1
      )
      INSERT INTO "openmeld"."inbox_items" (
        id,
        organization_id,
        recipient_user_id,
        kind,
        attention,
        importance,
        title,
        preview,
        source_kind,
        source_key,
        source_target_json,
        resolution_status,
        occurred_at_ms,
        created_at_ms,
        updated_at_ms
      )
      SELECT
        'bulk_inbox_' || value,
        'org_one',
        'user_one',
        'space_message',
        'update',
        'normal',
        'Unread Space message',
        'A new message is waiting.',
        'space_signal',
        'bulk_signal_' || value,
        json_build_object(
          'kind', 'space',
          'signalId', 'bulk_signal_' || value,
          'spaceId', 'bulk_space_' || value
        )::text,
        'not_applicable',
        value + 1,
        value + 1,
        value + 1
      FROM sequence
    `,
  });
}
async function createInboxHarness() {
  const harness = await createPostgresHarness();
  for (const [id, name, slug] of [
    ["org_one", "One", "one"],
    ["org_two", "Two", "two"],
  ] as const) {
    await harness.query({
      values: [id, name, slug, 1000],
      text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
    });
  }
  await seedSpaceIndex(harness, {
    organizationId: "org_one",
    spaceId: "space_one",
  });
  for (const [id, name, email] of [
    ["user_one", "One", "one@example.com"],
    ["user_two", "Two", "two@example.com"],
  ] as const) {
    await harness.query({
      values: [id, name, email],
      text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, $2, $3)',
    });
  }
  await seedActiveSpaceMembership(harness, {
    profileId: "agt_11111111-1111-4111-8111-111111111111",
    recipientUserId: "user_one",
    spaceId: "space_one",
  });
  await seedActiveSpaceMembership(harness, {
    profileId: "profile_two",
    recipientUserId: "user_two",
    spaceId: "space_one",
  });
  return harness;
}
async function seedCenterAgentDirectMessageSpace(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: {
    recipientProfileId: string;
    spaceId: string;
  }
): Promise<void> {
  await harness.query(`INSERT INTO "openmeld"."openmeld_profiles"
    (profile_id, profile_name, profile_handle, profile_kind, organization_id, managed_role, source)
    VALUES ('agt_33333333-3333-4333-8333-333333333333', 'Center Agent', 'center-agent', 'agent', 'org_one', 'center_agent', 'migration')`);
  await harness.query({
    values: [
      "openmeld_dm_space",
      `agt_33333333-3333-4333-8333-333333333333:${input.recipientProfileId}`,
      input.spaceId,
    ],
    text: `
      UPDATE "openmeld"."space_index_spaces"
      SET space_purpose = $1, direct_message_pair_key = $2
      WHERE space_id = $3
    `,
  });
  await harness.query({
    values: [
      "org_one",
      "agt_33333333-3333-4333-8333-333333333333",
      "user_one",
      1000,
    ],
    text: `
      INSERT INTO "openmeld"."center_agent_designations" (
        organization_id,
        agent_profile_id,
        designated_by,
        created_at
      ) VALUES ($1, $2, $3, $4)
    `,
  });
}
async function seedSpaceIndex(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: {
    organizationId: string;
    spaceId: string;
  }
): Promise<void> {
  await harness.query({
    values: [
      input.spaceId,
      input.organizationId,
      "private",
      "active",
      1000,
      1000,
      `space_projection_${input.spaceId}`,
    ],
    text: `
      INSERT INTO "openmeld"."space_index_spaces" (
        space_id,
        organization_id,
        organization_visibility,
        status,
        source_updated_at_ms,
        projected_at_ms,
        projection_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
  });
}
async function seedActiveSpaceMembership(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: {
    profileId: string;
    recipientUserId: string;
    spaceId: string;
  }
): Promise<void> {
  await harness.query({
    values: [
      input.spaceId,
      input.profileId,
      input.profileId,
      input.recipientUserId,
      1000,
      1000,
      1000,
      `projection_${input.profileId}`,
    ],
    text: `
      INSERT INTO "openmeld"."space_index_memberships" (
        space_id,
        profile_id,
        profile_kind_snapshot,
        profile_name_snapshot,
        owner_user_id_snapshot,
        status,
        member_source,
        added_at_ms,
        source_updated_at_ms,
        projected_at_ms,
        projection_event_id
      ) VALUES ($1, $2, 'human', $3, $4, 'active', 'joined_directly', $5, $6, $7, $8)
    `,
  });
}
