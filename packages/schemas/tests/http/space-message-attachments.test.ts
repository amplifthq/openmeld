import { describe, expect, it } from "vitest";
import {
  gatewayErrorCodeSchema,
  getSpaceUpdatesResponseSchema,
  postNormalMessageBodySchema,
  SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE,
  signalTextDataSchema,
  spaceLiveSignalFrameSchema,
} from "../../src";

const messageAttachment = {
  id: "attachment-1",
  mimeType: "image/png",
  sizeBytes: 1024,
  width: 800,
  height: 600,
  fileName: "diagram.png",
} as const;

const signalEnvelope = {
  v: 1,
  id: "signal-1",
  spaceId: "space-1",
  ts: 1_804_000_000_000,
  profile: {
    kind: "human",
    profileId: "11111111-1111-4111-8111-111111111111",
    profileName: "Mira",
  },
  type: "signal.text",
  data: {
    text: "Here is the latest diagram.",
    attachments: [messageAttachment],
  },
} as const;

describe("Space message attachment contracts", () => {
  it("accepts the embedded attachment descriptor subset on signal text and post bodies", () => {
    expect(signalTextDataSchema.parse(signalEnvelope.data)).toEqual(
      signalEnvelope.data
    );
    expect(postNormalMessageBodySchema.parse(signalEnvelope.data)).toEqual(
      signalEnvelope.data
    );
  });

  it("rejects more than four attachments", () => {
    const attachments = Array.from(
      { length: SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE + 1 },
      (_, index) => ({ ...messageAttachment, id: `attachment-${index}` })
    );

    expect(
      signalTextDataSchema.safeParse({
        text: "Five images should not be accepted.",
        attachments,
      }).success
    ).toBe(false);
    expect(
      postNormalMessageBodySchema.safeParse({
        text: "Five images should not be accepted.",
        attachments,
      }).success
    ).toBe(false);
  });

  it("rejects unknown message and attachment properties", () => {
    expect(
      signalTextDataSchema.safeParse({
        ...signalEnvelope.data,
        publicUrl: "https://example.test/image.png",
      }).success
    ).toBe(false);
    expect(
      postNormalMessageBodySchema.safeParse({
        ...signalEnvelope.data,
        attachments: [
          {
            ...messageAttachment,
            spaceId: "space-1",
          },
        ],
      }).success
    ).toBe(false);
  });

  it("accepts attachment-only messages but rejects messages with no content", () => {
    expect(
      postNormalMessageBodySchema.safeParse({
        text: "",
        attachments: [messageAttachment],
      }).success
    ).toBe(true);
    for (const text of ["", "   "]) {
      expect(
        postNormalMessageBodySchema.safeParse({ text, attachments: [] }).success
      ).toBe(false);
    }
    expect(
      postNormalMessageBodySchema.parse({
        attachments: [messageAttachment],
      })
    ).toMatchObject({ text: "", attachments: [messageAttachment] });
  });

  it("preserves attachments through live and history signal projections", () => {
    expect(
      spaceLiveSignalFrameSchema.parse({
        type: "space.signal",
        signal: signalEnvelope,
        history: { persisted: true },
      }).signal.data
    ).toEqual(signalEnvelope.data);
    expect(
      getSpaceUpdatesResponseSchema.parse({ signals: [signalEnvelope] })
        .signals[0]?.data
    ).toEqual(signalEnvelope.data);
  });

  it("preserves system-authored conversation compaction markers without letting clients forge them", () => {
    const dataWithCompaction = {
      ...signalEnvelope.data,
      meta: {
        conversationCompaction: {
          completedAtMs: 1_804_000_000_000,
          count: 1,
          v: 1,
        },
      },
    };

    expect(signalTextDataSchema.parse(dataWithCompaction).meta).toEqual(
      dataWithCompaction.meta
    );
    expect(postNormalMessageBodySchema.parse(dataWithCompaction).meta).toEqual(
      {}
    );
  });

  it("exposes an explicit invalid attachment reference error code", () => {
    expect(
      gatewayErrorCodeSchema.safeParse("attachment_reference_invalid").success
    ).toBe(true);
  });
});
