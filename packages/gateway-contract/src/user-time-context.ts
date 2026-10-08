import {
  observeUserTimeZone,
  userTimeZoneObservationSchema,
} from "@openmeld/schemas";
import type { UserTimeZoneObservation } from "@openmeld/schemas/types";

export const OPENMELD_HEADER_USER_TIME_ZONE = "x-openmeld-user-time-zone";
export const OPENMELD_HEADER_USER_TIME_ZONE_SOURCE =
  "x-openmeld-user-time-zone-source";

// These headers describe the authenticated caller's environment. They never
// select a user, confer authority, or supply a client clock.
export function readUserTimeZoneObservationHeaders(
  headers: Headers
): UserTimeZoneObservation | null {
  const parsed = userTimeZoneObservationSchema.safeParse({
    timeZone: headers.get(OPENMELD_HEADER_USER_TIME_ZONE),
    source: headers.get(OPENMELD_HEADER_USER_TIME_ZONE_SOURCE),
  });
  return parsed.success ? parsed.data : null;
}

export function buildUserTimeZoneObservationHeaders(
  observation: UserTimeZoneObservation | null
): Record<string, string> {
  return observation
    ? {
        [OPENMELD_HEADER_USER_TIME_ZONE]: observation.timeZone,
        [OPENMELD_HEADER_USER_TIME_ZONE_SOURCE]: observation.source,
      }
    : {};
}

export function observeUserTimeZoneHeaders(
  source: UserTimeZoneObservation["source"]
): Record<string, string> {
  return buildUserTimeZoneObservationHeaders(observeUserTimeZone(source));
}
