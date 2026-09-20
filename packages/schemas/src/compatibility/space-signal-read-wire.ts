/**
 * Read-only wire projection: existing history readers reject unknown top-level
 * signal data. They may read the additive meta mirror; it never authorizes work.
 * Do not use this projection for authoring, persistence, or dispatch snapshots.
 */
export function toSpaceSignalReadWireValue<T>(value: T): T {
  if (Array.isArray(value)) {
    const items = value.map(toSpaceSignalReadWireValue);
    return items.some((item, index) => item !== value[index])
      ? (items as T)
      : value;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (
    record.type === "signal.text" &&
    typeof record.data === "object" &&
    record.data !== null
  ) {
    const { deviceWait, contextSelection, ...data } = record.data as Record<
      string,
      unknown
    >;
    if (!(deviceWait || contextSelection)) {
      return value;
    }
    return {
      ...record,
      data: {
        ...data,
        ...(deviceWait
          ? {
              meta: {
                ...(data.meta as Record<string, unknown> | undefined),
                deviceWait,
              },
            }
          : {}),
      },
    } as T;
  }
  const entries = Object.entries(record).map(
    ([key, nested]) => [key, toSpaceSignalReadWireValue(nested)] as const
  );
  return entries.some(([key, nested]) => nested !== record[key])
    ? (Object.fromEntries(entries) as T)
    : value;
}
