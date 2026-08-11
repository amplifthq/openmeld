import {
  resultArchivePolicySchema,
  spaceAllowedActionsSchema,
  spaceAuthorityOrderSchema,
  spaceBriefModeSchema,
  spaceContractFieldsSchema,
  spaceDispatchPolicySchema,
  spaceNoteSchema,
  spacePublicationModeSchema,
} from "@openmeld/schemas";
import type { PutSpaceContractBody } from "@openmeld/schemas/types";
import {
  canonicalizeAllowedActions,
  DEFAULT_SPACE_CONTRACT_FIELDS,
} from "@openmeld/space-mesh";

export type NormalizedPersistedSpaceContractFields = {
  fields: PutSpaceContractBody;
  needsRewrite: boolean;
};

type LegacyDefaultReplyBehavior = "mirror_raw" | "system_status" | "silent";
type LegacyReplyPolicy = {
  defaultReplyBehavior: LegacyDefaultReplyBehavior;
  agentCanPostMessages: boolean;
};

const LEGACY_ALLOWED_KEYS = new Set([
  "dispatchPolicy",
  "publicationMode",
  "allowedActions",
  "resultArchivePolicy",
  "spaceNote",
  "authorityOrder",
  "entryBrief",
  "dispatchBrief",
  "replyPolicy",
]);

export function normalizePersistedSpaceContractFields(
  value: unknown
): NormalizedPersistedSpaceContractFields {
  const current = spaceContractFieldsSchema.safeParse(value);
  if (current.success) {
    const allowedActions = canonicalizeAllowedActions(
      current.data.allowedActions
    );
    return {
      fields: {
        ...current.data,
        allowedActions,
      },
      needsRewrite: !areSameActionOrder(
        current.data.allowedActions,
        allowedActions
      ),
    };
  }

  const legacy = parseLegacySpaceContractFields(value);
  if (!legacy) {
    throw new Error("space contract fields are invalid");
  }

  const replyPolicy = legacy.replyPolicy;
  return {
    fields: {
      dispatchPolicy:
        legacy.dispatchPolicy ?? DEFAULT_SPACE_CONTRACT_FIELDS.dispatchPolicy,
      publicationMode:
        legacy.publicationMode ??
        resolveLegacyPublicationMode(replyPolicy?.defaultReplyBehavior),
      allowedActions: canonicalizeAllowedActions(
        legacy.allowedActions ??
          resolveLegacyAllowedActions({
            defaultReplyBehavior: replyPolicy?.defaultReplyBehavior,
            agentCanPostMessages: replyPolicy?.agentCanPostMessages,
          })
      ),
      resultArchivePolicy:
        legacy.resultArchivePolicy ??
        DEFAULT_SPACE_CONTRACT_FIELDS.resultArchivePolicy,
      ...(legacy.spaceNote === undefined
        ? {}
        : { spaceNote: legacy.spaceNote }),
      authorityOrder:
        legacy.authorityOrder ?? DEFAULT_SPACE_CONTRACT_FIELDS.authorityOrder,
      entryBrief: legacy.entryBrief ?? DEFAULT_SPACE_CONTRACT_FIELDS.entryBrief,
      dispatchBrief:
        legacy.dispatchBrief ?? DEFAULT_SPACE_CONTRACT_FIELDS.dispatchBrief,
    },
    needsRewrite: true,
  };
}

function resolveLegacyPublicationMode(
  defaultReplyBehavior: LegacyDefaultReplyBehavior | undefined
): PutSpaceContractBody["publicationMode"] {
  if (defaultReplyBehavior === "mirror_raw") {
    return "raw_context_sharing";
  }
  return DEFAULT_SPACE_CONTRACT_FIELDS.publicationMode;
}

function resolveLegacyAllowedActions(input: {
  defaultReplyBehavior: LegacyDefaultReplyBehavior | undefined;
  agentCanPostMessages: boolean | undefined;
}): PutSpaceContractBody["allowedActions"] {
  if (input.agentCanPostMessages === true) {
    return DEFAULT_SPACE_CONTRACT_FIELDS.allowedActions;
  }
  if (input.defaultReplyBehavior === "system_status") {
    return ["post_status", "stay_silent"];
  }
  return ["stay_silent"];
}

function areSameActionOrder(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function parseLegacySpaceContractFields(
  value: unknown
):
  | (Partial<PutSpaceContractBody> & { replyPolicy?: LegacyReplyPolicy })
  | null {
  if (!isRecord(value)) {
    return null;
  }
  if (!hasOnlyLegacyAllowedKeys(value)) {
    return null;
  }

  const parsedFields = parseLegacyCoreFields(value);
  const replyPolicy = parseLegacyReplyPolicy(value.replyPolicy);
  if (hasInvalidLegacyFieldValues(value, parsedFields, replyPolicy)) {
    return null;
  }

  return {
    ...parsedFields,
    ...(replyPolicy ? { replyPolicy } : {}),
  };
}

function hasOnlyLegacyAllowedKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => LEGACY_ALLOWED_KEYS.has(key));
}

function parseLegacyCoreFields(
  value: Record<string, unknown>
): Partial<PutSpaceContractBody> {
  return {
    ...withParsedOptionalField(
      "dispatchPolicy",
      value.dispatchPolicy,
      spaceDispatchPolicySchema
    ),
    ...withParsedOptionalField(
      "publicationMode",
      value.publicationMode,
      spacePublicationModeSchema
    ),
    ...withParsedOptionalField(
      "allowedActions",
      value.allowedActions,
      spaceAllowedActionsSchema
    ),
    ...withParsedOptionalField(
      "resultArchivePolicy",
      value.resultArchivePolicy,
      resultArchivePolicySchema
    ),
    ...withParsedOptionalField("spaceNote", value.spaceNote, spaceNoteSchema),
    ...withParsedOptionalField(
      "authorityOrder",
      value.authorityOrder,
      spaceAuthorityOrderSchema
    ),
    ...withParsedOptionalField(
      "entryBrief",
      value.entryBrief,
      spaceBriefModeSchema
    ),
    ...withParsedOptionalField(
      "dispatchBrief",
      value.dispatchBrief,
      spaceBriefModeSchema
    ),
  };
}

function hasInvalidLegacyFieldValues(
  value: Record<string, unknown>,
  parsedFields: Partial<PutSpaceContractBody>,
  replyPolicy: LegacyReplyPolicy | undefined
): boolean {
  return (
    hasMissingParsedField(value, parsedFields, "dispatchPolicy") ||
    hasMissingParsedField(value, parsedFields, "publicationMode") ||
    hasMissingParsedField(value, parsedFields, "allowedActions") ||
    hasMissingParsedField(value, parsedFields, "resultArchivePolicy") ||
    hasMissingParsedField(value, parsedFields, "spaceNote") ||
    hasMissingParsedField(value, parsedFields, "authorityOrder") ||
    hasMissingParsedField(value, parsedFields, "entryBrief") ||
    hasMissingParsedField(value, parsedFields, "dispatchBrief") ||
    (value.replyPolicy !== undefined && replyPolicy === undefined)
  );
}

function hasMissingParsedField(
  rawValue: Record<string, unknown>,
  parsedFields: Partial<PutSpaceContractBody>,
  field: keyof PutSpaceContractBody
): boolean {
  return rawValue[field] !== undefined && parsedFields[field] === undefined;
}

function withParsedOptionalField<T, K extends keyof PutSpaceContractBody>(
  key: K,
  value: unknown,
  schema: {
    safeParse: (
      input: unknown
    ) => { success: true; data: T } | { success: false };
  }
): Partial<Record<K, T>> {
  const parsed = parseOptionalField(value, schema);
  if (parsed === undefined) {
    return {};
  }
  return { [key]: parsed } as Partial<Record<K, T>>;
}

function parseLegacyReplyPolicy(value: unknown): LegacyReplyPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const defaultReplyBehavior = value.defaultReplyBehavior;
  const agentCanPostMessages = value.agentCanPostMessages;
  if (
    defaultReplyBehavior !== "mirror_raw" &&
    defaultReplyBehavior !== "system_status" &&
    defaultReplyBehavior !== "silent"
  ) {
    return undefined;
  }
  if (typeof agentCanPostMessages !== "boolean") {
    return undefined;
  }
  return {
    defaultReplyBehavior,
    agentCanPostMessages,
  };
}

function parseOptionalField<T>(
  value: unknown,
  schema: {
    safeParse: (
      input: unknown
    ) => { success: true; data: T } | { success: false };
  }
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
