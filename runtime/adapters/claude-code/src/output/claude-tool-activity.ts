import {
  type AdapterToolActivityEvent,
  type AdapterToolActivityName,
  type AdapterToolActivityState,
  resolveAdapterToolActivityName,
  resolveAdapterToolWorkActivity,
} from "@openmeld/adapter-core";

type AdapterToolWorkActivity = NonNullable<AdapterToolActivityEvent["work"]>;

export type ClaudeAgentSdkToolActivityTracker = {
  observe(message: unknown, observedAtMs?: number): AdapterToolActivityEvent[];
};

type ClaudeToolLifecycleObservation = {
  providerToolInput: unknown;
  providerToolName: string | null;
  state: AdapterToolActivityState;
  toolCallId: string;
};

export function createClaudeAgentSdkToolActivityTracker(): ClaudeAgentSdkToolActivityTracker {
  const namesByToolCallId = new Map<string, AdapterToolActivityName>();
  const statesByToolCallId = new Map<string, AdapterToolActivityState>();
  const workByToolCallId = new Map<string, AdapterToolWorkActivity>();

  return {
    observe(message, observedAtMs = Date.now()) {
      const events: AdapterToolActivityEvent[] = [];
      for (const observation of extractClaudeToolLifecycleObservations(
        message
      )) {
        const previousState = statesByToolCallId.get(observation.toolCallId);
        if (
          previousState === observation.state ||
          (previousState !== undefined && previousState !== "input-available")
        ) {
          continue;
        }

        const toolName =
          namesByToolCallId.get(observation.toolCallId) ??
          resolveAdapterToolActivityName(observation.providerToolName);
        const observedWork = resolveAdapterToolWorkActivity(
          observation.providerToolName,
          observation.providerToolInput
        );
        if (observedWork) {
          workByToolCallId.set(observation.toolCallId, observedWork);
        }
        const work = workByToolCallId.get(observation.toolCallId);
        namesByToolCallId.set(observation.toolCallId, toolName);
        statesByToolCallId.set(observation.toolCallId, observation.state);
        events.push({
          phase: "tool_activity",
          state: observation.state,
          toolCallId: observation.toolCallId,
          toolName,
          tsMs: observedAtMs,
          ...(work ? { work } : {}),
        });
      }
      return events;
    },
  };
}

function extractClaudeToolLifecycleObservations(
  message: unknown
): ClaudeToolLifecycleObservation[] {
  const record = toRecord(message);
  if (!record) {
    return [];
  }
  if (record.type === "tool_progress") {
    const toolCallId = normalizeOptionalText(record.tool_use_id);
    const providerToolName = normalizeOptionalText(record.tool_name);
    return toolCallId
      ? [
          {
            providerToolInput: null,
            providerToolName,
            state: "input-available",
            toolCallId,
          },
        ]
      : [];
  }

  const content = readMessageContent(record.message);
  if (record.type === "assistant") {
    return content.flatMap((block) => {
      if (block.type !== "tool_use") {
        return [];
      }
      const toolCallId = normalizeOptionalText(block.id);
      if (!toolCallId) {
        return [];
      }
      return [
        {
          providerToolInput: block.input,
          providerToolName: normalizeOptionalText(block.name),
          state: "input-available" as const,
          toolCallId,
        },
      ];
    });
  }
  if (record.type !== "user") {
    return [];
  }
  return content.flatMap((block) => {
    if (block.type !== "tool_result") {
      return [];
    }
    const toolCallId = normalizeOptionalText(block.tool_use_id);
    if (!toolCallId) {
      return [];
    }
    return [
      {
        providerToolInput: null,
        providerToolName: null,
        state:
          block.is_error === true
            ? ("output-error" as const)
            : ("output-available" as const),
        toolCallId,
      },
    ];
  });
}

function readMessageContent(message: unknown): Record<string, unknown>[] {
  const record = toRecord(message);
  if (!(record && Array.isArray(record.content))) {
    return [];
  }
  return record.content.flatMap((block) => {
    const parsed = toRecord(block);
    return parsed ? [parsed] : [];
  });
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}
