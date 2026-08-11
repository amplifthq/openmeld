export const SPACE_DISPATCH_HISTORY_STATES = [
  "dispatch_recorded",
  "blocked",
  "retrying",
  "failed",
  "stopped",
  "unknown",
] as const;

export type SpaceDispatchHistoryState =
  (typeof SPACE_DISPATCH_HISTORY_STATES)[number];
