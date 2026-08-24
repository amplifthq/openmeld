import {
  normalizeMessageEnvelope,
  openMeldSpaceActionSchema,
  openMeldSpaceEgressActionSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldSpaceAction,
  OpenMeldSpaceEgressAction,
} from "@openmeld/schemas/types";

export function normalizeOpenMeldSpaceAction(
  input: unknown
): OpenMeldSpaceAction {
  const parsed = openMeldSpaceActionSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(
    parsed.error.issues[0]?.message ?? "OpenMeld Space Action is invalid"
  );
}

export function normalizeOpenMeldSpaceEgressAction(
  input: unknown
): OpenMeldSpaceEgressAction {
  const parsed = openMeldSpaceEgressActionSchema.safeParse(
    shouldSkipSharedPostMessageNormalization(input)
      ? input
      : normalizeOpenMeldSpaceEgressActionInput(input)
  );
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(
    parsed.error.issues[0]?.message ?? "OpenMeld Space egress action is invalid"
  );
}

function normalizeOpenMeldSpaceEgressActionInput(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }

  const action = { ...input };
  switch (action.type) {
    case "post_message":
      return normalizePostMessageEgressActionInput(action);
    case "post_status":
      return normalizePostStatusEgressActionInput(action);
    case "stay_silent":
      return normalizeStaySilentEgressActionInput(action);
    default:
      return action;
  }
}

function shouldSkipSharedPostMessageNormalization(input: unknown): boolean {
  if (!isRecord(input)) {
    return false;
  }
  return (
    input.type === "post_message" &&
    !(input.messageEnvelope && typeof input.messageEnvelope === "object")
  );
}

function normalizePostMessageEgressActionInput(
  action: Record<string, unknown>
): Record<string, unknown> {
  const { message, messageEnvelope, replyTo, text, ...rest } = action;
  if (isRecord(messageEnvelope)) {
    return {
      ...rest,
      messageEnvelope: normalizeMessageEnvelope(messageEnvelope),
    };
  }

  const rawText = resolveLegacyPostMessageText({ message, text });
  if (rawText === undefined) {
    return rest;
  }

  const rawReplyToSignalId =
    isRecord(replyTo) && typeof replyTo.signalId === "string"
      ? replyTo.signalId
      : undefined;
  return {
    ...rest,
    messageEnvelope: normalizeMessageEnvelope({
      ...(rawReplyToSignalId ? { replyToSignalId: rawReplyToSignalId } : {}),
      text: rawText,
    }),
  };
}

function resolveLegacyPostMessageText(input: {
  message: unknown;
  text: unknown;
}): string | undefined {
  if (typeof input.text === "string") {
    return input.text;
  }
  return typeof input.message === "string" ? input.message : undefined;
}

function normalizePostStatusEgressActionInput(
  action: Record<string, unknown>
): Record<string, unknown> {
  const { note, ...rest } = action;
  if (typeof rest.text !== "string" && typeof note === "string") {
    return { ...rest, text: note.trim() };
  }
  return rest;
}

function normalizeStaySilentEgressActionInput(
  action: Record<string, unknown>
): Record<string, unknown> {
  const { note, ...rest } = action;
  if (typeof rest.reason !== "string" && typeof note === "string") {
    return { ...rest, reason: note.trim() };
  }
  return rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
