export const SPACE_ACCESS_VERSION_HEADER = "x-openmeld-space-access-version";
export const SPACE_ACCESS_VERSION = "1";

/** Older strict readers keep their original metadata/status shape. */
export function projectLegacySpaceAccessView(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const {
    ownerUserIds: _owners,
    allowGuests: _guests,
    ...rest
  } = value as Record<string, unknown>;
  return {
    ...rest,
    ...(rest.meta === undefined
      ? {}
      : { meta: projectLegacySpaceAccessView(rest.meta) }),
    ...(rest.status === undefined
      ? {}
      : { status: projectLegacySpaceAccessView(rest.status) }),
  };
}
