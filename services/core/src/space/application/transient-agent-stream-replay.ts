import type { SpaceAgentStreamDeltaFrame } from "@openmeld/schemas/types";

type TransientFrame = Extract<
  SpaceAgentStreamDeltaFrame,
  { kind: "thinking" | "progress" }
>;

// Deliberately instance-local: never serialize reasoning or public progress
// into durable storage or bootstrap. Eviction loses the tail.
export class TransientAgentStreamReplay {
  private readonly frames = new Map<string, TransientFrame>();
  revision = 0;

  clearProfile(profileId: string): void {
    this.revision++;
    for (const [streamId, frame] of this.frames) {
      if (frame.profileId === profileId) {
        this.frames.delete(streamId);
      }
    }
  }

  isCurrent(frame: TransientFrame): boolean {
    return this.frames.get(frame.streamId) === frame;
  }

  remember(frame: SpaceAgentStreamDeltaFrame): void {
    if (frame.kind !== "thinking" && frame.kind !== "progress") {
      return;
    }
    this.prune(frame.updatedAtMs);
    const current = this.frames.get(frame.streamId);
    if (current && current.sequence >= frame.sequence) {
      return;
    }
    this.frames.delete(frame.streamId);
    this.frames.set(
      frame.streamId,
      frame.kind === "progress"
        ? { ...frame, progressSnapshot: frame.progressSnapshot.slice(-8192) }
        : {
            ...frame,
            thinkingSnapshot:
              frame.reasoningState &&
              frame.reasoningState.status !== "streaming"
                ? ""
                : frame.thinkingSnapshot.slice(-8192),
          }
    );
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

  read(nowMs: number): TransientFrame[] {
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
