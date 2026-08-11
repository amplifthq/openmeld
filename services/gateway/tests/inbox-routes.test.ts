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

describe("Inbox routes", () => {
  it("forwards the complete member Inbox surface to Core", async () => {
    const { coreRpc, env } = makeEnv();
    const requests = [
      new Request("http://local/v1/inbox?view=needs_action&limit=25"),
      new Request("http://local/v1/inbox/summary"),
      new Request("http://local/v1/inbox/center-agent/summary"),
      jsonRequest("http://local/v1/inbox/center-agent/read-through", "POST", {
        spaceId: "space-1",
        throughOccurredAtMs: 1_775_000_000_000,
      }),
      new Request("http://local/v1/inbox/spaces/summary"),
      jsonRequest("http://local/v1/inbox/spaces/read-through", "POST", {
        spaceId: "space-1",
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
      200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200,
    ]);
    expect(coreRpc.listInboxItems).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, view: "needs_action" })
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
    expect(coreRpc.markSpaceInboxReadThrough).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: "space-1",
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
});

function makeEnv() {
  const coreRpc = {
    dismissInboxItem: vi.fn(async () => ({
      dismissedItemId: ITEM.id,
    })),
    getInboxItem: vi.fn(async () => ({ item: ITEM })),
    getInboxNotificationPreferences: vi.fn(async () => ({
      updatedAt: null,
      urgentEmailEnabled: true,
    })),
    getInboxSummary: vi.fn(async () => ({
      organizationId: "org-1",
      totalUnreadCount: 1,
      unresolvedActionCount: 1,
    })),
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
    listInboxItems: vi.fn(async () => ({
      items: [ITEM],
      nextCursor: null,
      organizationId: "org-1",
    })),
    markAllInboxItemsRead: vi.fn(async () => ({ markedReadCount: 1 })),
    markCenterAgentInboxReadThrough: vi.fn(async () => ({
      markedReadCount: 1,
      readThroughAt: "2026-04-02T02:40:00.000Z",
    })),
    markSpaceInboxReadThrough: vi.fn(async () => ({
      markedReadCount: 1,
      readThroughAt: "2026-04-02T02:40:00.000Z",
    })),
    markInboxItemRead: vi.fn(async () => ({
      item: { ...ITEM, readAt: "2026-08-04T01:01:00.000Z" },
    })),
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

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  });
}
