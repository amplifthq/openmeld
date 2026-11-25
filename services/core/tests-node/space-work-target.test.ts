import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CenterAgentWorkTarget,
  CenterAgentWorkTargetSelection,
  SignalEnvelope,
  SpaceTaskActor,
} from "@openmeld/schemas/types";
import { expect, it } from "vitest";
import { createSpaceTaskForMessage } from "../src/space/application/space-task-message";
import { SpaceTaskService } from "../src/space/application/space-task-service";
import { accessSpaceWorkTarget } from "../src/space/application/space-work-target";
import { SpaceTaskDeliveryRepository } from "../src/space/infrastructure/sql/space-task-delivery-repo";
import {
  ensureSpaceTaskTables,
  SpaceTaskRepository,
} from "../src/space/infrastructure/sql/space-task-repo";
import { ensureSpaceWorkTargetTable } from "../src/space/infrastructure/sql/space-work-target-repo";

type Source = Extract<SignalEnvelope, { type: "signal.text" }>;
const human: SpaceTaskActor = {
  profileId: "11111111-1111-4111-8111-111111111111",
  profileKind: "human",
  profileName: "Requester",
  ownerUserId: "user-1",
};
const executor: SpaceTaskActor = {
  profileId: "agt_22222222-2222-4222-8222-222222222222",
  profileKind: "agent",
  profileName: "Assignee",
  ownerUserId: null,
};
const coordinator: SpaceTaskActor = {
  profileId: "agt_33333333-3333-4333-8333-333333333333",
  profileKind: "agent",
  profileName: "Coordinator",
  ownerUserId: null,
};
const oldTarget: CenterAgentWorkTarget = {
  requestGoal: "Review the intent PR",
  codeRepositories: [{ owner: "acme", repo: "platform" }],
  issueDestinations: [],
};
const correctedTarget: CenterAgentWorkTarget = {
  ...oldTarget,
  codeRepositories: [{ owner: "acme", repo: "product" }],
};
const select = (
  target: CenterAgentWorkTarget,
  relationship: "new_request" | "correction" = "new_request"
): CenterAgentWorkTargetSelection => ({ kind: "select", relationship, target });

it("keeps a corrected request across restart and an interleaved new request, including late callbacks and retries", () => {
  const directory = mkdtempSync(join(tmpdir(), "work-target-"));
  const path = join(directory, "space.sqlite");
  let db = new DatabaseSync(path);
  const sources = new Map<string, Source>();
  const call = (
    id: string,
    choice?: CenterAgentWorkTargetSelection,
    revision = 0,
    expectedSource: string | null = null
  ) => invoke(db, sources, id, choice, revision, expectedSource);
  try {
    ensureSpaceWorkTargetTable(storage(db));
    for (const id of [
      "original",
      "correction",
      "continue",
      "circle",
      "next",
      "stale",
    ]) {
      sources.set(id, source(id));
    }
    const first = call("original", select(oldTarget));
    const corrected = call(
      "correction",
      select(correctedTarget, "correction"),
      first.record?.revision,
      "original"
    );
    expect(corrected.record?.revision).toBe(2);
    expect(call("continue", { kind: "inherit" }, 2, "correction")).toEqual(
      corrected
    );
    db.close();
    db = new DatabaseSync(path);
    expect(call("continue").record?.target).toEqual(correctedTarget);
    const circle = {
      ...oldTarget,
      requestGoal: "Report the separate Circle request",
    };
    call("circle", select(circle), 2, "correction");
    sources.set("agent-request", source("agent-request", coordinator));
    expect(
      invoke(db, sources, "agent-request", select(oldTarget)).record?.target
    ).toEqual(oldTarget);
    sources.set("return-original", source("return-original"));
    const reference = {
      logicalConversationId: "another-thread",
      referenceSourceSignalId: "original",
    };
    expect(
      invoke(db, sources, "return-original", undefined, 0, null, reference)
        .record?.target
    ).toEqual(correctedTarget);
    expect(
      invoke(
        db,
        sources,
        "return-original",
        { kind: "inherit" },
        2,
        "correction",
        reference
      ).record?.target
    ).toEqual(correctedTarget);
    expect(() =>
      invoke(db, sources, "return-original", undefined, 0, null, {
        ...reference,
        referenceSourceSignalId: "circle",
      })
    ).toThrow("source_scope_changed");
    sources.set("agent-correction", source("agent-correction", coordinator));
    expect(() =>
      invoke(
        db,
        sources,
        "agent-correction",
        select(oldTarget, "correction"),
        1,
        "circle",
        { referenceSourceSignalId: "circle" }
      )
    ).toThrow("source_authority_required");
    sources.set(
      "other-requester",
      source("other-requester", {
        ...human,
        profileId: "44444444-4444-4444-8444-444444444444",
        ownerUserId: "user-2",
      })
    );
    expect(() =>
      invoke(
        db,
        sources,
        "other-requester",
        select(oldTarget, "correction"),
        1,
        "circle",
        { referenceSourceSignalId: "circle" }
      )
    ).toThrow("source_authority_required");
    // Old source-bound callbacks never follow the current conversation default.
    expect(call("original").record?.target).toEqual(correctedTarget);
    expect(call("original", select(oldTarget)).record?.target).toEqual(
      correctedTarget
    );
    expect(
      call("next", { kind: "inherit" }, 1, "circle").record?.target
    ).toEqual(circle);
    expect(() => call("original", select(circle))).toThrow(
      "selection_already_bound"
    );
    // A matching revision number alone cannot authorize a correction to another goal.
    expect(() =>
      call("stale", select(oldTarget, "correction"), 1, "original")
    ).toThrow("revision_conflict");
    const origin = sources.get("correction");
    if (!origin) {
      throw new Error("Missing fixture source");
    }
    origin.data.meta = { messageRevision: 1, recalledAt: 123 };
    expect(call("original")).toEqual({ record: null, selectionRequired: true });
    expect(call("circle").record?.target).toEqual(circle);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("resolves real Space Task creation and Agent handoff receipts without mixing Tasks sharing a Thread", () => {
  const db = new DatabaseSync(":memory:");
  const sql = storage(db);
  const sources = new Map<string, Source>();
  try {
    ensureSpaceWorkTargetTable(sql);
    ensureSpaceTaskTables(sql);
    const deliveries = new SpaceTaskDeliveryRepository(sql);
    deliveries.initialize();
    const members = new Map(
      [human, executor, coordinator].map((actor) => [actor.profileId, actor])
    );
    const context = {
      actor: human,
      requestedBy: human,
      isSpaceOwner: true,
      resolveMember: (id: string) => members.get(id) ?? null,
    };
    const service = new SpaceTaskService({
      repository: new SpaceTaskRepository(sql),
      runTransaction: (callback) => callback(),
      spaceId: "space-1",
    });
    const create = (id: string, title: string) => {
      const message = source(id);
      message.data.taskDraft = { title, assigneeProfileId: executor.profileId };
      message.data.messageEnvelope = {
        text: message.data.text,
        activationTargets: [executor.profileId],
        mentionTargets: [],
        referenceTargets: [],
      };
      sources.set(id, message);
      const receipt = createSpaceTaskForMessage({
        sql,
        signal: message,
        context,
        threadId: "shared-thread",
      });
      if (!receipt) {
        throw new Error("Task was not created");
      }
      const assigned = service.mutate(
        receipt.task.taskId,
        {
          action: "assign",
          assigneeProfileId: executor.profileId,
          expectedRevision: receipt.task.revision,
          operationId: `assign-${id}`,
        },
        { ...context, actor: coordinator, representedRequester: human }
      );
      const handoff = source(
        `space-task-handoff:${assigned.event.eventId}`,
        coordinator
      );
      handoff.data.meta = { purpose: "space_task_handoff", messageRevision: 0 };
      sources.set(handoff.id, handoff);
      return { message, handoff, task: assigned.task };
    };
    const first = create("task-request-a", "Review product code");
    const second = create("task-request-b", "Review platform code");
    const a = invoke(db, sources, first.message.id, select(correctedTarget));
    const b = invoke(db, sources, second.message.id, select(oldTarget));
    expect(() => invoke(db, sources, first.handoff.id)).toThrow(
      "task_source_unavailable"
    );
    deliveries.recordWake(
      first.task.taskId,
      first.handoff.id,
      executor.profileId
    );
    deliveries.recordWake(
      second.task.taskId,
      second.handoff.id,
      executor.profileId
    );
    expect(
      invoke(
        db,
        sources,
        first.handoff.id,
        { kind: "inherit" },
        a.record?.revision,
        first.message.id
      ).record?.target
    ).toEqual(correctedTarget);
    expect(
      invoke(
        db,
        sources,
        second.handoff.id,
        { kind: "inherit" },
        b.record?.revision,
        second.message.id
      ).record?.target
    ).toEqual(oldTarget);
    expect(invoke(db, sources, first.handoff.id).record?.target).toEqual(
      correctedTarget
    );
    expect(() =>
      invoke(db, sources, first.handoff.id, undefined, 0, null, {
        executorId: "unrelated-agent",
      })
    ).toThrow("task_source_unavailable");
  } finally {
    db.close();
  }
});

it("rejects edited source evidence without changing another source-bound goal", () => {
  const db = new DatabaseSync(":memory:");
  const sources = new Map([["original", source("original")]]);
  try {
    ensureSpaceWorkTargetTable(storage(db));
    invoke(db, sources, "original", select(oldTarget));
    const edited = sources.get("original");
    if (!edited) {
      throw new Error("Missing fixture source");
    }
    edited.data.meta = { messageRevision: 1, editedAt: 5 };
    expect(() => invoke(db, sources, "original")).toThrow("source_changed");
    sources.set("unbound-edited", {
      ...source("unbound-edited"),
      data: {
        text: "Edited request",
        meta: { messageRevision: 1, editedAt: 5 },
      },
    });
    expect(() => invoke(db, sources, "unbound-edited")).toThrow(
      "source_changed"
    );
  } finally {
    db.close();
  }
});

function source(id: string, actor = human): Source {
  return {
    v: 1,
    id,
    ts: 1,
    type: "signal.text",
    spaceId: "space-1",
    profile: {
      kind: actor.profileKind,
      profileId: actor.profileId,
      profileName: actor.profileName,
    },
    data: { text: "Requested work", meta: { messageRevision: 0 } },
  };
}

function invoke(
  db: DatabaseSync,
  sources: Map<string, Source>,
  id: string,
  choice?: CenterAgentWorkTargetSelection,
  revision = 0,
  expectedSource: string | null = null,
  options: {
    executorId?: string;
    logicalConversationId?: string;
    referenceSourceSignalId?: string;
  } = {}
) {
  const message = sources.get(id);
  if (!message) {
    throw new Error("Missing fixture source");
  }
  db.exec("BEGIN");
  try {
    const result = accessSpaceWorkTarget(
      storage(db),
      {
        logicalConversationId:
          options.logicalConversationId ??
          "center-space:room:root:shared-thread",
        sourceSignalId: id,
        sourceAuthorProfileId: message.profile.profileId,
        executorProfileId: options.executorId ?? executor.profileId,
        ...(options.referenceSourceSignalId
          ? { referenceSourceSignalId: options.referenceSourceSignalId }
          : {}),
        admittedAtMs: 10,
        ...(choice
          ? {
              selection: {
                expectedRevision: revision,
                expectedSourceSignalId: expectedSource,
                choice,
              },
            }
          : {}),
      },
      (sourceId) => sources.get(sourceId) ?? null,
      false
    );
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function storage(db: DatabaseSync): SqlStorage {
  return {
    exec(query: string, ...params: (string | number)[]) {
      const prefix = query.trimStart();
      if (prefix.startsWith("SELECT") || prefix.startsWith("PRAGMA")) {
        return { toArray: () => db.prepare(query).all(...params) };
      }
      if (params.length === 0) {
        db.exec(query);
      } else {
        db.prepare(query).run(...params);
      }
      return { toArray: () => [] };
    },
  } as unknown as SqlStorage;
}
