type JsonRecord = Record<string, unknown>;

const ORIGIN_FIELD_NAME = "origin";

/**
 * Negotiated-capability compatibility for Space Files responses. `origin`
 * (`"artifact" | "chat_upload" | null`) did not exist on any file descriptor
 * or list response before this contract. Adding it to a shared
 * `z.strictObject()` response breaks an already-published reader that
 * validates with its own frozen (older) schema, which has no concept of the
 * field at all — that reader's `.parse()` throws on the unrecognized key
 * regardless of the field's value, so making it optional or defaulted on the
 * current schema does nothing for an already-published reader's frozen
 * schema.
 *
 * Callers must pass values that have already crossed current schemas. The
 * returned value is for JSON/RPC serialization only and must never be reused
 * as a domain object: `origin` remains canonical on `space_file_entries` and
 * every internal read/write path; this function only controls what an
 * origin-unaware caller receives on the wire. Applying it is conditional on
 * the caller's declared capability (see `SPACE_FILES_ORIGIN_CAPABILITY_TOKEN`
 * and the Gateway/Core RPC negotiation described in the Space Files Origin
 * Classification Contract Impact Audit), not on whether the field happens to
 * be present after schema validation. Remove this projection after the
 * minimum supported Web, CLI, Gateway, Core, and Remote Agent versions all
 * understand `origin` and production history has completed one retention
 * window under the current contract.
 */
export function toLegacySpaceFilesOriginWireValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toLegacySpaceFilesOriginWireValue);
  }
  if (!isJsonRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== ORIGIN_FIELD_NAME)
      .map(([key, nestedValue]) => [
        key,
        toLegacySpaceFilesOriginWireValue(nestedValue),
      ])
  );
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}
