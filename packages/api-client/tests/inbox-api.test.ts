import {
  OPENMELD_INBOX_ITEM_KIND_VERSION,
  OPENMELD_INBOX_SOURCE_TARGET_VERSION,
  OPENMELD_INBOX_SUMMARY_VERSION,
} from "@openmeld/gateway-contract";
import { describe, expect, it, vi } from "vitest";
import {
  buildCenterAgentInboxReadThroughPath,
  buildCenterAgentInboxSummaryPath,
  buildInboxItemPath,
  buildInboxItemReadPath,
  buildInboxMarkAllReadPath,
  buildInboxPath,
  buildInboxSummaryPath,
  buildSpaceInboxReadThroughPath,
  buildSpaceInboxSummaryPath,
  buildSpaceInboxUnreadTargetsPath,
  createInboxApi,
  createOpenMeldApiClient,
  type OpenMeldApiClientTransport,
} from "../src";

const ITEM = {
  attention: "update",
  contextLabel: "Product",
  createdAt: "2026-08-04T01:00:00.000Z",
  id: "inbox/item 1",
  importance: "normal",
  kind: "space_message",
  occurredAt: "2026-08-04T01:00:00.000Z",
  organizationId: "org-1",
  preview: "A new update is available.",
  readAt: null,
  recipientUserId: "user-1",
  resolutionStatus: "not_applicable",
  sourceTarget: { kind: "space", signalId: "signal-1", spaceId: "space-1" },
  title: "New message",
  updatedAt: "2026-08-04T01:00:00.000Z",
};

describe("api-client Inbox API", () => {
  it("round-trips notification observation cursors through a bounded strict response", async () => {
    const page = {
      organizationId: "org-1",
      items: [ITEM],
      cursor: "next-position",
      hasMore: true,
    };
    const transport = vi.fn<OpenMeldApiClientTransport>(() =>
      Promise.resolve(jsonResponse(page))
    );
    const api = createInboxApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );
    expect(
      await api.observeNotifications({ cursor: "position+/=", limit: 50 })
    ).toEqual(page);
    const url = new URL(transport.mock.calls[0]?.[0].url ?? "");
    expect(url.pathname).toBe("/v1/inbox/notification-observations");
    expect(url.searchParams.get("cursor")).toBe("position+/=");
    expect(url.searchParams.get("limit")).toBe("50");
    await expect(api.observeNotifications({ limit: 101 })).rejects.toThrow();
    expect(transport).toHaveBeenCalledOnce();
  });

  it("sends full-dataset filters and frozen mutations through strict shared contracts", async () => {
    const page = {
      organizationId: "org-1",
      snapshotId: "snapshot",
      snapshotExpiresAt: "2026-09-19T00:15:00Z",
      nextCursor: "next-page",
      counts: {
        all: 4,
        mentions: 2,
        needsAction: 1,
        needsReview: 0,
        unread: 3,
        priority: 1,
      },
      rows: [
        {
          item: ITEM,
          itemCount: 4,
          unreadCount: 3,
          groupKey: "Z3JvdXA",
          latestOccurredAt: ITEM.occurredAt,
          section: "activity",
          requestCategory: null,
          dot: "blue",
        },
      ],
    };
    const transport = vi.fn<OpenMeldApiClientTransport>(() =>
      Promise.resolve(jsonResponse(page))
    );
    const api = createInboxApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );
    expect(
      await api.feed({
        category: "mentions",
        unreadOnly: "false",
        agentsOnly: "true",
        peopleOnly: "false",
        conversationType: "direct_messages",
        includeSelectionUnreadCount: "true",
        cursor: "cursor",
        limit: 20,
      })
    ).toEqual(page);
    const url = new URL(transport.mock.calls[0]?.[0].url ?? "");
    expect(url.pathname).toBe("/v1/inbox/feed");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      category: "mentions",
      unreadOnly: "false",
      agentsOnly: "true",
      peopleOnly: "false",
      conversationType: "direct_messages",
      includeSelectionUnreadCount: "true",
      cursor: "cursor",
      limit: "20",
    });
    transport.mockResolvedValueOnce(jsonResponse({ changedCount: 4 }));
    expect(
      await api.mutateFeed({
        snapshotId: page.snapshotId,
        groupKey: "Z3JvdXA",
        operation: "read",
      })
    ).toEqual({ changedCount: 4 });
    expect(transport.mock.calls[1]?.[0].url).toContain("/v1/inbox/feed/state");
    expect(JSON.parse(String(transport.mock.calls[1]?.[0].init?.body))).toEqual(
      { snapshotId: page.snapshotId, groupKey: "Z3JvdXA", operation: "read" }
    );
    transport.mockResolvedValueOnce(
      jsonResponse({ ...page, rows: [{ ...page.rows[0], dot: "red" }] })
    );
    await expect(api.feed()).rejects.toThrow();
  });

  it("requests and preserves recipient-specific Human reply facts", async () => {
    const reply = {
      ...ITEM,
      sourceTarget: {
        ...ITEM.sourceTarget,
        threadRootSignalId: "root",
        replyToRecipient: true,
      },
    };
    const transport = vi.fn<OpenMeldApiClientTransport>(async () =>
      jsonResponse({ item: reply })
    );
    const api = createInboxApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );
    expect((await api.get({ itemId: ITEM.id })).item.sourceTarget).toEqual(
      reply.sourceTarget
    );
    const headers = new Headers(transport.mock.calls[0]?.[0].init?.headers);
    expect(headers.get("x-openmeld-inbox-source-target-version")).toBe(
      OPENMELD_INBOX_SOURCE_TARGET_VERSION
    );
  });
  it("reads and writes message preferences with a separate strict contract", async () => {
    const response = {
      organizationId: "org-1",
      spaceId: "space/1",
      defaultMode: "mentions_and_replies",
      overrideMode: "all_messages",
      effectiveMode: "all_messages",
    };
    const transport = vi.fn<OpenMeldApiClientTransport>(async () =>
      jsonResponse(response)
    );
    const api = createInboxApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );
    expect(
      await api.getMessageNotificationPreferences({ spaceId: "space/1" })
    ).toEqual(response);
    expect(transport.mock.calls[0]?.[0].url).toContain(
      "message-notification-preferences?spaceId=space%2F1"
    );
    await api.updateMessageNotificationPreferences({
      preference: { scope: "conversation", spaceId: "space/1", mode: null },
    });
    expect(JSON.parse(String(transport.mock.calls[1]?.[0].init?.body))).toEqual(
      { scope: "conversation", spaceId: "space/1", mode: null }
    );
    transport.mockResolvedValueOnce(
      jsonResponse({ ...response, effectiveMode: "unknown" })
    );
    await expect(api.getMessageNotificationPreferences()).rejects.toThrow();
  });
  it("builds encoded list and item routes", () => {
    expect(
      buildInboxPath({
        cursor: "cursor value",
        limit: 25,
        notificationPreview: "true",
        presentation: "attention",
        view: "unread",
      })
    ).toBe(
      "/v1/inbox?cursor=cursor+value&limit=25&presentation=attention&notificationPreview=true&view=unread"
    );
    expect(buildInboxSummaryPath("attention")).toBe(
      "/v1/inbox/summary?presentation=attention"
    );
    expect(buildInboxMarkAllReadPath("attention")).toBe(
      "/v1/inbox/mark-all-read?presentation=attention"
    );
    expect(buildInboxItemReadPath("inbox/item 1")).toBe(
      "/v1/inbox/items/inbox%2Fitem%201/read"
    );
    expect(buildInboxItemPath("inbox/item 1")).toBe(
      "/v1/inbox/items/inbox%2Fitem%201"
    );
    expect(buildCenterAgentInboxSummaryPath()).toBe(
      "/v1/inbox/center-agent/summary"
    );
    expect(buildCenterAgentInboxReadThroughPath()).toBe(
      "/v1/inbox/center-agent/read-through"
    );
    expect(buildSpaceInboxSummaryPath()).toBe("/v1/inbox/spaces/summary");
    expect(buildSpaceInboxUnreadTargetsPath("space/1")).toBe(
      "/v1/inbox/spaces/space%2F1/unread-targets"
    );
    expect(buildSpaceInboxReadThroughPath()).toBe(
      "/v1/inbox/spaces/read-through"
    );
  });

  it("uses strict contracts for every Inbox operation", async () => {
    const transport = vi.fn<OpenMeldApiClientTransport>((call) => {
      const path = new URL(call.url).pathname;
      if (path === "/v1/inbox") {
        return Promise.resolve(
          jsonResponse({
            items: [ITEM],
            nextCursor: null,
            organizationId: "org-1",
          })
        );
      }
      if (path === "/v1/inbox/summary") {
        return Promise.resolve(
          jsonResponse({
            organizationId: "org-1",
            totalUnreadCount: 1,
            unresolvedActionCount: 0,
          })
        );
      }
      if (path === "/v1/inbox/center-agent/summary") {
        return Promise.resolve(
          jsonResponse({ organizationId: "org-1", unreadCount: 1 })
        );
      }
      if (path === "/v1/inbox/center-agent/read-through") {
        return Promise.resolve(
          jsonResponse({
            markedReadCount: 1,
            readThroughAt: "2026-04-02T02:40:00.000Z",
          })
        );
      }
      if (path === "/v1/inbox/spaces/summary") {
        return Promise.resolve(
          jsonResponse({
            organizationId: "org-1",
            spaces: [
              {
                latestUnreadOccurredAtMs: 1_775_000_000_000,
                spaceId: "space-1",
                unreadCount: 1,
              },
            ],
          })
        );
      }
      if (path === "/v1/inbox/spaces/space-1/unread-targets") {
        return Promise.resolve(
          jsonResponse({
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
          })
        );
      }
      if (path === "/v1/inbox/spaces/read-through") {
        return Promise.resolve(
          jsonResponse({
            markedReadCount: 1,
            readThroughAt: "2026-04-02T02:40:00.000Z",
          })
        );
      }
      if (path === "/v1/inbox/items/inbox%2Fitem%201") {
        return Promise.resolve(jsonResponse({ item: ITEM }));
      }
      if (path.endsWith("/read")) {
        return Promise.resolve(
          jsonResponse({
            item: { ...ITEM, readAt: "2026-08-04T01:01:00.000Z" },
          })
        );
      }
      if (path.endsWith("/dismiss")) {
        return Promise.resolve(jsonResponse({ dismissedItemId: ITEM.id }));
      }
      if (path === "/v1/inbox/mark-all-read") {
        return Promise.resolve(jsonResponse({ markedReadCount: 1 }));
      }
      if (path === "/v1/inbox/preferences") {
        return Promise.resolve(
          jsonResponse({
            updatedAt: null,
            urgentEmailEnabled: call.init?.method === "GET",
          })
        );
      }
      throw new Error(`Unexpected Inbox URL: ${call.url}`);
    });
    const api = createInboxApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.list({ presentation: "attention", view: "all" })
    ).resolves.toMatchObject({
      items: [{ id: ITEM.id }],
    });
    await expect(api.get({ itemId: ITEM.id })).resolves.toMatchObject({
      item: { id: ITEM.id },
    });
    await expect(
      api.summary({ presentation: "attention" })
    ).resolves.toMatchObject({ totalUnreadCount: 1 });
    await expect(api.centerAgentSummary()).resolves.toEqual({
      organizationId: "org-1",
      unreadCount: 1,
    });
    await expect(
      api.markCenterAgentReadThrough({
        spaceId: "space-1",
        throughOccurredAtMs: 1_775_000_000_000,
      })
    ).resolves.toEqual({
      markedReadCount: 1,
      readThroughAt: "2026-04-02T02:40:00.000Z",
    });
    await expect(api.spaceSummary()).resolves.toEqual({
      organizationId: "org-1",
      spaces: [
        {
          latestUnreadOccurredAtMs: 1_775_000_000_000,
          spaceId: "space-1",
          unreadCount: 1,
        },
      ],
    });
    await expect(
      api.spaceUnreadTargets({ spaceId: "space-1" })
    ).resolves.toMatchObject({
      targets: [{ signalId: "signal-1", threadRootSignalId: null }],
      totalUnreadCount: 1,
    });
    await expect(
      api.markSpaceReadThrough({
        spaceId: "space-1",
        threadRootSignalId: "thread-root-1",
        throughOccurredAtMs: 1_775_000_000_000,
      })
    ).resolves.toEqual({
      markedReadCount: 1,
      readThroughAt: "2026-04-02T02:40:00.000Z",
    });
    await expect(
      api.markRead({ itemId: ITEM.id, read: true })
    ).resolves.toMatchObject({ item: { readAt: expect.any(String) } });
    await expect(api.dismiss({ itemId: ITEM.id })).resolves.toEqual({
      dismissedItemId: ITEM.id,
    });
    await expect(
      api.markAllRead({ presentation: "attention" })
    ).resolves.toEqual({ markedReadCount: 1 });
    await expect(api.getPreferences()).resolves.toMatchObject({
      urgentEmailEnabled: true,
    });
    await expect(
      api.updatePreferences({ urgentEmailEnabled: false })
    ).resolves.toMatchObject({ urgentEmailEnabled: false });
    expect(transport).toHaveBeenCalledTimes(13);
    expect(
      transport.mock.calls.find(
        ([call]) => call.operation === "inbox.list"
      )?.[0].url
    ).toContain("presentation=attention");
    expect(
      transport.mock.calls.find(
        ([call]) => call.operation === "inbox.summary"
      )?.[0].url
    ).toContain("presentation=attention");
    expect(
      transport.mock.calls.find(
        ([call]) => call.operation === "inbox.mark_all_read"
      )?.[0].url
    ).toContain("presentation=attention");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "inbox.summary",
        init: expect.objectContaining({
          headers: expect.objectContaining({
            "x-openmeld-inbox-summary-version": OPENMELD_INBOX_SUMMARY_VERSION,
          }),
        }),
      })
    );
    for (const operation of [
      "inbox.list",
      "inbox.item.get",
      "inbox.item.read",
    ]) {
      expect(transport).toHaveBeenCalledWith(
        expect.objectContaining({
          init: expect.objectContaining({
            headers: expect.objectContaining({
              "x-openmeld-inbox-item-kind-version":
                OPENMELD_INBOX_ITEM_KIND_VERSION,
              "x-openmeld-inbox-source-target-version":
                OPENMELD_INBOX_SOURCE_TARGET_VERSION,
            }),
          }),
          operation,
        })
      );
    }
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "PUT" }),
        url: "https://gateway.openmeld.invalid/v1/inbox/items/inbox%2Fitem%201/dismiss",
      })
    );
  });

  it("rejects invalid input before transport", async () => {
    const transport = vi.fn<OpenMeldApiClientTransport>();
    const api = createInboxApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(api.list({ limit: 101 })).rejects.toThrow(
      "Inbox list request is invalid."
    );
    await expect(
      api.markCenterAgentReadThrough({
        spaceId: " ",
        throughOccurredAtMs: -1,
      })
    ).rejects.toThrow("Center Agent Inbox read request is invalid.");
    await expect(
      api.markSpaceReadThrough({
        spaceId: " ",
        throughOccurredAtMs: -1,
      })
    ).rejects.toThrow("Space Inbox read request is invalid.");
    await expect(api.spaceUnreadTargets({ spaceId: " " })).rejects.toThrow(
      "Space Inbox unread targets request is invalid."
    );
    expect(transport).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
