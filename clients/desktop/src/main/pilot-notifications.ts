import {
  createInboxApi,
  createOpenMeldApiClient,
  inboxMessageNotificationSpaceId,
  isInboxItemInOrganizationScope,
  isInboxItemVisibleConversation,
  isInboxNotificationEligible,
} from "@openmeld/api-client";
import { OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID } from "@openmeld/gateway-contract";
import {
  DESKTOP_APP_ORIGIN,
  DESKTOP_CONTRACT_HEADER,
  DESKTOP_CONTRACT_VERSION,
  DESKTOP_WEB_BUILD_HEADER,
  type DesktopInboxAttention,
  type DesktopNotificationContext,
  type DesktopNotificationReference,
  type DesktopNotificationResult,
  desktopNotificationContextSchema,
  desktopNotificationRequestSchema,
  desktopNotificationTestSchema,
} from "@openmeld/schemas";
import type { InboxItem } from "@openmeld/schemas/types";
import { type BrowserWindow, Notification, shell } from "electron";
import { WINDOW_IPC } from "../shared/ipc-contract";
import { PILOT_IPC } from "../shared/pilot-bridge";
import type { createPilotAuth } from "./pilot-auth";

export function createPilotNotifications(input: {
  auth: Pick<ReturnType<typeof createPilotAuth>, "session" | "cloudRequest">;
  webOrigin: string;
  webBuild: string;
  installed: boolean;
  ensureCompatible: () => Promise<void>;
  getWindow: () => BrowserWindow | null;
  setInboxAttention?: (attention: DesktopInboxAttention | null) => void;
  setTrayPresentation?: (presentation: DesktopTrayPresentation) => void;
  setTrayContext?: (context: DesktopTrayContext | null) => void;
  invalidateTrayScope?: () => void;
  readLocalServiceAuthenticationRequired?: (userId: string) => Promise<boolean>;
}) {
  let generation = 0;
  let activationRevision = 0;
  let navigationRevision = 0;
  let context: DesktopNotificationContext = null;
  let contextRevision = 0;
  const serviceAuthNotices = new Set<string>();
  let serviceAuthCheckPending = false;
  let serviceAuthCheckedAt = Number.NEGATIVE_INFINITY;
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
    serviceAuthNotices.clear();
    serviceAuthCheckedAt = Number.NEGATIVE_INFINITY;
    input.invalidateTrayScope?.();
    input.setInboxAttention?.(null);
    input.setTrayPresentation?.({ status: "signed_out" });
    input.setTrayContext?.(null);
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
  const createApi = (scope: { organizationId: string }) =>
    createInboxApi(
      createOpenMeldApiClient({
        baseUrl: input.webOrigin,
        transport: ({ url, init }) =>
          input.auth.cloudRequest(new URL(url).pathname + new URL(url).search, {
            method: "GET",
            headers: new Headers({
              origin: DESKTOP_APP_ORIGIN,
              ...Object.fromEntries(new Headers(init?.headers)),
              [OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID]: scope.organizationId,
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
      !isInboxItemInOrganizationScope(item, reference.organizationId) ||
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
    const revision = ++activationRevision;
    const navigationContext = context;
    const initialNavigationRevision = navigationRevision;
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
      const item = await readItem(reference);
      if (
        !(await currentAccount(reference.userId, epoch)) ||
        revision !== activationRevision ||
        navigationRevision !== initialNavigationRevision ||
        !sameNotificationScope(navigationContext, context) ||
        window.isDestroyed()
      ) {
        return;
      }
      if (item.sourceTarget.kind === "message_channel") {
        await shell.openExternal(item.sourceTarget.permalink);
        return;
      }
      window.webContents.send(PILOT_IPC.notificationClick, {
        ...reference,
        sourceTarget: item.sourceTarget,
      });
    }
  };
  const deliver = (
    title: string,
    body: string,
    soundEnabled: boolean,
    epoch: number,
    reference?: DesktopNotificationReference,
    isCurrent: () => boolean = () => true,
    onActivate?: () => Promise<void>
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
        (onActivate ? onActivate() : activate(reference, epoch))
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
  const observeServiceAuthentication = async (
    next: NonNullable<DesktopNotificationContext>,
    epoch: number
  ) => {
    if (next.computer?.statusTone === "connected") {
      serviceAuthNotices.delete(next.userId);
      return;
    }
    if (
      !(
        input.readLocalServiceAuthenticationRequired &&
        next.enabled &&
        next.computer?.statusTone
      ) ||
      serviceAuthNotices.has(next.userId) ||
      serviceAuthCheckPending ||
      Date.now() - serviceAuthCheckedAt < 60_000
    ) {
      return;
    }
    serviceAuthCheckPending = true;
    serviceAuthCheckedAt = Date.now();
    const isCurrent = () =>
      epoch === generation &&
      context?.userId === next.userId &&
      context.enabled &&
      context.computer?.statusTone !== "connected";
    try {
      if (
        !(
          (await input.readLocalServiceAuthenticationRequired(next.userId)) &&
          isCurrent() &&
          (await currentAccount(next.userId, epoch))
        )
      ) {
        return;
      }
      const result = await deliver(
        "Reconnect this computer",
        "OpenMeld Service needs you to sign in again. Open Computer settings and reconnect to receive new tasks.",
        false,
        epoch,
        undefined,
        isCurrent,
        async () => {
          if (!(isCurrent() && (await currentAccount(next.userId, epoch)))) {
            return;
          }
          await activate(undefined, epoch);
          input
            .getWindow()
            ?.webContents.send(WINDOW_IPC.navigateDestination, "computer");
        }
      );
      if (result === "delivered" && isCurrent()) {
        serviceAuthNotices.add(next.userId);
      }
    } catch (error) {
      console.warn("[openmeld.desktop.service_auth_check_failed]", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    } finally {
      serviceAuthCheckPending = false;
    }
  };
  const noCandidateStatus = (
    next: NonNullable<DesktopNotificationContext>
  ): Exclude<DesktopTrayPresentation, { status: "ready" }>["status"] => {
    if (!next.latestUnreadStatus || next.latestUnreadStatus === "loading") {
      return "loading";
    }
    if (next.latestUnreadStatus === "unavailable") {
      return "unavailable";
    }
    if (
      next.unreadCountStatus === "loading" ||
      (!next.unreadCountStatus && next.unreadCount == null)
    ) {
      return "loading";
    }
    if (next.unreadCountStatus === "unavailable") {
      return "unavailable";
    }
    return next.unreadCount && next.unreadCount > 0
      ? "no_unread_messages"
      : "empty";
  };
  const trayContextChanged = async (
    next: NonNullable<DesktopNotificationContext>,
    epoch: number
  ) =>
    context !== next ||
    generation !== epoch ||
    !(await currentAccount(next.userId, epoch));
  const assertInboxOrganization = (
    actualOrganizationId: string,
    expectedOrganizationId: string
  ) => {
    if (actualOrganizationId !== expectedOrganizationId) {
      throw new Error("Inbox preview organization changed.");
    }
  };
  const findLatestEligibleUnread = async (
    next: NonNullable<DesktopNotificationContext>,
    epoch: number
  ): Promise<
    | { item: InboxItem; reference: DesktopNotificationReference }
    | "context_changed"
    | "scan_incomplete"
    | null
  > => {
    if (!next.organizationSlug) {
      return "scan_incomplete";
    }
    const organizationSlug = next.organizationSlug;
    const response = await createApi(next).list({
      limit: 1,
      notificationPreview: "true",
      view: "unread",
    });
    if (await trayContextChanged(next, epoch)) {
      return "context_changed";
    }
    assertInboxOrganization(response.organizationId, next.organizationId);
    const item = response.items[0];
    return item
      ? {
          item,
          reference: {
            itemId: item.id,
            organizationId: next.organizationId,
            organizationSlug,
            userId: next.userId,
          },
        }
      : null;
  };
  const refreshTrayPresentation = async (
    next: NonNullable<DesktopNotificationContext>,
    epoch: number
  ) => {
    if (!next.latestUnreadStatus || next.latestUnreadStatus !== "ready") {
      input.setTrayPresentation?.({ status: noCandidateStatus(next) });
      return;
    }
    try {
      const candidate = await findLatestEligibleUnread(next, epoch);
      if (candidate === "context_changed") {
        return;
      }
      if (candidate === "scan_incomplete") {
        input.setTrayPresentation?.({ status: "unavailable" });
        return;
      }
      if (!candidate) {
        input.setTrayPresentation?.({ status: noCandidateStatus(next) });
        return;
      }
      input.setTrayPresentation?.({
        item: {
          contextLabel: candidate.item.contextLabel,
          occurredAt: candidate.item.occurredAt,
          preview: candidate.item.preview,
          reference: candidate.reference,
          title: candidate.item.title,
        },
        status: "ready",
      });
    } catch (error) {
      if (context === next && generation === epoch) {
        input.setTrayPresentation?.({ status: "unavailable" });
      }
      throw error;
    }
  };
  const validateContextAccount = async (
    next: NonNullable<DesktopNotificationContext>,
    epoch: number
  ) => {
    try {
      return await currentAccount(next.userId, epoch);
    } catch (error) {
      if (context === next && generation === epoch) {
        input.setInboxAttention?.(null);
      }
      throw error;
    }
  };
  return {
    activate(reference: DesktopNotificationReference) {
      return activate(reference, generation);
    },
    clear,
    refreshVisibility,
    async setContext(raw: unknown) {
      const next = desktopNotificationContextSchema.parse(raw);
      navigationRevision = nextNotificationNavigationRevision({
        current: context,
        next,
        revision: navigationRevision,
      });
      const scopeChanged =
        context?.userId !== next?.userId ||
        context?.organizationId !== next?.organizationId;
      if (scopeChanged || context?.enabled !== next?.enabled) {
        contextRevision += 1;
      }
      if (scopeChanged) {
        input.invalidateTrayScope?.();
        input.setInboxAttention?.(null);
        input.setTrayPresentation?.({ status: "loading" });
        input.setTrayContext?.(null);
      }
      context = next;
      refreshVisibility();
      const epoch = generation;
      if (!next) {
        input.setTrayPresentation?.({ status: "signed_out" });
        input.setInboxAttention?.(null);
        input.setTrayContext?.(null);
        return;
      }
      const accountMatches = await validateContextAccount(next, epoch);
      if (context !== next || generation !== epoch) {
        return;
      }
      input.setInboxAttention?.(
        accountMatches &&
          next.unreadCountStatus !== "loading" &&
          next.unreadCountStatus !== "unavailable"
          ? (next.attention ?? null)
          : null
      );
      if (!accountMatches) {
        input.setTrayPresentation?.({ status: "signed_out" });
        return;
      }
      input.setTrayContext?.({
        ...(next.computer ? { computer: next.computer } : {}),
        unreadCount: next.unreadCount,
      });
      // Reuse existing notification refreshes. Healthy Computers never spawn
      // a local probe, and a disconnected Computer is checked at most once a minute.
      observeServiceAuthentication(next, epoch);
      await refreshTrayPresentation(next, epoch);
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

export type DesktopTrayPresentation =
  | {
      status:
        | "empty"
        | "loading"
        | "no_unread_messages"
        | "signed_out"
        | "unavailable";
    }
  | {
      item: {
        contextLabel: string | null;
        occurredAt: string;
        preview: string;
        reference: DesktopNotificationReference;
        title: string;
      };
      status: "ready";
    };

export type DesktopTrayContext = {
  computer?: NonNullable<DesktopNotificationContext>["computer"];
  unreadCount: number | null | undefined;
};

function sameNotificationScope(
  current: DesktopNotificationContext,
  next: DesktopNotificationContext
): boolean {
  if (!current) {
    return true;
  }
  return (
    current.userId === next?.userId &&
    current.organizationId === next?.organizationId
  );
}

function didNotificationNavigationChange(
  current: DesktopNotificationContext,
  next: DesktopNotificationContext
): boolean {
  return Boolean(
    current?.navigationKey && current.navigationKey !== next?.navigationKey
  );
}

function nextNotificationNavigationRevision(input: {
  current: DesktopNotificationContext;
  next: DesktopNotificationContext;
  revision: number;
}): number {
  return (
    input.revision +
    (didNotificationNavigationChange(input.current, input.next) ? 1 : 0)
  );
}
