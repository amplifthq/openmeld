import { requestLocalSyncRouteCatalog } from "../control-plane/client";
import { touchDaemonCatalogSyncSignal } from "./catalog-sync-signal";

export type RouteCatalogSyncDelivery =
  | {
      delivery: "control_plane";
      syncStatus: "changed" | "registered" | "unchanged";
    }
  | {
      delivery: "signal";
      fallbackReason:
        | "control_plane_rejected"
        | "control_plane_unavailable"
        | "control_plane_failed";
    };

export async function notifyDaemonRouteCatalogChanged(input: {
  reason: string;
}): Promise<RouteCatalogSyncDelivery> {
  const reason = normalizeReason(input.reason);
  try {
    const response = await requestLocalSyncRouteCatalog({
      payload: {
        reason,
      },
    });
    if (
      response.accepted &&
      (response.syncStatus === "changed" ||
        response.syncStatus === "registered" ||
        response.syncStatus === "unchanged")
    ) {
      return {
        delivery: "control_plane",
        syncStatus: response.syncStatus,
      };
    }

    await touchDaemonCatalogSyncSignal({
      reason,
    }).catch(() => undefined);
    return {
      delivery: "signal",
      fallbackReason:
        response.syncStatus === "failed"
          ? "control_plane_failed"
          : "control_plane_rejected",
    };
  } catch {
    await touchDaemonCatalogSyncSignal({
      reason,
    }).catch(() => undefined);
    return {
      delivery: "signal",
      fallbackReason: "control_plane_unavailable",
    };
  }
}

function normalizeReason(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("route catalog sync reason is required");
  }
  return normalized;
}
