import type { SignalTextReplyTo } from "@openmeld/protocol";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import type {
  SpaceMessageReadProjection,
  SpaceReplyWorkflowProjection,
} from "@openmeld/space";
import type { SpacePanelKind } from "../panel/space-panel-definition";

export type SpaceTranscriptFormattedMessage = {
  bodyLines: readonly string[];
  relationLines: readonly string[];
  metaLines: readonly string[];
  threadIndicatorLine?: string | null;
  headerBadge?: string | null;
};

export type SpaceTranscriptProfileSnapshot = {
  kind: "human" | "agent" | "system" | "unknown";
  profileId: string | null;
  profileName: string;
  ownerUserId?: string | null;
  ownerName?: string | null;
  agentControllerRef?: string | null;
};

export type SpaceTranscriptReplyRef = SignalTextReplyTo;

export type SpaceTranscriptItem = {
  line: string;
  groupKey: string;
  refreshPrompt?: boolean;
  kind?: "message" | "system_notice" | "presence" | "membership_notice";
  formattedMessage?: SpaceTranscriptFormattedMessage;
  messageReadProjection?: SpaceMessageReadProjection;
  replyWorkflowProjection?: SpaceReplyWorkflowProjection;
  profile?: SpaceTranscriptProfileSnapshot;
  systemPurpose?: string | null;
  ts?: number;
  presenceAction?: "join" | "left";
  actorProfileId?: string;
  actorKind?: "human" | "agent" | "unknown";
  actorLabel?: string;
  actorAvatar?: string;
  membershipNotice?: SpaceMembershipNotice;
  replyRef?: SpaceTranscriptReplyRef;
};

export type SpaceMembershipNotice = {
  action: "member_added" | "member_removed";
  actorProfileId: string | null;
  actorKind: "human" | "agent" | "unknown";
  actorLabel: string;
  targetProfileId: string | null;
  targetProfileKind: "human" | "agent";
  targetProfileLabel: string;
  mentionLabel: string | null;
  ts: number;
};

export type SpaceOverlayKind = "none" | SpacePanelKind;

export type SpaceScreenState = {
  connection: {
    status: "connecting" | "connected" | "closing" | "closed";
    closeReason: string | null;
    closeCode: number | null;
    closeSource: "close" | "error" | null;
  };
  composer: {
    bufferText: string;
  };
  transcript: {
    items: SpaceTranscriptItem[];
  };
  status: {
    overlayLine: string;
  };
  overlay: {
    kind: SpaceOverlayKind;
    openedAtMs: number | null;
    interaction: {
      activeItemId: string | null;
      query: string;
    };
  };
  members: {
    refreshError: string | null;
    snapshot: SpaceMembersSnapshot | null;
    updatedAtMs: number | null;
  };
};

export function createInitialSpaceScreenState(): SpaceScreenState {
  return {
    connection: {
      status: "connecting",
      closeReason: null,
      closeCode: null,
      closeSource: null,
    },
    composer: {
      bufferText: "",
    },
    transcript: {
      items: [],
    },
    status: {
      overlayLine: "",
    },
    overlay: {
      kind: "none",
      openedAtMs: null,
      interaction: {
        activeItemId: null,
        query: "",
      },
    },
    members: {
      refreshError: null,
      snapshot: null,
      updatedAtMs: null,
    },
  };
}
