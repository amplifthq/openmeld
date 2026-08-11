import type { PrepareSessionStreamRole } from "@openmeld/schemas/types";

export const PREPARE_SESSION_HUB_ROLE_HEADER =
  "x-openmeld-internal-prepare-session-role";
export const PREPARE_SESSION_HUB_SESSION_ID_HEADER =
  "x-openmeld-internal-prepare-session-id";

export type PrepareSessionHubSocketAttachment = {
  connectionEpoch: number | null;
  prepareSessionId: string | null;
  role: PrepareSessionStreamRole | null;
};

export const readPrepareSessionHubSocketAttachment = (
  webSocket: WebSocket
): PrepareSessionHubSocketAttachment => {
  const attachment = (webSocket.deserializeAttachment() ?? {}) as {
    prepareSessionId?: unknown;
    connectionEpoch?: unknown;
    role?: unknown;
  };
  return {
    connectionEpoch: normalizePositiveInt(attachment.connectionEpoch),
    prepareSessionId: normalizeOptionalText(attachment.prepareSessionId),
    role:
      attachment.role === "web" || attachment.role === "terminal"
        ? attachment.role
        : null,
  };
};

export const writePrepareSessionHubSocketAttachment = (
  webSocket: WebSocket,
  input: {
    prepareSessionId: string;
    connectionEpoch?: number | null;
    role: PrepareSessionStreamRole;
  }
): void => {
  webSocket.serializeAttachment({
    connectionEpoch: input.connectionEpoch ?? null,
    prepareSessionId: input.prepareSessionId,
    role: input.role,
  });
};

const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizePositiveInt = (value: unknown): number | null => {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
};
