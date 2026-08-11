import { z } from "zod/v4";
import { clientMessageIdSchema } from "./client-message-id";

export const TARGET_WAKE_LIFECYCLE_IDENTITY_MODEL_VERSION =
  "openmeld.target_wake.lifecycle_identity.v1" as const;

const targetWakeLifecycleIdentifierSchema = z.string().trim().min(1).max(512);
const nullableTargetWakeLifecycleIdentifierSchema =
  targetWakeLifecycleIdentifierSchema.nullable();
const targetWakeLifecycleIdSchema = z.string().trim().min(1).max(2048);

export const targetWakeLifecycleIdentitySchema = z
  .strictObject({
    modelVersion: z.literal(TARGET_WAKE_LIFECYCLE_IDENTITY_MODEL_VERSION),
    targetWakeLifecycleId: targetWakeLifecycleIdSchema,
    spaceId: targetWakeLifecycleIdentifierSchema,
    sourceSignalId: targetWakeLifecycleIdentifierSchema,
    clientMessageId: clientMessageIdSchema.nullable(),
    targetProfileId: targetWakeLifecycleIdentifierSchema,
    dispatchId: nullableTargetWakeLifecycleIdentifierSchema,
  })
  .superRefine((value, context) => {
    const expectedTargetWakeLifecycleId = buildTargetWakeLifecycleId({
      spaceId: value.spaceId,
      sourceSignalId: value.sourceSignalId,
      targetProfileId: value.targetProfileId,
    });
    if (value.targetWakeLifecycleId === expectedTargetWakeLifecycleId) {
      return;
    }
    context.addIssue({
      code: "custom",
      message:
        "targetWakeLifecycleId must match spaceId, sourceSignalId, and targetProfileId",
      path: ["targetWakeLifecycleId"],
    });
  });

export type ProjectTargetWakeLifecycleIdentityInput = {
  clientMessageId?: unknown;
  dispatchId?: unknown;
  sourceSignalId: unknown;
  spaceId: unknown;
  targetProfileId: unknown;
};

export function buildTargetWakeLifecycleId(input: {
  sourceSignalId: string;
  spaceId: string;
  targetProfileId: string;
}): string {
  const spaceId = normalizeRequiredTargetWakeLifecycleIdPart(
    "spaceId",
    input.spaceId
  );
  const sourceSignalId = normalizeRequiredTargetWakeLifecycleIdPart(
    "sourceSignalId",
    input.sourceSignalId
  );
  const targetProfileId = normalizeRequiredTargetWakeLifecycleIdPart(
    "targetProfileId",
    input.targetProfileId
  );
  return [
    "twl_v1",
    encodeLengthPrefixedTargetWakeLifecycleIdPart(spaceId),
    encodeLengthPrefixedTargetWakeLifecycleIdPart(sourceSignalId),
    encodeLengthPrefixedTargetWakeLifecycleIdPart(targetProfileId),
  ].join("|");
}

export function projectTargetWakeLifecycleIdentity(
  input: ProjectTargetWakeLifecycleIdentityInput
): z.infer<typeof targetWakeLifecycleIdentitySchema> {
  const spaceId = normalizeRequiredTargetWakeLifecycleIdPart(
    "spaceId",
    input.spaceId
  );
  const sourceSignalId = normalizeRequiredTargetWakeLifecycleIdPart(
    "sourceSignalId",
    input.sourceSignalId
  );
  const targetProfileId = normalizeRequiredTargetWakeLifecycleIdPart(
    "targetProfileId",
    input.targetProfileId
  );
  const clientMessageId = normalizeOptionalClientMessageId(
    input.clientMessageId
  );
  const dispatchId = normalizeOptionalTargetWakeLifecycleIdPart(
    input.dispatchId
  );
  const candidate = {
    modelVersion: TARGET_WAKE_LIFECYCLE_IDENTITY_MODEL_VERSION,
    targetWakeLifecycleId: buildTargetWakeLifecycleId({
      spaceId,
      sourceSignalId,
      targetProfileId,
    }),
    spaceId,
    sourceSignalId,
    clientMessageId,
    targetProfileId,
    dispatchId,
  };
  const parsed = targetWakeLifecycleIdentitySchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error("invalid target Wake lifecycle identity");
  }
  return parsed.data;
}

const encodeLengthPrefixedTargetWakeLifecycleIdPart = (
  value: string
): string => {
  return `${value.length}:${value}`;
};

function normalizeRequiredTargetWakeLifecycleIdPart(
  fieldName: string,
  value: unknown
): string {
  if (typeof value !== "string") {
    throw new Error(
      `target_wake_lifecycle.identity_invalid: ${fieldName} must be a string`
    );
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(
      `target_wake_lifecycle.identity_invalid: ${fieldName} is required`
    );
  }
  return normalized;
}

function normalizeOptionalTargetWakeLifecycleIdPart(
  value: unknown
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(
      "target_wake_lifecycle.identity_invalid: value must be a string"
    );
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalClientMessageId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(
      "target_wake_lifecycle.identity_invalid: clientMessageId must be a string"
    );
  }
  const parsed = clientMessageIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
