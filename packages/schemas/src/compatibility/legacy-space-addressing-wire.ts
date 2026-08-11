type JsonRecord = Record<string, unknown>;

const MESSAGE_ENVELOPE_WIRE_FIELD_NAMES = new Set([
  "messageEnvelope",
  "sourceMessageEnvelope",
]);

/**
 * Temporary transport-only compatibility for clients released before Space
 * Message Addressing moved to Wake and Reference.
 *
 * Callers must pass values that have already crossed current schemas. The
 * returned value is for JSON serialization only and must never be reused as a
 * domain object. Remove this encoder after the minimum supported Web, CLI,
 * Local Service, Gateway, Core, and Remote Agent versions all understand the
 * two-relation contract and production history has completed one retention
 * window under the current read projection.
 */
export function toLegacySpaceAddressingWireValue(value: unknown): unknown {
  return encodeLegacySpaceAddressingWireValue(value, null);
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
      ...encoded,
      ccTargets: [],
    };
  }
  if (fieldName === "allowedRelations" && isCurrentAllowedRelations(encoded)) {
    return {
      ...encoded,
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
    typeof value.wake === "boolean" && typeof value.reference === "boolean"
  );
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}
