import { describe, expect, it, vi } from "vitest";
import {
  buildCenterAgentInboxReadThroughPath,
  buildCenterAgentInboxSummaryPath,
  buildInboxItemPath,
  buildInboxItemReadPath,
  buildInboxPath,
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
  it("builds encoded list and item routes", () => {
    expect(
      buildInboxPath({ cursor: "cursor value", limit: 25, view: "unread" })
    ).toBe("/v1/inbox?cursor=cursor+value&limit=25&view=unread");
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

    await expect(api.list({ view: "all" })).resolves.toMatchObject({
      items: [{ id: ITEM.id }],
    });
    await expect(api.get({ itemId: ITEM.id })).resolves.toMatchObject({
      item: { id: ITEM.id },
    });
    await expect(api.summary()).resolves.toMatchObject({ totalUnreadCount: 1 });
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
    await expect(api.markAllRead()).resolves.toEqual({ markedReadCount: 1 });
    await expect(api.getPreferences()).resolves.toMatchObject({
      urgentEmailEnabled: true,
    });
    await expect(
      api.updatePreferences({ urgentEmailEnabled: false })
    ).resolves.toMatchObject({ urgentEmailEnabled: false });
    expect(transport).toHaveBeenCalledTimes(13);
    for (const operation of [
      "inbox.list",
      "inbox.item.get",
      "inbox.item.read",
    ]) {
      expect(transport).toHaveBeenCalledWith(
        expect.objectContaining({
          init: expect.objectContaining({
            headers: expect.objectContaining({
              "x-openmeld-inbox-item-kind-version": "1",
              "x-openmeld-inbox-source-target-version": "4",
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
