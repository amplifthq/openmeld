import { describe, expect, it } from "vitest";
import {
  canonicalMentionLiteralSchema,
  collectCanonicalMentionTextFragments,
  formatCanonicalMentionLiteral,
  messageEnvelopeInputSchema,
  messageEnvelopeSchema,
  normalizeMessageEnvelope,
  parseCanonicalMentionLiteral,
  resolveMessageEnvelopeTargetField,
} from "../../src/index";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_HUMAN_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";
const DUPLICATE_PROFILE_ID_PATTERN = /duplicate profileId/;
const CONFLICTING_PROFILE_ID_PATTERN = /must not reuse profileId/;

describe("message envelope substrate", () => {
  it("normalizes a pure text envelope into canonical empty target lists", () => {
    expect(
      normalizeMessageEnvelope({
        text: "   hello from phase 2a   ",
      })
    ).toEqual({
      activationTargets: [],
      mentionTargets: [],
      referenceTargets: [],
      text: "hello from phase 2a",
    });
  });

  it("accepts the canonical message envelope shape", () => {
    const parsed = messageEnvelopeSchema.safeParse({
      activationTargets: [AGENT_PROFILE_ID],
      mentionTargets: [HUMAN_PROFILE_ID, SECOND_HUMAN_PROFILE_ID],
      referenceTargets: [],
      replyToSignalId: " evt-123 ",
      text: "  Rollout update is ready. ",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }

    expect(parsed.data).toEqual({
      activationTargets: [AGENT_PROFILE_ID],
      mentionTargets: [HUMAN_PROFILE_ID, SECOND_HUMAN_PROFILE_ID],
      referenceTargets: [],
      replyToSignalId: "evt-123",
      text: "Rollout update is ready.",
    });
  });

  it("preserves one trusted Navigation Action during normalization", () => {
    expect(
      normalizeMessageEnvelope({
        navigationAction: {
          label: "Open this Project",
          target: { kind: "project", projectId: "project_123" },
          url: "http://localhost:5173/o/acme/projects/project_123",
        },
        text: "Project created.",
      })
    ).toEqual({
      activationTargets: [],
      mentionTargets: [],
      referenceTargets: [],
      navigationAction: {
        label: "Open this Project",
        target: { kind: "project", projectId: "project_123" },
        url: "http://localhost:5173/o/acme/projects/project_123",
      },
      text: "Project created.",
    });
  });

  it("keeps canonical schema strict about target list presence", () => {
    expect(
      messageEnvelopeSchema.safeParse({
        text: "Missing target lists",
      }).success
    ).toBe(false);

    expect(
      messageEnvelopeInputSchema.safeParse({
        text: "Missing target lists is okay during input normalization",
      }).success
    ).toBe(true);
  });

  it("rejects blank text and invalid profile ids", () => {
    expect(
      messageEnvelopeInputSchema.safeParse({
        text: "   ",
      }).success
    ).toBe(false);

    expect(
      messageEnvelopeInputSchema.safeParse({
        activationTargets: ["ops-bot"],
        text: "Invalid profile id",
      }).success
    ).toBe(false);
  });

  it("rejects duplicate profile ids inside one relation list", () => {
    expect(() =>
      normalizeMessageEnvelope({
        activationTargets: [AGENT_PROFILE_ID, AGENT_PROFILE_ID],
        text: "Duplicate wake target",
      })
    ).toThrowError(DUPLICATE_PROFILE_ID_PATTERN);
  });

  it("rejects the same profile id across relation lists", () => {
    expect(() =>
      normalizeMessageEnvelope({
        activationTargets: [AGENT_PROFILE_ID],
        referenceTargets: [AGENT_PROFILE_ID],
        text: "Conflicting target semantics",
      })
    ).toThrowError(CONFLICTING_PROFILE_ID_PATTERN);
  });

  it("parses a canonical mention literal with whitespace-normalized name", () => {
    expect(parseCanonicalMentionLiteral("  @Budget   Analyst(wake)  ")).toEqual(
      {
        name: "Budget Analyst",
        type: "wake",
      }
    );
  });

  it("formats canonical mention literals into strict @Name(type) form", () => {
    const formatted = formatCanonicalMentionLiteral({
      name: "  Budget   Analyst  ",
      type: "wake",
    });

    expect(formatted).toBe("@Budget Analyst(wake)");
    expect(parseCanonicalMentionLiteral(formatted)).toEqual({
      name: "Budget Analyst",
      type: "wake",
    });
  });

  it("rejects non-canonical mention literal strings", () => {
    const invalidInputs = [
      "Budget Analyst(wake)",
      "@Budget Analyst",
      "@Budget(Analyst)(wake)",
      "@Budget Analyst (wake)",
      "@Budget Analyst(wake )",
      "@Budget Analyst( Wake )",
      "@Budget Analyst(alert)",
    ];

    for (const input of invalidInputs) {
      expect(parseCanonicalMentionLiteral(input)).toBeNull();
    }
  });

  it("collects canonical mention text fragments from linear text", () => {
    expect(
      collectCanonicalMentionTextFragments(
        [
          "Plain intro line",
          "@Budget Analyst(wake) Please propose the rollout plan.",
          "@Alice(reference) I agree with the risk framing.",
          "\\@escaped(wake) stays prose.",
          "@legacy-handle stays prose.",
          "@NameWith(Bracket)(wake) should stay invalid.",
        ].join("\n")
      )
    ).toEqual([
      {
        start: 17,
        end: 38,
        text: "@Budget Analyst(wake)",
        parsedLiteral: {
          name: "Budget Analyst",
          type: "wake",
        },
      },
      {
        start: 72,
        end: 89,
        text: "@Alice(reference)",
        parsedLiteral: {
          name: "Alice",
          type: "reference",
        },
      },
      {
        start: 178,
        end: 202,
        text: "@NameWith(Bracket)(wake)",
        parsedLiteral: null,
      },
    ]);
  });

  it("keeps @-prefixed technical tokens with inline parentheses as plain text", () => {
    // No explicit current relation or removed (cc) suffix: a same-line "()"
    // must NOT swallow
    // the token into a malformed mention fragment that would reject the send.
    expect(
      collectCanonicalMentionTextFragments(
        "@larksuiteoapi/node-sdk.foo(arg) please review"
      )
    ).toEqual([]);
    expect(
      collectCanonicalMentionTextFragments("@org/pkg in src/foo(bar).ts")
    ).toEqual([]);
    expect(
      collectCanonicalMentionTextFragments("@user check getConfig() now")
    ).toEqual([]);
    // A real relation in the same line still wins and is detected as before.
    expect(
      collectCanonicalMentionTextFragments("@Reviewer(wake) check getConfig()")
    ).toMatchObject([
      {
        text: "@Reviewer(wake)",
        parsedLiteral: { name: "Reviewer", type: "wake" },
      },
    ]);
  });

  it("does not let later prose parentheses become part of a wake mention", () => {
    const idMention = "@agt_449dc84a-14c2-4afc-a3be-94dc008ddd9c(wake)";
    const displayNameMention = "@Prod Smoke Codex 0.7.1 20260531(wake)";

    expect(
      collectCanonicalMentionTextFragments(
        `${idMention} DOGFOOD_REPORT: Confirmed \`openmeld --version\` and Felix (\`326d1bf2-a521-474f-8cb8-b6664c1c8c6f\`) can read the Space.`
      )
    ).toEqual([
      {
        start: 0,
        end: idMention.length,
        text: idMention,
        parsedLiteral: {
          name: "agt_449dc84a-14c2-4afc-a3be-94dc008ddd9c",
          type: "wake",
        },
      },
    ]);

    expect(
      collectCanonicalMentionTextFragments(
        `${displayNameMention} DOGFOOD_REPORT: service status said route online, then later status changed (transient).`
      )
    ).toEqual([
      {
        start: 0,
        end: displayNameMention.length,
        text: displayNameMention,
        parsedLiteral: {
          name: "Prod Smoke Codex 0.7.1 20260531",
          type: "wake",
        },
      },
    ]);
  });

  it("normalizes the canonical mention literal object shape", () => {
    const parsed = canonicalMentionLiteralSchema.safeParse({
      name: "  Budget   Analyst  ",
      type: "reference",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }

    expect(parsed.data).toEqual({
      name: "Budget Analyst",
      type: "reference",
    });
  });

  it("maps mention types to the canonical envelope target field", () => {
    expect(resolveMessageEnvelopeTargetField("wake")).toBe("activationTargets");
    expect(resolveMessageEnvelopeTargetField("reference")).toBe(
      "referenceTargets"
    );
  });
});
