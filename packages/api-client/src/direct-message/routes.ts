export function buildDirectMessageSpacePath(): string {
  return "/v1/organizations/current/dm-space";
}

export function buildDirectMessageConversionPath(spaceId: string): string {
  return `/v1/spaces/${encodeURIComponent(spaceId)}/direct-message-conversion`;
}
