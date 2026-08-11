import { AGENT_REPLY_FINAL_PURPOSE } from "@openmeld/schemas";
import type { AgentStreamToolPart } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  type AgentStreamProjectionStorage,
  applyAgentStreamPart,
  attachAgentActivityToFinalReply,
  closeAgentStreamProjection,
  readAgentWorkingDetailsForSignal,
} from "../space/application/agent-stream-projection";

const STREAM = {
  v: 1 as const,
  spaceId: "space-1",
  streamId: "stream-1",
  profileId: "agt_55555555-5555-4555-8555-555555555555",
  triggerMessageId: "signal-1",
  dispatchId: "dispatch-1",
};

describe("Agent stream work invariants", () => {
  it("locks the tool identity and semantic work after their first frame", async () => {
    const storage = createStorage();

    await applyPart(storage, 1, {
      type: "tool",
      toolCallId: "tool-call-1",
      toolName: "web_fetch",
      state: "input-available",
    });
    await applyPart(storage, 2, {
      type: "tool",
      toolCallId: "tool-call-1",
      toolName: "web_fetch",
      state: "output-available",
      work: {
        v: 1,
        key: "webpage.read",
        subject: { kind: "website", label: "docs.example.com" },
      },
    });

    await expect(
      applyPart(storage, 3, {
        type: "tool",
        toolCallId: "tool-call-1",
        toolName: "web_fetch",
        state: "output-available",
        work: {
          v: 1,
          key: "webpage.read",
          subject: { kind: "website", label: "private.example.com" },
        },
      })
    ).rejects.toThrow("changed work");
    await expect(
      applyPart(storage, 4, {
        type: "tool",
        toolCallId: "tool-call-1",
        toolName: "different_tool",
        state: "output-available",
      })
    ).rejects.toThrow("changed toolName");
  });

  it("rejects terminal state changes and lifecycle regressions", async () => {
    const storage = createStorage();

    await applyPart(storage, 1, {
      type: "tool",
      toolCallId: "tool-call-1",
      toolName: "web_fetch",
      state: "input-available",
      work: { v: 1, key: "webpage.read" },
    });
    await applyPart(storage, 2, {
      type: "tool",
      toolCallId: "tool-call-1",
      toolName: "web_fetch",
      state: "output-error",
    });

    await expect(
      applyPart(storage, 3, {
        type: "tool",
        toolCallId: "tool-call-1",
        toolName: "web_fetch",
        state: "input-available",
      })
    ).rejects.toThrow("invalid state transition");
    await expect(
      applyPart(storage, 4, {
        type: "tool",
        toolCallId: "tool-call-1",
        toolName: "web_fetch",
        state: "output-available",
      })
    ).rejects.toThrow("invalid state transition");
  });

  it("keeps unclassified tool calls out of published working details", async () => {
    const storage = createStorage();

    await applyPart(storage, 1, {
      type: "tool",
      toolCallId: "tool-call-hidden",
      toolName: "private_internal_tool",
      state: "output-available",
    });
    await closeAgentStreamProjection({
      storage,
      streamId: STREAM.streamId,
      terminal: {
        kind: "final_message",
        publishedSignalId: "signal-final",
      },
      nowMs: 3,
    });

    await expect(
      readAgentWorkingDetailsForSignal({
        storage,
        signalId: "signal-final",
        nowMs: 4,
      })
    ).resolves.toBeNull();
  });

  it("does not let hidden tool calls evict admitted work or mark it truncated", async () => {
    const storage = createStorage();

    await applyPart(storage, 1, {
      type: "tool",
      toolCallId: "tool-call-visible",
      toolName: "web_fetch",
      state: "output-available",
      work: {
        v: 1,
        key: "webpage.read",
        subject: { kind: "website", label: "docs.example.com" },
      },
    });
    for (let sequence = 2; sequence <= 51; sequence += 1) {
      await applyPart(storage, sequence, {
        type: "tool",
        toolCallId: `tool-call-hidden-${sequence}`,
        toolName: "private_internal_tool",
        state: "output-available",
      });
    }
    await closeAgentStreamProjection({
      storage,
      streamId: STREAM.streamId,
      terminal: {
        kind: "final_message",
        publishedSignalId: "signal-final",
      },
      nowMs: 52,
    });

    await expect(
      readAgentWorkingDetailsForSignal({
        storage,
        signalId: "signal-final",
        nowMs: 53,
      })
    ).resolves.toMatchObject({
      state: "recorded",
      tools: [
        {
          work: {
            key: "webpage.read",
            subject: { kind: "website", label: "docs.example.com" },
          },
        },
      ],
      truncated: false,
    });
  });

  it("keeps hidden tool identities locked outside the visible summary quota", async () => {
    const storage = createStorage();

    await applyPart(storage, 1, {
      type: "tool",
      toolCallId: "tool-call-first-hidden",
      toolName: "web_fetch",
      state: "input-available",
    });
    for (let sequence = 2; sequence <= 51; sequence += 1) {
      await applyPart(storage, sequence, {
        type: "tool",
        toolCallId: `tool-call-hidden-${sequence}`,
        toolName: "private_internal_tool",
        state: "output-available",
      });
    }

    await expect(
      applyPart(storage, 52, {
        type: "tool",
        toolCallId: "tool-call-first-hidden",
        toolName: "different_tool",
        state: "output-available",
        work: { v: 1, key: "webpage.read" },
      })
    ).rejects.toThrow("changed toolName");
  });

  it("truncates only after more than 50 presentable work calls", async () => {
    const storage = createStorage();

    for (let sequence = 1; sequence <= 51; sequence += 1) {
      await applyPart(storage, sequence, {
        type: "tool",
        toolCallId: `tool-call-visible-${sequence}`,
        toolName: "web_fetch",
        state: "output-available",
        work: {
          v: 1,
          key: "webpage.read",
          subject: {
            kind: "website",
            label: `docs-${sequence}.example.com`,
          },
        },
      });
    }
    await closeAgentStreamProjection({
      storage,
      streamId: STREAM.streamId,
      terminal: {
        kind: "final_message",
        publishedSignalId: "signal-final",
      },
      nowMs: 52,
    });

    const details = await readAgentWorkingDetailsForSignal({
      storage,
      signalId: "signal-final",
      nowMs: 53,
    });
    expect(details).toMatchObject({
      state: "recorded",
      truncated: true,
    });
    expect(details?.tools).toHaveLength(50);
    expect(details?.tools[0]?.work?.subject?.label).toBe("docs-2.example.com");
    expect(details?.tools.at(-1)?.work?.subject?.label).toBe(
      "docs-51.example.com"
    );
  });

  it("keeps following new visible work after the lifecycle index fills", async () => {
    const storage = createStorage();

    for (let sequence = 1; sequence <= 500; sequence += 1) {
      await applyPart(storage, sequence, {
        type: "tool",
        toolCallId: `tool-call-hidden-${sequence}`,
        toolName: "private_internal_tool",
        state: "output-available",
      });
    }
    await applyPart(storage, 501, {
      type: "tool",
      toolCallId: "tool-call-visible-after-capacity",
      toolName: "web_fetch",
      state: "output-available",
      work: {
        v: 1,
        key: "webpage.read",
        subject: {
          kind: "website",
          label: "latest.example.com",
        },
      },
    });
    await closeAgentStreamProjection({
      storage,
      streamId: STREAM.streamId,
      terminal: {
        kind: "final_message",
        publishedSignalId: "signal-final",
      },
      nowMs: 502,
    });

    await expect(
      readAgentWorkingDetailsForSignal({
        storage,
        signalId: "signal-final",
        nowMs: 503,
      })
    ).resolves.toMatchObject({
      state: "recorded",
      tools: [
        {
          work: {
            key: "webpage.read",
            subject: { kind: "website", label: "latest.example.com" },
          },
        },
      ],
      truncated: false,
    });
  });

  it("keeps new Connected App work out of the legacy final-reply field", async () => {
    const storage = createStorage();

    await applyPart(storage, 1, {
      type: "tool",
      toolCallId: "tool-call-connected-app",
      toolName: "openmeld_execute_app_action",
      state: "output-available",
      work: {
        v: 1,
        key: "connected_app.action.execute",
        subject: { kind: "connected_app", label: "Slack" },
      },
    });

    const signal = await attachAgentActivityToFinalReply({
      agentStreamId: STREAM.streamId,
      storage,
      nowMs: 2,
      signal: {
        v: 1,
        id: "signal-final",
        spaceId: STREAM.spaceId,
        ts: 2,
        profile: {
          kind: "agent",
          profileId: STREAM.profileId,
          profileName: "Center Agent",
        },
        type: "signal.text",
        data: {
          text: "Done.",
          meta: {
            dispatchId: STREAM.dispatchId,
            purpose: AGENT_REPLY_FINAL_PURPOSE,
          },
        },
      },
    });

    expect(
      signal.type === "signal.text"
        ? signal.data.meta?.agentActivity
        : "unexpected signal type"
    ).toBeUndefined();
    expect(signal).toMatchObject({
      data: {
        meta: {
          agentWorkSummary: {
            v: 1,
            steps: [
              {
                toolName: "openmeld_execute_app_action",
                state: "output-available",
                work: {
                  v: 1,
                  key: "connected_app.action.execute",
                  subject: { kind: "connected_app", label: "Slack" },
                },
              },
            ],
            truncated: false,
          },
        },
      },
    });
  });

  it("accepts legacy connected App work without publishing generic copy", async () => {
    const storage = createStorage();

    await applyPart(storage, 1, {
      type: "tool",
      toolCallId: "tool-call-legacy-connected-app",
      toolName: "openmeld_execute_app_action",
      state: "output-available",
      work: { v: 1, key: "connected_app.action.execute" },
    });
    await closeAgentStreamProjection({
      storage,
      streamId: STREAM.streamId,
      terminal: {
        kind: "final_message",
        publishedSignalId: "signal-final",
      },
      nowMs: 2,
    });

    await expect(
      readAgentWorkingDetailsForSignal({
        storage,
        signalId: "signal-final",
        nowMs: 3,
      })
    ).resolves.toBeNull();
  });
});

async function applyPart(
  storage: AgentStreamProjectionStorage,
  sequence: number,
  part: AgentStreamToolPart
): Promise<void> {
  await applyAgentStreamPart({
    storage,
    part: {
      ...STREAM,
      sequence,
      part,
    },
    nowMs: sequence,
  });
}

function createStorage(): AgentStreamProjectionStorage {
  const values = new Map<string, unknown>();
  const storage: AgentStreamProjectionStorage = {
    delete: (key) => {
      if (Array.isArray(key)) {
        let deleted = 0;
        for (const item of key) {
          deleted += values.delete(item) ? 1 : 0;
        }
        return Promise.resolve(deleted);
      }
      return Promise.resolve(values.delete(key));
    },
    get: <T>(key: string) => Promise.resolve(values.get(key) as T | undefined),
    list: <T>({ prefix }: { prefix: string }) =>
      Promise.resolve(
        new Map(
          [...values.entries()].filter(([key]) => key.startsWith(prefix))
        ) as Map<string, T>
      ),
    put: <T>(key: string, value: T) => {
      values.set(key, value);
      return Promise.resolve();
    },
    transaction: async <T>(
      closure: (transaction: AgentStreamProjectionStorage) => Promise<T>
    ) => await closure(storage),
  };
  return storage;
}
