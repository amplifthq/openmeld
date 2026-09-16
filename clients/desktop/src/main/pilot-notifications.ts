import {
  createInboxApi,
  createOpenMeldApiClient,
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
  const readItem = async (reference: DesktopNotificationReference) => {
    await input.ensureCompatible();
    const api = createInboxApi(
      createOpenMeldApiClient({
        baseUrl: input.webOrigin,
        transport: ({ url, init }) =>
          input.auth.cloudRequest(new URL(url).pathname, {
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
    const { item } = await api.get({ itemId: reference.itemId });
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
    setContext(raw: unknown) {
      const next = desktopNotificationContextSchema.parse(raw);
      if (
        context?.userId !== next?.userId ||
        context?.organizationId !== next?.organizationId ||
        context?.enabled !== next?.enabled
      ) {
        contextRevision += 1;
      }
      context = next;
      refreshVisibility();
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
      if (!((await currentAccount(request.userId, epoch)) && isCurrent())) {
        return "context_changed";
      }
      if (item.readAt !== null || !isInboxNotificationEligible(item)) {
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
