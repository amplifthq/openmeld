import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueControllerTaskLifecycleEvent,
  readDueControllerTaskLifecycleOutbox,
} from "../src/agent-activity/controller-task-lifecycle-store";
import {
  enqueueAgentActivityEvent,
  readDueAgentActivityOutbox,
} from "../src/agent-activity/local-event-store";
import {
  selectOneBindingPerProjectScope,
  syncLocalAgentActivity,
} from "../src/agent-activity/local-sync";
import {
  bindProject,
  listProjectBindings,
  unbindProject,
} from "../src/agent-activity/project-bindings";

const mocks = vi.hoisted(() => ({
  assertProjectBindingProducerCompatible: vi.fn(),
  submitAgentActivityEvents: vi.fn(),
  submitAgentControllerTaskLifecycleEvents: vi.fn(),
  submitRegistration: vi.fn(),
}));

vi.mock("@openmeld/api-client", () => ({
  createAgentActivityApi: vi.fn(() => ({
    readSnapshot: vi.fn(() => Promise.reject(new Error("not used"))),
  })),
  createRuntimeReportingApi: vi.fn(() => ({
    submitAgentActivityEvents: mocks.submitAgentActivityEvents,
    submitAgentControllerTaskLifecycleEvents:
      mocks.submitAgentControllerTaskLifecycleEvents,
    submitRegistration: mocks.submitRegistration,
  })),
}));
vi.mock("../src/config/auth-session", () => ({
  getAuthSessionState: vi.fn(() =>
    Promise.resolve({ session: { accessToken: "test" }, state: "valid" })
  ),
}));
vi.mock("../src/config/daemon-service-contract", () => ({
  readDaemonServiceContract: vi.fn(() =>
    Promise.resolve({
      deviceId: "device-1",
      gatewayUrl: "https://gateway.openmeld.invalid",
      lane: "dev",
    })
  ),
}));
vi.mock("../src/config/request-headers", () => ({
  canAttachAuthTokenToRequest: vi.fn(() => true),
}));
vi.mock("../src/agent-activity/project-binding-producer-gate", () => ({
  assertProjectBindingProducerCompatible:
    mocks.assertProjectBindingProducerCompatible,
}));
vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: vi.fn(() => ({})),
}));
vi.mock("../src/agent-activity/local-observer", () => ({
  scanLocalAgentActivity: vi.fn(() =>
    Promise.resolve({
      changedFileCount: 0,
      driftCount: 0,
      observedCount: 0,
      queuedCount: 0,
    })
  ),
  startAgentActivityTranscriptWatchers: vi.fn(() => () => Promise.resolve()),
}));

let root: string | null = null;

beforeEach(() => {
  mocks.assertProjectBindingProducerCompatible.mockResolvedValue(undefined);
  mocks.submitRegistration.mockResolvedValue({
    status: "accepted",
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority",
      value: "runtime-1",
    },
  });
  mocks.submitAgentActivityEvents.mockResolvedValue({
    events: [{ eventId: "event-1", index: 0, outcome: "accepted" }],
    status: "accepted",
  });
  mocks.submitAgentControllerTaskLifecycleEvents.mockResolvedValue({
    events: [
      {
        eventId: "codex:event-controller-1",
        outcome: "accepted",
        status: "accepted",
      },
    ],
    status: "accepted",
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  if (root) {
    await rm(root, { force: true, recursive: true });
    root = null;
  }
});

describe("Agent Activity local delivery", () => {
  it("orders a task registration before its same-turn completion", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-sync-"));
    const shared = {
      agentControllerRef: "builtin:codex" as const,
      attentionCode: null,
      occurredAtMs: 1000,
      organizationId: "org-1",
      taskId: "turn-1",
    };
    await enqueueControllerTaskLifecycleEvent({
      event: {
        ...shared,
        eventId: "codex:000-completion",
        eventType: "completed",
        source: "codex_stop",
      },
      nowMs: 1000,
      rootDir: requireRoot(),
    });
    await enqueueControllerTaskLifecycleEvent({
      event: {
        ...shared,
        eventId: "codex:fff-registration",
        eventType: "registered",
        source: "codex_user_prompt_submit",
      },
      nowMs: 1000,
      rootDir: requireRoot(),
    });

    await expect(
      readDueControllerTaskLifecycleOutbox({
        nowMs: 1000,
        rootDir: requireRoot(),
      })
    ).resolves.toMatchObject([
      { event: { eventType: "registered" } },
      { event: { eventType: "completed" } },
    ]);
  });

  it("delivers controller task lifecycle events through the same five-second sync path", async () => {
    await seedLocalEvent();
    await enqueueControllerTaskLifecycleEvent({
      event: {
        agentControllerRef: "builtin:codex",
        attentionCode: null,
        eventId: "codex:event-controller-1",
        eventType: "completed",
        occurredAtMs: 1000,
        organizationId: "org-1",
        source: "codex_stop",
        taskId: "turn-1",
      },
      nowMs: 1000,
      rootDir: requireRoot(),
    });

    await expect(runSync()).resolves.toMatchObject({ status: "submitted" });
    expect(mocks.submitAgentControllerTaskLifecycleEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device-1",
        events: [
          expect.objectContaining({
            eventId: "codex:event-controller-1",
            taskId: "turn-1",
          }),
        ],
      })
    );
    await expect(
      readDueControllerTaskLifecycleOutbox({
        nowMs: Date.now() + 60_000,
        rootDir: requireRoot(),
      })
    ).resolves.toHaveLength(0);
  });

  it("delivers controller task callbacks before an Activity batch failure", async () => {
    await seedLocalEvent();
    await enqueueControllerTaskLifecycleEvent({
      event: {
        agentControllerRef: "builtin:codex",
        attentionCode: null,
        eventId: "codex:event-controller-priority",
        eventType: "completed",
        occurredAtMs: 1000,
        organizationId: "org-1",
        source: "codex_stop",
        taskId: "turn-priority",
      },
      nowMs: 1000,
      rootDir: requireRoot(),
    });
    mocks.submitAgentActivityEvents.mockRejectedValueOnce(
      Object.assign(new Error("Activity endpoint unavailable"), { status: 404 })
    );
    mocks.submitAgentControllerTaskLifecycleEvents.mockResolvedValueOnce({
      events: [
        {
          eventId: "codex:event-controller-priority",
          outcome: "accepted",
          status: "accepted",
        },
      ],
      status: "accepted",
    });

    await expect(runSync()).resolves.toMatchObject({
      reason: "write_endpoint_unavailable",
      status: "unavailable",
    });
    expect(
      mocks.submitAgentControllerTaskLifecycleEvents
    ).toHaveBeenCalledOnce();
    await expect(
      readDueControllerTaskLifecycleOutbox({
        nowMs: Date.now() + 60_000,
        rootDir: requireRoot(),
      })
    ).resolves.toHaveLength(0);
    await expect(due(Date.now() + 60_000)).resolves.toHaveLength(1);
  });

  it("delivers readable Activity while Project mutations require a Service update", async () => {
    await seedLocalEvent();
    mocks.assertProjectBindingProducerCompatible.mockRejectedValue(
      Object.assign(new Error("Project mutation requires a Service update."), {
        code: "project_bindings.update_required",
      })
    );

    await expect(
      syncLocalAgentActivity({
        reconcile: false,
        refreshContext: false,
        rootDir: requireRoot(),
      })
    ).resolves.toMatchObject({
      status: "submitted",
      submittedCount: 1,
    });
    expect(mocks.assertProjectBindingProducerCompatible).not.toHaveBeenCalled();
    await expect(due()).resolves.toHaveLength(0);
  });

  it("selects one default connection before writing each Project context cache", () => {
    expect(
      selectOneBindingPerProjectScope([
        {
          isDefault: false,
          organizationId: "org-1",
          projectId: "project-1",
          repositoryPath: "/work/secondary",
        },
        {
          isDefault: true,
          organizationId: "org-1",
          projectId: "project-1",
          repositoryPath: "/work/default",
        },
      ])
    ).toEqual([
      expect.objectContaining({
        isDefault: true,
        repositoryPath: "/work/default",
      }),
    ]);
  });

  it.each([
    "accepted",
    "reused",
  ] as const)("removes %s evidence only after a terminal acknowledgement", async (outcome) => {
    const fixture = await seedLocalEvent();
    mocks.submitAgentActivityEvents.mockResolvedValue({
      events: [{ eventId: "event-1", index: 0, outcome }],
      status: "accepted",
    });

    await expect(runSync()).resolves.toMatchObject({
      status: "submitted",
      submittedCount: 1,
    });
    await expect(due()).resolves.toHaveLength(0);
    await expect(
      listProjectBindings({ rootDir: requireRoot() })
    ).resolves.toHaveLength(1);
    expect(fixture.repositoryPath).toContain("repository");
  });

  it("keeps retryable and 404 evidence for later delivery", async () => {
    await seedLocalEvent();
    mocks.submitAgentActivityEvents.mockResolvedValueOnce({
      events: [
        {
          eventId: "event-1",
          index: 0,
          outcome: "retryable_rejected",
          reason: "membership_unavailable",
        },
      ],
      status: "partial",
    });
    await expect(runSync()).resolves.toMatchObject({ status: "submitted" });
    expect((await due(Date.now() + 60_000)).length).toBe(1);

    await rm(requireRoot(), { force: true, recursive: true });
    root = null;
    await seedLocalEvent();
    mocks.submitAgentActivityEvents.mockRejectedValueOnce(
      Object.assign(new Error("not deployed"), { status: 404 })
    );
    await expect(runSync()).resolves.toMatchObject({
      reason: "write_endpoint_unavailable",
      status: "unavailable",
    });
    expect((await due(Date.now() + 120_000)).length).toBe(1);
  });

  it.each([
    {
      label: "a mismatched event id",
      results: [{ eventId: "event-other", index: 0, outcome: "accepted" }],
    },
    {
      label: "a duplicate index",
      results: [
        { eventId: "event-1", index: 0, outcome: "accepted" },
        { eventId: "event-1", index: 0, outcome: "reused" },
      ],
    },
    { label: "a missing index", results: [] },
  ])("retains the whole batch when Core returns $label", async ({
    results,
  }) => {
    await seedLocalEvent();
    mocks.submitAgentActivityEvents.mockResolvedValue({
      events: results,
      status: "accepted",
    });

    await expect(runSync()).resolves.toMatchObject({
      reason: "write_response_invalid",
      status: "unavailable",
      submittedCount: 0,
    });
    await expect(due(Date.now() + 60_000)).resolves.toHaveLength(1);
    await expect(
      listProjectBindings({ rootDir: requireRoot() })
    ).resolves.toHaveLength(1);
  });

  it("disables and purges a binding after a permanent Project rejection", async () => {
    await seedLocalEvent();
    mocks.submitAgentActivityEvents.mockResolvedValue({
      events: [
        {
          eventId: "event-1",
          index: 0,
          outcome: "permanent_rejected",
          reason: "project_archived",
        },
      ],
      status: "partial",
    });

    await runSync();

    await expect(due()).resolves.toHaveLength(0);
    await expect(
      listProjectBindings({ rootDir: requireRoot() })
    ).resolves.toHaveLength(0);
  });

  it("makes unbind wait for an in-flight upload before returning", async () => {
    await seedLocalEvent();
    let releaseUpload: (() => void) | undefined;
    mocks.submitAgentActivityEvents.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseUpload = () =>
            resolve({
              events: [{ eventId: "event-1", index: 0, outcome: "accepted" }],
              status: "accepted",
            });
        })
    );
    const syncing = runSync();
    await until(() => mocks.submitAgentActivityEvents.mock.calls.length === 1);
    let unbound = false;
    const unbinding = unbindProject({
      organizationId: "org-1",
      projectId: "project-1",
      rootDir: requireRoot(),
    }).then(() => {
      unbound = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(unbound).toBe(false);

    releaseUpload?.();
    await Promise.all([syncing, unbinding]);
    await expect(
      listProjectBindings({ rootDir: requireRoot() })
    ).resolves.toHaveLength(0);
  });
});

async function seedLocalEvent() {
  root = await mkdtemp(join(tmpdir(), "openmeld-activity-sync-"));
  const repositoryPath = join(root, "repository");
  await mkdir(repositoryPath, { recursive: true });
  await bindProject({
    organizationId: "org-1",
    projectId: "project-1",
    projectSlug: "openmeld",
    repositoryFingerprint: null,
    repositoryPath,
    rootDir: root,
  });
  await enqueueAgentActivityEvent({
    event: {
      clientKind: "codex-cli",
      eventId: "event-1",
      eventType: "session_active",
      expiresAtMs: 61_000,
      gitBranch: "main",
      gitCommit: null,
      model: "gpt-5.6-sol",
      observedAtMs: 1000,
      organizationId: "org-1",
      projectId: "project-1",
      provider: "codex",
      providerMetadata: { originator: "cli", source: "reconciliation" },
      providerSessionId: "session-1",
      repositoryFingerprint: null,
      source: "observed",
      startedAtMs: 900,
      status: "active",
      title: null,
    },
    nowMs: 1000,
    rootDir: root,
  });
  return { repositoryPath };
}

async function runSync() {
  return await syncLocalAgentActivity({
    reconcile: false,
    refreshContext: false,
    rootDir: requireRoot(),
  });
}

async function due(nowMs = Date.now()) {
  return await readDueAgentActivityOutbox({
    nowMs,
    rootDir: requireRoot(),
  });
}

function requireRoot() {
  if (!root) {
    throw new Error("Agent Activity local-sync fixture is unavailable.");
  }
  return root;
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for test condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
