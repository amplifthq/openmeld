import { describe, expect, it } from "vitest";
import {
  incomingServerMessageSchema,
  signalEnvelopeSchema,
  spaceAgentActivitySchema,
  spaceAgentStreamDeltaFrameSchema,
  spaceAgentStreamPartFrameSchema,
  spaceAgentStreamSnapshotSchema,
  spaceAgentStreamTerminalFrameSchema,
} from "../../src/index";

const baseFrame = {
  v: 1,
  spaceId: "space_1",
  streamId: "stream:sub_123",
  sequence: 3,
  profileId: "agt_11111111-1111-4111-8111-111111111111",
  triggerMessageId: "signal_1",
  dispatchId: "dispatch_1",
  updatedAtMs: 1_805_000_000_000,
} as const;

describe("Space Agent stream frames", () => {
  it("accepts privacy-bounded durable Agent Work Summary metadata", () => {
    const activity = {
      v: 1,
      steps: [
        {
          toolName: "openmeld_read_space_context",
          state: "output-available",
        },
        {
          toolName: "github_search_issues",
          state: "output-error",
        },
      ],
      truncated: false,
    } as const;

    expect(spaceAgentActivitySchema.parse(activity)).toEqual(activity);
    expect(
      signalEnvelopeSchema.parse({
        v: 1,
        id: "signal_final_1",
        spaceId: "space_1",
        ts: 1_805_000_000_000,
        profile: {
          kind: "agent",
          profileId: "agt_11111111-1111-4111-8111-111111111111",
          profileName: "Center Agent",
        },
        type: "signal.text",
        data: {
          text: "Here is the final answer.",
          meta: {
            purpose: "agent_reply_final",
            agentActivity: activity,
            agentWorkSummary: activity,
          },
        },
      })
    ).toMatchObject({
      data: {
        meta: {
          agentActivity: activity,
          agentWorkSummary: activity,
        },
      },
    });
  });

  it("rejects private fields from durable Agent Activity", () => {
    expect(
      spaceAgentActivitySchema.safeParse({
        v: 1,
        steps: [
          {
            toolCallId: "tool_call_1",
            toolName: "openmeld_list_spaces",
            state: "output-available",
            output: { spaces: ["private"] },
          },
        ],
        truncated: false,
      }).success
    ).toBe(false);
  });

  it("keeps Connected App subjects out of legacy final-reply metadata", () => {
    const connectedAppActivity = {
      v: 1,
      steps: [
        {
          toolName: "openmeld_execute_app_action",
          state: "output-available",
          work: {
            v: 1,
            key: "connected_app.action.execute",
            subject: { kind: "connected_app", label: "Slack · post_message" },
          },
        },
      ],
      truncated: false,
    } as const;
    const signal = {
      v: 1,
      id: "signal_final_connected_app",
      spaceId: "space_1",
      ts: 1_805_000_000_000,
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Center Agent",
      },
      type: "signal.text",
      data: {
        text: "Done.",
        meta: {
          purpose: "agent_reply_final",
          agentWorkSummary: connectedAppActivity,
        },
      },
    } as const;

    expect(signalEnvelopeSchema.safeParse(signal).success).toBe(true);
    expect(
      signalEnvelopeSchema.safeParse({
        ...signal,
        data: {
          ...signal.data,
          meta: {
            ...signal.data.meta,
            agentActivity: connectedAppActivity,
          },
        },
      }).success
    ).toBe(false);
  });

  it("accepts accumulated stream snapshots through the incoming frame schema", () => {
    const frame = {
      ...baseFrame,
      type: "space.agent_stream_delta",
      state: "streaming",
      textSnapshot: "The release plan is almost ready.",
    } as const;

    expect(spaceAgentStreamDeltaFrameSchema.parse(frame)).toEqual(frame);
    expect(incomingServerMessageSchema.parse(frame)).toEqual(frame);
  });

  it("accepts transient thinking snapshots without adding them to stored stream snapshots", () => {
    const frame = {
      ...baseFrame,
      type: "space.agent_stream_delta",
      kind: "thinking",
      state: "streaming",
      thinkingSnapshot: "Reviewing the current Space state",
    } as const;

    expect(spaceAgentStreamDeltaFrameSchema.parse(frame)).toEqual(frame);
    expect(incomingServerMessageSchema.parse(frame)).toEqual(frame);
    expect(spaceAgentStreamSnapshotSchema.safeParse(frame).success).toBe(false);
  });

  it("accepts tool lifecycle parts with a safe user-facing work meaning", () => {
    const frame = {
      ...baseFrame,
      type: "space.agent_stream_part",
      part: {
        type: "tool",
        toolCallId: "tool_call_1",
        toolName: "command_execution",
        state: "input-available",
        work: {
          v: 1,
          key: "repository.clone",
          subject: {
            kind: "repository",
            label: "amplifthq/reply",
          },
        },
      },
    } as const;

    expect(spaceAgentStreamPartFrameSchema.parse(frame)).toEqual(frame);
    expect(incomingServerMessageSchema.parse(frame)).toEqual(frame);
  });

  it("keeps internal tool lifecycle parts valid when no work meaning is safe to show", () => {
    const frame = {
      ...baseFrame,
      type: "space.agent_stream_part",
      part: {
        type: "tool",
        toolCallId: "tool_call_2",
        toolName: "codemode",
        state: "output-error",
      },
    } as const;

    expect(spaceAgentStreamPartFrameSchema.parse(frame)).toEqual(frame);
  });

  it("rejects tool parts that attempt to carry private input or output", () => {
    expect(
      spaceAgentStreamPartFrameSchema.safeParse({
        ...baseFrame,
        type: "space.agent_stream_part",
        part: {
          type: "tool",
          toolCallId: "tool_call_1",
          toolName: "openmeld_list_spaces",
          state: "output-available",
          output: { spaces: ["private"] },
        },
      }).success
    ).toBe(false);
  });

  it("rejects unregistered work meanings and arbitrary work details", () => {
    expect(
      spaceAgentStreamPartFrameSchema.safeParse({
        ...baseFrame,
        type: "space.agent_stream_part",
        part: {
          type: "tool",
          toolCallId: "tool_call_3",
          toolName: "command_execution",
          state: "output-available",
          work: {
            v: 1,
            key: "command.run",
            command: "print-secret",
          },
        },
      }).success
    ).toBe(false);
  });

  it.each([
    { kind: "final_message", publishedSignalId: "signal_final_1" },
    {
      kind: "failed",
      reasonCode: "remote_agent.turn_failed",
      noticeText: "Center Agent could not finish this reply. Please try again.",
    },
    {
      kind: "stopped",
      reasonCode: "remote_agent.stopped",
      noticeText: "Center Agent stopped this reply.",
    },
    {
      kind: "completed_but_publish_failed",
      reasonCode: "remote_agent.callback_publish_failed",
      noticeText:
        "Center Agent finished the reply, but OpenMeld could not publish it here. Please try again or open diagnostics.",
    },
  ])("accepts the $kind terminal stream frame", (terminal) => {
    const frame = {
      ...baseFrame,
      type: "space.agent_stream_terminal",
      terminal,
    };

    expect(spaceAgentStreamTerminalFrameSchema.parse(frame)).toEqual(frame);
    expect(incomingServerMessageSchema.parse(frame)).toEqual(frame);
  });

  it("rejects unknown terminal kinds", () => {
    expect(
      spaceAgentStreamTerminalFrameSchema.safeParse({
        ...baseFrame,
        type: "space.agent_stream_terminal",
        terminal: {
          kind: "timed_out",
          reasonCode: "remote_agent.timed_out",
          noticeText: "Timed out.",
        },
      }).success
    ).toBe(false);
  });
});
