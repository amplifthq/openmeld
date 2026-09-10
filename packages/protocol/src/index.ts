// biome-ignore-all lint/performance/noBarrelFile: This package intentionally exposes a single public entrypoint.

export {
  DAEMON_STREAM_KEEPALIVE_PING,
  DAEMON_STREAM_KEEPALIVE_PONG,
  MAX_PROFILE_ID_LENGTH,
  MAX_PROFILE_NAME_LENGTH,
  MAX_TEXT_LENGTH,
  SPACE_STREAM_KEEPALIVE_PING,
  SPACE_STREAM_KEEPALIVE_PONG,
} from "./constants";
export type { MessageLink } from "./message-links";
export {
  collectMessageLinks,
  collectMessagePreviewUrls,
  normalizeMessageLink,
} from "./message-links";
export {
  normalizeProfileId,
  parseEnvelope,
  parseHello,
  parseIncoming,
  parseJsonObject,
  parseProfile,
  parseServerErrorFrame,
  parseSignalText,
  parseSpaceCreator,
} from "./parse";
export type { ProfileDisplayInput } from "./profile-display";
export { buildProfileDisplay } from "./profile-display";
export {
  buildLegacyDefaultMentionAliasCandidates,
  buildProfileHandleBase,
  buildProfileHandleCandidate,
  buildProfileHandleCandidates,
  isLegacyDefaultMentionAlias,
  MAX_MENTION_TOKEN_LENGTH,
  MENTION_TOKEN_REGEX,
  normalizeMentionToken,
  resolveAvailableProfileHandle,
  resolveCustomMentionAliasOverride,
} from "./profile-handle";
export type {
  CoreReadinessFactsChangedMarker,
  Hello,
  HelloAck,
  IncomingClientMessage,
  IncomingServerMessage,
  ParseResult,
  PresenceEnvelope,
  Profile,
  ProfileKind,
  ServerErrorFrame,
  SignalEnvelope,
  SignalStatusData,
  SignalStatusEnvelope,
  SignalSystemNoticeData,
  SignalSystemNoticeEnvelope,
  SignalText,
  SignalTextEnvelope,
  SignalTextReplyTo,
  SpaceAgentStreamDeltaFrame,
  SpaceAgentStreamTerminalFrame,
  SpaceCreator,
  SpaceCursor,
  SpaceLiveInvalidationFrame,
  SpaceLiveSignalFrame,
  SpaceMeta,
  SpaceStorageUsage,
} from "./types";
