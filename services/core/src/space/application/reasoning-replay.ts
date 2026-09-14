import type { SpaceAgentStreamDeltaFrame } from "@openmeld/schemas/types";

type ThinkingFrame = Extract<SpaceAgentStreamDeltaFrame, { kind: "thinking" }>;

// Deliberately instance-local: never serialize private reasoning into storage
// or WebSocket attachments. Eviction loses the tail rather than persisting it.
export class ReasoningReplay {
  private readonly frames = new Map<string, ThinkingFrame>();

  remember(frame: SpaceAgentStreamDeltaFrame): void {
    if (frame.kind !== "thinking") {
      return;
    }
    this.prune(frame.updatedAtMs);
    const current = this.frames.get(frame.streamId);
    if (current && current.sequence >= frame.sequence) {
      return;
    }
    this.frames.delete(frame.streamId);
    this.frames.set(frame.streamId, {
      ...frame,
      thinkingSnapshot:
        frame.reasoningState && frame.reasoningState.status !== "streaming"
          ? ""
          : frame.thinkingSnapshot.slice(-8192),
    });
    if (this.frames.size > 128) {
      const oldest = this.frames.keys().next().value;
      if (oldest !== undefined) {
        this.frames.delete(oldest);
      }
    }
  }

  forget(streamId: string): void {
    this.frames.delete(streamId);
  }

  read(nowMs: number): ThinkingFrame[] {
    this.prune(nowMs);
    return [...this.frames.values()];
  }

  private prune(nowMs: number): void {
    for (const [streamId, frame] of this.frames) {
      if (frame.updatedAtMs + 30 * 60 * 1000 <= nowMs) {
        this.frames.delete(streamId);
      }
    }
  }
}
