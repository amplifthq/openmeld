import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAgentActivitySubmissionResults,
  deferAgentActivityOutbox,
  enqueueAgentActivityEvent,
  readAgentActivityOutboxHealth,
  readDueAgentActivityOutbox,
  removeProjectOutbox,
} from "../src/agent-activity/local-event-store";
import {
  bindProject as bindProjectConnection,
  unbindProject,
} from "../src/agent-activity/project-bindings";

let root: string | null = null;

afterEach(async () => {
  if (root) {
    await rm(root, { force: true, recursive: true });
    root = null;
  }
});

describe("Agent Activity local outbox", () => {
  it("persists only strict events with private permissions and reuses exact ids", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-outbox-"));
    await bindProject(root, "project-1");
    const event = buildEvent("event-1");
    await expect(
      enqueueAgentActivityEvent({ event, nowMs: 100, rootDir: root })
    ).resolves.toBe("queued");
    await expect(
      enqueueAgentActivityEvent({ event, nowMs: 101, rootDir: root })
    ).resolves.toBe("reused");
    const records = await readDueAgentActivityOutbox({
      nowMs: 100,
      rootDir: root,
    });
    expect(records).toEqual([
      expect.objectContaining({ attemptCount: 0, event }),
    ]);
    const outboxDirectory = join(root, "device", "agent-activity", "outbox");
    expect((await stat(outboxDirectory)).mode % 0o1000).toBe(0o700);
    expect(
      (await stat(join(outboxDirectory, "ZXZlbnQtMQ.json"))).mode % 0o1000
    ).toBe(0o600);
  });

  it("backs off retryable failures and terminates permanent outcomes without raw payload diagnostics", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-outbox-"));
    await bindProject(root, "project-1");
    await enqueueAgentActivityEvent({
      event: buildEvent("event-retry"),
      nowMs: 100,
      rootDir: root,
    });
    let records = await readDueAgentActivityOutbox({
      nowMs: 100,
      rootDir: root,
    });
    await deferAgentActivityOutbox({ nowMs: 100, records, rootDir: root });
    await expect(
      readDueAgentActivityOutbox({ nowMs: 2099, rootDir: root })
    ).resolves.toEqual([]);
    records = await readDueAgentActivityOutbox({ nowMs: 2100, rootDir: root });
    expect(records[0]).toMatchObject({ attemptCount: 1 });

    await applyAgentActivitySubmissionResults({
      nowMs: 2200,
      records,
      results: [
        {
          eventId: "event-retry",
          index: 0,
          outcome: "permanent_rejected",
          reason: "project_archived",
        },
      ],
      rootDir: root,
    });
    await expect(
      readAgentActivityOutboxHealth({ rootDir: root })
    ).resolves.toEqual({ pending: 0, permanentlyRejected: 1, retrying: 0 });
  });

  it("removes queued evidence immediately when its Project is unbound", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-outbox-"));
    await bindProject(root, "project-1");
    await bindProject(root, "project-2");
    await Promise.all([
      enqueueAgentActivityEvent({
        event: buildEvent("event-remove"),
        rootDir: root,
      }),
      enqueueAgentActivityEvent({
        event: { ...buildEvent("event-keep"), projectId: "project-2" },
        rootDir: root,
      }),
    ]);
    await expect(
      removeProjectOutbox({
        organizationId: "org-1",
        projectId: "project-1",
        rootDir: root,
      })
    ).resolves.toBe(1);
    await expect(
      readDueAgentActivityOutbox({ nowMs: Date.now(), rootDir: root })
    ).resolves.toEqual([
      expect.objectContaining({
        event: expect.objectContaining({ eventId: "event-keep" }),
      }),
    ]);
  });

  it("does not recreate a stale record after its Project is unbound", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-outbox-"));
    await bindProject(root, "project-1");
    await enqueueAgentActivityEvent({
      event: buildEvent("event-stale"),
      rootDir: root,
    });
    const records = await readDueAgentActivityOutbox({ rootDir: root });
    await unbindProject({
      organizationId: "org-1",
      projectId: "project-1",
      rootDir: root,
    });
    await removeProjectOutbox({
      organizationId: "org-1",
      projectId: "project-1",
      rootDir: root,
    });
    await deferAgentActivityOutbox({ records, rootDir: root });
    await expect(
      readDueAgentActivityOutbox({ rootDir: root })
    ).resolves.toEqual([]);
    await expect(
      enqueueAgentActivityEvent({
        event: buildEvent("event-after-unbind"),
        rootDir: root,
      })
    ).resolves.toBe("unbound");
  });

  it("quarantines a damaged record and continues returning healthy events", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-outbox-"));
    await bindProject(root, "project-1");
    await enqueueAgentActivityEvent({
      event: buildEvent("event-good"),
      rootDir: root,
    });
    const outbox = join(root, "device", "agent-activity", "outbox");
    await writeFile(
      join(outbox, "000-corrupt.json"),
      "{PRIVATE_BROKEN_PAYLOAD",
      {
        mode: 0o600,
      }
    );

    const records = await readDueAgentActivityOutbox({ rootDir: root });
    expect(records).toHaveLength(1);
    expect(records[0]?.event.eventId).toBe("event-good");
    expect(
      await readdir(join(root, "device", "agent-activity", "quarantine"))
    ).toHaveLength(1);
    expect(
      await readFile(
        join(root, "device", "agent-activity", "permanent-rejections.json"),
        "utf8"
      )
    ).not.toContain("PRIVATE_BROKEN_PAYLOAD");
  });

  it("keeps a permanent outcome terminal when the prior diagnostics file is damaged", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-outbox-"));
    await bindProject(root, "project-1");
    await enqueueAgentActivityEvent({
      event: buildEvent("event-terminal"),
      rootDir: root,
    });
    const records = await readDueAgentActivityOutbox({ rootDir: root });
    await writeFile(
      join(root, "device", "agent-activity", "permanent-rejections.json"),
      "{damaged diagnostics",
      { mode: 0o600 }
    );
    await applyAgentActivitySubmissionResults({
      records,
      results: [
        {
          eventId: "event-terminal",
          index: 0,
          outcome: "permanent_rejected",
          reason: "project_archived",
        },
      ],
      rootDir: root,
    });
    await deferAgentActivityOutbox({ records, rootDir: root });
    await expect(
      readDueAgentActivityOutbox({ rootDir: root })
    ).resolves.toEqual([]);
    await expect(
      readAgentActivityOutboxHealth({ rootDir: root })
    ).resolves.toMatchObject({ pending: 0, permanentlyRejected: 1 });
  });

  it("never retries a permanent outcome when diagnostic storage fails", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-outbox-"));
    await bindProject(root, "project-1");
    await enqueueAgentActivityEvent({
      event: buildEvent("event-diagnostic-failure"),
      rootDir: root,
    });
    const records = await readDueAgentActivityOutbox({ rootDir: root });
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await applyAgentActivitySubmissionResults({
      records,
      results: [
        {
          eventId: "event-diagnostic-failure",
          index: 0,
          outcome: "permanent_rejected",
          reason: "project_archived",
        },
      ],
      rootDir: root,
      writePermanentDiagnostic: () =>
        Promise.reject(new Error("simulated disk failure")),
    });
    await deferAgentActivityOutbox({ records, rootDir: root });
    await expect(
      readDueAgentActivityOutbox({ rootDir: root })
    ).resolves.toEqual([]);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("diagnostic_write_failed")
    );
    stderr.mockRestore();
  });
});

async function bindProject(rootDir: string, projectId: string) {
  const repositoryPath = join(rootDir, `repository-${projectId}`);
  await mkdir(repositoryPath, { recursive: true });
  await bindProjectConnection({
    organizationId: "org-1",
    projectId,
    projectSlug: projectId,
    repositoryFingerprint: null,
    repositoryPath,
    rootDir,
  });
}

function buildEvent(eventId: string) {
  return {
    clientKind: "codex-cli" as const,
    eventId,
    eventType: "session_active" as const,
    expiresAtMs: 61_000,
    gitBranch: "main",
    gitCommit: null,
    model: "gpt-5.6-sol",
    observedAtMs: 1000,
    organizationId: "org-1",
    projectId: "project-1",
    provider: "codex" as const,
    providerMetadata: {
      originator: "cli" as const,
      source: "rollout" as const,
    },
    providerSessionId: "session-1",
    repositoryFingerprint: null,
    source: "observed" as const,
    startedAtMs: 900,
    status: "active" as const,
    title: "Agent Activity",
  };
}
