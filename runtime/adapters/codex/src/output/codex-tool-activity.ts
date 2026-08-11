import {
  type AdapterToolActivityEvent,
  type AdapterToolActivityName,
  resolveAdapterToolActivityName,
  resolveAdapterToolWorkActivity,
} from "@openmeld/adapter-core";

const CODEX_TOOL_ITEM_TYPES = new Set([
  "collabagenttoolcall",
  "collab_agent_tool_call",
  "commandexecution",
  "command_execution",
  "dynamictoolcall",
  "dynamic_tool_call",
  "filechange",
  "file_change",
  "imagegeneration",
  "image_generation",
  "imageview",
  "image_view",
  "mcptoolcall",
  "mcp_tool_call",
  "websearch",
  "web_search",
]);

export function extractCodexToolActivityEvent(
  value: unknown,
  fallbackObservedAtMs = Date.now()
): AdapterToolActivityEvent | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }
  const lifecycle = resolveLifecycle(record);
  if (!lifecycle) {
    return null;
  }
  const params = toRecord(record.params);
  const item = toRecord(params?.item ?? record.item);
  const itemType = normalizeCompactName(item?.type);
  const toolCallId = normalizeOptionalText(item?.id);
  if (!(item && toolCallId && CODEX_TOOL_ITEM_TYPES.has(itemType))) {
    return null;
  }

  const work = resolveAdapterToolWorkActivity(itemType, item);
  return {
    phase: "tool_activity",
    state: resolveToolActivityState(lifecycle, item),
    toolCallId,
    toolName: resolveCodexToolActivityName(itemType, item),
    tsMs: resolveObservedAtMs({
      fallbackObservedAtMs,
      lifecycle,
      params,
      record,
    }),
    ...(work ? { work } : {}),
  };
}

function resolveToolActivityState(
  lifecycle: "completed" | "started",
  item: Record<string, unknown>
): AdapterToolActivityEvent["state"] {
  if (lifecycle === "started") {
    return "input-available";
  }
  return isFailedCodexItem(item) ? "output-error" : "output-available";
}

function resolveLifecycle(
  record: Record<string, unknown>
): "completed" | "started" | null {
  if (record.method === "item/started" || record.type === "item.started") {
    return "started";
  }
  if (record.method === "item/completed" || record.type === "item.completed") {
    return "completed";
  }
  return null;
}

function resolveCodexToolActivityName(
  itemType: string,
  item: Record<string, unknown>
): AdapterToolActivityName {
  if (itemType === "websearch" || itemType === "web_search") {
    const action = toRecord(item.action);
    const actionType = normalizeCompactName(action?.type);
    return actionType === "openpage" || actionType === "open_page"
      ? "agent_open_webpage"
      : "agent_search_web";
  }
  return resolveAdapterToolActivityName(itemType);
}

function isFailedCodexItem(item: Record<string, unknown>): boolean {
  const status = normalizeCompactName(item.status);
  return (
    status === "failed" ||
    status === "declined" ||
    item.success === false ||
    toRecord(item.error) !== null
  );
}

function resolveObservedAtMs(input: {
  fallbackObservedAtMs: number;
  lifecycle: "completed" | "started";
  params: Record<string, unknown> | null;
  record: Record<string, unknown>;
}): number {
  const candidate =
    input.lifecycle === "started"
      ? (input.params?.startedAtMs ?? input.record.startedAtMs)
      : (input.params?.completedAtMs ?? input.record.completedAtMs);
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? Math.max(0, Math.trunc(candidate))
    : input.fallbackObservedAtMs;
}

function normalizeCompactName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
