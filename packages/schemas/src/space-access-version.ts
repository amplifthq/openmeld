export const SPACE_ACCESS_VERSION_HEADER = "x-openmeld-space-access-version";
export const SPACE_ACCESS_VERSION = "2";

/** Preserve the fields understood by each strict shipped reader. */
export function projectSpaceAccessViewForVersion(
  value: unknown,
  requestedVersion: string | null
): unknown {
  if (requestedVersion === SPACE_ACCESS_VERSION) {
    return value;
  }
  if (requestedVersion === "1") {
    return stripSpaceAccessFields(value, ["linkJoinPolicy"]);
  }
  return projectLegacySpaceAccessView(value);
}

/** Older strict readers keep their original metadata/status shape. */
export function projectLegacySpaceAccessView(value: unknown): unknown {
  return stripSpaceAccessFields(value, [
    "ownerUserIds",
    "allowGuests",
    "linkJoinPolicy",
  ]);
}

function stripSpaceAccessFields(
  value: unknown,
  fields: readonly string[]
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const rest = { ...(value as Record<string, unknown>) };
  for (const field of fields) {
    delete rest[field];
  }
  return {
    ...rest,
    ...(rest.meta === undefined
      ? {}
      : { meta: stripSpaceAccessFields(rest.meta, fields) }),
    ...(rest.status === undefined
      ? {}
      : { status: stripSpaceAccessFields(rest.status, fields) }),
  };
}
