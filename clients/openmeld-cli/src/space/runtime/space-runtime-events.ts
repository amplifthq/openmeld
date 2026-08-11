import type { HelloAck, SignalEnvelope } from "@openmeld/protocol";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";

export type SpaceRuntimeMessage = SignalEnvelope | HelloAck;

export type SpaceRuntimeEvent =
  | {
      type: "connected";
    }
  | {
      type: "history.loaded";
      synced: boolean;
      reason?: "replay_error" | "live_buffer_overflow";
    }
  | {
      type: "signal.received";
      event: SpaceRuntimeMessage;
      source: "history" | "live";
    }
  | {
      type: "members.updated";
      snapshot: SpaceMembersSnapshot | null;
    }
  | {
      type: "send.queued";
      clientMessageId: string;
      text: string;
    }
  | {
      type: "send.confirmed";
      clientMessageId: string | null;
      text: string;
      event: SignalEnvelope;
    }
  | {
      type: "send.failed";
      clientMessageId: string;
      text: string;
      error: string;
    }
  | {
      type: "connection.closed";
      source: "close" | "error";
      reason: string;
      code?: number;
      error?: unknown;
    };
