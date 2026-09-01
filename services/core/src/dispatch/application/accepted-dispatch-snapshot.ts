import type {
  OpenMeldDaemonAcceptedDispatchSnapshot,
  OpenMeldDaemonDispatchQueueMessage,
} from "@openmeld/schemas/types";

export async function buildAcceptedDispatchSnapshot(input: {
  message: OpenMeldDaemonDispatchQueueMessage;
  openMeldServiceRuntimeId?: string | null;
  runtimeKind?: "hosted_center_agent" | "openmeld_service" | null;
}): Promise<OpenMeldDaemonAcceptedDispatchSnapshot | null> {
  const controllerSnapshot = input.message.controllerSnapshot;
  if (
    !(
      controllerSnapshot.bindingId &&
      controllerSnapshot.configurationRevision &&
      input.openMeldServiceRuntimeId
    ) ||
    input.runtimeKind !== "openmeld_service" ||
    controllerSnapshot.targetBindingState !== "bound" ||
    controllerSnapshot.targetBindingEnabled !== true ||
    !controllerSnapshot.agentControllerRef
  ) {
    return null;
  }
  return {
    controllerSnapshot: {
      bindingId: controllerSnapshot.bindingId,
      configurationRevision: controllerSnapshot.configurationRevision,
      targetBindingState: controllerSnapshot.targetBindingState,
      targetBindingEnabled: controllerSnapshot.targetBindingEnabled,
      agentControllerRef: controllerSnapshot.agentControllerRef,
    },
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
    payloadFingerprint: await fingerprintAcceptedDispatchPayload(input.message),
    runtimeKind: input.runtimeKind,
  };
}

export function applyAcceptedDispatchSnapshotToMessage(input: {
  message: OpenMeldDaemonDispatchQueueMessage;
  snapshot: OpenMeldDaemonAcceptedDispatchSnapshot;
}): OpenMeldDaemonDispatchQueueMessage {
  if (
    input.message.controllerSnapshot === input.snapshot.controllerSnapshot &&
    input.message.dispatchSnapshot.targetBindingState ===
      input.snapshot.controllerSnapshot.targetBindingState &&
    input.message.dispatchSnapshot.targetBindingEnabled ===
      input.snapshot.controllerSnapshot.targetBindingEnabled
  ) {
    return input.message;
  }
  return {
    ...input.message,
    controllerSnapshot: input.snapshot.controllerSnapshot,
    dispatchSnapshot: {
      ...input.message.dispatchSnapshot,
      targetBindingEnabled:
        input.snapshot.controllerSnapshot.targetBindingEnabled,
      targetBindingState: input.snapshot.controllerSnapshot.targetBindingState,
    },
  };
}

async function fingerprintAcceptedDispatchPayload(
  message: OpenMeldDaemonDispatchQueueMessage
): Promise<`sha256:${string}`> {
  const {
    controllerSnapshot: _controllerSnapshot,
    deliveryRecoveryReason: _deliveryRecoveryReason,
    dispatchSnapshot,
    ...immutableMessage
  } = message;
  const {
    targetBindingEnabled: _targetBindingEnabled,
    targetBindingState: _targetBindingState,
    ...immutableDispatchSnapshot
  } = dispatchSnapshot;
  const encoded = new TextEncoder().encode(
    stableJson({
      ...immutableMessage,
      dispatchSnapshot: immutableDispatchSnapshot,
    })
  );
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}
