import { describe, expect, it } from "vitest";
import { toSpaceSignalReadWireValue } from "../src/compatibility/space-signal-read-wire";
import { postNormalMessageBodySchema } from "../src/schemas/http/space-signals";
import { postSpaceThreadSignalBodySchema } from "../src/schemas/http/space-threads";

const engineer = "agt_11111111-1111-4111-8111-111111111111";
const reviewer = "agt_22222222-2222-4222-8222-222222222222";
const message = {
  text: "Review the upload fix",
  messageEnvelope: {
    text: "Review the upload fix",
    activationTargets: [engineer, reviewer],
    referenceTargets: [],
  },
  contextSelections: {
    [engineer]: { mode: "new", access: "workspace", workspace: "isolated" },
    [reviewer]: { mode: "auto", access: "read_only", workspace: "current" },
  },
  taskDraft: {
    title: "Fix image uploads",
    assigneeProfileId: engineer,
    reviewerProfileId: reviewer,
  },
};
describe("composer task and recipient settings", () => {
  it("enforces the same target and review rules in thread replies", () => {
    const reply = { ...message, clientMessageId: "thread-task-1" };
    expect(postSpaceThreadSignalBodySchema.safeParse(reply).success).toBe(true);
    expect(
      postSpaceThreadSignalBodySchema.safeParse({
        ...reply,
        messageEnvelope: {
          ...reply.messageEnvelope,
          activationTargets: [engineer],
        },
      }).success
    ).toBe(false);
    expect(
      postSpaceThreadSignalBodySchema.safeParse({
        ...reply,
        taskDraft: { ...reply.taskDraft, reviewerProfileId: engineer },
      }).success
    ).toBe(false);
  });
  it("accepts independent settings and an explicit task in one message", () => {
    expect(postNormalMessageBodySchema.parse(message)).toEqual(message);
  });
  it("rejects settings for an agent that will not wake", () => {
    expect(
      postNormalMessageBodySchema.safeParse({
        ...message,
        messageEnvelope: {
          text: "Review the upload fix",
          activationTargets: [engineer],
          referenceTargets: [reviewer],
        },
      }).success
    ).toBe(false);
  });
  it("rejects ambiguous shared settings and self-review", () => {
    expect(
      postNormalMessageBodySchema.safeParse({
        ...message,
        contextSelection: { mode: "new" },
      }).success
    ).toBe(false);
    expect(
      postNormalMessageBodySchema.safeParse({
        ...message,
        taskDraft: { ...message.taskDraft, reviewerProfileId: engineer },
      }).success
    ).toBe(false);
  });
  it("keeps authoring controls out of history for older readers", () => {
    const wire = toSpaceSignalReadWireValue({
      type: "signal.text",
      data: message,
    });
    expect(wire.data).toEqual({
      text: message.text,
      messageEnvelope: message.messageEnvelope,
    });
    expect(message.contextSelections[reviewer].access).toBe("read_only");
  });
});
