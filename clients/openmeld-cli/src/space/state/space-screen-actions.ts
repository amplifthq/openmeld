import type {
  SpaceOverlayKind,
  SpaceScreenState,
  SpaceTranscriptItem,
} from "./space-screen-state";

export type SpaceScreenAction =
  | {
      type: "connection.connected";
    }
  | {
      type: "connection.closing";
      reason: string;
    }
  | {
      type: "connection.closed";
      reason: string;
      code?: number;
      source: NonNullable<SpaceScreenState["connection"]["closeSource"]>;
    }
  | {
      type: "composer.buffer.updated";
      bufferText: string;
    }
  | {
      type: "transcript.item.appended";
      item: SpaceTranscriptItem;
    }
  | {
      type: "status.overlay.updated";
      line: string;
    }
  | {
      type: "overlay.opened";
      kind: Exclude<SpaceOverlayKind, "none">;
      openedAtMs: number;
    }
  | {
      type: "overlay.closed";
    }
  | {
      type: "overlay.interaction.reset";
    }
  | {
      type: "overlay.query.updated";
      query: string;
    }
  | {
      type: "overlay.active-item.updated";
      activeItemId: string | null;
    }
  | {
      type: "members.updated";
      snapshot: SpaceScreenState["members"]["snapshot"];
      updatedAtMs: number;
    }
  | {
      type: "members.refresh.failed";
      error: string;
    };
