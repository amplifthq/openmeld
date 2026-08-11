export const MAX_PROFILE_ID_LENGTH = 64 as const;
// Ceiling for visitedProfileIds entries in an actor context. Wire carriers
// (x-openmeld-visited-profile-ids) size their length bounds from this value, so
// changing it changes the header contract in gateway-contract as well.
export const MAX_VISITED_PROFILE_IDS = 256 as const;
export const MAX_PROFILE_NAME_LENGTH = 64 as const;
export const MAX_TEXT_LENGTH = 100_000 as const;
