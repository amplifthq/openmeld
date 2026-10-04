import type {
  OpenMeldDaemonAcceptedDispatchSnapshot,
  OpenMeldDaemonDispatchQueueMessage,
} from "@openmeld/schemas/types";
import { readRecordedDelegationRequester } from "../../center-agent/application/recorded-delegation-requester";
import {
  type CoreBindings,
  identityDb,
  wakeEvidenceDb,
} from "../../lib/bindings";
import { readActiveRepresentedHumanSender } from "../../remote-agent/application/turn-envelope";

export async function buildAcceptedDispatchSnapshot(input: {
  env?: CoreBindings;
  targetOwnerUserId?: string;
  message: OpenMeldDaemonDispatchQueueMessage;
  openMeldServiceRuntimeId?: string | null;
  runtimeKind?:
    | "hosted_center_agent"
    | "hosted_remote_agent"
    | "openmeld_service"
    | null;
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
    ...(input.message.organizationId &&
    input.message.sourceSignalSnapshot?.profileId
      ? {
          contextRequest: {
            ...((await isExecutionContextOwnerRequested(input))
              ? { ownerRequested: true as const }
              : {}),
            // Explicit intent must never fall back to a Binding conversation.
            // Core chooses implicit thread isolation only for supported harnesses.
            required: Boolean(input.message.contextSelection),
            scope: {
              organizationId: input.message.organizationId,
              requesterProfileId: input.message.sourceSignalSnapshot.profileId,
              spaceId: input.message.spaceId,
              targetProfileId: input.message.targetProfileId,
              threadId: input.message.threadContext?.threadId ?? null,
            },
            selection: input.message.contextSelection ?? {
              mode: "auto" as const,
            },
          },
        }
      : {}),
    ...(input.message.deviceWait
      ? { deviceWait: input.message.deviceWait }
      : {}),
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

export async function isExecutionContextOwnerRequested(input: {
  env?: CoreBindings;
  targetOwnerUserId?: string;
  message: OpenMeldDaemonDispatchQueueMessage;
}): Promise<boolean> {
  const { env, message, targetOwnerUserId } = input;
  const source = message.sourceSignalSnapshot;
  if (
    !(env && targetOwnerUserId && message.organizationId && source?.profileId)
  ) {
    return false;
  }
  const db = identityDb(env);
  if (!db) {
    return false;
  }
  if (source.profileKind === "human") {
    return Boolean(
      await readActiveRepresentedHumanSender({
        db,
        organizationId: message.organizationId,
        profileId: source.profileId,
        userId: targetOwnerUserId,
      })
    );
  }
  const evidenceDb = wakeEvidenceDb(env);
  if (
    !(
      source.profileKind === "agent" &&
      evidenceDb &&
      message.sourceClientMessageId
    )
  ) {
    return false;
  }
  return Boolean(
    await readRecordedDelegationRequester({
      identityDb: db,
      evidenceDb,
      organizationId: message.organizationId,
      spaceId: message.spaceId,
      sourceClientMessageId: message.sourceClientMessageId,
      sourceProfileId: source.profileId,
      targetProfileId: message.targetProfileId,
      targetOwnerUserId,
    })
  );
}

export function applyAcceptedDispatchSnapshotToMessage(input: {
  message: OpenMeldDaemonDispatchQueueMessage;
  snapshot: OpenMeldDaemonAcceptedDispatchSnapshot;
  executionContext?: OpenMeldDaemonDispatchQueueMessage["executionContext"];
}): OpenMeldDaemonDispatchQueueMessage {
  if (
    !input.executionContext &&
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
    ...(input.executionContext
      ? { executionContext: input.executionContext }
      : {}),
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
    enqueuedAtMs: _enqueuedAtMs,
    outboxCreatedAtMs: _outboxCreatedAtMs,
    sourceProfileNameSnapshot: _sourceProfileNameSnapshot,
    spaceNameSnapshot: _spaceNameSnapshot,
    targetProfileNameSnapshot: _targetProfileNameSnapshot,
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
