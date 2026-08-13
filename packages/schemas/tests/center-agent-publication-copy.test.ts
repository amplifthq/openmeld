import { describe, expect, it } from "vitest";
import {
  CENTER_AGENT_ACCOUNT_CONNECTION_REQUIRED_PUBLIC_COPY,
  resolveCenterAgentCompletedCallbackMessage,
} from "../src/center-agent-publication-copy";

describe("Center Agent publication copy", () => {
  it("replaces a blocked request with the fixed account connection guidance", () => {
    expect(
      resolveCenterAgentCompletedCallbackMessage({
        navigationTarget: {
          kind: "message_channel_identity_link",
          purpose: "continue_request",
        },
        text: "Internal tool availability explanation",
      })
    ).toBe(CENTER_AGENT_ACCOUNT_CONNECTION_REQUIRED_PUBLIC_COPY);
  });

  it("preserves a successful reply when account connection is optional", () => {
    expect(
      resolveCenterAgentCompletedCallbackMessage({
        navigationTarget: {
          kind: "message_channel_identity_link",
          purpose: "optional_setup",
        },
        text: "Here is the answer you requested.",
      })
    ).toBe("Here is the answer you requested.");
  });
});
