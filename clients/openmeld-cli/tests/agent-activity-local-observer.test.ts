import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drainAgentActivityHookInbox } from "../src/agent-activity/hook-inbox";
import { ingestAgentActivityHook } from "../src/agent-activity/hook-ingest";
import { readDueAgentActivityOutbox } from "../src/agent-activity/local-event-store";
import {
  scanLocalAgentActivity,
  startAgentActivityTranscriptWatchers,
} from "../src/agent-activity/local-observer";
import { bindProject } from "../src/agent-activity/project-bindings";

let root: string | null = null;

afterEach(async () => {
  if (root) {
    await rm(root, { force: true, recursive: true });
    root = null;
  }
});

describe("Agent Activity local observer", () => {
  it("attaches a watcher after a fresh provider creates its session root", async () => {
    const close = vi.fn();
    const watcher = {
      close,
      on: vi.fn().mockReturnThis(),
      unref: vi.fn(),
    };
    let attempts = 0;
    const watchFactory = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return watcher;
    });

    const stop = startAgentActivityTranscriptWatchers({
      homeDir: "/tmp/fresh-agent-activity-home",
      watchFactory: watchFactory as never,
      watchRetryMs: 10,
    });
    await until(() => watchFactory.mock.calls.length >= 3);
    await stop();

    expect(watcher.unref).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("reconciles a current Codex rollout once and keeps raw content out of the outbox", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-observer-"));
    const homeDir = join(root, "home");
    const openMeldRoot = join(root, "openmeld-home");
    const repositoryPath = join(root, "repository");
    const sessionDirectory = join(
      homeDir,
      ".codex",
      "sessions",
      "2026",
      "07",
      "13"
    );
    await Promise.all([
      mkdir(repositoryPath, { recursive: true }),
      mkdir(sessionDirectory, { recursive: true }),
      mkdir(join(homeDir, ".codex"), { recursive: true }),
    ]);
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir: openMeldRoot,
    });
    const nowMs = Date.now();
    const sessionId = "019f-observer-session";
    const rolloutPath = join(
      sessionDirectory,
      `rollout-2026-07-13T03-00-00-${sessionId}.jsonl`
    );
    await writeFile(
      rolloutPath,
      `${[
        {
          payload: {
            cli_version: "0.144.1",
            cwd: repositoryPath,
            git: { branch: "main", commit_hash: "abc123" },
            id: sessionId,
            instructions: "PRIVACY_CANARY_SYSTEM_INSTRUCTIONS",
            model_provider: "openai",
            originator: "Codex Desktop",
            source: "vscode",
            timestamp: new Date(nowMs - 30_000).toISOString(),
          },
          timestamp: new Date(nowMs - 30_000).toISOString(),
          type: "session_meta",
        },
        {
          payload: {
            approval_policy: "never",
            effort: "xhigh",
            model: "gpt-5.6-sol",
            sandbox_policy: { type: "danger-full-access" },
          },
          timestamp: new Date(nowMs - 1000).toISOString(),
          type: "turn_context",
        },
        {
          payload: {
            message: "PRIVACY_CANARY_USER_PROMPT",
            type: "user_message",
          },
          timestamp: new Date(nowMs).toISOString(),
          type: "event_msg",
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n")}\n`
    );
    await writeFile(
      join(homeDir, ".codex", "session_index.jsonl"),
      `${JSON.stringify({
        id: sessionId,
        thread_name: "Ship organization activity context",
      })}\n`
    );

    await ingestAgentActivityHook({
      homeDir,
      nowMs,
      payload: {
        cwd: repositoryPath,
        hook_event_name: "UserPromptSubmit",
        originator: "Codex Desktop",
        session_id: sessionId,
      },
      provider: "codex",
      rootDir: openMeldRoot,
    });
    await drainAgentActivityHookInbox({ nowMs, rootDir: openMeldRoot });
    await expect(
      scanLocalAgentActivity({ homeDir, nowMs, rootDir: openMeldRoot })
    ).resolves.toMatchObject({ observedCount: 1, queuedCount: 0 });
    await expect(
      scanLocalAgentActivity({
        homeDir,
        nowMs: nowMs + 1000,
        rootDir: openMeldRoot,
      })
    ).resolves.toMatchObject({ changedFileCount: 0, queuedCount: 0 });
    const records = await readDueAgentActivityOutbox({
      nowMs: nowMs + 1000,
      rootDir: openMeldRoot,
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.event).toMatchObject({
      clientKind: "codex-app",
      organizationId: "org-1",
      projectId: "project-1",
      providerSessionId: sessionId,
      status: "active",
      title: "Ship organization activity context",
    });
    expect(JSON.stringify(records)).not.toContain("PRIVACY_CANARY_USER_PROMPT");
    expect(JSON.stringify(records)).not.toContain(
      "PRIVACY_CANARY_SYSTEM_INSTRUCTIONS"
    );
    expect(JSON.stringify(records)).not.toContain(repositoryPath);
  });

  it("does not read the tail or retain the path of an unbound transcript", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-observer-"));
    const homeDir = join(root, "home");
    const openMeldRoot = join(root, "openmeld-home");
    const boundRepository = join(root, "bound-repository");
    const unboundRepository = join(root, "unbound-repository");
    const sessionDirectory = join(homeDir, ".codex", "sessions");
    await Promise.all([
      mkdir(boundRepository, { recursive: true }),
      mkdir(unboundRepository, { recursive: true }),
      mkdir(sessionDirectory, { recursive: true }),
    ]);
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "bound",
      repositoryFingerprint: null,
      repositoryPath: boundRepository,
      rootDir: openMeldRoot,
    });
    const unboundPath = join(sessionDirectory, "unbound.jsonl");
    await writeFile(
      unboundPath,
      `${JSON.stringify({
        payload: {
          cwd: unboundRepository,
          id: "unbound",
          timestamp: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
        type: "session_meta",
      })}\n${JSON.stringify({
        payload: { message: "PRIVACY_CANARY_UNBOUND_TAIL" },
        type: "event_msg",
      })}\n`
    );

    const parse = vi.spyOn(JSON, "parse");
    await scanLocalAgentActivity({ homeDir, rootDir: openMeldRoot });
    expect(
      parse.mock.calls.some(([raw]) => String(raw).includes("PRIVACY_CANARY"))
    ).toBe(false);
    parse.mockRestore();
    const state = await readFile(
      join(openMeldRoot, "device", "agent-activity", "observer-state.json"),
      "utf8"
    );
    expect(state).not.toContain(unboundPath);
    expect(state).not.toContain("PRIVACY_CANARY");
  });

  it("finds Claude identity after leading queue-operation and last-prompt records", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-observer-"));
    const homeDir = join(root, "home");
    const openMeldRoot = join(root, "openmeld-home");
    const repositoryPath = join(root, "repository");
    const sessionDirectory = join(homeDir, ".claude", "projects", "repo");
    await Promise.all([
      mkdir(repositoryPath, { recursive: true }),
      mkdir(sessionDirectory, { recursive: true }),
    ]);
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir: openMeldRoot,
    });
    const nowMs = Date.now();
    await writeFile(
      join(sessionDirectory, "claude-session.jsonl"),
      `${[
        {
          operation: "enqueue",
          sessionId: "claude-session",
          type: "queue-operation",
        },
        {
          prompt: "PRIVACY_CANARY_LAST_PROMPT",
          sessionId: "claude-session",
          type: "last-prompt",
        },
        {
          cwd: repositoryPath,
          entrypoint: "cli",
          gitBranch: "main",
          isSidechain: false,
          message: {
            content: "PRIVACY_CANARY_MESSAGE",
            model: "claude-sonnet-5",
          },
          sessionId: "claude-session",
          timestamp: new Date(nowMs).toISOString(),
          type: "assistant",
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n")}\n`
    );

    await expect(
      scanLocalAgentActivity({ homeDir, nowMs, rootDir: openMeldRoot })
    ).resolves.toMatchObject({ driftCount: 0, observedCount: 1 });
  });
});

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for watcher retry.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
