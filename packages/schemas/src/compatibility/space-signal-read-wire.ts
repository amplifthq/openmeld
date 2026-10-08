/**
 * Read-only wire projection: existing history readers reject unknown top-level
 * signal data. They may read the additive meta mirror; it never authorizes work.
 * Do not use this projection for authoring, persistence, or dispatch snapshots.
 */
const UNCONFIRMED_ACTION_COPY =
  "An action outcome is awaiting confirmation. Check the existing result before repeating the work.";

export function toSpaceSignalReadWireValue<T>(
  value: T,
  supportsAgentWorkOutcomes = false
): T {
  if (Array.isArray(value)) {
    const items = value.map((item) =>
      toSpaceSignalReadWireValue(item, supportsAgentWorkOutcomes)
    );
    return items.some((item, index) => item !== value[index])
      ? (items as T)
      : value;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (!supportsAgentWorkOutcomes && record.type === "space.agent_stream_part") {
    return projectLegacyAgentWorkProgress(record) as T;
  }
  if (
    record.type === "signal.text" &&
    typeof record.data === "object" &&
    record.data !== null
  ) {
    return projectSignalTextRead(record, supportsAgentWorkOutcomes) as T;
  }
  const entries = Object.entries(record).map(
    ([key, nested]) =>
      [
        key,
        toSpaceSignalReadWireValue(nested, supportsAgentWorkOutcomes),
      ] as const
  );
  return entries.some(([key, nested]) => nested !== record[key])
    ? (Object.fromEntries(entries) as T)
    : value;
}

function projectLegacyAgentWorkProgress(record: Record<string, unknown>) {
  const part = record.part as { work?: { outcome?: unknown } } | undefined;
  if (!requiresLegacyOutcomeProjection(part?.work?.outcome)) {
    return record;
  }
  const { part: _part, type: _type, ...identity } = record;
  return {
    ...identity,
    type: "space.agent_stream_delta",
    kind: "progress",
    state: "streaming",
    progressSnapshot: UNCONFIRMED_ACTION_COPY,
  };
}

function projectSignalTextRead(
  record: Record<string, unknown>,
  supportsAgentWorkOutcomes: boolean
) {
  const {
    deviceWait,
    contextSelection,
    contextSelections,
    taskDraft,
    ...data
  } = record.data as Record<string, unknown>;
  const meta = data.meta as Record<string, unknown> | undefined;
  const projectedMeta = supportsAgentWorkOutcomes
    ? meta
    : projectLegacyAgentWorkMetadata(meta);
  if (
    !(
      deviceWait ||
      contextSelection ||
      contextSelections ||
      taskDraft ||
      projectedMeta !== meta
    )
  ) {
    return record;
  }
  return {
    ...record,
    data: {
      ...data,
      ...(deviceWait || projectedMeta !== meta
        ? {
            meta: {
              ...projectedMeta,
              ...(deviceWait ? { deviceWait } : {}),
            },
          }
        : {}),
    },
  };
}

function projectLegacyAgentWorkMetadata(
  meta: Record<string, unknown> | undefined
) {
  const work = meta?.agentWorkSummary as
    | { steps?: { work?: { outcome?: unknown } }[] }
    | undefined;
  if (
    !(
      Array.isArray(work?.steps) &&
      work.steps.some((step) =>
        requiresLegacyOutcomeProjection(step?.work?.outcome)
      )
    )
  ) {
    return meta;
  }
  const {
    agentActivity: _activity,
    agentWorkSummary: _work,
    ...legacyMeta
  } = meta ?? {};
  return {
    ...legacyMeta,
    agentPublicProgress:
      `${typeof meta?.agentPublicProgress === "string" ? `${meta.agentPublicProgress}\n` : ""}${UNCONFIRMED_ACTION_COPY}`.slice(
        -8192
      ),
  };
}

function requiresLegacyOutcomeProjection(outcome: unknown): boolean {
  // A reader that predates outcome vocabulary understands only this original
  // value. Unknown future evidence must stay uncertain, never look completed.
  return outcome !== undefined && outcome !== "confirmation_required";
}
