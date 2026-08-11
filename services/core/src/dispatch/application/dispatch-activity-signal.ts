import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { emitSpaceTextSignal } from "../../rpc/space-signal-emitter";
import {
  DISPATCH_HINT_SYSTEM_PROFILE_ID,
  DISPATCH_HINT_SYSTEM_PROFILE_NAME,
} from "../rules/dispatch-hint-policy";
import { buildDispatchSystemSpaceAccess } from "./dispatch-space-access";

const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};

export const emitDispatchActivitySignal = async (input: {
  env: CoreBindings;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  errorCode?: string | null;
  purpose: string;
  runtimeDeviceDisplayName?: string | null;
  text: string;
  targetMentionLabel?: string | null;
  targetProfileName?: string | null;
}): Promise<void> => {
  const targetMentionLabel =
    normalizeOptionalText(input.targetMentionLabel) ??
    normalizeOptionalText(input.dispatchMessage.targetProfileMentionLabel);
  const targetProfileName =
    normalizeOptionalText(input.targetProfileName) ??
    normalizeOptionalText(input.dispatchMessage.targetProfileNameSnapshot);
  const runtimeDeviceDisplayName = normalizeOptionalText(
    input.runtimeDeviceDisplayName
  );

  await emitSpaceTextSignal({
    env: input.env,
    spaceId: input.dispatchMessage.spaceId,
    profile: {
      kind: "system",
      profileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
      profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
    },
    text: input.text,
    authoringPolicy: "system_emitted",
    transient: true,
    spaceAccess: buildDispatchSystemSpaceAccess({
      message: input.dispatchMessage,
      requestIdPrefix: "openMeldDaemon-dispatch-activity",
    }),
    meta: {
      transient: true,
      purpose: input.purpose,
      dispatchId: input.dispatchMessage.dispatchId,
      sourceEventId: input.dispatchMessage.sourceEventId,
      ...(input.dispatchMessage.sourceClientMessageId
        ? { sourceClientMessageId: input.dispatchMessage.sourceClientMessageId }
        : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      targetProfileId: input.dispatchMessage.targetProfileId,
      ...(targetMentionLabel ? { targetMentionLabel } : {}),
      ...(targetProfileName ? { targetProfileName } : {}),
      ...(runtimeDeviceDisplayName ? { runtimeDeviceDisplayName } : {}),
    },
  });
};
