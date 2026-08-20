import type { RuntimeTransportLookupOwnerServiceResponse } from "@openmeld/schemas/types";

type OnlineOwnerService = Extract<
  RuntimeTransportLookupOwnerServiceResponse,
  { online: true }
>;

export function selectCurrentOwnerServiceSessionsByDeviceLane(
  ownerService: OnlineOwnerService
): OnlineOwnerService["sessions"] {
  const currentSessions = new Map<
    string,
    OnlineOwnerService["sessions"][number]
  >();
  // Runtime Transport is the session authority and returns sessions in the
  // same freshness order used by RuntimeTransportHub for current-device
  // commands. A repeated device/lane is replacement history, not another
  // capability source.
  for (const session of ownerService.sessions) {
    const key = `${session.deviceId}\u0000${session.lane}`;
    if (!currentSessions.has(key)) {
      currentSessions.set(key, session);
    }
  }
  return [...currentSessions.values()];
}
