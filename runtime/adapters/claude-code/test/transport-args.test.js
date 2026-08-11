import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildClaudeArgs,
  classifyClaudeFailure,
} from "../dist/transport/claude-cli-transport.js";
import { OPENMELD_CLAUDE_ALLOWED_TOOLS } from "../dist/transport/claude-permission-policy.js";

const CONFIG_INVALID_PREFIX_RE = /^config\.invalid:/;

describe("Claude CLI transport args", () => {
  it("passes model, fallback model, and reasoning effort for a new session", () => {
    assert.deepEqual(
      buildClaudeArgs({
        conversationPolicy: {
          fallbackModel: "claude-haiku-4-5",
          model: "claude-sonnet-4-6",
          reasoningLevel: "xhigh",
        },
        prompt: "Reply with ok.",
        sessionId: null,
      }),
      [
        "--model",
        "claude-sonnet-4-6",
        "--fallback-model",
        "claude-haiku-4-5",
        "--effort",
        "xhigh",
        "-p",
        "Reply with ok.",
        "--allowedTools",
        ...OPENMELD_CLAUDE_ALLOWED_TOOLS,
        "--permission-mode",
        "default",
        "--output-format",
        "json",
      ]
    );
  });

  it("omits duplicate fallback model for a new session", () => {
    assert.deepEqual(
      buildClaudeArgs({
        conversationPolicy: {
          fallbackModel: "claude-opus-4-8",
          model: "claude-opus-4-8",
        },
        prompt: "Reply with ok.",
        sessionId: null,
      }),
      [
        "--model",
        "claude-opus-4-8",
        "-p",
        "Reply with ok.",
        "--allowedTools",
        ...OPENMELD_CLAUDE_ALLOWED_TOOLS,
        "--permission-mode",
        "default",
        "--output-format",
        "json",
      ]
    );
  });

  it("passes model and reasoning effort when resuming a session", () => {
    assert.deepEqual(
      buildClaudeArgs({
        conversationPolicy: {
          model: "claude-sonnet-4-6",
          reasoningLevel: "medium",
        },
        prompt: "Continue.",
        sessionId: "session-1",
      }),
      [
        "--resume",
        "session-1",
        "--model",
        "claude-sonnet-4-6",
        "--effort",
        "medium",
        "-p",
        "Continue.",
        "--allowedTools",
        ...OPENMELD_CLAUDE_ALLOWED_TOOLS,
        "--permission-mode",
        "default",
        "--output-format",
        "json",
      ]
    );
  });

  it("maps Agent Controller Permission Mode to exact Claude permission args", () => {
    assert.deepEqual(
      buildClaudeArgs({
        agentControllerPermissionMode: "claude-code:acceptEdits",
        prompt: "accept edits",
        sessionId: null,
      }),
      [
        "-p",
        "accept edits",
        "--allowedTools",
        ...OPENMELD_CLAUDE_ALLOWED_TOOLS,
        "--permission-mode",
        "acceptEdits",
        "--output-format",
        "json",
      ]
    );

    assert.deepEqual(
      buildClaudeArgs({
        agentControllerPermissionMode: "claude-code:auto",
        prompt: "auto",
        sessionId: null,
      }),
      [
        "-p",
        "auto",
        "--allowedTools",
        ...OPENMELD_CLAUDE_ALLOWED_TOOLS,
        "--permission-mode",
        "auto",
        "--output-format",
        "json",
      ]
    );

    assert.deepEqual(
      buildClaudeArgs({
        agentControllerPermissionMode: "claude-code:bypassPermissions",
        prompt: "full access",
        sessionId: null,
      }),
      [
        "-p",
        "full access",
        "--allowedTools",
        ...OPENMELD_CLAUDE_ALLOWED_TOOLS,
        "--permission-mode",
        "bypassPermissions",
        "--output-format",
        "json",
      ]
    );

    assert.deepEqual(
      buildClaudeArgs({
        agentControllerPermissionMode: "claude-code:bypassPermissions",
        executionMode: "repair",
        prompt: "repair",
        sessionId: null,
      }),
      [
        "-p",
        "repair",
        "--allowedTools",
        ...OPENMELD_CLAUDE_ALLOWED_TOOLS,
        "--permission-mode",
        "plan",
        "--output-format",
        "json",
      ]
    );
  });

  it("classifies retired or unknown model failures as invalid config", () => {
    const failure = classifyClaudeFailure({
      providerErrorMessages: [
        "Requested model claude-sonnet-4-0 is retired. Use claude-sonnet-4-6.",
      ],
    });

    assert.equal(failure.code, "config.invalid");
    assert.equal(failure.errorType, "config");
    assert.match(failure.message, CONFIG_INVALID_PREFIX_RE);
  });

  it("allows OpenMeld Space Action CLI commands for every local lane", () => {
    assert.deepEqual(OPENMELD_CLAUDE_ALLOWED_TOOLS, [
      "Bash(openmeld)",
      "Bash(openmeld *)",
      "Bash(openmeld-dev)",
      "Bash(openmeld-dev *)",
      "Bash(openmeld-canary)",
      "Bash(openmeld-canary *)",
    ]);
  });

  it("does not classify temporary model availability failures as invalid config", () => {
    const failure = classifyClaudeFailure({
      providerErrorMessages: ["Model claude-sonnet-4-6 is not available."],
    });

    assert.notEqual(failure.code, "config.invalid");
  });
});
