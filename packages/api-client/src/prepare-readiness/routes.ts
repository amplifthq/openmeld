export function buildPrepareReadinessRoute(deviceId: string): string {
  return `/v1/devices/${encodeURIComponent(deviceId)}/prepare-readiness`;
}
