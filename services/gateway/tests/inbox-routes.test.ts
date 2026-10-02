import type {
  GetInboxItemResponse,
  InboxSummaryResponse,
  ListInboxItemsResponse,
  MarkInboxItemReadResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

const TEST_EXECUTION_CONTEXT = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

const ITEM = {
  attention: "action_required" as const,
  contextLabel: "Build failures",
  createdAt: "2026-08-04T01:00:00.000Z",
  id: "inbox-item-1",
  importance: "urgent" as const,
  kind: "agent_interaction" as const,
  occurredAt: "2026-08-04T01:00:00.000Z",
  organizationId: "org-1",
  preview: "The agent needs your approval to continue.",
  readAt: null,
  recipientUserId: "owner-1",
  resolutionStatus: "open" as const,
  sourceTarget: {
    interactionId: "interaction-1",
    kind: "agent_interaction" as const,
    runtimeCoordinatorExecutionId: "execution-1",
    spaceId: "space-1",
  },
  title: "Approval required",
  updatedAt: "2026-08-04T01:00:00.000Z",
};

const MESSAGE_CHANNEL_ITEM = {
  ...ITEM,
  id: "inbox-item-2",
  sourceTarget: {
    channelId: "C0123456789",
    kind: "message_channel" as const,
    messageId: "1723200000.123456",
    permalink:
      "https://workspace.slack.com/archives/C0123456789/p1723200000123456?thread_ts=1723199999.654321&cid=C0123456789",
    provider: "slack" as const,
    teamId: "T0123456789",
    threadRootMessageId: "1723199999.654321",
  },
};

const AGENT_PROFILE_CREATION_REQUEST_ITEM = {
  ...ITEM,
  id: "inbox-item-3",
  sourceTarget: {
    kind: "agent_profile_creation_request" as const,
    requestId: "creation-request-1",
  },
};

const HUMAN_MENTION_ITEM = {
  ...ITEM,
  attention: "update" as const,
  id: "inbox-item-human-mention",
  kind: "space_mention" as const,
  resolutionStatus: "not_applicable" as const,
  sourceTarget: {
    kind: "space" as const,
    signalId: "signal-human-mention",
    spaceId: "space-1",
  },
  title: "Alex mentioned you in Launch Room",
};

describe("Inbox routes", () => {
  it("prepares a Space read selection through verified context and rejects injected recipients", async () => {
    const { coreRpc, env } = makeEnv();
    const request = (body: unknown) =>
      app.fetch(
        new Request("http://local/v1/inbox/spaces/read", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
        TEST_EXECUTION_CONTEXT
      );
    expect(
      (await request({ operation: "prepare", spaceId: "space-1" })).status
    ).toBe(200);
    expect(coreRpc.mutateSpaceInboxRead).toHaveBeenCalledWith({
      body: { operation: "prepare", spaceId: "space-1" },
      context: expect.any(Object),
    });
    expect(
      (
        await request({
          operation: "prepare",
          spaceId: "space-1",
          recipientUserId: "other",
        })
      ).status
    ).toBe(400);
    expect(
      (await request({ operation: "read", spaceId: "space-1", items: [] }))
        .status
    ).toBe(400);
    expect(coreRpc.mutateSpaceInboxRead).toHaveBeenCalledOnce();
  });

  it("routes bounded notification observations through verified Core context and rejects client scope", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/inbox/notification-observations?cursor=position&limit=50"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      organizationId: "org-1",
      items: [ITEM],
      cursor: "next-position",
      hasMore: false,
    });
    expect(coreRpc.observeInboxNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: "position",
        limit: 50,
        context: expect.any(Object),
      })
    );
    for (const query of [
      "limit=101",
      "recipientUserId=other",
      "organizationId=other",
    ]) {
      const invalid = await app.fetch(
        new Request(`http://local/v1/inbox/notification-observations?${query}`),
        env,
        TEST_EXECUTION_CONTEXT
      );
      expect(invalid.status).toBe(400);
    }
    expect(coreRpc.observeInboxNotifications).toHaveBeenCalledOnce();
  });

  it("accepts native update observations only through a session-bound native transport and validates the complete account-source body", async () => {
    const { coreRpc, env } = makeEnv();
    const body = {
      schemaVersion: 1,
      expectedUserId: "owner-1",
      installationId: "11111111-2222-4333-8444-555555555555",
      sequence: 1,
      lane: "dev-local",
      deviceName: "Test Mac",
      platform: "darwin",
      installedVersion: "0.1.3",
      availableVersion: "0.1.4",
    };
    const url = "http://local/v1/account/desktop-update-observations";
    const browser = await app.fetch(
      jsonRequest(url, "PUT", body, { origin: "http://local" }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(browser.status).toBe(400);
    expect(coreRpc.reportDesktopUpdateObservation).not.toHaveBeenCalled();
    const native = await app.fetch(
      jsonRequest(url, "PUT", body, { origin: "openmeld-desktop://app" }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(native.status).toBe(200);
    expect(coreRpc.reportDesktopUpdateObservation).toHaveBeenCalledWith(
      expect.objectContaining({ observation: body })
    );
    const injected = await app.fetch(
      jsonRequest(
        url,
        "PUT",
        { ...body, organizationId: "org-2" },
        { origin: "openmeld-desktop://app" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(injected.status).toBe(400);
    expect(coreRpc.reportDesktopUpdateObservation).toHaveBeenCalledOnce();
  });
  it.each([
    "7",
    "8",
    "9",
  ])("opts version %s into account items only when all its readers support device scope", async (version) => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/v1/inbox", {
        headers: { "x-openmeld-inbox-source-target-version": version },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    expect(coreRpc.listInboxItems).toHaveBeenCalledWith(
      expect.objectContaining({ includeAccountItems: version === "9" })
    );
  });
  it("forwards server feed filters and frozen scopes without accepting client-selected recipients", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/inbox/feed?category=mentions&agentsOnly=false&peopleOnly=true&conversationType=direct_messages&includeSelectionUnreadCount=true&unreadOnly=false&limit=20"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    expect(coreRpc.listInboxFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "mentions",
        agentsOnly: "false",
        peopleOnly: "true",
        conversationType: "direct_messages",
        includeSelectionUnreadCount: "true",
        unreadOnly: "false",
        limit: 20,
      })
    );
    const saved = await app.fetch(
      jsonRequest("http://local/v1/inbox/feed/state", "POST", {
        snapshotId: "snapshot",
        operation: "read",
        groupKey: "Z3JvdXA",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(saved.status).toBe(200);
    expect(coreRpc.mutateInboxFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotId: "snapshot",
        operation: "read",
        groupKey: "Z3JvdXA",
      })
    );
    expect(
      (
        await app.fetch(
          new Request("http://local/v1/inbox/feed?recipientUserId=other"),
          env,
          TEST_EXECUTION_CONTEXT
        )
      ).status
    ).toBe(400);
    expect(
      (
        await app.fetch(
          jsonRequest("http://local/v1/inbox/feed/state", "POST", {
            snapshotId: "snapshot",
            operation: "read",
            recipientUserId: "other",
          }),
          env,
          TEST_EXECUTION_CONTEXT
        )
      ).status
    ).toBe(400);
    expect(coreRpc.listInboxFeed).toHaveBeenCalledOnce();
    expect(coreRpc.mutateInboxFeed).toHaveBeenCalledOnce();
    expect(coreRpc.listInboxItems).not.toHaveBeenCalled();
    expect(coreRpc.markAllInboxItemsRead).not.toHaveBeenCalled();
  });

  it("routes message preferences separately from email and validates conversation writes", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/inbox/message-notification-preferences?spaceId=space-1"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    expect(coreRpc.getInboxMessageNotificationPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "space-1" })
    );
    const saved = await app.fetch(
      jsonRequest(
        "http://local/v1/inbox/message-notification-preferences",
        "PATCH",
        { scope: "conversation", spaceId: "space-1", mode: "muted" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(saved.status).toBe(200);
    expect(
      coreRpc.updateInboxMessageNotificationPreferences
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        preference: {
          scope: "conversation",
          spaceId: "space-1",
          mode: "muted",
        },
      })
    );
    expect(coreRpc.updateInboxNotificationPreferences).not.toHaveBeenCalled();
    const invalid = await app.fetch(
      jsonRequest(
        "http://local/v1/inbox/message-notification-preferences",
        "PATCH",
        { scope: "account", mode: "muted" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(invalid.status).toBe(400);
    expect(
      coreRpc.updateInboxMessageNotificationPreferences
    ).toHaveBeenCalledOnce();
  });
  it("exposes complete conversation counts only to summary-aware clients", async () => {
    const { coreRpc, env } = makeEnv();
    const legacy = {
      organizationId: "org-1",
      ordinarySpaceUnreadCount: 4,
      spaces: [],
    };
    const current = {
      ...legacy,
      chatUnreadCount: 106,
      chatUnresolvedActionCount: 1,
      chatUnreadUrgentUpdateCount: 1,
      attention: [
        { spaceId: "dm", unresolvedActionCount: 1, unreadUrgentUpdateCount: 1 },
      ],
    };
    coreRpc.getSpaceInboxSummary.mockResolvedValue(current);
    for (const version of ["1", "2", "3"]) {
      const response = await app.fetch(
        new Request("http://local/v1/inbox/spaces/summary", {
          headers: { "x-openmeld-inbox-summary-version": version },
        }),
        env,
        TEST_EXECUTION_CONTEXT
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(version === "1" ? legacy : current);
    }
  });

  it("preserves older routing and gates new source facts independently of version 7 reply facts", async () => {
    const { coreRpc, env } = makeEnv();
    const sourceTarget = {
      kind: "space" as const,
      spaceId: "dm",
      signalId: "reply",
      threadRootSignalId: "root",
      directMessage: true,
      agentOwnerActivity: true,
      replyToRecipient: true,
    };
    coreRpc.listInboxItems.mockResolvedValue({
      items: [
        {
          ...HUMAN_MENTION_ITEM,
          sourceTarget,
          sourceFacts: { version: 1, recipientReasons: ["human_mention"] },
        },
      ],
      nextCursor: null,
      organizationId: "org-1",
    });
    coreRpc.getInboxItem.mockResolvedValue({
      item: {
        ...HUMAN_MENTION_ITEM,
        sourceTarget,
        sourceFacts: { version: 1, recipientReasons: ["human_mention"] },
      },
    });
    coreRpc.markInboxItemRead.mockResolvedValue({
      item: {
        ...HUMAN_MENTION_ITEM,
        sourceTarget,
        sourceFacts: { version: 1, recipientReasons: ["human_mention"] },
      },
    });
    for (const version of ["4", "5", "6", "7", "8"]) {
      const headers = { "x-openmeld-inbox-source-target-version": version };
      const expectedTarget = {
        kind: "space",
        spaceId: "dm",
        signalId: "reply",
        threadRootSignalId: "root",
        ...(version !== "4" ? { directMessage: true } : {}),
        ...(["6", "7", "8"].includes(version)
          ? { agentOwnerActivity: true }
          : {}),
        ...(["7", "8"].includes(version) ? { replyToRecipient: true } : {}),
      };
      for (const request of [
        new Request("http://local/v1/inbox", { headers }),
        new Request("http://local/v1/inbox/items/inbox-item-human-mention", {
          headers,
        }),
        jsonRequest(
          "http://local/v1/inbox/items/inbox-item-human-mention/read",
          "PATCH",
          { read: true },
          headers
        ),
      ]) {
        const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          items?: { sourceTarget: unknown }[];
          item?: { sourceTarget: unknown };
        };
        expect((body.item ?? body.items?.[0])?.sourceTarget).toEqual(
          expectedTarget
        );
        if (version === "8") {
          expect(body.item ?? body.items?.[0]).toHaveProperty("sourceFacts", {
            version: 1,
            recipientReasons: ["human_mention"],
          });
        } else {
          expect(body.item ?? body.items?.[0]).not.toHaveProperty(
            "sourceFacts"
          );
        }
      }
    }
    expect(coreRpc.listInboxItems).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeReplyToRecipient: true })
    );
  });

  it("keeps an absent count unknown when talking to old Core", async () => {
    const { coreRpc, env } = makeEnv();
    coreRpc.getInboxSummary.mockResolvedValue({
      organizationId: "org-1",
      totalUnreadCount: 8,
      unresolvedActionCount: 2,
    });
    const response = await app.fetch(
      new Request("http://local/v1/inbox/summary", {
        headers: { "x-openmeld-inbox-summary-version": "1" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      organizationId: "org-1",
      totalUnreadCount: 8,
      unresolvedActionCount: 2,
    });
  });
  it("preserves old strict summaries and exposes attention counts only to aware clients", async () => {
    const { coreRpc, env } = makeEnv();
    coreRpc.getInboxSummary.mockResolvedValue({
      organizationId: "org-1",
      totalUnreadCount: 8,
      unresolvedActionCount: 2,
      unreadMentionCount: 4,
      unreadUrgentUpdateCount: 3,
      ordinaryUnreadCount: 1,
    });
    for (const version of [undefined, "1", "2", "3"]) {
      const response = await app.fetch(
        new Request("http://local/v1/inbox/summary", {
          headers: version
            ? { "x-openmeld-inbox-summary-version": version }
            : {},
        }),
        env,
        TEST_EXECUTION_CONTEXT
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        organizationId: "org-1",
        totalUnreadCount: 8,
        unresolvedActionCount: 2,
        ...(version ? { unreadUrgentUpdateCount: 3 } : {}),
        ...(version === "3"
          ? { unreadMentionCount: 4, ordinaryUnreadCount: 1 }
          : {}),
      });
    }
  });
  it("forwards the complete member Inbox surface to Core", async () => {
    const { coreRpc, env } = makeEnv();
    const requests = [
      new Request(
        "http://local/v1/inbox?view=needs_action&limit=25&notificationPreview=true"
      ),
      new Request("http://local/v1/inbox/summary"),
      new Request("http://local/v1/inbox/center-agent/summary"),
      jsonRequest("http://local/v1/inbox/center-agent/read-through", "POST", {
        spaceId: "space-1",
        throughOccurredAtMs: 1_775_000_000_000,
      }),
      new Request("http://local/v1/inbox/spaces/summary"),
      new Request("http://local/v1/inbox/spaces/space-1/unread-targets"),
      jsonRequest("http://local/v1/inbox/spaces/read-through", "POST", {
        spaceId: "space-1",
        threadRootSignalId: "thread-root-1",
        throughOccurredAtMs: 1_775_000_000_000,
      }),
      new Request("http://local/v1/inbox/items/inbox-item-1"),
      jsonRequest("http://local/v1/inbox/items/inbox-item-1/read", "PATCH", {
        read: true,
      }),
      new Request("http://local/v1/inbox/items/inbox-item-1/dismiss", {
        method: "PUT",
      }),
      new Request("http://local/v1/inbox/mark-all-read", { method: "POST" }),
      new Request("http://local/v1/inbox/preferences"),
      jsonRequest("http://local/v1/inbox/preferences", "PATCH", {
        urgentEmailEnabled: false,
      }),
    ];

    const responses: Response[] = [];
    for (const request of requests) {
      responses.push(await app.fetch(request, env, TEST_EXECUTION_CONTEXT));
    }

    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200,
    ]);
    expect(coreRpc.listInboxItems).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 25,
        notificationPreview: "true",
        view: "needs_action",
      })
    );
    expect(coreRpc.getInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "inbox-item-1" })
    );
    expect(coreRpc.getCenterAgentInboxSummary).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.any(Object) })
    );
    expect(coreRpc.markCenterAgentInboxReadThrough).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: "space-1",
        throughOccurredAtMs: 1_775_000_000_000,
      })
    );
    expect(coreRpc.getSpaceInboxSummary).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.any(Object) })
    );
    expect(coreRpc.getSpaceInboxUnreadTargets).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "space-1" })
    );
    expect(coreRpc.markSpaceInboxReadThrough).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: "space-1",
        threadRootSignalId: "thread-root-1",
        throughOccurredAtMs: 1_775_000_000_000,
      })
    );
    expect(coreRpc.markInboxItemRead).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "inbox-item-1", read: true })
    );
    expect(coreRpc.dismissInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "inbox-item-1" })
    );
    expect(coreRpc.updateInboxNotificationPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ urgentEmailEnabled: false })
    );
  });

  it("rejects malformed query, item identity, and preference bodies", async () => {
    const { coreRpc, env } = makeEnv();
    const requests = [
      new Request("http://local/v1/inbox?view=unknown"),
      jsonRequest("http://local/v1/inbox/items/%20/read", "PATCH", {
        read: true,
      }),
      jsonRequest("http://local/v1/inbox/preferences", "PATCH", {
        urgentEmailEnabled: "yes",
      }),
      jsonRequest("http://local/v1/inbox/center-agent/read-through", "POST", {
        spaceId: " ",
        throughOccurredAtMs: -1,
      }),
      jsonRequest("http://local/v1/inbox/spaces/read-through", "POST", {
        spaceId: " ",
        throughOccurredAtMs: -1,
      }),
    ];

    for (const request of requests) {
      const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_payload" },
        ok: false,
      });
    }
    expect(coreRpc.listInboxItems).not.toHaveBeenCalled();
    expect(coreRpc.markInboxItemRead).not.toHaveBeenCalled();
    expect(coreRpc.updateInboxNotificationPreferences).not.toHaveBeenCalled();
    expect(coreRpc.markCenterAgentInboxReadThrough).not.toHaveBeenCalled();
    expect(coreRpc.markSpaceInboxReadThrough).not.toHaveBeenCalled();
  });

  it("projects the legacy source target for every item response from a stale Inbox client", async () => {
    const { env } = makeEnv();
    const legacyMessageChannelItem = {
      ...MESSAGE_CHANNEL_ITEM,
      sourceTarget: { kind: "center_agent" },
    };

    const staleResponse = await app.fetch(
      new Request("http://local/v1/inbox?limit=25"),
      env,
      TEST_EXECUTION_CONTEXT
    );
    const currentResponse = await app.fetch(
      new Request("http://local/v1/inbox?limit=25", {
        headers: { "x-openmeld-inbox-source-target-version": "4" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    const staleItemResponse = await app.fetch(
      new Request("http://local/v1/inbox/items/inbox-item-2"),
      env,
      TEST_EXECUTION_CONTEXT
    );
    const currentItemResponse = await app.fetch(
      new Request("http://local/v1/inbox/items/inbox-item-2", {
        headers: { "x-openmeld-inbox-source-target-version": "4" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    const staleReadResponse = await app.fetch(
      jsonRequest("http://local/v1/inbox/items/inbox-item-2/read", "PATCH", {
        read: true,
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    const currentReadResponse = await app.fetch(
      jsonRequest(
        "http://local/v1/inbox/items/inbox-item-2/read",
        "PATCH",
        { read: true },
        { "x-openmeld-inbox-source-target-version": "4" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(staleResponse.status).toBe(200);
    await expect(staleResponse.json()).resolves.toEqual({
      items: [ITEM, legacyMessageChannelItem],
      nextCursor: "next-page",
      organizationId: "org-1",
    });
    expect(currentResponse.status).toBe(200);
    await expect(currentResponse.json()).resolves.toEqual({
      items: [ITEM, MESSAGE_CHANNEL_ITEM],
      nextCursor: "next-page",
      organizationId: "org-1",
    });
    expect(staleItemResponse.status).toBe(200);
    await expect(staleItemResponse.json()).resolves.toEqual({
      item: legacyMessageChannelItem,
    });
    expect(currentItemResponse.status).toBe(200);
    await expect(currentItemResponse.json()).resolves.toEqual({
      item: MESSAGE_CHANNEL_ITEM,
    });
    expect(staleReadResponse.status).toBe(200);
    await expect(staleReadResponse.json()).resolves.toEqual({
      item: {
        ...legacyMessageChannelItem,
        readAt: "2026-08-04T01:01:00.000Z",
      },
    });
    expect(currentReadResponse.status).toBe(200);
    await expect(currentReadResponse.json()).resolves.toEqual({
      item: {
        ...MESSAGE_CHANNEL_ITEM,
        readAt: "2026-08-04T01:01:00.000Z",
      },
    });
  });

  it("keeps Human Mention readable across old and current Inbox clients", async () => {
    const { coreRpc, env } = makeEnv();
    const oldCoreItem = {
      ...HUMAN_MENTION_ITEM,
      kind: "space_reference" as const,
    };
    coreRpc.listInboxItems.mockResolvedValue({
      items: [oldCoreItem as unknown as typeof ITEM],
      nextCursor: null,
      organizationId: "org-1",
    });
    coreRpc.getInboxItem.mockResolvedValue({
      item: HUMAN_MENTION_ITEM as unknown as typeof ITEM,
    });
    coreRpc.markInboxItemRead.mockResolvedValue({
      item: {
        ...HUMAN_MENTION_ITEM,
        readAt: "2026-08-04T01:01:00.000Z",
      } as never,
    });

    const currentHeaders = {
      "x-openmeld-inbox-item-kind-version": "1",
      "x-openmeld-inbox-source-target-version": "4",
    };
    const currentListResponse = await app.fetch(
      new Request("http://local/v1/inbox?limit=25", {
        headers: currentHeaders,
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    const staleItemResponse = await app.fetch(
      new Request("http://local/v1/inbox/items/inbox-item-human-mention"),
      env,
      TEST_EXECUTION_CONTEXT
    );
    const staleReadResponse = await app.fetch(
      jsonRequest(
        "http://local/v1/inbox/items/inbox-item-human-mention/read",
        "PATCH",
        { read: true }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(currentListResponse.status).toBe(200);
    await expect(currentListResponse.json()).resolves.toMatchObject({
      items: [{ kind: "space_mention" }],
    });
    expect(staleItemResponse.status).toBe(200);
    await expect(staleItemResponse.json()).resolves.toMatchObject({
      item: { kind: "space_reference" },
    });
    expect(staleReadResponse.status).toBe(200);
    await expect(staleReadResponse.json()).resolves.toMatchObject({
      item: { kind: "space_reference" },
    });
  });

  it("removes the Agent Interaction thread locator for version 3 Inbox clients", async () => {
    const { coreRpc, env } = makeEnv();
    const threadAwareItem = {
      ...ITEM,
      sourceTarget: {
        ...ITEM.sourceTarget,
        sourceSignalId: "signal-1",
        threadRootSignalId: "thread-root-1",
      },
    };
    coreRpc.listInboxItems.mockResolvedValue({
      items: [threadAwareItem],
      nextCursor: null,
      organizationId: "org-1",
    });
    coreRpc.getInboxItem.mockResolvedValue({ item: threadAwareItem });
    coreRpc.markInboxItemRead.mockResolvedValue({
      item: {
        ...threadAwareItem,
        readAt: "2026-08-04T01:01:00.000Z",
      },
    });

    const requests = (version: "3" | "4") => [
      new Request("http://local/v1/inbox?limit=25", {
        headers: { "x-openmeld-inbox-source-target-version": version },
      }),
      new Request("http://local/v1/inbox/items/inbox-item-1", {
        headers: { "x-openmeld-inbox-source-target-version": version },
      }),
      jsonRequest(
        "http://local/v1/inbox/items/inbox-item-1/read",
        "PATCH",
        { read: true },
        { "x-openmeld-inbox-source-target-version": version }
      ),
    ];

    for (const request of requests("3")) {
      const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).not.toContain(
        "threadRootSignalId"
      );
    }
    for (const request of requests("4")) {
      const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).toContain(
        '"threadRootSignalId":"thread-root-1"'
      );
    }
  });

  it("keeps a new Agent creation approval readable for stale Inbox clients", async () => {
    const { coreRpc, env } = makeEnv();
    coreRpc.listInboxItems.mockResolvedValue({
      items: [AGENT_PROFILE_CREATION_REQUEST_ITEM as unknown as typeof ITEM],
      nextCursor: null,
      organizationId: "org-1",
    });

    const staleResponse = await app.fetch(
      new Request("http://local/v1/inbox?limit=25", {
        headers: { "x-openmeld-inbox-source-target-version": "2" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    const currentResponse = await app.fetch(
      new Request("http://local/v1/inbox?limit=25", {
        headers: { "x-openmeld-inbox-source-target-version": "4" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    await expect(staleResponse.json()).resolves.toMatchObject({
      items: [{ sourceTarget: { kind: "center_agent" } }],
    });
    await expect(currentResponse.json()).resolves.toMatchObject({
      items: [
        {
          sourceTarget: {
            kind: "agent_profile_creation_request",
            requestId: "creation-request-1",
          },
        },
      ],
    });
  });

  it("rejects an invalid current source target before projecting a legacy response", async () => {
    const { coreRpc, env } = makeEnv();
    coreRpc.listInboxItems.mockResolvedValueOnce({
      items: [
        {
          ...MESSAGE_CHANNEL_ITEM,
          sourceTarget: {
            ...MESSAGE_CHANNEL_ITEM.sourceTarget,
            permalink: "not a url",
          },
        },
      ],
      nextCursor: null,
      organizationId: "org-1",
    });

    const response = await app.fetch(
      new Request("http://local/v1/inbox"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "upstream_unreachable" },
      ok: false,
    });
  });

  it("logs the read-position failure reason with the response request ID", async () => {
    const { coreRpc, env } = makeEnv();
    coreRpc.markSpaceInboxReadThrough.mockRejectedValueOnce(
      Object.assign(new Error("Read position is outside the allowed window."), {
        code: "inbox.invalid_read_position",
        status: 400,
      })
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const response = await app.fetch(
        jsonRequest("http://local/v1/inbox/spaces/read-through", "POST", {
          spaceId: "space-1",
          throughOccurredAtMs: 1_775_000_000_000,
        }),
        env,
        TEST_EXECUTION_CONTEXT
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("x-openmeld-request-id")).toBe("req-inbox");
      expect(
        log.mock.calls
          .map(
            ([entry]) => JSON.parse(String(entry)) as Record<string, unknown>
          )
          .find((entry) => entry.route === "/v1/inbox/spaces/read-through")
      ).toMatchObject({
        errorCode: "inbox.invalid_read_position",
        reason: "Read position is outside the allowed window.",
        requestId: "req-inbox",
        status: 400,
      });
    } finally {
      log.mockRestore();
    }
  });
});

function makeEnv() {
  const coreRpc = {
    observeInboxNotifications: vi.fn(async () => ({
      organizationId: "org-1",
      items: [ITEM],
      cursor: "next-position",
      hasMore: false,
    })),
    reportDesktopUpdateObservation: vi.fn(async () => ({
      accepted: true,
      sequence: 1,
    })),
    listInboxFeed: vi.fn(async () => ({
      organizationId: "org-1",
      snapshotId: "snapshot",
      snapshotExpiresAt: "2026-09-19T00:15:00Z",
      nextCursor: null,
      counts: {
        all: 1,
        mentions: 1,
        needsAction: 0,
        needsReview: 0,
        unread: 1,
        priority: 0,
      },
      rows: [
        {
          groupKey: "Z3JvdXA",
          item: HUMAN_MENTION_ITEM,
          itemCount: 1,
          unreadCount: 1,
          latestOccurredAt: HUMAN_MENTION_ITEM.occurredAt,
          section: "activity",
          requestCategory: null,
          dot: "blue",
        },
      ],
    })),
    mutateInboxFeed: vi.fn(async () => ({ changedCount: 1 })),
    getInboxMessageNotificationPreferences: vi.fn(async () => ({
      organizationId: "org-1",
      spaceId: "space-1",
      defaultMode: "mentions_and_replies",
      overrideMode: null,
      effectiveMode: "mentions_and_replies",
    })),
    updateInboxMessageNotificationPreferences: vi.fn(async () => ({
      organizationId: "org-1",
      spaceId: "space-1",
      defaultMode: "mentions_and_replies",
      overrideMode: "muted",
      effectiveMode: "muted",
    })),
    dismissInboxItem: vi.fn(async () => ({
      dismissedItemId: ITEM.id,
    })),
    getInboxItem: vi.fn(
      async (input: { itemId: string }): Promise<GetInboxItemResponse> => ({
        item:
          input.itemId === MESSAGE_CHANNEL_ITEM.id
            ? MESSAGE_CHANNEL_ITEM
            : ITEM,
      })
    ),
    getInboxNotificationPreferences: vi.fn(async () => ({
      updatedAt: null,
      urgentEmailEnabled: true,
    })),
    getInboxSummary: vi.fn(
      async (): Promise<InboxSummaryResponse> => ({
        organizationId: "org-1",
        totalUnreadCount: 1,
        unresolvedActionCount: 1,
        unreadUrgentUpdateCount: 0,
      })
    ),
    getCenterAgentInboxSummary: vi.fn(async () => ({
      organizationId: "org-1",
      unreadCount: 1,
    })),
    getSpaceInboxSummary: vi.fn(async () => ({
      organizationId: "org-1",
      spaces: [
        {
          latestUnreadOccurredAtMs: 1_775_000_000_000,
          spaceId: "space-1",
          unreadCount: 1,
        },
      ],
    })),
    getSpaceInboxUnreadTargets: vi.fn(async () => ({
      hasMoreTargets: false,
      organizationId: "org-1",
      spaceId: "space-1",
      targets: [
        {
          occurredAtMs: 1_775_000_000_000,
          signalId: "signal-1",
          threadRootSignalId: null,
        },
      ],
      totalUnreadCount: 1,
    })),
    listInboxItems: vi.fn(
      async (): Promise<ListInboxItemsResponse> => ({
        items: [ITEM, MESSAGE_CHANNEL_ITEM],
        nextCursor: "next-page" as string | null,
        organizationId: "org-1",
      })
    ),
    markAllInboxItemsRead: vi.fn(async () => ({ markedReadCount: 1 })),
    markCenterAgentInboxReadThrough: vi.fn(async () => ({
      markedReadCount: 1,
      readThroughAt: "2026-04-02T02:40:00.000Z",
    })),
    mutateSpaceInboxRead: vi.fn(async () => ({
      operation: "prepare",
      snapshotId: "selection",
      unreadCount: 2,
    })),
    markSpaceInboxReadThrough: vi.fn(async () => ({
      markedReadCount: 1,
      readThroughAt: "2026-04-02T02:40:00.000Z",
    })),
    markInboxItemRead: vi.fn(
      async (input: {
        itemId: string;
      }): Promise<MarkInboxItemReadResponse> => ({
        item: {
          ...(input.itemId === MESSAGE_CHANNEL_ITEM.id
            ? MESSAGE_CHANNEL_ITEM
            : ITEM),
          readAt: "2026-08-04T01:01:00.000Z",
        },
      })
    ),
    updateInboxNotificationPreferences: vi.fn(async () => ({
      updatedAt: "2026-08-04T01:01:00.000Z",
      urgentEmailEnabled: false,
    })),
  };
  const claims = {
    activeOrganizationId: "org-1",
    authenticated: true,
    authMethod: "session",
    callerPrincipalId: "owner-1",
    ownerIds: ["owner-1"],
    requestId: "req-inbox",
  };
  const resolvedProfile = {
    ownerUserId: "owner-1",
    profileKind: "human" as const,
    profileName: "Felix",
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
  };
  const authRpc = {
    resolveProfile: vi.fn(async () => ({ ok: true, resolvedProfile })),
    resolveRequestAuth: vi.fn(async () => ({ claims, ok: true })),
    resolveRequestAuthWithProfile: vi.fn(async () => ({
      claims,
      ok: true,
      profile: { ok: true, resolvedProfile },
    })),
  };
  return {
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
    } as unknown as CloudflareBindings,
  };
}

function jsonRequest(
  url: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {}
): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method,
  });
}
