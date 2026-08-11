import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyControllerTaskLifecycleSubmissionResults,
  deferControllerTaskLifecycleOutbox,
  enqueueControllerTaskLifecycleEvent,
  readControllerTaskLifecycleOutboxHealth,
  readDueControllerTaskLifecycleOutbox,
} from "../src/agent-activity/controller-task-lifecycle-store";
import { withAgentActivityLocalStateLock } from "../src/agent-activity/local-state-lock";

const PERMISSION_ERROR_CODE_PATTERN = /EACCES|EPERM/u;
const INVALID_DIAGNOSTIC_EVENT_ID_PATTERN = /^invalid:/u;

let root: string | null = null;

afterEach(async () => {
  if (root) {
    await rm(root, { force: true, recursive: true });
    root = null;
  }
});

describe("Agent Controller task lifecycle outbox", () => {
  it("quarantines an invalid callback and records bounded diagnostic evidence", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-controller-task-outbox-"));
    const storeRoot = join(root, "device", "agent-task-coordination");
    const outbox = join(storeRoot, "outbox");
    const quarantine = join(storeRoot, "quarantine");
    await mkdir(outbox, { recursive: true });
    const invalidCallbackPath = join(outbox, "invalid.json");
    const invalidCallback = "{not valid json\n";
    await writeFile(invalidCallbackPath, invalidCallback, "utf8");

    await expect(
      readDueControllerTaskLifecycleOutbox({
        nowMs: 2000,
        rootDir: root,
      })
    ).resolves.toEqual([]);

    const quarantineEntries = await readdir(quarantine);
    expect(quarantineEntries).toHaveLength(1);
    await expect(
      readFile(join(quarantine, quarantineEntries[0] ?? ""), "utf8")
    ).resolves.toBe(invalidCallback);
    await expect(
      readFile(join(storeRoot, "permanent-rejections.json"), "utf8").then(
        JSON.parse
      )
    ).resolves.toEqual([
      {
        eventId: expect.stringMatching(INVALID_DIAGNOSTIC_EVENT_ID_PATTERN),
        occurredAtMs: 2000,
        reason: "invalid_outbox_record",
      },
    ]);
    await expect(
      readControllerTaskLifecycleOutboxHealth({ rootDir: root })
    ).resolves.toEqual({
      pending: 0,
      permanentlyRejected: 1,
      retrying: 0,
    });
  });

  it("quarantines a damaged matching callback before safely re-enqueuing it", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-controller-task-outbox-"));
    const storeRoot = join(root, "device", "agent-task-coordination");
    const outbox = join(storeRoot, "outbox");
    const quarantine = join(storeRoot, "quarantine");
    const event = {
      agentControllerRef: "builtin:codex",
      attentionCode: null,
      eventId: "codex:event-damaged",
      eventType: "completed" as const,
      occurredAtMs: 1000,
      organizationId: "org-1",
      source: "codex_stop" as const,
      taskId: "turn-damaged",
    };
    await mkdir(outbox, { recursive: true });
    const damagedPath = join(
      outbox,
      `${createHash("sha256").update(event.eventId).digest("hex")}.json`
    );
    await writeFile(damagedPath, "{not valid json\n", "utf8");

    await expect(
      enqueueControllerTaskLifecycleEvent({
        event,
        nowMs: 2000,
        rootDir: root,
      })
    ).resolves.toBe("queued");

    await expect(
      readDueControllerTaskLifecycleOutbox({
        nowMs: 2000,
        rootDir: root,
      })
    ).resolves.toEqual([
      expect.objectContaining({
        attemptCount: 0,
        event,
        queuedAtMs: 2000,
      }),
    ]);
    await expect(readdir(quarantine)).resolves.toHaveLength(1);
    await expect(
      readControllerTaskLifecycleOutboxHealth({ rootDir: root })
    ).resolves.toEqual({
      pending: 1,
      permanentlyRejected: 1,
      retrying: 0,
    });
  });

  it("keeps invalid callback diagnostics within the permanent evidence limit", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-controller-task-outbox-"));
    const storeRoot = join(root, "device", "agent-task-coordination");
    const outbox = join(storeRoot, "outbox");
    await mkdir(outbox, { recursive: true });
    await writeFile(
      join(storeRoot, "permanent-rejections.json"),
      `${JSON.stringify(
        Array.from({ length: 200 }, (_, index) => ({
          eventId: `codex:history-${index}`,
          occurredAtMs: index,
          reason: "event_source_invalid",
        }))
      )}\n`,
      "utf8"
    );
    await writeFile(join(outbox, "invalid.json"), "{not valid json\n", "utf8");

    await readDueControllerTaskLifecycleOutbox({
      nowMs: 2000,
      rootDir: root,
    });

    const diagnostics = JSON.parse(
      await readFile(join(storeRoot, "permanent-rejections.json"), "utf8")
    ) as Array<{ eventId: string; reason: string }>;
    expect(diagnostics).toHaveLength(200);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        eventId: expect.stringMatching(INVALID_DIAGNOSTIC_EVENT_ID_PATTERN),
        occurredAtMs: 2000,
        reason: "invalid_outbox_record",
      })
    );
    expect(
      diagnostics.some((entry) => entry.eventId === "codex:history-0")
    ).toBe(false);
    expect(
      diagnostics.some((entry) => entry.eventId === "codex:history-199")
    ).toBe(true);
  });

  it("preserves an invalid callback when quarantine cannot accept it", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-controller-task-outbox-"));
    const storeRoot = join(root, "device", "agent-task-coordination");
    const outbox = join(storeRoot, "outbox");
    const quarantine = join(storeRoot, "quarantine");
    await mkdir(outbox, { recursive: true });
    await mkdir(quarantine, { recursive: true });
    const invalidCallbackPath = join(outbox, "invalid.json");
    const invalidCallback = "{not valid json\n";
    await writeFile(invalidCallbackPath, invalidCallback, "utf8");
    await chmod(quarantine, 0o500);

    try {
      await expect(
        readDueControllerTaskLifecycleOutbox({
          nowMs: 2000,
          rootDir: root,
        })
      ).rejects.toMatchObject({
        code: expect.stringMatching(PERMISSION_ERROR_CODE_PATTERN),
      });
      await expect(readFile(invalidCallbackPath, "utf8")).resolves.toBe(
        invalidCallback
      );
    } finally {
      await chmod(quarantine, 0o700);
    }
  });

  it("treats missing diagnostics as empty but surfaces diagnostic I/O errors", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-controller-task-outbox-"));
    const storeRoot = join(root, "device", "agent-task-coordination");

    await expect(
      readControllerTaskLifecycleOutboxHealth({ rootDir: root })
    ).resolves.toEqual({
      pending: 0,
      permanentlyRejected: 0,
      retrying: 0,
    });

    await mkdir(join(storeRoot, "permanent-rejections.json"));
    await expect(
      readControllerTaskLifecycleOutboxHealth({ rootDir: root })
    ).rejects.toMatchObject({ code: "EISDIR" });
  });

  it("treats a quarantine directory removed before a health read as empty", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-controller-task-outbox-"));
    const quarantine = join(
      root,
      "device",
      "agent-task-coordination",
      "quarantine"
    );
    let releaseLock!: () => void;
    let confirmLockHeld!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      confirmLockHeld = resolve;
    });
    const lockRelease = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const heldLock = withAgentActivityLocalStateLock(
      { rootDir: root },
      async () => {
        confirmLockHeld();
        await lockRelease;
      }
    );
    await lockHeld;

    const health = readControllerTaskLifecycleOutboxHealth({ rootDir: root });
    await vi.waitFor(async () => {
      await expect(readdir(quarantine)).resolves.toEqual([]);
    });
    await rm(quarantine, { force: true, recursive: true });
    releaseLock();
    await heldLock;

    await expect(health).resolves.toEqual({
      pending: 0,
      permanentlyRejected: 0,
      retrying: 0,
    });
  });

  it("reports quarantined diagnostic corruption as bounded health evidence", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-controller-task-outbox-"));
    const storeRoot = join(root, "device", "agent-task-coordination");
    const quarantine = join(storeRoot, "quarantine");
    const invalidDiagnostics = "{not valid json\n";
    await mkdir(storeRoot, { recursive: true });
    await writeFile(
      join(storeRoot, "permanent-rejections.json"),
      invalidDiagnostics,
      "utf8"
    );

    await expect(
      readControllerTaskLifecycleOutboxHealth({ rootDir: root })
    ).resolves.toEqual({
      pending: 0,
      permanentlyRejected: 1,
      retrying: 0,
    });

    const quarantineEntries = (await readdir(quarantine)).filter((name) =>
      name.includes(".invalid-diagnostics")
    );
    expect(quarantineEntries).toHaveLength(1);
    await expect(
      readFile(join(quarantine, quarantineEntries[0] ?? ""), "utf8")
    ).resolves.toBe(invalidDiagnostics);
    await expect(
      readFile(join(storeRoot, "permanent-rejections.json"), "utf8").then(
        JSON.parse
      )
    ).resolves.toEqual([
      {
        eventId: expect.stringMatching(INVALID_DIAGNOSTIC_EVENT_ID_PATTERN),
        occurredAtMs: expect.any(Number),
        reason: "invalid_outbox_record",
      },
    ]);
  });

  it("recovers callback corruption evidence after quarantine outlives a diagnostic write failure", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-controller-task-outbox-"));
    const storeRoot = join(root, "device", "agent-task-coordination");
    const outbox = join(storeRoot, "outbox");
    const quarantine = join(storeRoot, "quarantine");
    const invalidCallbackPath = join(outbox, "invalid.json");
    await mkdir(outbox, { recursive: true });
    await mkdir(join(storeRoot, "permanent-rejections.json"));
    await writeFile(invalidCallbackPath, "{not valid json\n", "utf8");

    await expect(
      readDueControllerTaskLifecycleOutbox({
        nowMs: 2000,
        rootDir: root,
      })
    ).rejects.toMatchObject({ code: "EISDIR" });
    await expect(readFile(invalidCallbackPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readdir(quarantine)).resolves.toHaveLength(1);

    await rm(join(storeRoot, "permanent-rejections.json"), {
      recursive: true,
    });
    await expect(
      readControllerTaskLifecycleOutboxHealth({ rootDir: root })
    ).resolves.toEqual({
      pending: 0,
      permanentlyRejected: 1,
      retrying: 0,
    });
  });

  it.each([
    {
      existingDiagnostics: "{not valid json\n",
      name: "malformed JSON",
    },
    {
      existingDiagnostics: `${JSON.stringify([
        {
          eventId: "codex:valid-history",
          occurredAtMs: 900,
          reason: "event_source_invalid",
        },
        {
          eventId: "codex:invalid-history",
        },
      ])}\n`,
      name: "schema-invalid history",
    },
  ])("quarantines $name before writing new permanent diagnostic evidence", async ({
    existingDiagnostics,
  }) => {
    root = await mkdtemp(join(tmpdir(), "openmeld-controller-task-outbox-"));
    const storeRoot = join(root, "device", "agent-task-coordination");
    const quarantine = join(storeRoot, "quarantine");
    await enqueueControllerTaskLifecycleEvent({
      event: {
        agentControllerRef: "builtin:codex",
        attentionCode: null,
        eventId: "codex:event-permanent",
        eventType: "completed",
        occurredAtMs: 1000,
        organizationId: "org-1",
        source: "codex_stop",
        taskId: "turn-1",
      },
      nowMs: 1000,
      rootDir: root,
    });
    await writeFile(
      join(storeRoot, "permanent-rejections.json"),
      existingDiagnostics,
      "utf8"
    );
    const records = await readDueControllerTaskLifecycleOutbox({
      nowMs: 1000,
      rootDir: root,
    });

    await applyControllerTaskLifecycleSubmissionResults({
      nowMs: 2000,
      records,
      results: [
        {
          eventId: "codex:event-permanent",
          reason: "event_source_invalid",
          status: "permanently_rejected",
        },
      ],
      rootDir: root,
    });

    const quarantineEntries = (await readdir(quarantine)).filter((name) =>
      name.includes(".invalid-diagnostics")
    );
    expect(quarantineEntries).toHaveLength(1);
    await expect(
      readFile(join(quarantine, quarantineEntries[0] ?? ""), "utf8")
    ).resolves.toBe(existingDiagnostics);
    await expect(
      readFile(join(storeRoot, "permanent-rejections.json"), "utf8").then(
        JSON.parse
      )
    ).resolves.toEqual([
      {
        eventId: "codex:event-permanent",
        occurredAtMs: 2000,
        reason: "event_source_invalid",
      },
      {
        eventId: expect.stringMatching(INVALID_DIAGNOSTIC_EVENT_ID_PATTERN),
        occurredAtMs: expect.any(Number),
        reason: "invalid_outbox_record",
      },
    ]);
  });

  it("keeps the newest 200 diagnostics from nonchronological recovery input", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-controller-task-outbox-"));
    const storeRoot = join(root, "device", "agent-task-coordination");
    await mkdir(storeRoot, { recursive: true });
    const newestDiagnostic = {
      eventId: "codex:newest",
      occurredAtMs: 10_000,
      reason: "event_source_invalid",
    };
    const olderDiagnostics = Array.from({ length: 200 }, (_, index) => ({
      eventId: `codex:older-${String(index).padStart(3, "0")}`,
      occurredAtMs: index,
      reason: "event_source_invalid",
    }));
    await writeFile(
      join(storeRoot, "permanent-rejections.json"),
      `${JSON.stringify([newestDiagnostic, ...olderDiagnostics])}\n`,
      "utf8"
    );

    await expect(
      readControllerTaskLifecycleOutboxHealth({ rootDir: root })
    ).resolves.toEqual({
      pending: 0,
      permanentlyRejected: 200,
      retrying: 0,
    });

    const persisted = JSON.parse(
      await readFile(join(storeRoot, "permanent-rejections.json"), "utf8")
    ) as Array<{ eventId: string; occurredAtMs: number }>;
    expect(persisted).toHaveLength(200);
    expect(persisted.at(-1)).toEqual(newestDiagnostic);
    expect(persisted.some((entry) => entry.occurredAtMs === 0)).toBe(false);
    expect(
      persisted.every(
        (entry, index) =>
          index === 0 ||
          (persisted[index - 1]?.occurredAtMs ?? 0) <= entry.occurredAtMs
      )
    ).toBe(true);
  });

  it("uses one stable recovery time for mixed legacy quarantine evidence", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-controller-task-outbox-"));
    const storeRoot = join(root, "device", "agent-task-coordination");
    const quarantine = join(storeRoot, "quarantine");
    await mkdir(quarantine, { recursive: true });
    const currentDiagnostic = {
      eventId: "zzzz:current",
      occurredAtMs: 5000,
      reason: "event_source_invalid",
    };
    await writeFile(
      join(storeRoot, "permanent-rejections.json"),
      `${JSON.stringify([currentDiagnostic])}\n`,
      "utf8"
    );
    const legacyDiagnosticIds = Array.from(
      { length: 200 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
    );
    await Promise.all(
      legacyDiagnosticIds.map((diagnosticId) =>
        writeFile(
          join(quarantine, `${diagnosticId}.invalid-diagnostics`),
          "legacy evidence\n",
          "utf8"
        )
      )
    );
    let nowCallCount = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      const callIndex = nowCallCount++;
      return callIndex < 2 ? 0 : 5000 + callIndex - 2;
    });
    try {
      await expect(
        readControllerTaskLifecycleOutboxHealth({ rootDir: root })
      ).resolves.toEqual({
        pending: 0,
        permanentlyRejected: 200,
        retrying: 0,
      });
    } finally {
      nowSpy.mockRestore();
    }

    const persisted = JSON.parse(
      await readFile(join(storeRoot, "permanent-rejections.json"), "utf8")
    ) as Array<{ eventId: string; occurredAtMs: number }>;
    expect(persisted).toHaveLength(200);
    expect(persisted).toContainEqual(currentDiagnostic);
    expect(
      persisted.filter((entry) => entry.eventId.startsWith("invalid:"))
    ).toHaveLength(199);
    expect(
      new Set(
        persisted
          .filter((entry) => entry.eventId.startsWith("invalid:"))
          .map((entry) => entry.occurredAtMs)
      )
    ).toEqual(new Set([5000]));
    expect(
      (await readdir(quarantine)).every((entry) =>
        entry.endsWith(".reconciled")
      )
    ).toBe(true);
  });

  it("retains a permanently rejected event until its diagnostic is durable", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-controller-task-outbox-"));
    await enqueueControllerTaskLifecycleEvent({
      event: {
        agentControllerRef: "builtin:codex",
        attentionCode: null,
        eventId: "codex:event-permanent",
        eventType: "completed",
        occurredAtMs: 1000,
        organizationId: "org-1",
        source: "codex_stop",
        taskId: "turn-1",
      },
      nowMs: 1000,
      rootDir: root,
    });
    const records = await readDueControllerTaskLifecycleOutbox({
      nowMs: 1000,
      rootDir: root,
    });

    await expect(
      applyControllerTaskLifecycleSubmissionResults({
        records,
        results: [
          {
            eventId: "codex:event-permanent",
            reason: "event_source_invalid",
            status: "permanently_rejected",
          },
        ],
        rootDir: root,
        writePermanentDiagnostic: () =>
          Promise.reject(new Error("simulated disk failure")),
      })
    ).rejects.toThrow("simulated disk failure");
    await expect(
      readDueControllerTaskLifecycleOutbox({
        nowMs: 1000,
        rootDir: root,
      })
    ).resolves.toHaveLength(1);
  });

  it("reports pending, retrying, and permanently rejected callback evidence", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-controller-task-outbox-"));
    await enqueueControllerTaskLifecycleEvent({
      event: {
        agentControllerRef: "builtin:codex",
        attentionCode: null,
        eventId: "codex:event-retry",
        eventType: "completed",
        occurredAtMs: 1000,
        organizationId: "org-1",
        source: "codex_stop",
        taskId: "turn-1",
      },
      nowMs: 1000,
      rootDir: root,
    });
    await enqueueControllerTaskLifecycleEvent({
      event: {
        agentControllerRef: "builtin:codex",
        attentionCode: null,
        eventId: "codex:event-permanent",
        eventType: "completed",
        occurredAtMs: 1001,
        organizationId: "org-1",
        source: "codex_stop",
        taskId: "turn-2",
      },
      nowMs: 1001,
      rootDir: root,
    });
    const records = await readDueControllerTaskLifecycleOutbox({
      nowMs: 1001,
      rootDir: root,
    });
    const retryRecord = records.find(
      (record) => record.event.eventId === "codex:event-retry"
    );
    const permanentRecord = records.find(
      (record) => record.event.eventId === "codex:event-permanent"
    );
    expect(retryRecord).toBeDefined();
    expect(permanentRecord).toBeDefined();
    if (!(retryRecord && permanentRecord)) {
      throw new Error("Expected both controller task callback records");
    }

    await deferControllerTaskLifecycleOutbox({
      nowMs: 1001,
      records: [retryRecord],
      rootDir: root,
    });
    await applyControllerTaskLifecycleSubmissionResults({
      nowMs: 1001,
      records: [permanentRecord],
      results: [
        {
          eventId: "codex:event-permanent",
          reason: "event_source_invalid",
          status: "permanently_rejected",
        },
      ],
      rootDir: root,
    });

    await expect(
      readControllerTaskLifecycleOutboxHealth({ rootDir: root })
    ).resolves.toEqual({
      pending: 1,
      permanentlyRejected: 1,
      retrying: 1,
    });
  });
});
