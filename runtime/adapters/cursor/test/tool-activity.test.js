import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCursorAcpToolActivityTracker } from "../dist/index.js";

describe("Cursor ACP tool activity", () => {
  it("preserves safe command work across incremental ACP updates", () => {
    const tracker = createCursorAcpToolActivityTracker();

    assert.deepEqual(
      tracker.observe(
        {
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-1",
              title: "Run tests",
              kind: "execute",
              status: "in_progress",
            },
          },
        },
        100
      ),
      {
        phase: "tool_activity",
        toolCallId: "tool-1",
        toolName: "agent_run_command",
        state: "input-available",
        tsMs: 100,
      }
    );

    assert.deepEqual(
      tracker.observe(
        {
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tool-1",
              rawInput: {
                command: "pnpm test --filter @openmeld/web",
              },
            },
          },
        },
        150
      ),
      {
        phase: "tool_activity",
        toolCallId: "tool-1",
        toolName: "agent_run_command",
        state: "input-available",
        tsMs: 150,
        work: {
          v: 1,
          key: "tests.run",
        },
      }
    );

    assert.deepEqual(
      tracker.observe(
        {
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tool-1",
              status: "completed",
            },
          },
        },
        200
      ),
      {
        phase: "tool_activity",
        toolCallId: "tool-1",
        toolName: "agent_run_command",
        state: "output-available",
        tsMs: 200,
        work: {
          v: 1,
          key: "tests.run",
        },
      }
    );
  });

  it("does not invent file work from a broad ACP kind without file evidence", () => {
    const tracker = createCursorAcpToolActivityTracker();

    assert.deepEqual(
      tracker.observe(
        {
          method: "session/update",
          params: {
            sessionId: "session-broad-read",
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-broad-read",
              kind: "read",
            },
          },
        },
        250
      ),
      {
        phase: "tool_activity",
        toolCallId: "tool-broad-read",
        toolName: "agent_read_files",
        state: "input-available",
        tsMs: 250,
      }
    );
  });

  it("describes file work without exposing raw ACP input", () => {
    const tracker = createCursorAcpToolActivityTracker();

    assert.deepEqual(
      tracker.observe(
        {
          method: "session/update",
          params: {
            sessionId: "session-2",
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-2",
              title: "Read README.md",
              kind: "read",
              rawInput: {
                path: "/Users/felix/private/repository/README.md",
              },
            },
          },
        },
        300
      ),
      {
        phase: "tool_activity",
        toolCallId: "tool-2",
        toolName: "agent_read_files",
        state: "input-available",
        tsMs: 300,
        work: {
          v: 1,
          key: "documentation.read",
        },
      }
    );
  });

  it("accepts ACP locations as reviewed file evidence", () => {
    const tracker = createCursorAcpToolActivityTracker();

    assert.deepEqual(
      tracker.observe(
        {
          method: "session/update",
          params: {
            sessionId: "session-location",
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-location",
              kind: "edit",
              locations: [
                {
                  path: "/Users/felix/private/repository/docs/setup.md",
                },
              ],
            },
          },
        },
        325
      ),
      {
        phase: "tool_activity",
        toolCallId: "tool-location",
        toolName: "agent_edit_files",
        state: "input-available",
        tsMs: 325,
        work: {
          v: 1,
          key: "documentation.update",
        },
      }
    );
  });

  it("locks the first tool name and first admitted work across richer updates", () => {
    const tracker = createCursorAcpToolActivityTracker();

    assert.deepEqual(
      tracker.observe(
        {
          method: "session/update",
          params: {
            sessionId: "session-stable",
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-stable",
              title: "Working",
            },
          },
        },
        350
      ),
      {
        phase: "tool_activity",
        toolCallId: "tool-stable",
        toolName: "agent_use_tool",
        state: "input-available",
        tsMs: 350,
      }
    );

    assert.deepEqual(
      tracker.observe(
        {
          method: "session/update",
          params: {
            sessionId: "session-stable",
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tool-stable",
              kind: "execute",
              rawInput: {
                command: "pnpm test",
              },
            },
          },
        },
        360
      ),
      {
        phase: "tool_activity",
        toolCallId: "tool-stable",
        toolName: "agent_use_tool",
        state: "input-available",
        tsMs: 360,
        work: {
          v: 1,
          key: "tests.run",
        },
      }
    );

    assert.deepEqual(
      tracker.observe(
        {
          method: "session/update",
          params: {
            sessionId: "session-stable",
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tool-stable",
              rawInput: {
                command: "pnpm build",
              },
            },
          },
        },
        370
      ),
      {
        phase: "tool_activity",
        toolCallId: "tool-stable",
        toolName: "agent_use_tool",
        state: "input-available",
        tsMs: 370,
        work: {
          v: 1,
          key: "tests.run",
        },
      }
    );
  });

  it("keeps terminal lifecycle state across sparse or conflicting updates", () => {
    const tracker = createCursorAcpToolActivityTracker();
    const observe = (update, observedAtMs) =>
      tracker.observe(
        {
          method: "session/update",
          params: {
            sessionId: "session-terminal",
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tool-terminal",
              ...update,
            },
          },
        },
        observedAtMs
      );

    assert.equal(observe({ kind: "execute" }, 500)?.state, "input-available");
    assert.equal(
      observe({ status: "completed" }, 510)?.state,
      "output-available"
    );
    assert.equal(observe({}, 520)?.state, "output-available");
    assert.equal(observe({ status: "failed" }, 530)?.state, "output-available");
  });

  it("keeps unknown ACP tools generic and private", () => {
    const tracker = createCursorAcpToolActivityTracker();

    assert.deepEqual(
      tracker.observe(
        {
          method: "session/update",
          params: {
            sessionId: "session-3",
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-3",
              title: "MCP: tool",
              kind: "other",
              rawInput: {
                secret: "private value",
              },
            },
          },
        },
        400
      ),
      {
        phase: "tool_activity",
        toolCallId: "tool-3",
        toolName: "agent_use_tool",
        state: "input-available",
        tsMs: 400,
      }
    );
  });

  it("ignores non-tool updates and tool updates without an id", () => {
    const tracker = createCursorAcpToolActivityTracker();

    assert.equal(
      tracker.observe({
        method: "session/update",
        params: {
          sessionId: "session-4",
          update: {
            sessionUpdate: "agent_message_chunk",
          },
        },
      }),
      null
    );
    assert.equal(
      tracker.observe({
        method: "session/update",
        params: {
          sessionId: "session-4",
          update: {
            sessionUpdate: "tool_call",
            title: "Run command",
            kind: "execute",
          },
        },
      }),
      null
    );
  });
});
