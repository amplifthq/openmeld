type JsonRecord = Record<string, unknown>;

const MESSAGE_ENVELOPE_WIRE_FIELD_NAMES = new Set([
  "messageEnvelope",
  "sourceMessageEnvelope",
]);

/**
 * Temporary transport-only compatibility for clients released before Space
 * Message Addressing moved from CC to explicit Wake, Reference, and Mention.
 *
 * Callers must pass values that have already crossed current schemas. The
 * returned value is for JSON serialization only and must never be reused as a
 * domain object. Remove this encoder after the minimum supported Web, CLI,
 * Local Service, Gateway, Core, and Remote Agent versions all understand the
 * current addressing contract and production history has completed one retention
 * window under the current read projection.
 */
export function toLegacySpaceAddressingWireValue(value: unknown): unknown {
  return encodeLegacySpaceAddressingWireValue(value, null);
}

/**
 * Keeps Human Mention requests current while retaining the old request shape
 * for messages that do not use the new relation.
 */
export function toCompatibleSpaceAddressingRequestWireValue(
  value: unknown
): unknown {
  return containsHumanMentionTarget(value)
    ? value
    : toLegacySpaceAddressingWireValue(value);
}

function containsHumanMentionTarget(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsHumanMentionTarget);
  }
  if (!isJsonRecord(value)) {
    return false;
  }
  if (Array.isArray(value.mentionTargets) && value.mentionTargets.length > 0) {
    return true;
  }
  return Object.values(value).some(containsHumanMentionTarget);
}

function encodeLegacySpaceAddressingWireValue(
  value: unknown,
  fieldName: string | null
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      encodeLegacySpaceAddressingWireValue(item, fieldName)
    );
  }
  if (!isJsonRecord(value)) {
    return value;
  }

  const encoded = Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      encodeLegacySpaceAddressingWireValue(nestedValue, key),
    ])
  );

  if (
    (fieldName === null ||
      (fieldName !== null &&
        MESSAGE_ENVELOPE_WIRE_FIELD_NAMES.has(fieldName))) &&
    isCurrentMessageEnvelope(encoded)
  ) {
    return {
      ...omitJsonField(encoded, "mentionTargets"),
      ccTargets: [],
    };
  }
  if (fieldName === "allowedRelations" && isCurrentAllowedRelations(encoded)) {
    return {
      ...omitJsonField(encoded, "mention"),
      cc: false,
    };
  }
  return encoded;
}

function isCurrentMessageEnvelope(value: JsonRecord): boolean {
  return (
    typeof value.text === "string" &&
    Array.isArray(value.activationTargets) &&
    Array.isArray(value.referenceTargets)
  );
}

function isCurrentAllowedRelations(value: JsonRecord): boolean {
  return (
    typeof value.wake === "boolean" &&
    typeof value.reference === "boolean" &&
    typeof value.mention === "boolean"
  );
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function omitJsonField(value: JsonRecord, fieldName: string): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== fieldName)
  );
}
