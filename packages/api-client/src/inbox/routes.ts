import type { ListInboxItemsQuery } from "@openmeld/schemas/types";

const INBOX_PATH = "/v1/inbox";

export function buildInboxPath(query: ListInboxItemsQuery = {}): string {
  const search = new URLSearchParams();
  if (query.cursor !== undefined) {
    search.set("cursor", query.cursor);
  }
  if (query.limit !== undefined) {
    search.set("limit", String(query.limit));
  }
  if (query.view !== undefined) {
    search.set("view", query.view);
  }
  const suffix = search.toString();
  return suffix ? `${INBOX_PATH}?${suffix}` : INBOX_PATH;
}

export function buildInboxSummaryPath(): string {
  return `${INBOX_PATH}/summary`;
}

export function buildCenterAgentInboxSummaryPath(): string {
  return `${INBOX_PATH}/center-agent/summary`;
}

export function buildCenterAgentInboxReadThroughPath(): string {
  return `${INBOX_PATH}/center-agent/read-through`;
}

export function buildSpaceInboxSummaryPath(): string {
  return `${INBOX_PATH}/spaces/summary`;
}

export function buildSpaceInboxReadThroughPath(): string {
  return `${INBOX_PATH}/spaces/read-through`;
}

export function buildInboxItemReadPath(itemId: string): string {
  return `${INBOX_PATH}/items/${encodeURIComponent(itemId)}/read`;
}

export function buildInboxItemDismissPath(itemId: string): string {
  return `${INBOX_PATH}/items/${encodeURIComponent(itemId)}/dismiss`;
}

export function buildInboxItemPath(itemId: string): string {
  return `${INBOX_PATH}/items/${encodeURIComponent(itemId)}`;
}

export function buildInboxMarkAllReadPath(): string {
  return `${INBOX_PATH}/mark-all-read`;
}

export function buildInboxPreferencesPath(): string {
  return `${INBOX_PATH}/preferences`;
}
