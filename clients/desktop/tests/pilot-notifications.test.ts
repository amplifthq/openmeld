import { EventEmitter } from "node:events";
import { desktopNotificationReferenceSchema } from "@openmeld/schemas";
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
  const session = vi.fn(async () => ({
    user: { id: "user-a", name: "A", email: "a@example.com" },
  }));
  const cloudRequest = vi.fn<
    Parameters<typeof createPilotNotifications>[0]["auth"]["cloudRequest"]
  >(async () => Response.json({ item }));
  const notifications = createPilotNotifications({
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
  });
  return { notifications, session, cloudRequest };
}

beforeEach(() => {
  vi.useFakeTimers();
  native.created.mockClear();
});

it.each([
  true,
  false,
])("rechecks access before restoring the window on click: %s", async (authorized) => {
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
  if (!authorized) {
    cloudRequest.mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 })
    );
  }
  notification.emit("click");
  await vi.waitFor(() => expect(cloudRequest).toHaveBeenCalledTimes(2));
  if (authorized) {
    await vi.waitFor(() => expect(window.focus).toHaveBeenCalledOnce());
    expect(window.restore).toHaveBeenCalledOnce();
    const reference = desktopNotificationReferenceSchema.parse(
      send.mock.calls[0]?.[1]
    );
    expect(reference.itemId).toBe(item.id);
  } else {
    await vi.runAllTimersAsync();
    expect(window.show).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  }
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
    });
  }
  pending.resolve({
    user: { id: "user-a", name: "A", email: "a@example.com" },
  });
  await expect(delivery).resolves.toBe("context_changed");
  expect(native.created).not.toHaveBeenCalled();
});
