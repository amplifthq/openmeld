import { describe, expect, it } from "vitest";
import {
  AGENT_INTERACTION_DEFAULT_TIMEOUT_MS,
  agentInteractionPendingSummarySchema,
  agentInteractionRequestSchema,
  agentInteractionResolutionSchema,
  agentInteractionResponseSchema,
} from "../../src/schemas/protocol/agent-interaction";

describe("agent interaction contracts", () => {
  it("keeps a full owner-visible permission request bounded and typed", () => {
    const request = agentInteractionRequestSchema.parse({
      v: 1,
      interactionId: "interaction-1",
      kind: "permission",
      requestedAtMs: 100,
      expiresAtMs: 100 + AGENT_INTERACTION_DEFAULT_TIMEOUT_MS,
      title: "Run project tests?",
      description: "The agent wants to verify its changes.",
      subject: {
        type: "command",
        command: "pnpm test",
        cwd: "/workspace/project",
      },
      options: [
        {
          optionId: "accept",
          label: "Allow once",
          intent: "allow_once",
        },
        {
          optionId: "decline",
          label: "Deny",
          intent: "deny",
        },
      ],
    });

    expect(request.kind).toBe("permission");
  });

  it("supports option, multi-select, and free-text question answers", () => {
    const response = agentInteractionResponseSchema.parse({
      kind: "question",
      answers: [
        {
          questionId: "database",
          values: ["PostgreSQL"],
        },
        {
          questionId: "features",
          values: ["Authentication", "A custom audit trail"],
        },
      ],
    });

    expect(response.kind).toBe("question");
  });

  it("supports plan approval and requested changes without creating a new Wake", () => {
    expect(
      agentInteractionResponseSchema.parse({
        kind: "plan_review",
        action: "request_changes",
        feedback: "Keep the public API unchanged.",
      })
    ).toEqual({
      kind: "plan_review",
      action: "request_changes",
      feedback: "Keep the public API unchanged.",
    });
  });

  it("redacts full interaction details for non-owners", () => {
    expect(
      agentInteractionPendingSummarySchema.parse({
        interactionId: "interaction-1",
        kind: "permission",
        requestedAtMs: 100,
        expiresAtMs: 200,
        canRespond: false,
        request: null,
      })
    ).toEqual({
      interactionId: "interaction-1",
      kind: "permission",
      requestedAtMs: 100,
      expiresAtMs: 200,
      canRespond: false,
      request: null,
    });
  });

  it("rejects answers that do not belong to the pending interaction", () => {
    const request = agentInteractionRequestSchema.parse({
      v: 1,
      interactionId: "interaction-1",
      kind: "permission",
      requestedAtMs: 100,
      expiresAtMs: 200,
      title: "Run project tests?",
      subject: {
        type: "command",
        command: "pnpm test",
      },
      options: [
        {
          optionId: "accept",
          label: "Allow once",
          intent: "allow_once",
        },
      ],
    });

    expect(
      agentInteractionResolutionSchema.safeParse({
        request,
        response: {
          kind: "permission",
          optionId: "decline",
        },
      }).success
    ).toBe(false);
  });
});
