import type {
  Hello,
  Profile,
  SignalEnvelope,
  SpaceLiveInvalidationFrame,
  SpaceLiveSignalFrame,
} from "@openmeld/protocol";
import { normalizeSpacePasswordText } from "@openmeld/schemas";
import type {
  SpaceAgentStreamDeltaFrame,
  SpaceAgentStreamPartFrame,
  SpaceAgentStreamTerminalFrame,
} from "@openmeld/schemas/types";

export type SpaceQueuedWebSocketMessage =
  | string
  | SignalEnvelope
  | SpaceLiveSignalFrame
  | SpaceLiveInvalidationFrame
  | SpaceAgentStreamDeltaFrame
  | SpaceAgentStreamPartFrame
  | SpaceAgentStreamTerminalFrame;

export type SpaceWebSocketSession = {
  viewerDeletedThroughPosition?: number;
  callerPrincipalId?: string;
  supportsAgentWorkOutcomes?: boolean;
  supportsAgentReplyPlacement?: boolean;
  profile?: Profile;
  enforcedProfile?: Profile;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  spacePassword?: string;
  blocked?: SpaceQueuedWebSocketMessage[];
  quit?: boolean;
  helloAccepted: boolean;
  supportsLiveSignalHistory: boolean;
  supportsSpaceMessageAddressing: boolean;
  supportsSpaceImageGeometry?: boolean;
};

type SpaceWebSocketSessionAttachment = {
  callerPrincipalId?: string;
  supportsAgentWorkOutcomes?: boolean;
  supportsAgentReplyPlacement?: boolean;
  profile?: Profile;
  enforcedProfile?: Profile;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  spacePassword?: string;
  helloAccepted?: boolean;
  supportsLiveSignalHistory?: boolean;
  supportsSpaceMessageAddressing?: boolean;
  supportsSpaceImageGeometry?: boolean;
};

export function createPendingSpaceWebSocketSession(input: {
  callerPrincipalId?: string;
  enforcedProfile?: Profile;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  spacePassword?: string;
  blocked?: SpaceQueuedWebSocketMessage[];
}): SpaceWebSocketSession {
  const spacePassword =
    input.spacePassword === undefined
      ? undefined
      : normalizeSpacePasswordText(input.spacePassword);
  return {
    blocked: input.blocked ?? [],
    ...(input.callerPrincipalId
      ? { callerPrincipalId: input.callerPrincipalId }
      : {}),
    enforcedProfile: input.enforcedProfile,
    helloAccepted: false,
    supportsLiveSignalHistory: false,
    supportsSpaceMessageAddressing: false,
    ...(input.viewerOwnerUserId
      ? { viewerOwnerUserId: input.viewerOwnerUserId }
      : {}),
    ...(input.viewerProfileId
      ? { viewerProfileId: input.viewerProfileId }
      : {}),
    ...(spacePassword ? { spacePassword } : {}),
  };
}

export function acceptSpaceWebSocketHello(input: {
  session: SpaceWebSocketSession;
  hello: Hello;
}): Profile {
  const profile = input.session.enforcedProfile ?? input.hello.profile;
  input.session.profile = profile;
  input.session.helloAccepted = true;
  input.session.supportsLiveSignalHistory =
    input.hello.capabilities?.liveSignalHistory === true;
  input.session.supportsAgentReplyPlacement =
    input.hello.capabilities?.agentReplyPlacement === true;
  input.session.supportsAgentWorkOutcomes =
    input.hello.capabilities?.agentWorkOutcomes === true;
  input.session.supportsSpaceMessageAddressing =
    input.hello.capabilities?.spaceMessageAddressing === true;
  input.session.supportsSpaceImageGeometry =
    input.hello.capabilities?.spaceImageGeometry === true;
  return profile;
}

export function coalesceQueuedSpaceWebSocketInvalidations(
  messages: readonly SpaceQueuedWebSocketMessage[]
): SpaceQueuedWebSocketMessage[] {
  const coalesced: SpaceQueuedWebSocketMessage[] = [];
  const invalidationIndexByTopic = new Map<
    SpaceLiveInvalidationFrame["type"],
    number
  >();

  for (const message of messages) {
    if (!isSpaceLiveInvalidationFrame(message)) {
      coalesced.push(message);
      continue;
    }

    const existingIndex = invalidationIndexByTopic.get(message.type);
    if (existingIndex === undefined) {
      invalidationIndexByTopic.set(message.type, coalesced.length);
      coalesced.push(message);
      continue;
    }

    const existing = coalesced[existingIndex];
    if (existing === undefined || !isSpaceLiveInvalidationFrame(existing)) {
      throw new Error("Queued Space invalidation index is inconsistent.");
    }
    coalesced[existingIndex] = mergeSpaceLiveInvalidationFrames(
      existing,
      message
    );
  }

  return coalesced;
}

export function resolveAcceptedSpaceWebSocketProfile(
  session: SpaceWebSocketSession
): Profile | null {
  if (!session.helloAccepted) {
    return null;
  }
  return session.profile ?? session.enforcedProfile ?? null;
}

export function buildSpaceWebSocketSessionAttachment(
  session: SpaceWebSocketSession
): SpaceWebSocketSessionAttachment {
  return {
    ...(session.callerPrincipalId
      ? { callerPrincipalId: session.callerPrincipalId }
      : {}),
    ...(session.helloAccepted ? { helloAccepted: true } : {}),
    ...(session.helloAccepted && session.profile
      ? { profile: session.profile }
      : {}),
    ...(session.enforcedProfile
      ? { enforcedProfile: session.enforcedProfile }
      : {}),
    ...(session.viewerOwnerUserId
      ? { viewerOwnerUserId: session.viewerOwnerUserId }
      : {}),
    ...(session.viewerProfileId
      ? { viewerProfileId: session.viewerProfileId }
      : {}),
    ...(session.spacePassword ? { spacePassword: session.spacePassword } : {}),
    ...(session.supportsLiveSignalHistory
      ? { supportsLiveSignalHistory: true }
      : {}),
    ...(session.supportsAgentReplyPlacement
      ? { supportsAgentReplyPlacement: true }
      : {}),
    ...(session.supportsAgentWorkOutcomes
      ? { supportsAgentWorkOutcomes: true }
      : {}),
    ...(session.supportsSpaceMessageAddressing
      ? { supportsSpaceMessageAddressing: true }
      : {}),
    ...(session.supportsSpaceImageGeometry
      ? { supportsSpaceImageGeometry: true }
      : {}),
  };
}

export function restoreSpaceWebSocketSessionFromAttachment(
  attachment: SpaceWebSocketSessionAttachment | null | undefined
): SpaceWebSocketSession {
  const meta = attachment ?? {};
  const spacePassword =
    typeof meta.spacePassword === "string"
      ? normalizeSpacePasswordText(meta.spacePassword)
      : undefined;
  const helloAccepted =
    meta.helloAccepted === true || meta.profile !== undefined;
  return {
    blocked: [],
    ...(meta.callerPrincipalId
      ? { callerPrincipalId: meta.callerPrincipalId }
      : {}),
    helloAccepted,
    supportsLiveSignalHistory: meta.supportsLiveSignalHistory === true,
    supportsAgentReplyPlacement: meta.supportsAgentReplyPlacement === true,
    supportsAgentWorkOutcomes: meta.supportsAgentWorkOutcomes === true,
    supportsSpaceMessageAddressing:
      meta.supportsSpaceMessageAddressing === true,
    supportsSpaceImageGeometry: meta.supportsSpaceImageGeometry === true,
    ...(helloAccepted ? { profile: meta.profile ?? meta.enforcedProfile } : {}),
    ...(meta.enforcedProfile ? { enforcedProfile: meta.enforcedProfile } : {}),
    ...(meta.viewerOwnerUserId
      ? { viewerOwnerUserId: meta.viewerOwnerUserId }
      : {}),
    ...(meta.viewerProfileId ? { viewerProfileId: meta.viewerProfileId } : {}),
    ...(spacePassword ? { spacePassword } : {}),
  };
}

export function shouldSendSpaceLiveSignalFrameToSession(input: {
  frame: SpaceLiveSignalFrame;
  session: SpaceWebSocketSession;
}): boolean {
  return Boolean(
    input.frame.threadContext || input.session.supportsLiveSignalHistory
  );
}

export function removeFailedSpaceWebSocketSession(input: {
  sessions: Map<WebSocket, SpaceWebSocketSession>;
  webSocket: WebSocket;
  session: SpaceWebSocketSession;
  closeCode: number;
  closeReason: string;
}): void {
  input.session.quit = true;
  input.sessions.delete(input.webSocket);
  try {
    input.webSocket.close(input.closeCode, input.closeReason);
  } catch {
    // Socket may already be closed by the runtime.
  }
}

function isSpaceLiveInvalidationFrame(
  message: SpaceQueuedWebSocketMessage
): message is SpaceLiveInvalidationFrame {
  return (
    typeof message !== "string" &&
    "type" in message &&
    (message.type === "space.members.changed" ||
      message.type === "space.meta.changed" ||
      message.type === "space.files.changed" ||
      message.type === "agent.readiness.invalidated" ||
      message.type === "wake.progress.changed")
  );
}

function mergeSpaceLiveInvalidationFrames(
  previous: SpaceLiveInvalidationFrame,
  next: SpaceLiveInvalidationFrame
): SpaceLiveInvalidationFrame {
  const profileIds = mergeUniqueIds(previous.profileIds, next.profileIds);
  const agentProfileIds = mergeUniqueIds(
    previous.agentProfileIds,
    next.agentProfileIds
  );
  const clientMessageIds = mergeUniqueIds(
    previous.clientMessageIds,
    next.clientMessageIds
  );
  return {
    ...previous,
    ...next,
    version: Math.max(previous.version, next.version),
    ...(profileIds ? { profileIds } : {}),
    ...(agentProfileIds ? { agentProfileIds } : {}),
    ...(clientMessageIds ? { clientMessageIds } : {}),
  };
}

function mergeUniqueIds(
  previous: readonly string[] | undefined,
  next: readonly string[] | undefined
): string[] | undefined {
  if (!(previous || next)) {
    return undefined;
  }
  return Array.from(new Set([...(previous ?? []), ...(next ?? [])]));
}
