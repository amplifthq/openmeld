import type { WakeProgressItem } from "@openmeld/schemas/types";

export function projectWakeProgressItemsForClient(input: {
  includePreviewText: boolean;
  includeDeviceWait?: boolean;
  items: readonly WakeProgressItem[];
}): WakeProgressItem[] {
  if (input.includePreviewText && input.includeDeviceWait) {
    return [...input.items];
  }
  return input.items.map((item) => {
    const { previewText, deviceWait, ...projectedItem } = item;
    return {
      ...projectedItem,
      ...(input.includePreviewText && previewText !== undefined
        ? { previewText }
        : {}),
      ...(input.includeDeviceWait && deviceWait ? { deviceWait } : {}),
    };
  });
}
