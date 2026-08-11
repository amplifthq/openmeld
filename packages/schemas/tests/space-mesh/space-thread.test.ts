import { describe, expect, it } from "vitest";
import {
  createSpaceThreadBodySchema,
  messageEnvelopeSchema,
  openMeldSpaceActionSchema,
  postSpaceThreadSignalBodySchema,
  spaceThreadContextSchema,
  spaceThreadSchema,
} from "../../src/index";

const THREAD_ID = "thr_11111111-1111-4111-8111-111111111111";
const ACTOR_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";

describe("Space Thread schemas", () => {
  it("accepts the canonical thread and dispatch context shape", () => {
    expect(
      spaceThreadSchema.safeParse({
        threadId: THREAD_ID,
        spaceId: "space-1",
        rootSignalId: "sig-root-1",
        createdByProfileId: ACTOR_PROFILE_ID,
        createdAt: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      }).success
    ).toBe(true);

    expect(
      spaceThreadContextSchema.safeParse({
        threadId: THREAD_ID,
        rootSignalId: "sig-root-1",
      }).success
    ).toBe(true);
  });

  it("creates a thread from only a root signal and mutation id", () => {
    expect(
      createSpaceThreadBodySchema.safeParse({
        rootSignalId: "sig-root-1",
        clientMutationId: "mutation-1",
      }).success
    ).toBe(true);

    expect(
      createSpaceThreadBodySchema.safeParse({
        rootSignalId: "sig-root-1",
        title: "Not a core thread field",
        clientMutationId: "mutation-1",
      }).success
    ).toBe(false);
  });

  it("keeps thread placement out of messageEnvelope", () => {
    expect(
      messageEnvelopeSchema.safeParse({
        text: "Wake the agent in this thread.",
        activationTargets: [ACTOR_PROFILE_ID],
        referenceTargets: [],
        threadId: THREAD_ID,
      }).success
    ).toBe(false);

    expect(
      postSpaceThreadSignalBodySchema.safeParse({
        text: "@agent please check this.",
        messageEnvelope: {
          text: "@agent please check this.",
          activationTargets: [ACTOR_PROFILE_ID],
          referenceTargets: [],
          threadId: THREAD_ID,
        },
        clientMessageId: "client-message-1",
      }).success
    ).toBe(false);
  });

  it("allows thread refs on explicit actions without changing envelope semantics", () => {
    for (const action of [
      {
        type: "post_message",
        messageEnvelope: {
          text: "Reply in the current thread.",
          activationTargets: [],
          referenceTargets: [],
        },
        thread: { threadId: THREAD_ID },
      },
      {
        type: "post_status",
        status: "working",
        text: "Checking details.",
        thread: { threadId: THREAD_ID },
      },
      {
        type: "read_updates",
        from: "last_public_reply",
        thread: { threadId: THREAD_ID },
      },
    ]) {
      expect(openMeldSpaceActionSchema.safeParse(action).success).toBe(true);
    }
  });
});
