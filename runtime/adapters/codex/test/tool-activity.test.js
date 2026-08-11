import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractCodexToolActivityEvent } from "../dist/index.js";

describe("Codex tool activity", () => {
  it("describes recognized app-server command work without exposing command text", () => {
    assert.deepEqual(
      extractCodexToolActivityEvent(
        {
          method: "item/started",
          params: {
            startedAtMs: 100,
            item: {
              type: "commandExecution",
              id: "item-1",
              command: "print-secret",
              status: "inProgress",
            },
          },
        },
        999
      ),
      {
        phase: "tool_activity",
        toolCallId: "item-1",
        toolName: "agent_run_command",
        state: "input-available",
        tsMs: 100,
      }
    );

    assert.deepEqual(
      extractCodexToolActivityEvent(
        {
          method: "item/completed",
          params: {
            completedAtMs: 150,
            item: {
              type: "commandExecution",
              id: "item-1",
              command: "print-secret",
              aggregatedOutput: "private output",
              status: "completed",
            },
          },
        },
        999
      ),
      {
        phase: "tool_activity",
        toolCallId: "item-1",
        toolName: "agent_run_command",
        state: "output-available",
        tsMs: 150,
      }
    );
  });

  it("adds safe work semantics for recognized commands and hides unknown commands", () => {
    assert.deepEqual(
      extractCodexToolActivityEvent(
        {
          method: "item/started",
          params: {
            item: {
              type: "commandExecution",
              id: "clone-1",
              command: "gh repo clone amplifthq/reply /tmp/reply",
            },
          },
        },
        100
      ),
      {
        phase: "tool_activity",
        toolCallId: "clone-1",
        toolName: "agent_run_command",
        state: "input-available",
        tsMs: 100,
        work: {
          v: 1,
          key: "repository.clone",
          subject: {
            kind: "repository",
            label: "amplifthq/reply",
          },
        },
      }
    );

    assert.equal(
      extractCodexToolActivityEvent(
        {
          method: "item/started",
          params: {
            item: {
              type: "commandExecution",
              id: "secret-1",
              command: "print-secret",
            },
          },
        },
        100
      )?.work,
      undefined
    );
  });

  it("reads CLI JSONL tool items and preserves only a stable category", () => {
    assert.deepEqual(
      extractCodexToolActivityEvent(
        {
          type: "item.completed",
          item: {
            type: "file_change",
            id: "item-2",
            changes: [{ path: "/private/file", kind: "update" }],
            status: "failed",
          },
        },
        200
      ),
      {
        phase: "tool_activity",
        toolCallId: "item-2",
        toolName: "agent_edit_files",
        state: "output-error",
        tsMs: 200,
        work: {
          v: 1,
          key: "source.update",
        },
      }
    );
  });

  it("ignores text and reasoning items", () => {
    assert.equal(
      extractCodexToolActivityEvent(
        {
          method: "item/completed",
          params: {
            item: {
              type: "agentMessage",
              id: "message-1",
              text: "private answer",
            },
          },
        },
        300
      ),
      null
    );
  });
});
