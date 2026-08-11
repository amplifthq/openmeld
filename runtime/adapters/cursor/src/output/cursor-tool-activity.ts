import {
  type AdapterToolActivityEvent,
  type AdapterToolActivityName,
  resolveAdapterToolActivityName,
  resolveAdapterToolWorkActivity,
} from "@openmeld/adapter-core";

type AdapterToolWorkActivity = NonNullable<AdapterToolActivityEvent["work"]>;

type CursorToolActivityState = {
  providerInput?: unknown;
  providerKind: string | null;
  providerLocations?: unknown;
  providerTitle: string | null;
  state: AdapterToolActivityEvent["state"];
  toolName: AdapterToolActivityName;
  work?: AdapterToolWorkActivity;
};

export type CursorAcpToolActivityTracker = {
  observe(
    value: unknown,
    observedAtMs?: number
  ): AdapterToolActivityEvent | null;
};

export function createCursorAcpToolActivityTracker(): CursorAcpToolActivityTracker {
  const toolCalls = new Map<string, CursorToolActivityState>();

  return {
    observe(value, observedAtMs = Date.now()) {
      const observation = extractCursorToolActivityObservation(value);
      if (!observation) {
        return null;
      }

      const current = toolCalls.get(observation.scopedToolCallId);
      const providerKind =
        observation.providerKind ?? current?.providerKind ?? null;
      const providerTitle =
        observation.providerTitle ?? current?.providerTitle ?? null;
      const providerInput = mergeProviderPatch(
        current?.providerInput,
        observation.providerInput
      );
      const providerLocations = mergeProviderPatch(
        current?.providerLocations,
        observation.providerLocations
      );
      const providerToolName = resolveCursorProviderToolName(
        providerKind,
        providerTitle
      );
      const toolName =
        current?.toolName ?? resolveAdapterToolActivityName(providerToolName);
      const work =
        current?.work ??
        resolveCursorToolWorkActivity({
          providerInput,
          providerKind,
          providerLocations,
          providerToolName,
        }) ??
        undefined;
      const state = resolveToolActivityState(
        current?.state,
        observation.status
      );
      toolCalls.set(observation.scopedToolCallId, {
        providerInput,
        providerKind,
        providerLocations,
        providerTitle,
        state,
        toolName,
        work,
      });

      return {
        phase: "tool_activity",
        state,
        toolCallId: observation.toolCallId,
        toolName,
        tsMs: observedAtMs,
        ...(work ? { work } : {}),
      };
    },
  };
}

type CursorToolActivityObservation = {
  providerInput?: unknown;
  providerKind: string | null;
  providerLocations?: unknown;
  providerTitle: string | null;
  scopedToolCallId: string;
  status: string | null;
  toolCallId: string;
};

function extractCursorToolActivityObservation(
  value: unknown
): CursorToolActivityObservation | null {
  const message = toRecord(value);
  if (message?.method !== "session/update") {
    return null;
  }
  const params = toRecord(message.params);
  const update = toRecord(params?.update);
  const updateType = normalizeOptionalText(update?.sessionUpdate);
  if (
    !(
      update &&
      (updateType === "tool_call" || updateType === "tool_call_update")
    )
  ) {
    return null;
  }
  const toolCallId = normalizeOptionalText(
    update.toolCallId ?? update.tool_call_id
  );
  if (!toolCallId) {
    return null;
  }
  const sessionId = normalizeOptionalText(params?.sessionId);
  return {
    ...(Object.hasOwn(update, "rawInput")
      ? { providerInput: update.rawInput }
      : {}),
    providerKind: normalizeOptionalText(update.kind),
    ...(Object.hasOwn(update, "locations")
      ? { providerLocations: update.locations }
      : {}),
    providerTitle: normalizeOptionalText(update.title ?? update.name),
    scopedToolCallId: sessionId ? `${sessionId}\0${toolCallId}` : toolCallId,
    status: normalizeOptionalText(update.status)?.toLowerCase() ?? null,
    toolCallId,
  };
}

function resolveCursorProviderToolName(
  kind: string | null,
  title: string | null
): string | null {
  switch (kind?.toLowerCase()) {
    case "execute":
      return "command";
    case "read":
      return "read";
    case "edit":
    case "delete":
    case "move":
      return "edit";
    case undefined:
      return title;
    default:
      return kind;
  }
}

function resolveCursorToolWorkActivity(input: {
  providerInput: unknown;
  providerKind: string | null;
  providerLocations: unknown;
  providerToolName: string | null;
}): AdapterToolWorkActivity | null {
  const providerKind = input.providerKind?.toLowerCase();
  if (
    providerKind === "read" ||
    providerKind === "edit" ||
    providerKind === "delete" ||
    providerKind === "move"
  ) {
    const providerInput = resolveCursorFileEvidenceInput({
      providerInput: input.providerInput,
      providerLocations: input.providerLocations,
    });
    if (!providerInput) {
      return null;
    }
    return resolveAdapterToolWorkActivity(
      input.providerToolName,
      providerInput
    );
  }
  return resolveAdapterToolWorkActivity(
    input.providerToolName,
    input.providerInput
  );
}

function resolveCursorFileEvidenceInput(input: {
  providerInput: unknown;
  providerLocations: unknown;
}): Record<string, unknown> | null {
  const providerInput = toRecord(input.providerInput);
  if (providerInput && readFilePath(providerInput)) {
    return providerInput;
  }
  const locationPath = readLocationPath(input.providerLocations);
  if (!locationPath) {
    return null;
  }
  return {
    ...(providerInput ?? {}),
    path: locationPath,
  };
}

function readFilePath(value: Record<string, unknown>): string | null {
  for (const candidate of [value.file_path, value.filePath, value.path]) {
    const path = normalizeOptionalText(candidate);
    if (path) {
      return path;
    }
  }
  if (Array.isArray(value.changes)) {
    for (const change of value.changes) {
      const path = normalizeOptionalText(toRecord(change)?.path);
      if (path) {
        return path;
      }
    }
  }
  return null;
}

function readLocationPath(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const location of value) {
    const path = normalizeOptionalText(toRecord(location)?.path);
    if (path) {
      return path;
    }
  }
  return null;
}

function mergeProviderPatch(current: unknown, patch: unknown): unknown {
  if (patch === undefined || patch === null) {
    return current;
  }
  const currentRecord = toRecord(current);
  const patchRecord = toRecord(patch);
  if (currentRecord && patchRecord) {
    return {
      ...currentRecord,
      ...patchRecord,
    };
  }
  return patch;
}

function resolveToolActivityState(
  current: AdapterToolActivityEvent["state"] | undefined,
  status: string | null
): AdapterToolActivityEvent["state"] {
  if (current === "output-available" || current === "output-error") {
    return current;
  }
  if (status === "failed") {
    return "output-error";
  }
  if (status === "completed") {
    return "output-available";
  }
  return "input-available";
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
