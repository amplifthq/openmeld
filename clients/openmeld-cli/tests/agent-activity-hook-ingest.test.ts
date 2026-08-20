import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ingestRoutedAgentActivityHook } from "../src/agent-activity/activity-command";
import { readDueControllerTaskLifecycleOutbox } from "../src/agent-activity/controller-task-lifecycle-store";
import { drainAgentActivityHookInbox } from "../src/agent-activity/hook-inbox";
import { ingestAgentActivityHook } from "../src/agent-activity/hook-ingest";
import { readRecentAgentActivityHookStatus } from "../src/agent-activity/hook-projection-store";
import { readDueAgentActivityOutbox } from "../src/agent-activity/local-event-store";
import { bindProject } from "../src/agent-activity/project-bindings";
import { registerAgentActivityRoute } from "../src/agent-activity/route-registry";

let root: string | null = null;

afterEach(async () => {
  if (root) {
    await rm(root, { force: true, recursive: true });
    root = null;
  }
});

describe("Agent Activity hook ingestion", () => {
  it("durably queues exact provider task completion without copying private content", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-hook-"));
    const repositoryPath = join(root, "repository");
    const openMeldRoot = join(root, "openmeld-home");
    await mkdir(repositoryPath);
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir: openMeldRoot,
    });

    await expect(
      ingestAgentActivityHook({
        nowMs: 1000,
        payload: {
          cwd: repositoryPath,
          hook_event_name: "TaskCompleted",
          session_id: "claude-session-1",
          task_id: "task-1",
          task_subject: "PRIVACY_CANARY",
          transcript_path: "/private/transcript.jsonl",
        },
        provider: "claude-code",
        rootDir: openMeldRoot,
      })
    ).resolves.toBe("queued");
    const records = await readDueControllerTaskLifecycleOutbox({
      nowMs: 1000,
      rootDir: openMeldRoot,
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.event).toMatchObject({
      eventType: "completed",
      organizationId: "org-1",
      source: "claude_task_completed",
      taskId: "task-1",
    });
    expect(JSON.stringify(records)).not.toContain("PRIVACY_CANARY");
    expect(JSON.stringify(records)).not.toContain("/private/");
  });

  it("queues a global hook event only in the repository's registered lane", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-hook-"));
    const globalRootDir = join(root, "global");
    const productionRoot = join(root, ".openmeld");
    const developmentRoot = join(root, ".openmeld-dev");
    const repositoryPath = join(root, "repository");
    await Promise.all([mkdir(productionRoot), mkdir(repositoryPath)]);
    await bindProject({
      organizationId: "org-dev",
      projectId: "project-dev",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir: developmentRoot,
    });
    await registerAgentActivityRoute({
      globalRootDir,
      rootDir: developmentRoot,
    });

    await expect(
      ingestRoutedAgentActivityHook({
        globalRootDir,
        nowMs: 1000,
        payload: {
          cwd: repositoryPath,
          hook_event_name: "SessionStart",
          session_id: "codex-session-dev",
        },
        provider: "codex",
      })
    ).resolves.toBe("queued");
    await drainAgentActivityHookInbox({
      nowMs: 1000,
      rootDir: developmentRoot,
    });
    await expect(
      readDueAgentActivityOutbox({ nowMs: 1000, rootDir: developmentRoot })
    ).resolves.toHaveLength(1);
    await expect(
      readDueAgentActivityOutbox({ nowMs: 1000, rootDir: productionRoot })
    ).resolves.toHaveLength(0);
  });

  it("maps only safe Claude hook fields and drops prompt/transcript content", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-hook-"));
    const repositoryPath = join(root, "repository");
    const openMeldRoot = join(root, "openmeld-home");
    await mkdir(repositoryPath);
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir: openMeldRoot,
    });

    await expect(
      ingestAgentActivityHook({
        nowMs: 1000,
        payload: {
          cwd: repositoryPath,
          hook_event_name: "UserPromptSubmit",
          model: "claude-sonnet-5",
          permission_mode: "plan",
          session_id: "claude-session-1",
          transcript_path: "/private/transcript.jsonl",
          user_prompt: "PRIVACY_CANARY_PROMPT",
        },
        provider: "claude-code",
        rootDir: openMeldRoot,
      })
    ).resolves.toBe("queued");
    await drainAgentActivityHookInbox({ nowMs: 1000, rootDir: openMeldRoot });
    const records = await readDueAgentActivityOutbox({
      nowMs: 1000,
      rootDir: openMeldRoot,
    });
    expect(records[0]?.event).toMatchObject({
      model: "claude-sonnet-5",
      provider: "claude-code",
      providerMetadata: { permissionMode: "plan", source: "hook" },
      status: "active",
    });
    expect(JSON.stringify(records)).not.toContain("PRIVACY_CANARY");
    expect(JSON.stringify(records)).not.toContain("/private/");
    expect(JSON.stringify(records)).not.toContain(repositoryPath);
  });

  it("uses only explicit Claude hooks for top-level Session lifecycle status", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-hook-"));
    const repositoryPath = join(root, "repository");
    const openMeldRoot = join(root, "openmeld-home");
    await mkdir(repositoryPath);
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir: openMeldRoot,
    });

    for (const [hookEventName, sessionId] of [
      ["Notification", "claude-notification"],
      ["SubagentStop", "claude-subagent-stop"],
      ["Stop", "claude-stop"],
    ] as const) {
      await expect(
        ingestAgentActivityHook({
          nowMs: 1000,
          payload: {
            cwd: repositoryPath,
            hook_event_name: hookEventName,
            session_id: sessionId,
          },
          provider: "claude-code",
          rootDir: openMeldRoot,
        })
      ).resolves.toBe("queued");
    }
    await drainAgentActivityHookInbox({ nowMs: 1000, rootDir: openMeldRoot });

    const records = await readDueAgentActivityOutbox({
      nowMs: 1000,
      rootDir: openMeldRoot,
    });
    expect(
      records
        .map(({ event }) => ({
          eventType: event.eventType,
          providerSessionId: event.providerSessionId,
          status: event.status,
        }))
        .sort((left, right) =>
          left.providerSessionId.localeCompare(right.providerSessionId)
        )
    ).toEqual([
      {
        eventType: "session_updated",
        providerSessionId: "claude-notification",
        status: "unknown",
      },
      {
        eventType: "session_idle",
        providerSessionId: "claude-stop",
        status: "idle",
      },
      {
        eventType: "session_updated",
        providerSessionId: "claude-subagent-stop",
        status: "unknown",
      },
    ]);
    await expect(
      Promise.all(
        ["claude-notification", "claude-subagent-stop", "claude-stop"].map(
          (providerSessionId) =>
            readRecentAgentActivityHookStatus({
              nowMs: 1000,
              provider: "claude-code",
              providerSessionId,
              rootDir: openMeldRoot,
            })
        )
      )
    ).resolves.toEqual([null, null, "idle"]);
  });

  it("keeps the newest hook lifecycle and fails closed on conflicting timestamp ties", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-hook-"));
    const repositoryPath = join(root, "repository");
    const openMeldRoot = join(root, "openmeld-home");
    await mkdir(repositoryPath);
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir: openMeldRoot,
    });

    for (const observation of [
      {
        hookEventName: "Stop",
        nowMs: 2000,
        sessionId: "claude-out-of-order",
      },
      {
        hookEventName: "UserPromptSubmit",
        nowMs: 1000,
        sessionId: "claude-out-of-order",
      },
      {
        hookEventName: "Stop",
        nowMs: 3000,
        sessionId: "claude-ambiguous-tie",
      },
      {
        hookEventName: "UserPromptSubmit",
        nowMs: 3000,
        sessionId: "claude-ambiguous-tie",
      },
    ] as const) {
      await expect(
        ingestAgentActivityHook({
          nowMs: observation.nowMs,
          payload: {
            cwd: repositoryPath,
            hook_event_name: observation.hookEventName,
            session_id: observation.sessionId,
          },
          provider: "claude-code",
          rootDir: openMeldRoot,
        })
      ).resolves.toBe("queued");
    }
    await drainAgentActivityHookInbox({ nowMs: 3000, rootDir: openMeldRoot });

    await expect(
      Promise.all(
        ["claude-out-of-order", "claude-ambiguous-tie"].map(
          (providerSessionId) =>
            readRecentAgentActivityHookStatus({
              nowMs: 3000,
              provider: "claude-code",
              providerSessionId,
              rootDir: openMeldRoot,
            })
        )
      )
    ).resolves.toEqual(["idle", null]);
  });

  it("attributes OpenCode events by each verified session directory and never treats metadata updates as active", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-hook-"));
    const first = join(root, "first");
    const second = join(root, "second");
    const openMeldRoot = join(root, "openmeld-home");
    await Promise.all([mkdir(first), mkdir(second)]);
    await Promise.all([
      bindProject({
        organizationId: "org-1",
        projectId: "project-1",
        projectSlug: "first",
        repositoryFingerprint: null,
        repositoryPath: first,
        rootDir: openMeldRoot,
      }),
      bindProject({
        organizationId: "org-1",
        projectId: "project-2",
        projectSlug: "second",
        repositoryFingerprint: null,
        repositoryPath: second,
        rootDir: openMeldRoot,
      }),
    ]);

    await ingestAgentActivityHook({
      nowMs: 1000,
      payload: {
        cwd: first,
        hook_event_name: "session.status",
        session_id: "opencode-first",
        session_title: "Fix the first Project",
        status: "idle",
      },
      provider: "opencode",
      rootDir: openMeldRoot,
    });
    await ingestAgentActivityHook({
      nowMs: 1001,
      payload: {
        cwd: second,
        hook_event_name: "session.updated",
        session_id: "opencode-second",
      },
      provider: "opencode",
      rootDir: openMeldRoot,
    });
    await drainAgentActivityHookInbox({ nowMs: 1001, rootDir: openMeldRoot });
    const records = await readDueAgentActivityOutbox({
      nowMs: 1001,
      rootDir: openMeldRoot,
    });
    expect(
      records
        .map(({ event }) => ({
          projectId: event.projectId,
          providerSessionId: event.providerSessionId,
          status: event.status,
          title: event.title,
        }))
        .sort((left, right) => left.projectId.localeCompare(right.projectId))
    ).toEqual([
      {
        projectId: "project-1",
        providerSessionId: "opencode-first",
        status: "idle",
        title: "Fix the first Project",
      },
      {
        projectId: "project-2",
        providerSessionId: "opencode-second",
        status: "unknown",
        title: null,
      },
    ]);
  });

  it("maps only safe Cursor hook metadata and ignores prompt and response content", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-hook-"));
    const repositoryPath = join(root, "repository");
    const openMeldRoot = join(root, "openmeld-home");
    await mkdir(repositoryPath);
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath,
      rootDir: openMeldRoot,
    });

    await expect(
      ingestAgentActivityHook({
        nowMs: 1000,
        payload: {
          client_kind: "cursor-ide",
          composer_mode: "chat",
          cursor_version: "3.2.1",
          gitBranch: "PRIVACY_CANARY_BRANCH",
          hook_event_name: "sessionStart",
          is_background_agent: false,
          model: "PRIVACY_CANARY_MODEL",
          prompt: "PRIVACY_CANARY_PROMPT",
          response: "PRIVACY_CANARY_RESPONSE",
          session_id: "cursor-session-1",
          session_title: "PRIVACY_CANARY_TITLE",
          transcript_path: "PRIVACY_CANARY_TRANSCRIPT",
          user_email: "PRIVACY_CANARY_USER",
          workspace_roots: [repositoryPath],
        },
        provider: "cursor",
        rootDir: openMeldRoot,
      })
    ).resolves.toBe("queued");
    await expect(
      ingestAgentActivityHook({
        nowMs: 2000,
        payload: {
          conversation_id: "cursor-session-1",
          hook_event_name: "beforeSubmitPrompt",
          prompt: "PRIVACY_CANARY_PROMPT",
          workspace_roots: [repositoryPath],
        },
        provider: "cursor",
        rootDir: openMeldRoot,
      })
    ).resolves.toBe("queued");
    await expect(
      ingestAgentActivityHook({
        nowMs: 3000,
        payload: {
          conversation_id: "cursor-session-1",
          error_message: "PRIVACY_CANARY_RESPONSE",
          hook_event_name: "stop",
          status: "error",
          workspace_roots: [repositoryPath],
        },
        provider: "cursor",
        rootDir: openMeldRoot,
      })
    ).resolves.toBe("queued");
    await drainAgentActivityHookInbox({ nowMs: 1000, rootDir: openMeldRoot });
    const records = await readDueAgentActivityOutbox({
      nowMs: 3000,
      rootDir: openMeldRoot,
    });
    const chronological = [...records].sort(
      (left, right) => left.event.observedAtMs - right.event.observedAtMs
    );
    expect(chronological.map((record) => record.event.status)).toEqual([
      "active",
      "active",
      "error",
    ]);
    expect(chronological[0]?.event).toMatchObject({
      clientKind: "unknown",
      gitBranch: null,
      model: null,
      provider: "cursor",
      providerMetadata: {
        composerMode: "chat",
        isBackgroundAgent: false,
        source: "hook",
        version: "3.2.1",
      },
      title: null,
    });
    expect(JSON.stringify(records)).not.toContain("PRIVACY_CANARY");
    expect(JSON.stringify(records)).not.toContain(repositoryPath);
  });
});
