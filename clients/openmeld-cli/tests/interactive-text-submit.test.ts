import type { MessageEnvelope } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { performInteractiveTextSubmit } from "../src/space/interactive-text-submit";

describe("performInteractiveTextSubmit", () => {
  it("keeps the draft intact when outbound text preparation fails", async () => {
    const applyComposerBuffer = vi.fn();
    const clearSubmittedInputLine = vi.fn();
    const queueText = vi.fn();
    const submittedText =
      "@Budget Analyst(wake) Please propose the rollout plan.";

    await expect(
      performInteractiveTextSubmit({
        nextBufferText: "",
        submittedText,
        text: submittedText,
        prepareOutboundText: vi
          .fn()
          .mockRejectedValue(new Error("members could not be loaded")),
        queueText,
        applyComposerBuffer,
        clearSubmittedInputLine,
      })
    ).rejects.toThrow("members could not be loaded");

    expect(queueText).not.toHaveBeenCalled();
    expect(applyComposerBuffer).toHaveBeenCalledWith(submittedText);
    expect(clearSubmittedInputLine).not.toHaveBeenCalled();
  });

  it("does not clear the draft when runtime queueing fails", async () => {
    const applyComposerBuffer = vi.fn();
    const clearSubmittedInputLine = vi.fn();
    const queueText = vi.fn().mockReturnValue({
      queued: false,
    });
    const submittedText = "hello world";

    await expect(
      performInteractiveTextSubmit({
        nextBufferText: "",
        submittedText,
        text: submittedText,
        prepareOutboundText: vi.fn().mockResolvedValue({
          text: "hello world",
          messageEnvelope: null,
          canonicalMentionsInTextOrder: [],
          resolvedStructuredTargets: {
            canonicalMentionsInTextOrder: [],
            profileIdsInTextOrder: [],
          },
        }),
        queueText,
        applyComposerBuffer,
        clearSubmittedInputLine,
      })
    ).resolves.toEqual({
      status: "not_queued",
      text: "hello world",
      canonicalMentionsInTextOrder: [],
      resolvedStructuredTargets: {
        canonicalMentionsInTextOrder: [],
        profileIdsInTextOrder: [],
      },
    });

    expect(queueText).toHaveBeenCalledWith({
      text: "hello world",
    });
    expect(applyComposerBuffer).toHaveBeenCalledWith(submittedText);
    expect(clearSubmittedInputLine).not.toHaveBeenCalled();
  });

  it("passes the prepared message envelope to the runtime queue", async () => {
    const messageEnvelope = {
      activationTargets: ["agt_11111111-2222-4333-8444-555555555555"],
      referenceTargets: [],
      text: "@Budget Analyst(wake) Please propose the rollout plan.",
    } satisfies MessageEnvelope;
    const queueText = vi.fn().mockReturnValue({
      queued: true,
      clientMessageId: "client-1",
    });

    await expect(
      performInteractiveTextSubmit({
        nextBufferText: "",
        submittedText: "@Budget Analyst(wake) Please propose the rollout plan.",
        text: "@Budget Analyst(wake) Please propose the rollout plan.",
        prepareOutboundText: vi.fn().mockResolvedValue({
          text: "@Budget Analyst(wake) Please propose the rollout plan.",
          messageEnvelope,
          canonicalMentionsInTextOrder: [],
          resolvedStructuredTargets: {
            canonicalMentionsInTextOrder: [],
            profileIdsInTextOrder: [],
          },
        }),
        queueText,
        applyComposerBuffer: vi.fn(),
        clearSubmittedInputLine: vi.fn(),
      })
    ).resolves.toMatchObject({
      clientMessageId: "client-1",
      status: "queued",
    });

    expect(queueText).toHaveBeenCalledWith({
      messageEnvelope,
      text: "@Budget Analyst(wake) Please propose the rollout plan.",
    });
  });

  it("clears the draft only after queueing succeeds", async () => {
    const callOrder: string[] = [];
    const applyComposerBuffer = vi.fn((bufferText: string) => {
      callOrder.push(`buffer:${bufferText}`);
    });
    const clearSubmittedInputLine = vi.fn((submittedText: string) => {
      callOrder.push(`clear:${submittedText}`);
    });
    const queueText = vi.fn((input: { text: string }) => {
      callOrder.push(`queue:${input.text}`);
      return {
        queued: true,
        clientMessageId: "client-1",
      };
    });

    await expect(
      performInteractiveTextSubmit({
        nextBufferText: "",
        submittedText: "hello world",
        text: "hello world",
        prepareOutboundText: vi.fn().mockResolvedValue({
          text: "hello world",
          messageEnvelope: null,
          canonicalMentionsInTextOrder: [],
          resolvedStructuredTargets: {
            canonicalMentionsInTextOrder: [],
            profileIdsInTextOrder: [],
          },
        }),
        queueText,
        applyComposerBuffer,
        clearSubmittedInputLine,
      })
    ).resolves.toEqual({
      status: "queued",
      text: "hello world",
      clientMessageId: "client-1",
      canonicalMentionsInTextOrder: [],
      resolvedStructuredTargets: {
        canonicalMentionsInTextOrder: [],
        profileIdsInTextOrder: [],
      },
    });

    expect(callOrder).toEqual([
      "queue:hello world",
      "buffer:",
      "clear:hello world",
    ]);
  });
});
