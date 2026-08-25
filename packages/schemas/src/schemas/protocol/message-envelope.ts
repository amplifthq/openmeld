import * as z from "zod/v4";
import { navigationActionSchema } from "../../navigation-action";
import { MAX_TEXT_LENGTH } from "./constants";
import { openMeldRuntimeProfileIdSchema } from "./profile";
import { trimmedStringFromUnknown } from "./shared";

const MULTI_SPACE_PATTERN = /\s+/g;
const CANONICAL_MENTION_LITERAL_PATTERN =
  /^@(?<name>.+)\((?<type>wake|reference)\)$/u;
// Keep recognizing the retired `(cc)` suffix at the parsing boundary so
// current clients can reject it with actionable guidance instead of treating
// it as ordinary text. CC is not part of the current relation schema.
const RELATION_TEXT_PATTERN = /\((wake|reference|cc)\)/gu;
const WORD_CHARACTER_PATTERN = /\w/u;

export const SPACE_MESSAGE_ADDRESSING_RELATION_VALUES = [
  "wake",
  "reference",
] as const;
export const MESSAGE_MENTION_TYPE_VALUES =
  SPACE_MESSAGE_ADDRESSING_RELATION_VALUES;

export const MESSAGE_ENVELOPE_TARGET_FIELD_VALUES = [
  "activationTargets",
  "referenceTargets",
] as const;
export const SPACE_MESSAGE_ADDRESSING_TARGET_FIELD_VALUES =
  MESSAGE_ENVELOPE_TARGET_FIELD_VALUES;
export const SPACE_MESSAGE_ADDRESSING_TARGET_KIND_VALUES = [
  "human_profile",
  "agent_profile",
] as const;

export const spaceMessageAddressingRelationSchema = z.enum(
  SPACE_MESSAGE_ADDRESSING_RELATION_VALUES
);
export const messageMentionTypeSchema = spaceMessageAddressingRelationSchema;

export const messageEnvelopeTargetFieldSchema = z.enum(
  MESSAGE_ENVELOPE_TARGET_FIELD_VALUES
);
export const spaceMessageAddressingTargetKindSchema = z.enum(
  SPACE_MESSAGE_ADDRESSING_TARGET_KIND_VALUES
);

const MESSAGE_ENVELOPE_TARGET_FIELD_BY_MENTION_TYPE = {
  wake: "activationTargets",
  reference: "referenceTargets",
} as const;

type SpaceMessageAddressingRelation = z.infer<
  typeof spaceMessageAddressingRelationSchema
>;
type SpaceMessageAddressingTargetKind = z.infer<
  typeof spaceMessageAddressingTargetKindSchema
>;

const SPACE_MESSAGE_ADDRESSING_TARGET_KIND_SUPPORT_BY_RELATION = {
  wake: ["agent_profile"],
  reference: ["human_profile", "agent_profile"],
} as const satisfies Record<
  SpaceMessageAddressingRelation,
  readonly SpaceMessageAddressingTargetKind[]
>;

const normalizeCanonicalMentionName = (value: unknown): string | undefined => {
  const normalized = trimmedStringFromUnknown(value)
    .replace(MULTI_SPACE_PATTERN, " ")
    .trim();
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized;
};

const canonicalMentionNameSchema = z.preprocess(
  normalizeCanonicalMentionName,
  z
    .string()
    .min(1)
    .refine(
      (value) => !(value.includes("(") || value.includes(")")),
      "Canonical mention name must not contain parentheses"
    )
);

export const canonicalMentionLiteralSchema = z.strictObject({
  name: canonicalMentionNameSchema,
  type: messageMentionTypeSchema,
});

export const canonicalMentionTextFragmentSchema = z.strictObject({
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  text: z.string().min(1),
  parsedLiteral: canonicalMentionLiteralSchema.nullable(),
});

type MessageEnvelopeTargetField = z.infer<
  typeof messageEnvelopeTargetFieldSchema
>;
type CanonicalMentionLiteral = z.infer<typeof canonicalMentionLiteralSchema>;
type CanonicalMentionTextFragment = z.infer<
  typeof canonicalMentionTextFragmentSchema
>;

const buildTargetListSchema = (fieldName: MessageEnvelopeTargetField) =>
  z.array(openMeldRuntimeProfileIdSchema).superRefine((targets, context) => {
    const seenTargets = new Set<string>();
    for (const [index, targetProfileId] of targets.entries()) {
      if (seenTargets.has(targetProfileId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${fieldName} must not contain duplicate profileId`,
          path: [index],
        });
        continue;
      }
      seenTargets.add(targetProfileId);
    }
  });

const activationTargetsSchema = buildTargetListSchema("activationTargets");
const referenceTargetsSchema = buildTargetListSchema("referenceTargets");

const replyToSignalIdSchema = z.preprocess(
  trimmedStringFromUnknown,
  z.string().min(1)
);

const validateDistinctTargetLists = (
  input: {
    activationTargets: string[];
    referenceTargets: string[];
  },
  context: z.RefinementCtx
) => {
  const seenByTarget = new Map<string, MessageEnvelopeTargetField>();

  for (const fieldName of MESSAGE_ENVELOPE_TARGET_FIELD_VALUES) {
    for (const targetProfileId of input[fieldName]) {
      const existingField = seenByTarget.get(targetProfileId);
      if (!existingField) {
        seenByTarget.set(targetProfileId, fieldName);
        continue;
      }

      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${fieldName} must not reuse profileId from ${existingField}`,
        path: [fieldName],
      });
    }
  }
};

const currentMessageEnvelopeSchema = z
  .strictObject({
    activationTargets: activationTargetsSchema,
    referenceTargets: referenceTargetsSchema,
    navigationAction: navigationActionSchema.optional(),
    replyToSignalId: replyToSignalIdSchema.optional(),
    text: z.preprocess(
      trimmedStringFromUnknown,
      z.string().min(1).max(MAX_TEXT_LENGTH)
    ),
  })
  .superRefine(validateDistinctTargetLists);

const currentMessageEnvelopeInputSchema = z
  .strictObject({
    activationTargets: activationTargetsSchema.optional(),
    referenceTargets: referenceTargetsSchema.optional(),
    navigationAction: navigationActionSchema.optional(),
    replyToSignalId: replyToSignalIdSchema.optional(),
    text: z.preprocess(
      trimmedStringFromUnknown,
      z.string().min(1).max(MAX_TEXT_LENGTH)
    ),
  })
  .superRefine((value, context) =>
    validateDistinctTargetLists(
      {
        activationTargets: value.activationTargets ?? [],
        referenceTargets: value.referenceTargets ?? [],
      },
      context
    )
  );

/**
 * Time-bounded compatibility boundary for deployed clients and persisted
 * signals authored before CC was removed. A valid legacy `ccTargets` list is
 * folded into Reference before the value enters the current domain model.
 *
 * Removal condition: the minimum supported Web, CLI, Local Service, Gateway,
 * Core, and Remote Agent versions all author and consume the two-relation
 * envelope, and production history has been durably migrated or retained
 * behind a dedicated historical decoder.
 */
const normalizeLegacyCcTargetsAsReference = (value: unknown): unknown => {
  if (!(value && typeof value === "object") || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (!Object.hasOwn(record, "ccTargets")) {
    return value;
  }

  const legacyCcTargets = record.ccTargets;
  const referenceTargets = record.referenceTargets;
  if (
    !Array.isArray(legacyCcTargets) ||
    (referenceTargets !== undefined && !Array.isArray(referenceTargets))
  ) {
    return value;
  }

  const { ccTargets: _legacyCcTargets, ...currentFields } = record;
  return {
    ...currentFields,
    referenceTargets: [
      ...(Array.isArray(referenceTargets) ? referenceTargets : []),
      ...legacyCcTargets,
    ],
  };
};

export const messageEnvelopeSchema = z.preprocess(
  normalizeLegacyCcTargetsAsReference,
  currentMessageEnvelopeSchema
);

export const messageEnvelopeInputSchema = z.preprocess(
  normalizeLegacyCcTargetsAsReference,
  currentMessageEnvelopeInputSchema
);

export const normalizeMessageEnvelope = (value: unknown) => {
  const parsed = messageEnvelopeInputSchema.safeParse(value);
  if (!parsed.success) {
    throw parsed.error;
  }

  const normalized = {
    activationTargets: parsed.data.activationTargets ?? [],
    referenceTargets: parsed.data.referenceTargets ?? [],
    ...(parsed.data.navigationAction
      ? { navigationAction: parsed.data.navigationAction }
      : {}),
    text: parsed.data.text,
    ...(parsed.data.replyToSignalId
      ? { replyToSignalId: parsed.data.replyToSignalId }
      : {}),
  };

  const canonical = messageEnvelopeSchema.safeParse(normalized);
  if (!canonical.success) {
    throw canonical.error;
  }

  return canonical.data;
};

export const parseCanonicalMentionLiteral = (
  value: unknown
): CanonicalMentionLiteral | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const match = trimmed.match(CANONICAL_MENTION_LITERAL_PATTERN);
  if (!match?.groups) {
    return null;
  }

  const name = match.groups.name;
  const type = match.groups.type;
  if (typeof name !== "string" || typeof type !== "string") {
    return null;
  }

  if (name.trim() !== name) {
    return null;
  }

  const parsed = canonicalMentionLiteralSchema.safeParse({
    name,
    type,
  });
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
};

export const formatCanonicalMentionLiteral = (
  value: z.input<typeof canonicalMentionLiteralSchema>
): string => {
  const parsed = canonicalMentionLiteralSchema.safeParse(value);
  if (!parsed.success) {
    throw parsed.error;
  }
  return `@${parsed.data.name}(${parsed.data.type})`;
};

export const collectCanonicalMentionTextFragments = (
  value: unknown
): CanonicalMentionTextFragment[] => {
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }

  const fragments: CanonicalMentionTextFragment[] = [];

  let cursor = 0;
  while (cursor < value.length) {
    const atIndex = value.indexOf("@", cursor);
    if (atIndex < 0) {
      break;
    }

    if (shouldSkipCanonicalMentionAt(value, atIndex)) {
      cursor = atIndex + 1;
      continue;
    }

    const lineEndIndex = value.indexOf("\n", atIndex);
    const nextAtIndex = value.indexOf("@", atIndex + 1);
    const searchEnd = Math.min(
      lineEndIndex < 0 ? value.length : lineEndIndex,
      nextAtIndex < 0 ? value.length : nextAtIndex
    );
    const lineFragment = value.slice(atIndex, searchEnd);
    const relationEndOffset = findCanonicalMentionRelationEnd(lineFragment);
    if (relationEndOffset === null) {
      cursor = atIndex + 1;
      continue;
    }

    const rawMentionText = lineFragment.slice(0, relationEndOffset);
    const leadingTrimmedLength =
      rawMentionText.length - rawMentionText.trimStart().length;
    const mentionText = rawMentionText.trim();
    if (!mentionText) {
      cursor = atIndex + Math.max(1, relationEndOffset);
      continue;
    }

    const start = atIndex + leadingTrimmedLength;
    const end = start + mentionText.length;
    const fragment = canonicalMentionTextFragmentSchema.safeParse({
      start,
      end,
      text: mentionText,
      parsedLiteral: parseCanonicalMentionLiteral(mentionText),
    });
    if (!fragment.success) {
      throw fragment.error;
    }

    fragments.push(fragment.data);
    cursor = atIndex + relationEndOffset;
  }

  return fragments;
};

function shouldSkipCanonicalMentionAt(value: string, atIndex: number): boolean {
  const previous = atIndex > 0 ? (value[atIndex - 1] ?? "") : "";
  return previous === "\\" || WORD_CHARACTER_PATTERN.test(previous);
}

// A canonical mention fragment ends at an explicit current relation, or at the
// retired `(cc)` suffix so the caller can reject it explicitly. We intentionally
// do NOT treat an arbitrary same-line "()" as a mention boundary: technical
// messages like `@scope/pkg.foo(arg)`, `@org/pkg in src/foo(bar).ts`, or `@user
// check getConfig()` must stay plain text instead of being swallowed into a
// malformed mention fragment.
function findCanonicalMentionRelationEnd(value: string): number | null {
  RELATION_TEXT_PATTERN.lastIndex = 0;
  const relationMatch = RELATION_TEXT_PATTERN.exec(value);
  if (relationMatch?.index !== undefined) {
    return relationMatch.index + relationMatch[0].length;
  }
  return null;
}

export const resolveMessageEnvelopeTargetField = (
  value: z.input<typeof messageMentionTypeSchema>
): MessageEnvelopeTargetField => {
  const parsed = messageMentionTypeSchema.safeParse(value);
  if (!parsed.success) {
    throw parsed.error;
  }
  return MESSAGE_ENVELOPE_TARGET_FIELD_BY_MENTION_TYPE[parsed.data];
};

export const resolveSpaceMessageAddressingTargetField = (
  value: z.input<typeof spaceMessageAddressingRelationSchema>
): MessageEnvelopeTargetField => {
  const parsed = spaceMessageAddressingRelationSchema.safeParse(value);
  if (!parsed.success) {
    throw parsed.error;
  }
  return MESSAGE_ENVELOPE_TARGET_FIELD_BY_MENTION_TYPE[parsed.data];
};

export const isSpaceMessageAddressingRelationSupportedForTargetKind = (input: {
  relation: z.input<typeof spaceMessageAddressingRelationSchema>;
  targetKind: z.input<typeof spaceMessageAddressingTargetKindSchema>;
}): boolean => {
  const relation = spaceMessageAddressingRelationSchema.safeParse(
    input.relation
  );
  if (!relation.success) {
    throw relation.error;
  }

  const targetKind = spaceMessageAddressingTargetKindSchema.safeParse(
    input.targetKind
  );
  if (!targetKind.success) {
    throw targetKind.error;
  }

  const supportedTargetKinds: readonly SpaceMessageAddressingTargetKind[] =
    SPACE_MESSAGE_ADDRESSING_TARGET_KIND_SUPPORT_BY_RELATION[relation.data];
  return supportedTargetKinds.includes(targetKind.data);
};

export const getSpaceMessageAddressingRelationSupportForTargetKind = (
  value: z.input<typeof spaceMessageAddressingTargetKindSchema>
): Record<SpaceMessageAddressingRelation, boolean> => {
  const targetKind = spaceMessageAddressingTargetKindSchema.safeParse(value);
  if (!targetKind.success) {
    throw targetKind.error;
  }

  return {
    wake: isSpaceMessageAddressingRelationSupportedForTargetKind({
      relation: "wake",
      targetKind: targetKind.data,
    }),
    reference: isSpaceMessageAddressingRelationSupportedForTargetKind({
      relation: "reference",
      targetKind: targetKind.data,
    }),
  };
};
