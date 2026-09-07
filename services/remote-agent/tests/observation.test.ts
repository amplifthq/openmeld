import type {
  FlueObservation,
  PromptResponse,
  PromptUsage,
} from "@flue/runtime";
import { describe, expect, it } from "vitest";
import {
  extractAssistantText,
  extractFlueStreamDelta,
  extractModelId,
} from "../flue-adapter/observation";

const PROMPT_USAGE = {
  cacheRead: 3,
  cacheWrite: 4,
  cost: {
    cacheRead: 0.03,
    cacheWrite: 0.04,
    input: 0.01,
    output: 0.02,
    total: 0.1,
  },
  input: 10,
  output: 20,
  totalTokens: 37,
} satisfies PromptUsage;

describe("Flue observation parsing", () => {
  it("extracts trimmed assistant text from Flue agent output first", () => {
    const event = promptOperationObservation({
      agentOutput: {
        finishReason: "stop",
        text: "  Done from agent output.  ",
        type: "text",
      },
      result: promptResponse("Fallback text."),
    });

    expect(extractAssistantText(event)).toBe("Done from agent output.");
  });

  it("falls back to PromptResponse text when agent output is unavailable", () => {
    const event = promptOperationObservation({
      result: promptResponse("  Done from prompt response.  "),
    });

    expect(extractAssistantText(event)).toBe("Done from prompt response.");
  });

  it("extracts the provider/model id from the PromptResponse model", () => {
    const event = promptOperationObservation({
      result: promptResponse("Done.", {
        id: "x-ai/grok-4.5",
        provider: "openrouter",
      }),
    });

    expect(extractModelId(event)).toBe("openrouter/x-ai/grok-4.5");
  });

  it("returns null when the observation has no typed PromptResponse model", () => {
    const event = promptOperationObservation({ result: { ok: true } });

    expect(extractAssistantText(event)).toBe("");
    expect(extractModelId(event)).toBeNull();
  });

  it("extracts correlated Flue text deltas without trimming user-visible spacing", () => {
    expect(
      extractFlueStreamDelta({
        agentName: "center-agent-v2",
        eventIndex: 2,
        submissionId: "flue_submission_123",
        text: " next",
        timestamp: "2026-07-08T12:00:00.100Z",
        type: "text_delta",
        v: 3,
      } satisfies FlueObservation)
    ).toEqual({
      delta: " next",
      kind: "text",
      observedAtMs: Date.parse("2026-07-08T12:00:00.100Z"),
      submissionId: "flue_submission_123",
    });
  });

  it("extracts correlated Flue thinking deltas without relabeling them as text", () => {
    expect(
      extractFlueStreamDelta({
        agentName: "center-agent-v2",
        delta: "Checking the Space",
        eventIndex: 3,
        submissionId: "flue_submission_123",
        timestamp: "2026-07-08T12:00:00.200Z",
        type: "thinking_delta",
        v: 3,
      } satisfies FlueObservation)
    ).toEqual({
      delta: "Checking the Space",
      kind: "thinking",
      observedAtMs: Date.parse("2026-07-08T12:00:00.200Z"),
      submissionId: "flue_submission_123",
    });
  });
});

function promptResponse(
  text: string,
  model: PromptResponse["model"] = {
    id: "x-ai/grok-4.5",
    provider: "openrouter",
  }
): PromptResponse {
  return {
    model,
    text,
    usage: PROMPT_USAGE,
  };
}

function promptOperationObservation(input: {
  agentOutput?: FlueObservation["agentOutput"];
  result?: unknown;
}): FlueObservation {
  return {
    agentName: "center-agent-v2",
    durationMs: 42,
    eventIndex: 1,
    isError: false,
    operationId: "operation_1",
    operationKind: "prompt",
    result: input.result,
    submissionId: "flue_submission_123",
    timestamp: "2026-07-08T12:00:00.000Z",
    type: "operation",
    usage: PROMPT_USAGE,
    v: 3,
    ...(input.agentOutput ? { agentOutput: input.agentOutput } : {}),
  } satisfies FlueObservation;
}
