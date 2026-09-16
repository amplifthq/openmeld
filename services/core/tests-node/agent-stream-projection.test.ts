import { AGENT_REPLY_FINAL_PURPOSE } from "@openmeld/schemas";
import type {
  AgentStreamToolPart,
  SpaceAgentStreamSnapshot,
  SpaceAgentStreamTerminal,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  AGENT_STREAM_PROJECTION_RETENTION_MS,
  AGENT_WORKING_DETAILS_RETENTION_MS,
  type AgentStreamProjectionStorage,
  applyAgentStreamDelta,
  applyAgentStreamPart,
  applyAgentStreamThinkingDelta,
  attachAgentActivityToFinalReply,
  cleanupExpiredAgentStreamProjections,
  closeAgentStreamProjection,
  listActiveAgentStreamPresences,
  listActiveAgentStreamSnapshots,
  readAgentActivityForFinalReply,
  readAgentWorkingDetailsForSignal,
  readNextAgentStreamProjectionAlarmAtMs,
} from "../src/space/application/agent-stream-projection";

const SPACE_ID =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

describe("Space Agent stream projection", () => {
  it("accepts the explicit text kind used by the stream RPC without persisting it", async () => {
    const storage = new MemoryProjectionStorage();

    const result = await applyAgentStreamDelta({
      storage,
      delta: {
        ...createDelta({ sequence: 1, textSnapshot: "Hello" }),
        kind: "text",
      },
      nowMs: 1000,
    });

    expect(result).toMatchObject({
      status: "accepted",
      snapshot: {
        sequence: 1,
        textSnapshot: "Hello",
      },
    });
    expect(result).not.toHaveProperty("snapshot.kind");
  });

  it("restores thinking-only stream presence without persisting model thinking", async () => {
    const storage = new MemoryProjectionStorage();

    await expect(
      applyAgentStreamThinkingDelta({
        storage,
        delta: {
          ...createDelta({ sequence: 1 }),
          thinkingSnapshot: "Checking the current Space state",
        },
        nowMs: 1000,
      })
    ).resolves.toMatchObject({
      status: "accepted",
      gapDetected: false,
      lastSequence: 1,
    });
    await expect(
      listActiveAgentStreamSnapshots({ storage, nowMs: 1000 })
    ).resolves.toEqual([]);
    await expect(
      listActiveAgentStreamPresences({ storage, nowMs: 1000 })
    ).resolves.toEqual([
      expect.objectContaining({
        createdAtMs: 1000,
        sequence: 1,
        streamId: "stream:sub_1",
        updatedAtMs: 1000,
      }),
    ]);
    const storedPresence = (
      await listActiveAgentStreamPresences({ storage, nowMs: 1000 })
    )[0];
    expect(storedPresence).not.toHaveProperty("thinkingSnapshot");
    expect(storedPresence).not.toHaveProperty("textSnapshot");

    await expect(
      applyAgentStreamDelta({
        storage,
        delta: createDelta({ sequence: 2, textSnapshot: "Done." }),
        nowMs: 1100,
      })
    ).resolves.toMatchObject({
      status: "accepted",
      snapshot: {
        createdAtMs: 1000,
        sequence: 2,
        textSnapshot: "Done.",
      },
    });
  });

  it("deduplicates replayed sequences and accepts the latest out-of-order snapshot", async () => {
    const storage = new MemoryProjectionStorage();

    await expect(
      applyAgentStreamDelta({
        storage,
        delta: createDelta({ sequence: 1, textSnapshot: "Hello" }),
        nowMs: 1000,
      })
    ).resolves.toMatchObject({
      status: "accepted",
      gapDetected: false,
      lastSequence: 1,
    });

    await expect(
      applyAgentStreamDelta({
        storage,
        delta: createDelta({ sequence: 1, textSnapshot: "Replayed" }),
        nowMs: 1100,
      })
    ).resolves.toEqual({
      status: "duplicate_accepted",
      lastSequence: 1,
    });

    await expect(
      applyAgentStreamDelta({
        storage,
        delta: createDelta({
          sequence: 3,
          textSnapshot: "Hello from the latest snapshot",
        }),
        nowMs: 1200,
      })
    ).resolves.toMatchObject({
      status: "accepted",
      gapDetected: true,
      lastSequence: 3,
    });

    await expect(
      listActiveAgentStreamSnapshots({ storage, nowMs: 1200 })
    ).resolves.toEqual([
      expect.objectContaining({
        sequence: 3,
        textSnapshot: "Hello from the latest snapshot",
        gapDetected: true,
      }),
    ]);
  });

  it("rebuilds active stream state from durable storage after a reader restart", async () => {
    const storage = new MemoryProjectionStorage();
    await applyAgentStreamDelta({
      storage,
      delta: {
        ...createDelta({ sequence: 2, textSnapshot: "Restored text" }),
        replyThreadRootSignalId: "source-root",
      },
      nowMs: 2000,
    });

    const restartedReaderStorage = storage.reopen();

    await expect(
      listActiveAgentStreamSnapshots({
        storage: restartedReaderStorage,
        nowMs: 2100,
      })
    ).resolves.toEqual([
      expect.objectContaining({
        streamId: "stream:sub_1",
        sequence: 2,
        textSnapshot: "Restored text",
        replyThreadRootSignalId: "source-root",
      }),
    ]);
  });

  it("quarantines malformed transient projection records instead of blocking a Space restart", async () => {
    const storage = new MemoryProjectionStorage();
    await storage.put("agent_stream:malformed", { v: 0 });
    await storage.put("agent_stream_cursor:malformed", { v: 0 });
    await storage.put("agent_stream_terminal:malformed", { v: 0 });
    await storage.put("agent_stream_working_draft:malformed", { v: 0 });
    await storage.put("agent_working_details:malformed", { v: 0 });
    const quarantinedRecordKinds: string[] = [];

    await expect(
      readNextAgentStreamProjectionAlarmAtMs(storage, {
        onInvalidRecord: (record) => {
          quarantinedRecordKinds.push(record.recordKind);
        },
      })
    ).resolves.toBeNull();
    await expect(
      listActiveAgentStreamSnapshots({ storage, nowMs: 1000 })
    ).resolves.toEqual([]);

    await expect(storage.list({ prefix: "agent_stream:" })).resolves.toEqual(
      new Map()
    );
    await expect(
      storage.list({ prefix: "agent_stream_cursor:" })
    ).resolves.toEqual(new Map());
    await expect(
      storage.list({ prefix: "agent_stream_terminal:" })
    ).resolves.toEqual(new Map());
    await expect(
      storage.list({ prefix: "agent_stream_working_draft:" })
    ).resolves.toEqual(new Map());
    await expect(
      storage.list({ prefix: "agent_working_details:" })
    ).resolves.toEqual(new Map());
    expect(quarantinedRecordKinds.sort()).toEqual([
      "active_stream",
      "cursor",
      "published_working_details",
      "terminal_guard",
      "working_details_draft",
    ]);
  });

  it.each<SpaceAgentStreamTerminal>([
    { kind: "final_message", publishedSignalId: "signal_final_1" },
    {
      kind: "failed",
      reasonCode: "remote_agent.model_failed",
      noticeText: "Center Agent could not finish this reply.",
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
        "Center Agent finished the reply, but OpenMeld could not publish it here.",
    },
  ])("closes $kind streams and rejects late deltas", async (terminal) => {
    const storage = new MemoryProjectionStorage();
    await applyAgentStreamDelta({
      storage,
      delta: {
        ...createDelta({ sequence: 1, textSnapshot: "Partial reply" }),
        replyThreadRootSignalId: "source-root",
      },
      nowMs: 3000,
    });

    await expect(
      closeAgentStreamProjection({
        storage,
        streamId: "stream:sub_1",
        terminal,
        nowMs: 3100,
      })
    ).resolves.toMatchObject({
      status: "closed",
      snapshot: expect.objectContaining({ sequence: 1 }),
      stream: expect.objectContaining({
        replyThreadRootSignalId: "source-root",
      }),
    });
    await expect(
      listActiveAgentStreamSnapshots({ storage, nowMs: 3100 })
    ).resolves.toEqual([]);
    await expect(
      applyAgentStreamDelta({
        storage,
        delta: createDelta({ sequence: 2, textSnapshot: "Late reply" }),
        nowMs: 3200,
      })
    ).resolves.toEqual({
      status: "rejected",
      reasonCode: "agent_stream.terminal",
      lastSequence: 1,
    });
  });

  it("removes abandoned streams and terminal guards after thirty minutes", async () => {
    const storage = new MemoryProjectionStorage();
    await applyAgentStreamDelta({
      storage,
      delta: createDelta({ sequence: 1, textSnapshot: "Abandoned" }),
      nowMs: 4000,
    });

    await expect(readNextAgentStreamProjectionAlarmAtMs(storage)).resolves.toBe(
      4000 + AGENT_STREAM_PROJECTION_RETENTION_MS
    );
    await expect(
      cleanupExpiredAgentStreamProjections({
        storage,
        nowMs: 4000 + AGENT_STREAM_PROJECTION_RETENTION_MS - 1,
      })
    ).resolves.toEqual({
      activeDeleted: 0,
      terminalGuardsDeleted: 0,
      workingDetailsDeleted: 0,
    });
    await expect(
      cleanupExpiredAgentStreamProjections({
        storage,
        nowMs: 4000 + AGENT_STREAM_PROJECTION_RETENTION_MS,
      })
    ).resolves.toEqual({
      activeDeleted: 1,
      terminalGuardsDeleted: 0,
      workingDetailsDeleted: 0,
    });

    await applyAgentStreamDelta({
      storage,
      delta: createDelta({ sequence: 1, textSnapshot: "Terminal soon" }),
      nowMs: 5000 + AGENT_STREAM_PROJECTION_RETENTION_MS,
    });
    await closeAgentStreamProjection({
      storage,
      streamId: "stream:sub_1",
      terminal: {
        kind: "final_message",
        publishedSignalId: "signal_final_2",
      },
      nowMs: 5100 + AGENT_STREAM_PROJECTION_RETENTION_MS,
    });

    await expect(
      cleanupExpiredAgentStreamProjections({
        storage,
        nowMs: 5100 + AGENT_STREAM_PROJECTION_RETENTION_MS * 2,
      })
    ).resolves.toEqual({
      activeDeleted: 0,
      terminalGuardsDeleted: 1,
      workingDetailsDeleted: 0,
    });
    await expect(
      readNextAgentStreamProjectionAlarmAtMs(storage)
    ).resolves.toBeNull();
  });

  it("keeps tool parts and text snapshots on one ordered stream", async () => {
    const storage = new MemoryProjectionStorage();

    const tool = await applyAgentStreamPart({
      storage,
      nowMs: 1000,
      part: createPart({ sequence: 1 }),
    });
    const text = await applyAgentStreamDelta({
      storage,
      nowMs: 1100,
      delta: createDelta({
        sequence: 2,
        textSnapshot: "I found the Space.",
      }),
    });

    expect(tool).toMatchObject({
      status: "accepted",
      lastSequence: 1,
      gapDetected: false,
    });
    expect(text).toMatchObject({
      status: "accepted",
      lastSequence: 2,
      gapDetected: false,
      snapshot: {
        createdAtMs: 1000,
        sequence: 2,
        textSnapshot: "I found the Space.",
      },
    });
  });

  it("closes a tool-only stream so live activity cannot linger", async () => {
    const storage = new MemoryProjectionStorage();
    await applyAgentStreamPart({
      storage,
      nowMs: 1000,
      part: createPart({
        part: {
          type: "tool",
          toolCallId: "tool_call_1",
          toolName: "openmeld_list_spaces",
          state: "output-available",
          work: {
            v: 1,
            key: "spaces.read",
          },
        },
      }),
    });

    const closed = await closeAgentStreamProjection({
      storage,
      streamId: "stream:sub_1",
      terminal: {
        kind: "final_message",
        publishedSignalId: "signal_final_1",
      },
      nowMs: 1100,
    });
    const latePart = await applyAgentStreamPart({
      storage,
      nowMs: 1200,
      part: createPart({
        sequence: 2,
        part: {
          type: "tool",
          toolCallId: "tool_call_2",
          toolName: "openmeld_read_space_context",
          state: "input-available",
        },
      }),
    });

    expect(closed).toMatchObject({
      status: "closed",
      snapshot: null,
      stream: { streamId: "stream:sub_1", sequence: 1 },
    });
    expect(latePart).toEqual({
      status: "rejected",
      reasonCode: "agent_stream.terminal",
      lastSequence: 1,
    });
  });

  it("deduplicates tool lifecycle parts by the shared sequence", async () => {
    const storage = new MemoryProjectionStorage();
    const part = createPart();

    await applyAgentStreamPart({ storage, nowMs: 1000, part });

    await expect(
      applyAgentStreamPart({ storage, nowMs: 1010, part })
    ).resolves.toEqual({
      status: "duplicate_accepted",
      lastSequence: 1,
    });
  });

  it("restores tool-only stream presence from durable storage", async () => {
    const storage = new MemoryProjectionStorage();

    await applyAgentStreamPart({
      storage,
      nowMs: 1000,
      part: createPart(),
    });

    await expect(
      listActiveAgentStreamPresences({
        storage: storage.reopen(),
        nowMs: 1100,
      })
    ).resolves.toEqual([
      expect.objectContaining({
        createdAtMs: 1000,
        sequence: 1,
        streamId: "stream:sub_1",
      }),
    ]);
  });

  it("moves privacy-bounded tool activity to the published reply", async () => {
    const storage = new MemoryProjectionStorage();
    await applyAgentStreamPart({
      storage,
      nowMs: 1000,
      part: createPart(),
    });
    await applyAgentStreamPart({
      storage,
      nowMs: 1200,
      part: createPart({
        sequence: 2,
        part: {
          type: "tool",
          toolCallId: "tool_call_1",
          toolName: "openmeld_list_spaces",
          state: "output-available",
        },
      }),
    });
    await applyAgentStreamPart({
      storage,
      nowMs: 1300,
      part: createPart({
        sequence: 3,
        part: {
          type: "tool",
          toolCallId: "tool_call_2",
          toolName: "github_search_issues",
          state: "output-error",
          work: {
            v: 1,
            key: "github.issues.search",
          },
        },
      }),
    });

    await expect(
      readAgentActivityForFinalReply({
        storage,
        spaceId: SPACE_ID,
        dispatchId: "dispatch_1",
        profileId: PROFILE_ID,
        streamId: "stream:sub_1",
        nowMs: 1350,
      })
    ).resolves.toEqual({
      v: 1,
      steps: [
        {
          toolName: "openmeld_list_spaces",
          state: "output-available",
          work: {
            v: 1,
            key: "spaces.read",
          },
        },
        {
          toolName: "github_search_issues",
          state: "output-error",
          work: {
            v: 1,
            key: "github.issues.search",
          },
        },
      ],
      truncated: false,
    });
    await expect(
      attachAgentActivityToFinalReply({
        agentStreamId: "stream:sub_1",
        storage,
        nowMs: 1350,
        signal: {
          v: 1,
          id: "signal_final_with_tools",
          spaceId: SPACE_ID,
          ts: 1350,
          profile: {
            kind: "agent",
            profileId: PROFILE_ID,
            profileName: "Center Agent",
          },
          type: "signal.text",
          data: {
            text: "Here is the final answer.",
            meta: {
              dispatchId: "dispatch_1",
              purpose: AGENT_REPLY_FINAL_PURPOSE,
            },
          },
        },
      })
    ).resolves.toMatchObject({
      data: {
        meta: {
          agentActivity: {
            v: 1,
            steps: [
              {
                toolName: "openmeld_list_spaces",
                state: "output-available",
                work: {
                  v: 1,
                  key: "spaces.read",
                },
              },
              {
                toolName: "github_search_issues",
                state: "output-error",
                work: {
                  v: 1,
                  key: "github.issues.search",
                },
              },
            ],
            truncated: false,
          },
        },
      },
    });

    await closeAgentStreamProjection({
      storage,
      streamId: "stream:sub_1",
      terminal: {
        kind: "final_message",
        publishedSignalId: "signal_final_with_tools",
      },
      nowMs: 1400,
    });

    await expect(
      readAgentWorkingDetailsForSignal({
        storage,
        signalId: "signal_final_with_tools",
        nowMs: 1500,
      })
    ).resolves.toEqual({
      state: "recorded",
      tools: [
        {
          toolName: "openmeld_list_spaces",
          state: "output-available",
          startedAtMs: 1000,
          updatedAtMs: 1200,
          work: {
            v: 1,
            key: "spaces.read",
          },
        },
        {
          toolName: "github_search_issues",
          state: "output-error",
          startedAtMs: 1300,
          updatedAtMs: 1300,
          work: {
            v: 1,
            key: "github.issues.search",
          },
        },
      ],
      truncated: false,
    });
    const storedPublishedDetails = await storage.get<unknown>(
      "agent_working_details:signal_final_with_tools"
    );
    expect(JSON.stringify(storedPublishedDetails)).not.toContain("tool_call_1");
    expect(JSON.stringify(storedPublishedDetails)).not.toContain("dispatch_1");
    await expect(readNextAgentStreamProjectionAlarmAtMs(storage)).resolves.toBe(
      1400 + AGENT_STREAM_PROJECTION_RETENTION_MS
    );
    await expect(
      cleanupExpiredAgentStreamProjections({
        storage,
        nowMs: 1400 + AGENT_WORKING_DETAILS_RETENTION_MS,
      })
    ).resolves.toEqual({
      activeDeleted: 0,
      terminalGuardsDeleted: 1,
      workingDetailsDeleted: 1,
    });
    await expect(
      readAgentWorkingDetailsForSignal({
        storage,
        signalId: "signal_final_with_tools",
        nowMs: 1400 + AGENT_WORKING_DETAILS_RETENTION_MS,
      })
    ).resolves.toBeNull();
  });

  it("attaches only the exact execution attempt activity to the final reply", async () => {
    const storage = new MemoryProjectionStorage();
    await applyAgentStreamPart({
      storage,
      nowMs: 1000,
      part: createPart({
        streamId: "stream:attempt-1",
        part: {
          type: "tool",
          toolCallId: "tool_call_attempt_1",
          toolName: "github_search_issues",
          state: "output-available",
          work: {
            v: 1,
            key: "github.issues.search",
          },
        },
      }),
    });
    await applyAgentStreamPart({
      storage,
      nowMs: 1100,
      part: createPart({
        streamId: "stream:attempt-2",
        part: {
          type: "tool",
          toolCallId: "tool_call_attempt_2",
          toolName: "openmeld_list_spaces",
          state: "output-available",
          work: {
            v: 1,
            key: "spaces.read",
          },
        },
      }),
    });

    await expect(
      attachAgentActivityToFinalReply({
        agentStreamId: "stream:attempt-2",
        storage,
        nowMs: 1200,
        signal: {
          v: 1,
          id: "signal_final_attempt_2",
          spaceId: SPACE_ID,
          ts: 1200,
          profile: {
            kind: "agent",
            profileId: PROFILE_ID,
            profileName: "Center Agent",
          },
          type: "signal.text",
          data: {
            text: "Here is the final answer from attempt 2.",
            meta: {
              dispatchId: "dispatch_1",
              purpose: AGENT_REPLY_FINAL_PURPOSE,
            },
          },
        },
      })
    ).resolves.toMatchObject({
      data: {
        meta: {
          agentActivity: {
            v: 1,
            steps: [
              {
                toolName: "openmeld_list_spaces",
                state: "output-available",
                work: {
                  v: 1,
                  key: "spaces.read",
                },
              },
            ],
            truncated: false,
          },
        },
      },
    });
  });

  it("discards tool activity when a stream does not publish a reply", async () => {
    const storage = new MemoryProjectionStorage();
    await applyAgentStreamPart({
      storage,
      nowMs: 1000,
      part: createPart(),
    });
    await closeAgentStreamProjection({
      storage,
      streamId: "stream:sub_1",
      terminal: {
        kind: "failed",
        reasonCode: "remote_agent.model_failed",
        noticeText: "Center Agent could not finish this reply.",
      },
      nowMs: 1100,
    });

    await expect(
      readAgentWorkingDetailsForSignal({
        storage,
        signalId: "signal_failure_notice",
        nowMs: 1200,
      })
    ).resolves.toBeNull();
  });
});

function createDelta(
  overrides: Partial<SpaceAgentStreamSnapshot> = {}
): Omit<
  SpaceAgentStreamSnapshot,
  "createdAtMs" | "expiresAtMs" | "gapDetected" | "state" | "updatedAtMs"
> {
  return {
    v: 1,
    spaceId: SPACE_ID,
    streamId: "stream:sub_1",
    sequence: 1,
    profileId: PROFILE_ID,
    triggerMessageId: "signal_trigger_1",
    dispatchId: "dispatch_1",
    textSnapshot: "Hello",
    ...overrides,
  };
}

function createPart(
  overrides: {
    part?: AgentStreamToolPart;
    sequence?: number;
    streamId?: string;
  } = {}
) {
  return {
    v: 1 as const,
    spaceId: SPACE_ID,
    streamId: overrides.streamId ?? "stream:sub_1",
    sequence: overrides.sequence ?? 1,
    profileId: PROFILE_ID,
    triggerMessageId: "signal_trigger_1",
    dispatchId: "dispatch_1",
    part: overrides.part ?? {
      type: "tool" as const,
      toolCallId: "tool_call_1",
      toolName: "openmeld_list_spaces",
      state: "input-available" as const,
      work: {
        v: 1 as const,
        key: "spaces.read" as const,
      },
    },
  };
}

class MemoryProjectionStorage implements AgentStreamProjectionStorage {
  private readonly values: Map<string, unknown>;

  constructor(values = new Map<string, unknown>()) {
    this.values = values;
  }

  reopen(): MemoryProjectionStorage {
    return new MemoryProjectionStorage(this.values);
  }

  delete(key: string | string[]): Promise<boolean | number> {
    if (Array.isArray(key)) {
      let deleted = 0;
      for (const item of key) {
        deleted += this.values.delete(item) ? 1 : 0;
      }
      return Promise.resolve(deleted);
    }
    return Promise.resolve(this.values.delete(key));
  }

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.values.get(key) as T | undefined);
  }

  list<T>(options: { prefix: string }): Promise<Map<string, T>> {
    return Promise.resolve(
      new Map(
        [...this.values.entries()].filter(([key]) =>
          key.startsWith(options.prefix)
        )
      ) as Map<string, T>
    );
  }

  put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  async transaction<T>(
    closure: (transaction: AgentStreamProjectionStorage) => Promise<T>
  ): Promise<T> {
    return await closure(this);
  }
}
