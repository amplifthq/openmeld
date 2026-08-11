import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAgentActivityEvent,
  parseClaudeTranscriptSnapshot,
  parseCodexRolloutSnapshot,
  parseOpenCodeSessionRow,
} from "../src/agent-activity/observer-adapters";

let root: string | null = null;

afterEach(async () => {
  if (root) {
    await rm(root, { force: true, recursive: true });
    root = null;
  }
});

describe("Agent Activity provider adapters", () => {
  it("extracts Codex allowlist fields without forwarding prompt, answer, or subagent identity", async () => {
    const nowMs = Date.parse("2026-07-13T03:00:00.000Z");
    const observed = parseCodexRolloutSnapshot({
      lines: [
        {
          payload: {
            cli_version: "0.144.1",
            cwd: await repositoryPath(),
            git: { branch: "main", commit_hash: "abc123" },
            id: "codex-session-1",
            instructions: "PRIVACY_CANARY_INSTRUCTIONS",
            model_provider: "openai",
            originator: "Codex Desktop",
            source: {
              subagent: {
                thread_spawn: {
                  agent_path: "/root/private-agent",
                  parent_thread_id: "private-thread",
                },
              },
            },
            timestamp: "2026-07-13T02:59:00.000Z",
          },
          timestamp: "2026-07-13T02:59:00.000Z",
          type: "session_meta",
        },
        {
          payload: {
            approval_policy: "never",
            cwd: "/private/path",
            effort: "xhigh",
            model: "gpt-5.6-sol",
            sandbox_policy: { type: "danger-full-access" },
            summary: {
              developer_instructions: "PRIVATE",
              model_context_window: 272_000,
            },
          },
          timestamp: "2026-07-13T02:59:50.000Z",
          type: "turn_context",
        },
        {
          payload: {
            last_agent_message: "PRIVACY_CANARY_LAST_ANSWER",
            type: "task_complete",
          },
          timestamp: "2026-07-13T02:59:59.000Z",
          type: "event_msg",
        },
      ],
      nowMs,
      titles: new Map([["codex-session-1", "Ship richer Agent Activity"]]),
    });
    expect(observed).toMatchObject({
      clientKind: "codex-app",
      model: "gpt-5.6-sol",
      provider: "codex",
      providerMetadata: {
        approvalPolicy: "never",
        originator: "desktop",
        source: "rollout",
      },
      status: "idle",
      title: "Ship richer Agent Activity",
    });
    const event = await buildAgentActivityEvent({
      bindings: [binding()],
      observed: requireObserved(observed),
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("PRIVACY_CANARY");
    expect(serialized).not.toContain("/private/");
    expect(serialized).not.toContain("private-thread");
  });

  it("reads Claude model metadata while ignoring message content and attachments", async () => {
    const path = await repositoryPath();
    const observed = parseClaudeTranscriptSnapshot({
      lines: [
        {
          attachment: { content: "PRIVACY_CANARY_ATTACHMENT" },
          cwd: path,
          entrypoint: "claude-desktop",
          gitBranch: "feature/activity",
          isSidechain: false,
          message: {
            content: "PRIVACY_CANARY_MESSAGE",
            model: "claude-sonnet-5",
          },
          sessionId: "claude-session-1",
          timestamp: "2026-07-13T02:59:50.000Z",
          type: "assistant",
          version: "2.1.207",
        },
      ],
      nowMs: Date.parse("2026-07-13T03:00:00.000Z"),
    });
    expect(observed).toMatchObject({
      clientKind: "claude-code-cli",
      model: "claude-sonnet-5",
      providerMetadata: { entrypoint: "desktop", source: "jsonl" },
      status: "active",
      title: null,
    });
    const event = await buildAgentActivityEvent({
      bindings: [binding()],
      observed: requireObserved(observed),
    });
    expect(JSON.stringify(event)).not.toContain("PRIVACY_CANARY");
  });

  it("keeps OpenCode provenance unknown and copies only reviewed counters", async () => {
    const observed = parseOpenCodeSessionRow({
      nowMs: 100_000,
      row: {
        agent: "build",
        directory: await repositoryPath(),
        id: "opencode-session-1",
        metadata: JSON.stringify({ secret: "PRIVACY_CANARY_METADATA" }),
        model: JSON.stringify({
          id: "gpt-5.6-sol",
          providerID: "openai",
          variant: "high",
        }),
        parent_id: null,
        path: "/private/opencode/path",
        time_archived: null,
        time_created: 90_000,
        time_updated: 99_000,
        title: "Implement activity",
        tokens_input: 10,
        tokens_output: 20,
        version: "1.17.15",
      },
    });
    expect(observed).toMatchObject({
      clientKind: "unknown",
      provider: "opencode",
      providerMetadata: {
        modelProvider: "openai",
        tokensInput: 10,
        tokensOutput: 20,
      },
      title: "Implement activity",
    });
    const event = await buildAgentActivityEvent({
      bindings: [binding()],
      observed: requireObserved(observed),
    });
    expect(JSON.stringify(event)).not.toContain("PRIVACY_CANARY");
    expect(JSON.stringify(event)).not.toContain("/private/");
  });
});

function requireObserved<T>(value: T | null): T {
  if (!value) {
    throw new Error("Expected adapter observation.");
  }
  return value;
}

function binding() {
  if (!root) {
    throw new Error("Repository fixture is unavailable.");
  }
  return {
    bindingGeneration: "binding-generation-1",
    boundAtMs: 1,
    isDefault: true,
    organizationId: "org-1",
    projectId: "project-1",
    projectSlug: "openmeld",
    repositoryFingerprint: null,
    repositoryPath: join(root, "repository"),
  };
}

async function repositoryPath() {
  if (!root) {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-adapter-"));
    await mkdir(join(root, "repository"));
  }
  return join(root, "repository");
}
