import { describe, expect, it } from "vitest";
import {
  isRemoteAgentContextWindowExceeded,
  normalizeRemoteAgentErrorMessage,
} from "../agent-core/error-message";

describe("remote agent error message normalization", () => {
  it("preserves nested provider messages instead of object placeholders", () => {
    expect(
      normalizeRemoteAgentErrorMessage({
        cause: {
          error: {
            message:
              "Cloudflare AI binding request failed with 429 Too Many Requests.",
          },
        },
        message: "[object Object]",
      })
    ).toBe("Cloudflare AI binding request failed with 429 Too Many Requests.");
  });

  it("uses an error cause before falling back to an error name", () => {
    const error = new Error("[object Object]") as Error & { cause: unknown };
    error.cause = {
      message:
        "Cloudflare AI binding request failed with 429 Too Many Requests.",
    };

    expect(normalizeRemoteAgentErrorMessage(error)).toBe(
      "Cloudflare AI binding request failed with 429 Too Many Requests."
    );
  });

  it("does not preserve pre-stringified opaque object placeholders", () => {
    expect(normalizeRemoteAgentErrorMessage("[object Object]")).toBe(
      "unknown error"
    );
  });

  it("recognizes provider context-window overflow without relying on a model-specific token limit", () => {
    expect(
      isRemoteAgentContextWindowExceeded({
        message:
          "This endpoint's maximum context length is 500000 tokens. However, you requested about 516153 tokens.",
        name: "FlueError",
        type: "operation_failed",
      })
    ).toBe(true);
    expect(
      isRemoteAgentContextWindowExceeded({
        code: "context_length_exceeded",
        message: "The request is too large.",
      })
    ).toBe(true);
    expect(
      isRemoteAgentContextWindowExceeded(
        new Error("Customer asked how context windows work.")
      )
    ).toBe(false);
    expect(
      isRemoteAgentContextWindowExceeded(
        new Error(
          "You requested 200 tokens, but only 100 tokens remain in this account."
        )
      )
    ).toBe(false);
  });
});
