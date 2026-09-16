import {
  createInboxApi,
  createOpenMeldApiClient,
  inboxMessageNotificationSpaceId,
  isInboxItemVisibleConversation,
  isInboxNotificationEligible,
} from "@openmeld/api-client";
import { OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID } from "@openmeld/gateway-contract";
import {
  DESKTOP_APP_ORIGIN,
  DESKTOP_CONTRACT_HEADER,
  DESKTOP_CONTRACT_VERSION,
  DESKTOP_WEB_BUILD_HEADER,
  type DesktopNotificationContext,
  type DesktopNotificationReference,
  type DesktopNotificationResult,
  desktopNotificationContextSchema,
  desktopNotificationRequestSchema,
  desktopNotificationTestSchema,
} from "@openmeld/schemas";
import type { InboxItem } from "@openmeld/schemas/types";
import { type BrowserWindow, Notification, shell } from "electron";
import { PILOT_IPC } from "../shared/pilot-bridge";
import type { createPilotAuth } from "./pilot-auth";

export function createPilotNotifications(input: {
  auth: Pick<ReturnType<typeof createPilotAuth>, "session" | "cloudRequest">;
  webOrigin: string;
  webBuild: string;
  installed: boolean;
  ensureCompatible: () => Promise<void>;
  getWindow: () => BrowserWindow | null;
  setUnreadCount?: (count: number | null) => void;
}) {
  let generation = 0;
  let context: DesktopNotificationContext = null;
  let contextRevision = 0;
  const active = new Set<Notification>();
  const pending = new Map<
    Notification,
    { valid: () => boolean; cancel: () => void }
  >();
  const refreshVisibility = () => {
    for (const attempt of pending.values()) {
      if (!attempt.valid()) {
        attempt.cancel();
      }
    }
  };
  const isSourceVisible = (item: InboxItem) => {
    if (
      !isInboxItemVisibleConversation(
        item,
        context?.visibleConversation ?? null
      )
    ) {
      return false;
    }
    const window = input.getWindow();
    return window?.isFocused() === true && window.isVisible();
  };
  const clear = () => {
    generation += 1;
    contextRevision += 1;
    context = null;
    input.setUnreadCount?.(null);
    for (const attempt of pending.values()) {
      attempt.cancel();
    }
    for (const notification of active) {
      notification.close();
    }
    active.clear();
  };
  const currentAccount = async (userId: string, epoch: number) =>
    (await input.auth.session()).user?.id === userId && epoch === generation;
  const createApi = (reference: DesktopNotificationReference) =>
    createInboxApi(
      createOpenMeldApiClient({
        baseUrl: input.webOrigin,
        transport: ({ url, init }) =>
          input.auth.cloudRequest(new URL(url).pathname + new URL(url).search, {
            method: "GET",
            headers: new Headers({
              origin: DESKTOP_APP_ORIGIN,
              ...Object.fromEntries(new Headers(init?.headers)),
              [OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID]:
                reference.organizationId,
              [input.installed
                ? DESKTOP_CONTRACT_HEADER
                : DESKTOP_WEB_BUILD_HEADER]: input.installed
                ? DESKTOP_CONTRACT_VERSION
                : input.webBuild,
            }),
          }),
      })
    );
  const readItem = async (reference: DesktopNotificationReference) => {
    await input.ensureCompatible();
    const { item } = await createApi(reference).get({
      itemId: reference.itemId,
    });
    if (
      item.recipientUserId !== reference.userId ||
      item.organizationId !== reference.organizationId ||
      item.id !== reference.itemId
    ) {
      throw new Error("Notification account changed.");
    }
    return item;
  };
  const activate = async (
    reference: DesktopNotificationReference | undefined,
    epoch: number
  ) => {
    if (epoch !== generation) {
      return;
    }
    if (reference) {
      const item = await readItem(reference);
      if (!(await currentAccount(reference.userId, epoch))) {
        return;
      }
      if (item.sourceTarget.kind === "message_channel") {
        await shell.openExternal(item.sourceTarget.permalink);
        return;
      }
    }
    const window = input.getWindow();
    if (!window || window.isDestroyed()) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
    if (reference) {
      window.webContents.send(PILOT_IPC.notificationClick, reference);
    }
  };
  const deliver = (
    title: string,
    body: string,
    soundEnabled: boolean,
    epoch: number,
    reference?: DesktopNotificationReference,
    isCurrent: () => boolean = () => true
  ): Promise<DesktopNotificationResult> => {
    if (!Notification.isSupported()) {
      return Promise.resolve("unavailable");
    }
    return new Promise((resolve) => {
      const notification = new Notification({
        title,
        body,
        silent: !soundEnabled,
      });
      active.add(notification);
      let settled = false;
      const valid = () => epoch === generation && isCurrent();
      const finish = (result: DesktopNotificationResult) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        pending.delete(notification);
        notification.removeAllListeners("show");
        notification.removeAllListeners("failed");
        if (result !== "delivered") {
          notification.removeAllListeners("click");
          active.delete(notification);
          notification.close();
        }
        resolve(result);
      };
      // A missing native acknowledgement is not delivery. The existing Inbox
      // pending ledger owns retries; close this attempt before returning.
      const timer = setTimeout(() => {
        finish("unavailable");
      }, 10_000);
      pending.set(notification, {
        valid,
        cancel: () => finish("context_changed"),
      });
      notification.once("show", () => {
        finish(valid() ? "delivered" : "context_changed");
      });
      notification.once("failed", (_event, error) => {
        console.warn("[openmeld.desktop.notification_failed]", { error });
        active.delete(notification);
        finish("unavailable");
      });
      notification.once("close", () => active.delete(notification));
      notification.on("click", () => {
        activate(reference, epoch)
          .then(() => notification.close())
          .catch((error: unknown) =>
            console.warn("[openmeld.desktop.notification_click_failed]", {
              error,
            })
          );
      });
      try {
        notification.show();
      } catch (error) {
        active.delete(notification);
        finish("unavailable");
        console.warn("[openmeld.desktop.notification_failed]", { error });
      }
    });
  };
  return {
    clear,
    refreshVisibility,
    async setContext(raw: unknown) {
      const next = desktopNotificationContextSchema.parse(raw);
      const scopeChanged =
        context?.userId !== next?.userId ||
        context?.organizationId !== next?.organizationId;
      if (scopeChanged || context?.enabled !== next?.enabled) {
        contextRevision += 1;
      }
      if (scopeChanged) {
        input.setUnreadCount?.(null);
      }
      context = next;
      refreshVisibility();
      const epoch = generation;
      if (next?.unreadCount == null) {
        input.setUnreadCount?.(null);
        return;
      }
      let accountMatches: boolean;
      try {
        accountMatches = await currentAccount(next.userId, epoch);
      } catch (error) {
        if (context === next && generation === epoch) {
          input.setUnreadCount?.(null);
        }
        throw error;
      }
      if (context !== next || generation !== epoch) {
        return;
      }
      input.setUnreadCount?.(accountMatches ? next.unreadCount : null);
    },
    async show(raw: unknown): Promise<DesktopNotificationResult> {
      const request = desktopNotificationRequestSchema.parse(raw);
      const epoch = generation;
      const revision = contextRevision;
      const isCurrent = () =>
        contextRevision === revision &&
        context?.enabled === true &&
        context.userId === request.userId &&
        context.organizationId === request.organizationId;
      if (!isCurrent()) {
        return "context_changed";
      }
      const item = await readItem(request);
      const spaceId = inboxMessageNotificationSpaceId(item);
      const preferences = spaceId
        ? await createApi(request).getMessageNotificationPreferences({
            spaceId,
          })
        : null;
      if (
        preferences &&
        (preferences.organizationId !== request.organizationId ||
          preferences.spaceId !== spaceId)
      ) {
        throw new Error("Notification preference scope changed.");
      }
      if (!((await currentAccount(request.userId, epoch)) && isCurrent())) {
        return "context_changed";
      }
      if (
        item.readAt !== null ||
        !isInboxNotificationEligible(item, preferences?.effectiveMode)
      ) {
        return "ineligible";
      }
      if (isSourceVisible(item)) {
        return "source_visible";
      }
      const { soundEnabled, ...reference } = request;
      return deliver(
        item.title,
        item.contextLabel
          ? `${item.contextLabel}: ${item.preview}`
          : item.preview,
        soundEnabled,
        epoch,
        reference,
        () => isCurrent() && !isSourceVisible(item)
      );
    },
    async test(raw: unknown): Promise<DesktopNotificationResult> {
      const request = desktopNotificationTestSchema.parse(raw);
      const epoch = generation;
      if (!(await currentAccount(request.userId, epoch))) {
        return "context_changed";
      }
      return deliver(
        "OpenMeld",
        "This is a test notification.",
        request.soundEnabled,
        epoch
      );
    },
  };
}
