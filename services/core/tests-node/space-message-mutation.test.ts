import { DatabaseSync } from "node:sqlite";
import { signalTextEnvelopeSchema } from "@openmeld/schemas";
import type { SpaceMessageMutationBody } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it } from "vitest";
import { readSpaceUpdatesUseCase } from "../src/space/application/space-updates-service";
import {
  createDispatchOutboxRecord,
  listDispatchOutboxRecordsBySourceSignalId,
} from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import {
  completeRecalledMessageRepost,
  mutateSpaceMessage,
} from "../src/space/infrastructure/sql/space-message-mutation-repo";
import {
  listSignalEntriesPageWindow,
  readAgentReplyObservationState,
} from "../src/space/infrastructure/sql/space-signal-repo";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

function fixture() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`CREATE TABLE space_signals (id TEXT PRIMARY KEY, ts INTEGER, type TEXT, profile_id TEXT, profile_kind TEXT, payload_json TEXT);
    CREATE TABLE space_recalled_message_drafts (signal_id TEXT PRIMARY KEY, payload_json TEXT);
    CREATE TABLE space_thread_signal_placements (signal_id TEXT PRIMARY KEY, thread_id TEXT, placement TEXT, created_at_ms INTEGER);`);
  const original = {
    v: 1,
    id: "message-1",
    spaceId: "space-1",
    ts: 100,
    type: "signal.text",
    profile: { profileId: "human-1", profileName: "Alice", kind: "human" },
    data: { text: "Deploy A" },
  };
  db.prepare("INSERT INTO space_signals VALUES (?, ?, ?, ?, ?, ?)").run(
    original.id,
    100,
    original.type,
    "human-1",
    "human",
    JSON.stringify(original)
  );
  const sql = {
    exec(query: string, ...params: (string | number | null)[]) {
      const statement = db.prepare(query);
      if (statement.columns().length) {
        const rows = statement.all(...params);
        return {
          toArray: () => rows,
          rowsWritten: 0,
          [Symbol.iterator]: () => rows[Symbol.iterator](),
        };
      }
      const result = statement.run(...params);
      return {
        toArray: () => [],
        rowsWritten: Number(result.changes),
        [Symbol.iterator]: () => [][Symbol.iterator](),
      };
    },
  } as unknown as SqlStorage;
  const change = (
    body: SpaceMessageMutationBody,
    actorProfileId = "human-1",
    actorKind = "human"
  ) => {
    db.exec("BEGIN");
    try {
      const result = mutateSpaceMessage({
        sql,
        signalId: original.id,
        actorProfileId,
        actorKind,
        body,
        nowMs: 200,
      });
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  return { db, sql, original, change };
}

describe("message editing and recall", () => {
  it("finds an old message's Wake even after more than 500 newer dispatches", () => {
    const f = fixture();
    f.db.exec(
      "CREATE TABLE openMeldDaemon_outbox (source_event_id TEXT, payload_json TEXT, status TEXT, created_at_ms INTEGER, queued_at_ms INTEGER)"
    );
    const record = createDispatchOutboxRecord({
      bindingEnabled: true,
      bindingState: "bound",
      dispatchPolicy: "mention_only",
      spaceId: "space-1",
      sourceEventId: "message-1",
      senderProfileId: "human-1",
      sourceSignalSnapshot: {
        text: "@Alex Deploy A",
        profileId: "human-1",
        profileKind: "human",
      },
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
      ruleSource: "registry",
      ruleId: "registry.default.all_members.v1",
      ruleReason: "explicit Wake",
      nowMs: 100,
    });
    const insert = f.db.prepare(
      "INSERT INTO openMeldDaemon_outbox VALUES (?, ?, 'queued', ?, 100)"
    );
    insert.run("message-1", record.payloadJson, 100);
    for (let index = 0; index < 501; index++) {
      insert.run(`newer-${index}`, record.payloadJson, 200 + index);
    }
    const records = listDispatchOutboxRecordsBySourceSignalId(
      f.sql,
      "message-1"
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourceEventId: "message-1",
      outboxStatus: "handed_off",
    });
  });

  it("adds the first Wake in place and never rearms it through later edits", () => {
    const f = fixture();
    const envelope = {
      text: "@Alex Deploy A",
      activationTargets: ["agt_11111111-1111-4111-8111-111111111111"],
      referenceTargets: [],
    };
    const first = f.change({
      action: "edit",
      expectedRevision: 0,
      text: envelope.text,
      messageEnvelope: envelope,
    });
    expect(first.message.id).toBe(f.original.id);
    expect(first.message.ts).toBe(100);
    expect(first.message.data.messageEnvelope?.activationTargets).toEqual([
      "agt_11111111-1111-4111-8111-111111111111",
    ]);
    expect(() =>
      f.change({
        action: "edit",
        expectedRevision: 0,
        text: envelope.text,
        messageEnvelope: envelope,
      })
    ).toThrow("another device");
    const corrected = f.change({
      action: "edit",
      expectedRevision: 1,
      text: "@Alex Deploy B",
    });
    expect(corrected.message.data.messageEnvelope?.activationTargets).toEqual([
      "agt_11111111-1111-4111-8111-111111111111",
    ]);
    for (const targets of [
      [],
      ["agt_22222222-2222-4222-8222-222222222222"],
      [
        "agt_11111111-1111-4111-8111-111111111111",
        "agt_22222222-2222-4222-8222-222222222222",
      ],
    ]) {
      expect(() =>
        f.change({
          action: "edit",
          expectedRevision: 2,
          text: envelope.text,
          messageEnvelope: { ...envelope, activationTargets: targets },
        })
      ).toThrow("already started");
    }
  });

  it("rolls back the edit when dispatch admission fails inside its transaction", () => {
    const f = fixture();
    f.db.exec("BEGIN");
    expect(() =>
      mutateSpaceMessage({
        sql: f.sql,
        signalId: f.original.id,
        actorProfileId: "human-1",
        actorKind: "human",
        nowMs: 200,
        body: {
          action: "edit",
          expectedRevision: 0,
          text: "@Alex Deploy A",
          messageEnvelope: {
            text: "@Alex Deploy A",
            activationTargets: ["agt_11111111-1111-4111-8111-111111111111"],
            referenceTargets: [],
          },
        },
        onEdit: () => {
          throw new Error("Agent unavailable");
        },
      })
    ).toThrow("Agent unavailable");
    f.db.exec("ROLLBACK");
    expect(
      f.change({ action: "edit", expectedRevision: 0, text: "Kept draft" })
        .message.data.text
    ).toBe("Kept draft");
  });
  it("consumes recovery only in a successful publication transaction and keeps the notice", () => {
    const f = fixture();
    f.change({ action: "recall", expectedRevision: 0 });
    const repost = signalTextEnvelopeSchema.parse({
      ...f.original,
      id: "repost-1",
      ts: 300,
      data: { text: "Deploy B", meta: { restoredFromSignalId: f.original.id } },
    });
    expect(() =>
      completeRecalledMessageRepost(f.sql, {
        ...repost,
        profile: { ...repost.profile, profileId: "other" },
      })
    ).toThrow();
    f.db.exec("BEGIN");
    completeRecalledMessageRepost(f.sql, repost);
    f.db.exec("ROLLBACK");
    expect(f.change({ action: "restore_draft" }).message.data.text).toBe(
      "Deploy A"
    );
    f.db.exec("BEGIN");
    const consumed = completeRecalledMessageRepost(f.sql, repost);
    f.db.exec("COMMIT");
    expect(consumed?.data.text).toBe("Alice recalled a message.");
    expect(consumed?.data.meta?.repostedAt).toBe(300);
    expect(() => f.change({ action: "restore_draft" })).toThrow();
    expect(completeRecalledMessageRepost(f.sql, repost)).toBeNull();
  });
  it("keeps attachment-only messages valid and rejects added or duplicated attachment identities", () => {
    const f = fixture();
    const file = {
      fileId: "file-1",
      revision: 1,
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 6,
    };
    const source = {
      ...f.original,
      data: {
        text: "Deploy A",
        files: [file],
        messageEnvelope: {
          text: "Deploy A",
          activationTargets: [],
          referenceTargets: [],
        },
      },
    };
    f.db
      .prepare("UPDATE space_signals SET payload_json = ? WHERE id = ?")
      .run(JSON.stringify(source), source.id);
    expect(() =>
      f.change({
        action: "edit",
        expectedRevision: 0,
        text: "",
        retainedFileIds: ["unknown"],
      })
    ).toThrow("invalid_attachment");
    expect(() =>
      f.change({
        action: "edit",
        expectedRevision: 0,
        text: "",
        retainedFileIds: ["file-1", "file-1"],
      })
    ).toThrow("invalid_attachment");
    const edited = f.change({
      action: "edit",
      expectedRevision: 0,
      text: " \n ",
      retainedFileIds: ["file-1"],
    }).message;
    expect(edited.data.text).toBe("");
    expect(edited.data.files).toEqual([file]);
    expect(edited.data.meta?.recalledAt).toBeUndefined();
    expect(() =>
      f.change({
        action: "edit",
        expectedRevision: 1,
        text: "",
        retainedFileIds: [],
      })
    ).toThrow("recall_confirmation_required");
    f.change({ action: "recall", expectedRevision: 1 });
    expect(f.change({ action: "restore_draft" }).message.data.files).toEqual([
      file,
    ]);
  });

  it("does not fill visible history pages with mutation cursor notices", () => {
    const f = fixture();
    const notice = {
      ...f.original,
      id: "change-1",
      ts: 200,
      profile: {
        profileId: "openmeld-system",
        profileName: "OpenMeld",
        kind: "system",
      },
      data: {
        text: "Message changed",
        meta: {
          purpose: "space_message_changed",
          changedMessageId: "message-1",
        },
      },
    };
    f.db
      .prepare("INSERT INTO space_signals VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        notice.id,
        200,
        notice.type,
        "openmeld-system",
        "system",
        JSON.stringify(notice)
      );
    const page = listSignalEntriesPageWindow(f.sql, {
      afterTs: null,
      cursor: null,
      limit: 10,
      filters: { signalTypes: ["signal.text"] },
    });
    expect(page.entries.map((entry) => JSON.parse(entry[1]).id)).toEqual([
      "message-1",
    ]);
  });
  it("edits in place, preserves identity and time, rejects stale writes and leaves unchanged saves unmarked", () => {
    const f = fixture();
    expect(
      f.change({ action: "edit", text: "Deploy A", expectedRevision: 0 })
        .changed
    ).toBe(false);
    const result = f.change({
      action: "edit",
      text: "Deploy B",
      expectedRevision: 0,
    });
    expect(result.message).toMatchObject({
      id: "message-1",
      ts: 100,
      data: { text: "Deploy B", meta: { messageRevision: 1, editedAt: 200 } },
    });
    expect(() =>
      f.change({ action: "edit", text: "Stale", expectedRevision: 0 })
    ).toThrow("version_conflict");
    expect(
      f.db.prepare("SELECT COUNT(*) AS n FROM space_signals").get()?.n
    ).toBe(1);
  });
  it("requires the human sender for edits, recall and recovery", () => {
    const f = fixture();
    for (const action of [
      { action: "edit", text: "Changed", expectedRevision: 0 },
      { action: "recall", expectedRevision: 0 },
      { action: "restore_draft" },
    ] satisfies SpaceMessageMutationBody[]) {
      expect(() => f.change(action, "human-2")).toThrow("author_required");
      expect(() => f.change(action, "human-1", "agent")).toThrow(
        "author_required"
      );
    }
  });
  it("requires explicit recall after clearing and restores the last published version, never the empty editor", () => {
    const f = fixture();
    f.change({ action: "edit", text: "Latest version", expectedRevision: 0 });
    expect(() =>
      f.change({ action: "edit", text: " \n ", expectedRevision: 1 })
    ).toThrow("recall_confirmation_required");
    const recalled = f.change({ action: "recall", expectedRevision: 1 });
    expect(recalled.message.data.text).toBe("Alice recalled a message.");
    expect(
      JSON.stringify(
        f.db.prepare("SELECT payload_json FROM space_signals").all()
      )
    ).not.toContain("Latest version");
    expect(f.change({ action: "recall", expectedRevision: 1 }).changed).toBe(
      false
    );
    expect(f.change({ action: "restore_draft" }).message.data.text).toBe(
      "Latest version"
    );
    expect(() =>
      f.change({ action: "edit", text: "Resurrect", expectedRevision: 2 })
    ).toThrow("recalled");
  });
  it("scrubs legacy quoted previews and catches edits to old messages during Agent work", () => {
    const f = fixture();
    const reply = {
      ...f.original,
      id: "reply-1",
      ts: 150,
      data: {
        text: "Noted",
        replyTo: {
          signalId: "message-1",
          profileId: "human-1",
          profileKind: "human",
          profileName: "Alice",
          previewText: "Deploy A",
        },
      },
    };
    f.db
      .prepare("INSERT INTO space_signals VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        reply.id,
        150,
        reply.type,
        "human-1",
        "human",
        JSON.stringify(reply)
      );
    f.change({ action: "recall", expectedRevision: 0 });
    expect(
      JSON.stringify(
        f.db.prepare("SELECT payload_json FROM space_signals").all()
      )
    ).not.toContain("Deploy A");
    const notice = {
      ...f.original,
      id: "change-1",
      ts: 200,
      profile: {
        profileId: "openmeld-system",
        profileName: "OpenMeld",
        kind: "system",
      },
      data: {
        text: "Message message-1 was recalled. Read it again.",
        meta: {
          purpose: "space_message_changed",
          changedMessageId: "message-1",
        },
      },
    };
    f.db
      .prepare("INSERT INTO space_signals VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        notice.id,
        200,
        notice.type,
        "openmeld-system",
        "system",
        JSON.stringify(notice)
      );
    expect(
      readAgentReplyObservationState(f.sql, {
        observedThroughSignalId: "reply-1",
        sourceSignalId: "message-1",
        threadId: null,
      })
    ).toBe("changed");
    const updates = readSpaceUpdatesUseCase({
      sql: f.sql,
      afterSignalId: "reply-1",
      limit: 10,
    });
    expect(updates.signals.map((signal) => signal.id)).toEqual([
      "message-1",
      "change-1",
    ]);
    expect(JSON.stringify(updates)).not.toContain("Deploy A");
    expect(
      readAgentReplyObservationState(f.sql, {
        observedThroughSignalId: "change-1",
        sourceSignalId: "message-1",
        threadId: null,
      })
    ).toBe("current");
  });
});
