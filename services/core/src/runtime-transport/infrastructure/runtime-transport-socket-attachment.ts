import {
  COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY,
  LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY,
  serviceConnectionDiagnosticIdSchema,
} from "@openmeld/schemas";
import type { RuntimeTransportCapabilities } from "@openmeld/schemas/types";
import { normalizeOptionalText } from "../application/runtime-transport-normalization";

export const RUNTIME_TRANSPORT_VERIFIED_OWNER_HEADER =
  "x-openmeld-internal-daemon-owner-user-id";

// Socket attachments carry identity pointers and one bounded handshake fact.
// Durable session state lives in ServiceRuntime records
// (runtime-transport-runtime-store.ts); putting state payloads here is what
// previously blew the platform's 2KiB attachment limit and silently broke
// hibernation recovery.
export type RuntimeTransportSocketAttachment = {
  connectionDiagnosticId?: string;
  reasoningStream?: boolean;
  computerFileAccessCapability:
    | typeof COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY
    | null;
  localFolderPickerCapability:
    | typeof LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY
    | null;
  verifiedOwnerUserId: string | null;
  daemonSessionId: string | null;
  connectionGeneration: number | null;
};

export const readRuntimeTransportSocketAttachment = (
  webSocket: WebSocket
): RuntimeTransportSocketAttachment => {
  let attachment: {
    connectionDiagnosticId?: unknown;
    reasoningStream?: unknown;
    verifiedOwnerUserId?: unknown;
    computerFileAccessCapability?: unknown;
    localFolderPickerCapability?: unknown;
    daemonSessionId?: unknown;
    connectionGeneration?: unknown;
  };
  try {
    attachment = (webSocket.deserializeAttachment() ?? {}) as {
      connectionDiagnosticId?: unknown;
      reasoningStream?: unknown;
      verifiedOwnerUserId?: unknown;
      computerFileAccessCapability?: unknown;
      localFolderPickerCapability?: unknown;
      daemonSessionId?: unknown;
      connectionGeneration?: unknown;
    };
  } catch (error) {
    console.warn("[core.runtime_transport.socket_attachment.read_failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      computerFileAccessCapability: null,
      localFolderPickerCapability: null,
      verifiedOwnerUserId: null,
      daemonSessionId: null,
      connectionGeneration: null,
    };
  }

  return {
    ...(serviceConnectionDiagnosticIdSchema.safeParse(
      attachment.connectionDiagnosticId
    ).success
      ? { connectionDiagnosticId: String(attachment.connectionDiagnosticId) }
      : {}),
    reasoningStream: attachment.reasoningStream === true,
    computerFileAccessCapability:
      attachment.computerFileAccessCapability ===
      COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY
        ? COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY
        : null,
    localFolderPickerCapability:
      attachment.localFolderPickerCapability ===
      LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY
        ? LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY
        : null,
    verifiedOwnerUserId: normalizeOptionalText(attachment.verifiedOwnerUserId),
    daemonSessionId: normalizeOptionalText(attachment.daemonSessionId),
    connectionGeneration: normalizePositiveInt(attachment.connectionGeneration),
  };
};

export const writeRuntimeTransportSocketAttachment = (
  webSocket: WebSocket,
  input: {
    connectionDiagnosticId?: string;
    reasoningStream?: boolean;
    verifiedOwnerUserId: string;
    computerFileAccessCapability?:
      | typeof COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY
      | null;
    localFolderPickerCapability?:
      | typeof LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY
      | null;
    daemonSessionId?: string | null;
    connectionGeneration?: number | null;
  }
): void => {
  try {
    const current = readRuntimeTransportSocketAttachment(webSocket);
    webSocket.serializeAttachment({
      ...((input.connectionDiagnosticId ?? current.connectionDiagnosticId)
        ? {
            connectionDiagnosticId:
              input.connectionDiagnosticId ?? current.connectionDiagnosticId,
          }
        : {}),
      reasoningStream:
        input.reasoningStream ?? current.reasoningStream ?? false,
      verifiedOwnerUserId: input.verifiedOwnerUserId,
      computerFileAccessCapability:
        input.computerFileAccessCapability === undefined
          ? current.computerFileAccessCapability
          : input.computerFileAccessCapability,
      localFolderPickerCapability:
        input.localFolderPickerCapability === undefined
          ? current.localFolderPickerCapability
          : input.localFolderPickerCapability,
      daemonSessionId: input.daemonSessionId ?? null,
      connectionGeneration: input.connectionGeneration ?? null,
    });
  } catch (error) {
    console.error("[core.runtime_transport.socket_attachment.write_failed]", {
      daemonSessionId: input.daemonSessionId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export function applyRuntimeTransportNegotiatedCapabilities(input: {
  attachment: RuntimeTransportSocketAttachment;
  capabilities: RuntimeTransportCapabilities;
}): RuntimeTransportCapabilities;
export function applyRuntimeTransportNegotiatedCapabilities(input: {
  attachment: RuntimeTransportSocketAttachment;
  capabilities?: RuntimeTransportCapabilities;
}): RuntimeTransportCapabilities | undefined;
export function applyRuntimeTransportNegotiatedCapabilities(input: {
  attachment: RuntimeTransportSocketAttachment;
  capabilities?: RuntimeTransportCapabilities;
}): RuntimeTransportCapabilities | undefined {
  const hasComputerFileAccess =
    input.attachment.computerFileAccessCapability ===
    COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY;
  const hasLocalFolderPicker =
    input.attachment.localFolderPickerCapability ===
    LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY;
  if (!(hasComputerFileAccess || hasLocalFolderPicker)) {
    return input.capabilities;
  }
  return {
    ...(input.capabilities ?? {}),
    ...(hasComputerFileAccess
      ? {
          computerFileAccess: {
            readPolicy: true as const,
            updatePolicy: true as const,
          },
        }
      : {}),
    ...(hasLocalFolderPicker
      ? { localFolderPicker: { selectFolders: true as const } }
      : {}),
  };
}

const normalizePositiveInt = (value: unknown): number | null => {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
};
