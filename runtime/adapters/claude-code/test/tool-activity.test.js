import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClaudeAgentSdkToolActivityTracker } from "../dist/index.js";

describe("Claude Agent SDK tool activity", () => {
  it("retains safe work meaning across start and completion without retaining tool input or output", () => {
    const tracker = createClaudeAgentSdkToolActivityTracker();

    assert.deepEqual(
      tracker.observe(
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tool-use-1",
                name: "Bash",
                input: { command: "pnpm test --filter @openmeld/web" },
              },
            ],
          },
        },
        100
      ),
      [
        {
          phase: "tool_activity",
          toolCallId: "tool-use-1",
          toolName: "agent_run_command",
          state: "input-available",
          tsMs: 100,
          work: {
            v: 1,
            key: "tests.run",
          },
        },
      ]
    );

    assert.deepEqual(
      tracker.observe(
        {
          type: "tool_progress",
          tool_use_id: "tool-use-1",
          tool_name: "Bash",
        },
        110
      ),
      []
    );

    assert.deepEqual(
      tracker.observe(
        {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-use-1",
                content: "private command output",
              },
            ],
          },
        },
        120
      ),
      [
        {
          phase: "tool_activity",
          toolCallId: "tool-use-1",
          toolName: "agent_run_command",
          state: "output-available",
          tsMs: 120,
          work: {
            v: 1,
            key: "tests.run",
          },
        },
      ]
    );
  });

  it("marks failed tool results without exposing their error text", () => {
    const tracker = createClaudeAgentSdkToolActivityTracker();
    tracker.observe(
      {
        type: "tool_progress",
        tool_use_id: "tool-use-2",
        tool_name: "Read",
      },
      200
    );

    assert.deepEqual(
      tracker.observe(
        {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-use-2",
                is_error: true,
                content: "private path and error",
              },
            ],
          },
        },
        220
      ),
      [
        {
          phase: "tool_activity",
          toolCallId: "tool-use-2",
          toolName: "agent_read_files",
          state: "output-error",
          tsMs: 220,
          work: {
            v: 1,
            key: "source.read",
          },
        },
      ]
    );
  });
});
