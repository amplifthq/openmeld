import { describe, expect, it } from "vitest";
import {
  gatewayErrorEnvelopeSchema,
  getSpaceStatusResponseSchema,
  postNormalMessageBodySchema,
  postNormalMessageResponseSchema,
  spaceMembersSnapshotSchema,
} from "../../src/index";

describe("phase 1 gateway contracts", () => {
  it("accepts canonical gateway error envelopes and requires requestId", () => {
    const valid = gatewayErrorEnvelopeSchema.safeParse({
      ok: false,
      error: {
        code: "space.not_found",
        message: "Space not found.",
        requestId: "req-phase1",
        upstreamCode: "controller.binding.lookup_failed",
      },
    });
    expect(valid.success).toBe(true);

    const missingRequestId = gatewayErrorEnvelopeSchema.safeParse({
      ok: false,
      error: {
        code: "space.not_found",
        message: "Space not found.",
      },
    });
    expect(missingRequestId.success).toBe(false);

    const unknownCode = gatewayErrorEnvelopeSchema.safeParse({
      ok: false,
      error: {
        code: "space.unknown",
        message: "Space not found.",
        requestId: "req-phase1",
      },
    });
    expect(unknownCode.success).toBe(false);

    const blankUpstreamCode = gatewayErrorEnvelopeSchema.safeParse({
      ok: false,
      error: {
        code: "space.not_found",
        message: "Space not found.",
        requestId: "req-phase1",
        upstreamCode: "   ",
      },
    });
    expect(blankUpstreamCode.success).toBe(false);
  });

  it("accepts the minimal post normal message body and rejects legacy envelope wrappers", () => {
    const valid = postNormalMessageBodySchema.safeParse({
      text: "Hello from phase 1.",
      messageEnvelope: {
        text: "Hello from phase 1.",
        activationTargets: [],
        referenceTargets: ["agt_9a7252af-d284-4c4a-bf1c-ceeb96656b71"],
      },
      replyTo: {
        signalId: "sig-reply",
        profileId: "agt_9a7252af-d284-4c4a-bf1c-ceeb96656b71",
        profileKind: "agent",
        profileName: "Ops Bot",
        previewText: "Earlier reply",
      },
    });
    expect(valid.success).toBe(true);

    const legacyWrapped = postNormalMessageBodySchema.safeParse({
      type: "signal.text",
      data: {
        text: "Hello from phase 1.",
      },
    });
    expect(legacyWrapped.success).toBe(false);
  });

  it("accepts the canonical post normal message response envelope", () => {
    const parsed = postNormalMessageResponseSchema.safeParse({
      v: 1,
      id: "sig-1",
      spaceId:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ts: 1,
      profile: {
        kind: "human",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileName: "Mira",
      },
      type: "signal.text",
      data: {
        text: "Hello from phase 1.",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("keeps space status and members omission semantics explicit", () => {
    const missingLatestVisibleUpdate = getSpaceStatusResponseSchema.safeParse({
      spaceId:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      generatedAt: "2026-04-02T00:00:00.000Z",
      name: "ops-room",
      accessMode: "public",
      passwordProtected: false,
      dispatchPolicy: { mode: "mention_only" },
      publicationMode: "collaboration",
      allowedActions: ["post_message", "post_status", "stay_silent"],
      resultArchivePolicy: { mode: "all_final_results" },
      entryBrief: "default",
      dispatchBrief: "default",
      members: {
        totalCount: 1,
        humanCount: 1,
        agentCount: 0,
        liveNowCount: 1,
        liveHumanCount: 1,
        liveAgentCount: 0,
      },
      latestVisibleUpdate: null,
    });
    expect(missingLatestVisibleUpdate.success).toBe(false);

    const missingMembersSummary = spaceMembersSnapshotSchema.safeParse({
      spaceId:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      generatedAt: "2026-04-02T00:00:00.000Z",
      humans: [],
      agents: [],
    });
    expect(missingMembersSummary.success).toBe(false);
  });
});
