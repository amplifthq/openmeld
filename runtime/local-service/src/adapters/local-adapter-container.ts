import type { RuntimeAdapter } from "@openmeld/adapter-core";
import type { RuntimeTransportMode } from "@openmeld/schemas/types";

export type LocalDaemonAdapterEntry = {
  adapter: RuntimeAdapter;
  adapterId: string;
  transportModes: RuntimeTransportMode[];
};

export type LocalDaemonAdapterContainer = ReturnType<
  typeof createLocalAdapterContainer
>;

export function createLocalAdapterContainer(
  entries: LocalDaemonAdapterEntry[]
) {
  const entryByAdapterId = new Map<string, LocalDaemonAdapterEntry>();

  for (const entry of entries) {
    const adapterId = entry.adapterId.trim();
    if (!adapterId) {
      continue;
    }
    entryByAdapterId.set(adapterId, {
      ...entry,
      adapterId,
      transportModes: [...entry.transportModes],
    });
  }

  return {
    getAdapter(adapterId: string): LocalDaemonAdapterEntry | null {
      const normalized = adapterId.trim();
      if (!normalized) {
        return null;
      }
      return entryByAdapterId.get(normalized) ?? null;
    },
    getRequiredAdapter(adapterId: string): LocalDaemonAdapterEntry {
      const entry = this.getAdapter(adapterId);
      if (entry) {
        return entry;
      }
      throw new Error(
        `daemon.local_adapter.missing: adapter '${adapterId}' is not configured in local adapter container`
      );
    },
    hasAdapter(adapterId: string): boolean {
      return this.getAdapter(adapterId) !== null;
    },
    listAdapters(): LocalDaemonAdapterEntry[] {
      return [...entryByAdapterId.values()];
    },
  } as const;
}
