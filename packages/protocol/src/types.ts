export type ProfileKind = import("@openmeld/schemas/types").ProfileKind;

export type Profile = import("@openmeld/schemas/types").Profile;

export type SpaceCreator = import("@openmeld/schemas/types").SpaceCreator;

export type SpaceStorageUsage =
  import("@openmeld/schemas/types").SpaceStorageUsage;

export type SpaceMeta = import("@openmeld/schemas/types").SpaceMeta;

export type CoreReadinessFactsChangedMarker =
  import("@openmeld/schemas/types").CoreReadinessFactsChangedMarker;

export type SpaceCursor = {
  spaceId: string;
  profileId: string;
  /** Unix epoch (ms) timestamp, used for resume cursor tracking. */
  lastSeenTs?: number;
  role?: string;
  mentionAlias?: string;
  /** ISO 8601 timestamp. */
  createdAt?: string;
  /** ISO 8601 timestamp. */
  updatedAt?: string;
};

export type Hello = import("@openmeld/schemas/types").Hello;

export type SignalText = import("@openmeld/schemas/types").SignalText;

export type SignalTextReplyTo =
  import("@openmeld/schemas/types").SignalTextReplyTo;

export type SignalStatusData =
  import("@openmeld/schemas/types").SignalStatusData;
export type SignalSystemNoticeData =
  import("@openmeld/schemas/types").SignalSystemNoticeData;

export type HelloAck = import("@openmeld/schemas/types").HelloAck;

export type ServerErrorFrame =
  import("@openmeld/schemas/types").ServerErrorFrame;

export type IncomingClientMessage = Hello | SignalText;

export type PresenceEnvelope =
  import("@openmeld/schemas/types").PresenceEnvelope;

export type SignalTextEnvelope =
  import("@openmeld/schemas/types").SignalTextEnvelope;

export type SignalStatusEnvelope =
  import("@openmeld/schemas/types").SignalStatusEnvelope;

export type SignalSystemNoticeEnvelope =
  import("@openmeld/schemas/types").SignalSystemNoticeEnvelope;

export type SignalEnvelope = import("@openmeld/schemas/types").SignalEnvelope;

export type IncomingServerMessage =
  import("@openmeld/schemas/types").IncomingServerMessage;

export type SpaceAgentStreamDeltaFrame =
  import("@openmeld/schemas/types").SpaceAgentStreamDeltaFrame;

export type SpaceAgentStreamTerminalFrame =
  import("@openmeld/schemas/types").SpaceAgentStreamTerminalFrame;

export type SpaceLiveSignalFrame =
  import("@openmeld/schemas/types").SpaceLiveSignalFrame;

export type SpaceLiveInvalidationFrame =
  import("@openmeld/schemas/types").SpaceLiveInvalidationFrame;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
