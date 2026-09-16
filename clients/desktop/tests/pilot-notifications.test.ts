import { EventEmitter } from "node:events";
import { desktopNotificationActivationSchema } from "@openmeld/schemas";
import type { InboxItem } from "@openmeld/schemas/types";
import type { BrowserWindow, NotificationConstructorOptions } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ created: vi.fn() }));
vi.mock("electron", () => ({
  Notification: class extends EventEmitter {
    static isSupported() {
      return true;
    }
    constructor(options: NotificationConstructorOptions) {
      super();
      native.created(this, options);
    }
    show() {
      /* Tests emit the native acknowledgement independently. */
    }
    close() {
      this.emit("close");
    }
  },
}));

import { createPilotNotifications } from "../src/main/pilot-notifications";

const item: InboxItem = {
  id: "item-a",
  organizationId: "org-a",
  recipientUserId: "user-a",
  title: "A message",
  preview: "Hello",
  contextLabel: "Chat",
  kind: "space_message",
  attention: "update",
  importance: "normal",
  readAt: null,
  resolutionStatus: "not_applicable",
  createdAt: "2026-09-15T00:00:00.000Z",
  occurredAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
  sourceTarget: {
    kind: "space",
    spaceId: "space-a",
    signalId: "signal-a",
    directMessage: true,
  },
};
const request = {
  userId: item.recipientUserId,
  organizationId: item.organizationId,
  organizationSlug: "workspace",
  itemId: item.id,
  soundEnabled: false,
};

function setup(window: BrowserWindow | null = null) {
  const setUnreadCount = vi.fn();
  const session = vi.fn(async () => ({
    user: { id: "user-a", name: "A", email: "a@example.com" },
  }));
  const cloudRequest = vi.fn<
    Parameters<typeof createPilotNotifications>[0]["auth"]["cloudRequest"]
  >(async (path) =>
    path.startsWith("/v1/inbox/message-notification-preferences")
      ? Response.json({
          organizationId: "org-a",
          spaceId: "space-a",
          defaultMode: "mentions_and_replies",
          overrideMode: null,
          effectiveMode: "mentions_and_replies",
        })
      : Response.json({ item })
  );
  const notifications = createPilotNotifications({
    setUnreadCount,
    auth: { session, cloudRequest },
    webOrigin: "https://openmeld.ai",
    webBuild: "a".repeat(64),
    installed: true,
    ensureCompatible: async () => undefined,
    getWindow: () => window,
  });
  notifications.setContext({
    userId: request.userId,
    organizationId: request.organizationId,
    enabled: true,
    visibleConversation: null,
  });
  return { notifications, session, cloudRequest, setUnreadCount };
}

it("keeps the Inbox count independent of notification permission and clears it on logout", async () => {
  const { notifications, setUnreadCount } = setup();
  await notifications.setContext({
    userId: "user-a",
    organizationId: "org-a",
    enabled: false,
    visibleConversation: null,
    unreadCount: 7,
  });
  expect(setUnreadCount).toHaveBeenLastCalledWith(7);
  notifications.clear();
  expect(setUnreadCount).toHaveBeenLastCalledWith(null);
});

it.each([
  "logout",
  "organization switch",
])("rejects a count that completes after %s", async (change) => {
  const { notifications, session, setUnreadCount } = setup();
  const held = Promise.withResolvers<Awaited<ReturnType<typeof session>>>();
  session.mockReturnValueOnce(held.promise);
  const pending = notifications.setContext({
    userId: "user-a",
    organizationId: "org-a",
    enabled: false,
    visibleConversation: null,
    unreadCount: 7,
  });
  if (change === "logout") {
    notifications.clear();
  } else {
    await notifications.setContext({
      userId: "user-a",
      organizationId: "org-b",
      enabled: false,
      visibleConversation: null,
      unreadCount: null,
    });
  }
  held.resolve({ user: { id: "user-a", name: "A", email: "a@example.com" } });
  await pending;
  expect(setUnreadCount).toHaveBeenLastCalledWith(null);
  expect(setUnreadCount).not.toHaveBeenCalledWith(7);
});

it("rejects a late old-account count after the native account changes", async () => {
  const { notifications, session, setUnreadCount } = setup();
  session.mockResolvedValue({
    user: { id: "user-b", name: "B", email: "b@example.com" },
  });
  await notifications.setContext({
    userId: "user-a",
    organizationId: "org-a",
    enabled: false,
    visibleConversation: null,
    unreadCount: 7,
  });
  expect(setUnreadCount).toHaveBeenLastCalledWith(null);
  expect(setUnreadCount).not.toHaveBeenCalledWith(7);
});

beforeEach(() => {
  vi.useFakeTimers();
  native.created.mockClear();
});

it.each([
  ["all_messages", false, true],
  ["mentions_and_replies", false, false],
  ["mentions_and_replies", true, true],
  ["muted", true, false],
] as const)("uses fresh native message preferences: %s, Human reply %s", async (mode, replyToRecipient, eligible) => {
  const { notifications, cloudRequest } = setup();
  cloudRequest.mockImplementation(async (path) =>
    path.startsWith("/v1/inbox/message-notification-preferences")
      ? Response.json({
          organizationId: item.organizationId,
          spaceId: "space-a",
          defaultMode: "mentions_and_replies",
          overrideMode: mode,
          effectiveMode: mode,
        })
      : Response.json({
          item: {
            ...item,
            sourceTarget: {
              kind: "space",
              spaceId: "space-a",
              signalId: "signal-a",
              replyToRecipient,
            },
          },
        })
  );
  const delivery = notifications.show(request);
  if (eligible) {
    await vi.waitFor(() => expect(native.created).toHaveBeenCalledOnce());
    native.created.mock.calls[0]?.[0].emit("show");
    expect(await delivery).toBe("delivered");
  } else {
    expect(await delivery).toBe("ineligible");
    expect(native.created).not.toHaveBeenCalled();
  }
  expect(cloudRequest.mock.calls[1]?.[0]).toBe(
    "/v1/inbox/message-notification-preferences?spaceId=space-a"
  );
});

it.each([
  true,
  false,
])("shows the window promptly but rechecks access before sending a target: %s", async (authorized) => {
  const send = vi.fn();
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send },
  };
  const { notifications, cloudRequest } = setup(
    window as unknown as BrowserWindow
  );
  const delivery = notifications.show(request);
  await vi.waitFor(() => expect(native.created).toHaveBeenCalledOnce());
  const notification = native.created.mock.calls[0]?.[0] as EventEmitter;
  notification.emit("show");
  await delivery;
  notifications.setContext({
    userId: request.userId,
    organizationId: "other-org",
    enabled: true,
    visibleConversation: null,
  });
  if (!authorized) {
    cloudRequest.mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 })
    );
  }
  notification.emit("click");
  expect(window.show).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(cloudRequest).toHaveBeenCalledTimes(3));
  if (authorized) {
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(window.restore).toHaveBeenCalledOnce();
    const reference = desktopNotificationActivationSchema.parse(
      send.mock.calls[0]?.[1]
    );
    expect(reference.itemId).toBe(item.id);
    expect(reference.sourceTarget).toEqual(item.sourceTarget);
  } else {
    await vi.runAllTimersAsync();
    expect(send).not.toHaveBeenCalled();
  }
  notifications.clear();
});
it.each([
  "new click",
  "user navigation",
] as const)("drops an outdated notification activation after %s", async (supersededBy) => {
  const send = vi.fn();
  const window = {
    isDestroyed: () => false,
    isMinimized: () => false,
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send },
  };
  const { notifications, cloudRequest } = setup(
    window as unknown as BrowserWindow
  );
  const delivery = notifications.show(request);
  await vi.waitFor(() => expect(native.created).toHaveBeenCalledOnce());
  const notification = native.created.mock.calls[0]?.[0] as EventEmitter;
  notification.emit("show");
  await delivery;
  let completeFirst!: (response: Response) => void;
  cloudRequest.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        completeFirst = resolve;
      })
  );
  notification.emit("click");
  await vi.waitFor(() => expect(completeFirst).toBeDefined());
  if (supersededBy === "new click") {
    notification.emit("click");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  } else {
    await notifications.setContext({
      userId: request.userId,
      organizationId: request.organizationId,
      enabled: true,
      visibleConversation: null,
      navigationKey: "user-opened-another-page",
    });
  }
  completeFirst(Response.json({ item }));
  await vi.runAllTimersAsync();
  expect(send).toHaveBeenCalledTimes(supersededBy === "new click" ? 1 : 0);
  notifications.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

it.each([
  "show",
  "failed",
] as const)("uses native %s acknowledgement and preserves the fixed Inbox request", async (event) => {
  const { notifications, cloudRequest } = setup();
  const delivery = notifications.show(request);
  await vi.waitFor(() => expect(native.created).toHaveBeenCalledOnce());
  const [notification, options] = native.created.mock.calls[0] as [
    EventEmitter,
    NotificationConstructorOptions,
  ];
  expect(options).toEqual({
    title: item.title,
    body: "Chat: Hello",
    silent: true,
  });
  notification.emit(event, {}, "system rejected delivery");
  await expect(delivery).resolves.toBe(
    event === "show" ? "delivered" : "unavailable"
  );
  expect(cloudRequest.mock.calls[0]?.[0]).toBe("/v1/inbox/items/item-a");
  notifications.clear();
});

it("rejects arbitrary payloads and items that are no longer eligible", async () => {
  const { notifications, cloudRequest } = setup();
  await expect(
    notifications.show({ ...request, title: "arbitrary" })
  ).rejects.toThrow();
  cloudRequest.mockResolvedValueOnce(
    Response.json({ item: { ...item, readAt: item.updatedAt } })
  );
  await expect(notifications.show(request)).resolves.toBe("ineligible");
  expect(native.created).not.toHaveBeenCalled();
});

it.each([
  "account",
  "disabled",
  "organization",
])("cancels a pending delivery after %s changes", async (change) => {
  const { notifications, session } = setup();
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof session>>>();
  session.mockReturnValueOnce(pending.promise);
  const delivery = notifications.show(request);
  await vi.waitFor(() => expect(session).toHaveBeenCalledOnce());
  if (change === "account") {
    notifications.clear();
  } else {
    notifications.setContext({
      userId: request.userId,
      organizationId:
        change === "organization" ? "other-org" : request.organizationId,
      enabled: change !== "disabled",
      visibleConversation: null,
    });
  }
  pending.resolve({
    user: { id: "user-a", name: "A", email: "a@example.com" },
  });
  await expect(delivery).resolves.toBe("context_changed");
  expect(native.created).not.toHaveBeenCalled();
});

it.each([
  "space-a",
  "other-space",
])("rechecks native focus and current conversation after held auth: %s", async (spaceId) => {
  let focused = false;
  const window = {
    isFocused: () => focused,
    isVisible: () => true,
  } as BrowserWindow;
  const { notifications, session } = setup(window);
  const held = Promise.withResolvers<Awaited<ReturnType<typeof session>>>();
  session.mockReturnValueOnce(held.promise);
  const delivery = notifications.show(request);
  await vi.waitFor(() => expect(session).toHaveBeenCalledOnce());
  focused = true;
  notifications.setContext({
    userId: request.userId,
    organizationId: request.organizationId,
    enabled: true,
    visibleConversation: { kind: "space", spaceId, threadRootSignalId: null },
  });
  held.resolve({ user: { id: "user-a", name: "A", email: "a@example.com" } });
  if (spaceId === "space-a") {
    await expect(delivery).resolves.toBe("source_visible");
    expect(native.created).not.toHaveBeenCalled();
  } else {
    await vi.waitFor(() => expect(native.created).toHaveBeenCalledOnce());
    (native.created.mock.calls[0]?.[0] as EventEmitter).emit("show");
    await expect(delivery).resolves.toBe("delivered");
  }
  notifications.clear();
});

it.each([
  "account",
  "disabled",
  "organization",
  "focus",
])("settles and closes submitted pending attempts immediately on %s, ignoring late native events", async (change) => {
  let focused = false;
  const window = {
    isFocused: () => focused,
    isVisible: () => true,
  } as BrowserWindow;
  const { notifications } = setup(window);
  notifications.setContext({
    userId: request.userId,
    organizationId: request.organizationId,
    enabled: true,
    visibleConversation: {
      kind: "space",
      spaceId: "space-a",
      threadRootSignalId: null,
    },
  });
  const settled = vi.fn();
  const delivery = notifications.show(request).then((result) => {
    settled(result);
    return result;
  });
  await vi.waitFor(() => expect(native.created).toHaveBeenCalledOnce());
  const notification = native.created.mock.calls[0]?.[0] as EventEmitter & {
    close(): void;
  };
  const close = vi.spyOn(notification, "close");
  if (change === "account") {
    notifications.clear();
  } else if (change === "focus") {
    focused = true;
    notifications.refreshVisibility();
  } else {
    notifications.setContext({
      userId: request.userId,
      organizationId:
        change === "organization" ? "other-org" : request.organizationId,
      enabled: change !== "disabled",
      visibleConversation: null,
    });
  }
  expect(close).toHaveBeenCalledOnce();
  await expect(delivery).resolves.toBe("context_changed");
  expect(vi.getTimerCount()).toBe(0);
  notification.emit("show");
  notification.emit("failed", {}, "late failure");
  expect(settled.mock.calls).toEqual([["context_changed"]]);
});
