import type {
  SignalEnvelope,
  SpaceThreadSignalPlacement,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveExistingThreadSignalRetry } from "../space/application/space-thread-signal-idempotency";

const signal = {
  v: 1,
  id: "signal-1",
  spaceId: "space-1",
  ts: 1,
  profile: {
    kind: "human",
    profileId: "human-1",
    profileName: "Felix",
  },
  type: "signal.text",
  data: {
    text: "Run the checks",
    meta: { clientMessageId: "client-message-1" },
  },
} as const satisfies Extract<SignalEnvelope, { type: "signal.text" }>;

const placement = {
  createdAt: "2026-07-15T00:00:00.000Z",
  placement: "thread",
  signalId: signal.id,
  threadId: "thread-1",
} as const satisfies SpaceThreadSignalPlacement;

describe("thread signal idempotency", () => {
  it("replays the persisted signal only in its original thread", () => {
    expect(
      resolveExistingThreadSignalRetry({
        existingPlacement: placement,
        existingSignal: signal,
        threadId: "thread-1",
      })
    ).toEqual({ status: "replay", placement, signal });
  });

  it("fails closed when the message identity belongs to another location", () => {
    expect(
      resolveExistingThreadSignalRetry({
        existingPlacement: null,
        existingSignal: signal,
        threadId: "thread-1",
      })
    ).toEqual({ status: "location_conflict" });
    expect(
      resolveExistingThreadSignalRetry({
        existingPlacement: { ...placement, threadId: "thread-2" },
        existingSignal: signal,
        threadId: "thread-1",
      })
    ).toEqual({ status: "location_conflict" });
  });
});
