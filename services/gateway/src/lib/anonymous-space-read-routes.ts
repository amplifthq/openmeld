const HEX_SPACE_ID_PATTERN = "[0-9a-fA-F]{64}";
const THREAD_ID_PATTERN = "[^/]+";

const ANONYMOUS_SPACE_READ_ROUTE_PATTERNS: readonly RegExp[] = [
  new RegExp(`^/v1/spaces/(${HEX_SPACE_ID_PATTERN})/link-previews$`, "u"),
  new RegExp(`^/v1/spaces/(${HEX_SPACE_ID_PATTERN})/conversation-state$`, "u"),
  new RegExp(`^/v1/spaces/(${HEX_SPACE_ID_PATTERN})/entry-resolution$`, "u"),
  new RegExp(`^/v1/spaces/(${HEX_SPACE_ID_PATTERN})/status$`, "u"),
  new RegExp(`^/v1/spaces/(${HEX_SPACE_ID_PATTERN})/signals$`, "u"),
  new RegExp(`^/v1/spaces/(${HEX_SPACE_ID_PATTERN})/threads$`, "u"),
  new RegExp(
    `^/v1/spaces/(${HEX_SPACE_ID_PATTERN})/threads/${THREAD_ID_PATTERN}$`,
    "u"
  ),
  new RegExp(
    `^/v1/spaces/(${HEX_SPACE_ID_PATTERN})/threads/${THREAD_ID_PATTERN}/events$`,
    "u"
  ),
  new RegExp(
    `^/v1/spaces/(${HEX_SPACE_ID_PATTERN})/threads/${THREAD_ID_PATTERN}/signals$`,
    "u"
  ),
];

export function parseAnonymousSpaceReadRoute(request: Request): {
  spaceId: string;
} | null {
  if (request.method.toUpperCase() !== "GET") {
    return null;
  }

  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return null;
  }

  for (const pattern of ANONYMOUS_SPACE_READ_ROUTE_PATTERNS) {
    const match = pattern.exec(pathname);
    const spaceId = match?.[1];
    if (spaceId) {
      return { spaceId };
    }
  }

  return null;
}
