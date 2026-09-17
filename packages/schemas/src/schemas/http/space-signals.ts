import * as z from "zod/v4";
import { signalTextEnvelopeSchema } from "../protocol/envelope";
import { signalTextSchema } from "../protocol/signal";

const signalTextRequestDataSchema = signalTextSchema.shape.data;

export const SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE =
  "space.wake.client_message_id_required";

export const SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_MESSAGE =
  "Wake requests from user-authored signal posts require clientMessageId.";

export const SPACE_SIGNAL_AUTHORING_POLICY_REQUIRED_ERROR_CODE =
  "space.signal_authoring_policy_required";

export const SPACE_AGENT_REPLY_CONTEXT_CHANGED_ERROR_CODE =
  "space.agent_reply.context_changed" as const;

export const SPACE_SIGNAL_AUTHORING_POLICY_REQUIRED_MESSAGE =
  "Signal posts must declare authoringPolicy before clientMessageId policy validation.";

export const spaceSignalAuthoringPolicySchema = z.enum([
  "user_authored",
  "system_emitted",
  "legacy_nullable",
]);

type SpaceSignalClientMessageIdPolicyInput = {
  authoringPolicy: unknown;
  messageEnvelope?: { activationTargets?: readonly unknown[] } | null;
  meta?: { clientMessageId?: unknown } | null;
};

export type SpaceSignalClientMessageIdPolicyResult =
  | {
      ok: true;
      createsWakeDispatch: boolean;
      requiresClientMessageId: boolean;
    }
  | {
      ok: false;
      code: typeof SPACE_SIGNAL_AUTHORING_POLICY_REQUIRED_ERROR_CODE;
      createsWakeDispatch: boolean;
      message: typeof SPACE_SIGNAL_AUTHORING_POLICY_REQUIRED_MESSAGE;
      requiresClientMessageId: false;
    }
  | {
      ok: false;
      code: typeof SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE;
      createsWakeDispatch: true;
      message: typeof SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_MESSAGE;
      requiresClientMessageId: true;
    };

export const hasSpaceSignalWakeActivationTarget = (
  messageEnvelope: SpaceSignalClientMessageIdPolicyInput["messageEnvelope"]
): boolean =>
  (messageEnvelope?.activationTargets ?? []).some(
    (target) => typeof target === "string" && target.trim().length > 0
  );

const hasSpaceSignalClientMessageId = (
  meta: SpaceSignalClientMessageIdPolicyInput["meta"]
): boolean =>
  typeof meta?.clientMessageId === "string" &&
  meta.clientMessageId.trim().length > 0;

export const validateSpaceSignalClientMessageIdPolicy = (
  input: SpaceSignalClientMessageIdPolicyInput
): SpaceSignalClientMessageIdPolicyResult => {
  const createsWakeDispatch = hasSpaceSignalWakeActivationTarget(
    input.messageEnvelope
  );
  const authoringPolicy = spaceSignalAuthoringPolicySchema.safeParse(
    input.authoringPolicy
  );
  if (!authoringPolicy.success) {
    return {
      ok: false,
      code: SPACE_SIGNAL_AUTHORING_POLICY_REQUIRED_ERROR_CODE,
      createsWakeDispatch,
      message: SPACE_SIGNAL_AUTHORING_POLICY_REQUIRED_MESSAGE,
      requiresClientMessageId: false,
    };
  }

  const requiresClientMessageId =
    authoringPolicy.data === "user_authored" && createsWakeDispatch;

  if (requiresClientMessageId && !hasSpaceSignalClientMessageId(input.meta)) {
    return {
      ok: false,
      code: SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE,
      createsWakeDispatch: true,
      message: SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_MESSAGE,
      requiresClientMessageId: true,
    };
  }

  return {
    ok: true,
    createsWakeDispatch,
    requiresClientMessageId,
  };
};

export const postNormalMessageBodySchema = z
  .strictObject({
    text: signalTextRequestDataSchema.shape.text,
    deviceWait: signalTextRequestDataSchema.shape.deviceWait.optional(),
    contextSelection:
      signalTextRequestDataSchema.shape.contextSelection.optional(),
    attachments: signalTextRequestDataSchema.shape.attachments.optional(),
    files: signalTextRequestDataSchema.shape.files.optional(),
    messageEnvelope:
      signalTextRequestDataSchema.shape.messageEnvelope.optional(),
    replyTo: signalTextRequestDataSchema.shape.replyTo.optional(),
    meta: signalTextRequestDataSchema.shape.meta.optional(),
  })
  .superRefine((value, ctx) => {
    const parsed = signalTextRequestDataSchema.safeParse(value);
    if (parsed.success) {
      return;
    }

    const firstIssue = parsed.error.issues[0];
    ctx.addIssue({
      code: "custom",
      path: firstIssue?.path ?? [],
      message: firstIssue?.message ?? "Invalid normal message payload",
    });
  });

export const postNormalMessageResponseSchema = signalTextEnvelopeSchema;
