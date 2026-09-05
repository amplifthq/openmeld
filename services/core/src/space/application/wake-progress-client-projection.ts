import type { WakeProgressItem } from "@openmeld/schemas/types";

export function projectWakeProgressItemsForClient(input: {
  includePreviewText: boolean;
  items: readonly WakeProgressItem[];
}): WakeProgressItem[] {
  if (input.includePreviewText) {
    return [...input.items];
  }
  return input.items.map((item) => {
    if (item.previewText === undefined) {
      return item;
    }
    const { previewText: _, ...projectedItem } = item;
    return projectedItem;
  });
}
