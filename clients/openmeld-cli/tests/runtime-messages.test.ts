import { afterEach, describe, expect, it, vi } from "vitest";
import { formatMessage } from "../src/runtime/messages";

describe("runtime messages", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("describes agent join without stdin as stream-only instead of watch mode", () => {
    const message = formatMessage("agent", "space.join.stdin_fallback_watch", {
      connectionMode: "join",
      sendCommand:
        "openmeld space send --profile agt_demo 0123456789abcdef <text...>",
    });

    expect(message).toContain("stream-only join");
    expect(message).toContain(
      "openmeld space send --profile agt_demo 0123456789abcdef <text...>"
    );
    expect(message).not.toContain("watch mode");
  });

  it("describes agent no-stdio join as joined stream-only mode with send hint", () => {
    const message = formatMessage("agent", "connect.connected_no_stdio", {
      connectionMode: "join",
      sendCommand:
        "openmeld space send --profile agt_demo 0123456789abcdef <text...>",
    });

    expect(message).toContain("joined in stream-only mode");
    expect(message).toContain(
      "openmeld space send --profile agt_demo 0123456789abcdef <text...>"
    );
    expect(message).not.toContain("watch mode");
  });

  it("keeps watch wording for watch connections without stdio", () => {
    const message = formatMessage("agent", "connect.connected_no_stdio", {
      connectionMode: "watch",
    });

    expect(message).toBe("watch mode active; Ctrl+C to quit");
  });

  it("keeps human connection failures plain while Agent View retains diagnostics", () => {
    const params = {
      error: "connect ECONNREFUSED 127.0.0.1:65535",
      hint: "try again in a moment",
    };

    expect(formatMessage("human", "connect.error", params)).toBe(
      "OpenMeld lost the connection. Try again in a moment."
    );
    expect(formatMessage("agent", "connect.error", params)).toContain(
      "connect ECONNREFUSED 127.0.0.1:65535"
    );
  });

  it("tells a human when a message was not confirmed", () => {
    expect(
      formatMessage("human", "connect.error", {
        error:
          "last message may not have been confirmed before the connection closed",
        hint: "rejoin the space and send it again if you still do not see it",
      })
    ).toBe(
      "OpenMeld lost the connection before confirming your message. Rejoin the space and send it again if you still do not see it."
    );
  });

  it("renders openmeld-dev send guidance when the dev shortcut is active", () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");

    const message = formatMessage("agent", "connect.connected_no_stdio", {
      connectionMode: "join",
    });

    expect(message).toContain(
      "`openmeld-dev space send --profile <profile-id> <space-id> <text...>`"
    );
  });

  it("renders join bootstrap context with field-level source labels", () => {
    const humanMessage = formatMessage(
      "human",
      "space.join.bootstrap_context",
      {
        role: "Architect",
        mentionAlias: "saved-codex",
        roleSource: "explicit",
        mentionAliasSource: "local",
      }
    );
    const agentMessage = formatMessage(
      "agent",
      "space.join.bootstrap_context",
      {
        role: "Architect",
        mentionAlias: "saved-codex",
        roleSource: "explicit",
        mentionAliasSource: "local",
      }
    );

    expect(humanMessage).toContain('role "Architect" (explicit)');
    expect(humanMessage).toContain("mention alias @saved-codex (saved)");

    expect(agentMessage).toContain('role "Architect" (explicit)');
    expect(agentMessage).toContain("mention alias @saved-codex (local)");
  });
});
