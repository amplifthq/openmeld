import { DatabaseSync } from "node:sqlite";
import { PostgresDatabase } from "@openmeld/db/postgresql";
import type { SignalEnvelope } from "@openmeld/protocol";
import { describe, expect, it } from "vitest";
import { recordSpaceInboxFirstContacts } from "../src/space/application/space-inbox-first-contact";
import { buildSpaceInboxProjectionOutboxRecord } from "../src/space/application/space-inbox-projection";
import { attemptSpaceInboxProjectionOutboxRecord } from "../src/space/application/space-inbox-projection-outbox-service";
import type { SignalPublishContext } from "../src/space/application/types";
import {
  insertSpaceInboxProjectionOutboxRecord,
  listDueSpaceInboxProjectionOutboxRecords,
} from "../src/space/infrastructure/sql/space-inbox-projection-outbox-repo";
import {
  listSpaceMemberRecords,
  upsertSpaceMemberRecord,
} from "../src/space/infrastructure/sql/space-member-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";
import { insertSignalRecord } from "../src/space/infrastructure/sql/space-signal-repo";
import { buildDirectMessageDispatchReadyDecisions } from "../src/space/rules/dispatch/direct-message-dispatch";

const CODEX = "agt_22222222-2222-4222-8222-222222222222";
const FELIX = "11111111-1111-4111-8111-111111111111";

describe("durable personal-Agent contact identity", () => {
  it("records a first contact once and replays its original priority after subsequent messages", () => {
    const fixture = contactFixture();
    try {
      const first = fixture.publish(text("first"));
      expect(
        first.candidates.find(
          (candidate) => candidate.sourceFacts?.personalAgentProfileIds?.length
        )?.sourceFacts?.firstContactAgentProfileIds
      ).toEqual([CODEX]);
      expect(
        fixture
          .publish(text("next"))
          .candidates.flatMap(
            (candidate) =>
              candidate.sourceFacts?.firstContactAgentProfileIds ?? []
          )
      ).toEqual([]);
      ensureSpaceSqlSchema(fixture.sql);
      expect(fixture.publish(text("first")).candidates).toEqual(
        first.candidates
      );
      expect(
        fixture.db
          .prepare(
            "SELECT count(*) AS n FROM space_inbox_personal_agent_contacts"
          )
          .get()?.n
      ).toBe(1);
    } finally {
      fixture.db.close();
    }
  });

  it("gives separate real Threads separate identities, never a model turn or a repeated @", () => {
    const fixture = contactFixture();
    try {
      for (const root of ["root-one", "root-two"]) {
        const scope = fixture.thread(root);
        expect(
          fixture
            .publish(text(`${root}-first`), scope)
            .candidates.flatMap(
              (candidate) =>
                candidate.sourceFacts?.firstContactAgentProfileIds ?? []
            )
        ).toEqual([CODEX]);
        expect(
          fixture
            .publish(text(`${root}-again`), scope)
            .candidates.flatMap(
              (candidate) =>
                candidate.sourceFacts?.firstContactAgentProfileIds ?? []
            )
        ).toEqual([]);
      }
      expect(
        fixture.db
          .prepare(
            "SELECT count(*) AS n FROM space_inbox_personal_agent_contacts"
          )
          .get()?.n
      ).toBe(2);
    } finally {
      fixture.db.close();
    }
  });

  it("does not spend a first-contact identity on a Reference or an automatic Thread continuation", () => {
    const fixture = contactFixture();
    try {
      const reference = text("reference", {
        referenceTargets: [CODEX],
        activationTargets: [],
      });
      fixture.publish(reference);
      const continuation = text("continuation");
      continuation.data.meta = {
        ...continuation.data.meta,
        threadWakeContinuation: true,
      };
      fixture.publish(continuation);
      expect(
        fixture.db
          .prepare(
            "SELECT count(*) AS n FROM space_inbox_personal_agent_contacts"
          )
          .get()?.n
      ).toBe(0);
      expect(
        fixture
          .publish(text("explicit"))
          .candidates.flatMap(
            (candidate) =>
              candidate.sourceFacts?.firstContactAgentProfileIds ?? []
          )
      ).toEqual([CODEX]);
    } finally {
      fixture.db.close();
    }
  });

  it("records the first real Agent DM even when it references its recipient, without changing Wake addressing", () => {
    const fixture = contactFixture();
    try {
      fixture.sql.exec(
        "UPDATE space_members SET status = 'removed' WHERE profile_id = ?",
        FELIX
      );
      const reference = text("dm-reference-first", {
        activationTargets: [],
        referenceTargets: [CODEX],
      });
      const envelope = structuredClone(reference.data.messageEnvelope);
      const dispatch = buildDirectMessageDispatchReadyDecisions({
        activeMemberRecords: listSpaceMemberRecords(fixture.sql, {
          status: "active",
        }),
        senderProfileId: "monica",
        signal: reference,
        spacePurpose: "openmeld_dm_space",
      });
      // A Reference opts out of the default DM Wake while still recording the first real contact.
      expect(dispatch.map((decision) => decision.targetProfileId)).toEqual([]);
      const first = fixture.publish(reference, undefined, true);
      expect(
        first.candidates.flatMap(
          (candidate) =>
            candidate.sourceFacts?.firstContactAgentProfileIds ?? []
        )
      ).toEqual([CODEX]);
      expect(reference.data.messageEnvelope).toEqual(envelope);
      const followup = fixture.publish(
        text("dm-followup", { activationTargets: [] }),
        undefined,
        true
      );
      expect(
        followup.candidates.flatMap(
          (candidate) =>
            candidate.sourceFacts?.firstContactAgentProfileIds ?? []
        )
      ).toEqual([]);
      ensureSpaceSqlSchema(fixture.sql);
      expect(fixture.publish(reference, undefined, true).candidates).toEqual(
        first.candidates
      );
      expect(
        fixture.db
          .prepare(
            "SELECT contact_signal_id FROM space_inbox_personal_agent_contacts"
          )
          .all()
      ).toEqual([{ contact_signal_id: "dm-reference-first" }]);
    } finally {
      fixture.db.close();
    }
  });

  it("retains no first-contact receipt when message publication rolls back", () => {
    const fixture = contactFixture();
    try {
      fixture.db.exec("BEGIN");
      fixture.publish(text("rolled-back"));
      fixture.db.exec("ROLLBACK");
      expect(
        fixture.db
          .prepare(
            "SELECT count(*) AS n FROM space_inbox_personal_agent_contacts"
          )
          .get()?.n
      ).toBe(0);
      expect(
        fixture.db
          .prepare("SELECT count(*) AS n FROM space_inbox_projection_outbox")
          .get()?.n
      ).toBe(0);
      expect(
        fixture
          .publish(text("accepted"))
          .candidates.flatMap(
            (candidate) =>
              candidate.sourceFacts?.firstContactAgentProfileIds ?? []
          )
      ).toEqual([CODEX]);
    } finally {
      fixture.db.close();
    }
  });

  it.each([
    { referenceTargets: [] },
    { referenceTargets: [CODEX] },
  ])("does not replay old DM contact with references $referenceTargets when switching the sender's Human Profile", ({
    referenceTargets,
  }) => {
    const fixture = contactFixture();
    try {
      insertSignalRecord(
        fixture.sql,
        text("before-upgrade", { activationTargets: [], referenceTargets })
      );
      fixture.addMember("monica-second", "monica-account", "human");
      const signal = text("new-profile", { activationTargets: [] });
      signal.profile.profileId = "monica-second";
      const first = fixture.publish(signal, undefined, true);
      expect(
        first.candidates.flatMap(
          (candidate) =>
            candidate.sourceFacts?.firstContactAgentProfileIds ?? []
        )
      ).toEqual([]);
      expect(
        first.candidates.flatMap(
          (candidate) => candidate.sourceFacts?.mentionedAgentProfileIds ?? []
        )
      ).toEqual([]);
    } finally {
      fixture.db.close();
    }
  });

  it("does not infer a first contact from an unavailable history prefix", () => {
    const fixture = contactFixture();
    try {
      insertSignalRecord(fixture.sql, text("pruned"));
      insertSignalRecord(
        fixture.sql,
        text("retained-reference", {
          activationTargets: [],
          referenceTargets: [CODEX],
        })
      );
      fixture.db
        .prepare("DELETE FROM space_signals WHERE id = ?")
        .run("pruned");
      expect(
        fixture
          .publish(text("unknown-history"))
          .candidates.flatMap(
            (candidate) =>
              candidate.sourceFacts?.firstContactAgentProfileIds ?? []
          )
      ).toEqual([]);
    } finally {
      fixture.db.close();
    }
  });

  it("preserves an independent Human mention if Agent ownership changes during a failed projection retry", async () => {
    const fixture = contactFixture();
    try {
      const record = fixture.publish(
        text("first", { mentionTargets: [FELIX] })
      );
      const failed = await attemptSpaceInboxProjectionOutboxRecord({
        db: new PostgresDatabase({
          connectionString:
            "postgresql://127.0.0.1:1/unexpected_test_database_access",
        }),
        sql: fixture.sql,
        record,
        nowMs: 2000,
        canReceiveAgentActivity: async () => true,
        isRecipientEligible: async () => true,
        ensureItem: () =>
          Promise.reject(new Error("Transient database failure")),
      });
      expect(failed.status).toBe("failed");
      const retry = listDueSpaceInboxProjectionOutboxRecords(fixture.sql, {
        limit: 10,
        nowMs: 100_000,
      })[0];
      expect(retry?.candidates).toHaveLength(2);
      const delivered: string[] = [];
      expect(
        (
          await attemptSpaceInboxProjectionOutboxRecord({
            db: new PostgresDatabase({
              connectionString:
                "postgresql://127.0.0.1:1/unexpected_test_database_access",
            }),
            sql: fixture.sql,
            record: retry ?? record,
            nowMs: 100_000,
            canReceiveAgentActivity: async () => false,
            isRecipientEligible: (candidate) => {
              expect(candidate.sourceTarget).not.toHaveProperty(
                "agentOwnerActivity"
              );
              return Promise.resolve(true);
            },
            ensureItem: ({ candidate }) => {
              // The source relationship was frozen before the first database attempt.
              // Rechecking access must not change the item's idempotent payload.
              expect(candidate.sourceTarget).toHaveProperty(
                "agentOwnerActivity",
                true
              );
              delivered.push(candidate.kind);
              return Promise.resolve({
                itemId: "durable-item",
                deliveryId: null,
              });
            },
          })
        ).status
      ).toBe("completed");
      expect(delivered).toEqual(["space_mention"]);
    } finally {
      fixture.db.close();
    }
  });
});

function text(
  id: string,
  addressing: {
    activationTargets?: string[];
    mentionTargets?: string[];
    referenceTargets?: string[];
  } = {}
): Extract<SignalEnvelope, { type: "signal.text" }> {
  return {
    v: 1,
    id,
    spaceId: "space",
    ts: 1000,
    type: "signal.text",
    profile: { kind: "human", profileId: "monica", profileName: "Monica" },
    data: {
      text: "Please check this.",
      meta: { authorHasRead: true },
      messageEnvelope: {
        text: "Please check this.",
        activationTargets: addressing.activationTargets ?? [CODEX],
        mentionTargets: addressing.mentionTargets ?? [],
        referenceTargets: addressing.referenceTargets ?? [],
      },
    },
  };
}

function contactFixture() {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec: (query: string, ...params: (string | number | null)[]) => {
      const rows = db.prepare(query).all(...params);
      const iterator = rows[Symbol.iterator]();
      return {
        next: () => iterator.next(),
        toArray: () => rows,
        rowsWritten: Number(db.prepare("SELECT changes() AS n").get()?.n ?? 0),
        [Symbol.iterator]: () => rows[Symbol.iterator](),
      };
    },
  } as unknown as SqlStorage;
  ensureSpaceSqlSchema(sql);
  const addMember = (
    profileId: string,
    ownerUserIdSnapshot: string,
    profileKindSnapshot: "human" | "agent"
  ) =>
    upsertSpaceMemberRecord(sql, {
      profileId,
      ownerUserIdSnapshot,
      profileKindSnapshot,
      profileNameSnapshot: profileId,
      spaceId: "space",
      status: "active",
      memberSource: "joined_directly",
      addedAt: new Date(0).toISOString(),
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      ownerNameSnapshot: ownerUserIdSnapshot,
      controllerRefSnapshot: null,
      removedAt: null,
      addedByProfileId: null,
      addedByOwnerUserId: null,
      addedByDisplayNameSnapshot: null,
      removedByProfileId: null,
      removedByOwnerUserId: null,
      removalReason: null,
      firstEnteredAt: null,
      lastEnteredAt: null,
    });
  addMember("monica", "monica-account", "human");
  addMember(FELIX, "felix-account", "human");
  addMember(CODEX, "felix-account", "agent");
  return {
    db,
    sql,
    addMember,
    thread: (root: string): SignalPublishContext => {
      insertSignalRecord(sql, text(root, { activationTargets: [] }));
      sql.exec(
        "INSERT INTO space_threads VALUES (?, ?, ?, ?, ?, ?)",
        root,
        "space",
        root,
        "monica",
        1000,
        1000
      );
      sql.exec(
        "INSERT INTO space_thread_signal_placements VALUES (?, ?, ?, ?)",
        root,
        root,
        "root",
        1000
      );
      return {
        threadContext: { threadId: root, rootSignalId: root },
        threadPlacement: "thread",
      };
    },
    publish: (
      signal: Extract<SignalEnvelope, { type: "signal.text" }>,
      signalContext?: SignalPublishContext,
      directMessage = false
    ) => {
      insertSignalRecord(sql, signal);
      if (signalContext?.threadContext) {
        sql.exec(
          "INSERT OR IGNORE INTO space_thread_signal_placements VALUES (?, ?, ?, ?)",
          signal.id,
          signalContext.threadContext.threadId,
          "thread",
          signal.ts
        );
      }
      const input = {
        activeMemberRecords: listSpaceMemberRecords(sql, { status: "active" }),
        archiveCursorTs: null,
        directMessage,
        organizationId: "org",
        signal,
        signalContext,
        sql,
      };
      const record = buildSpaceInboxProjectionOutboxRecord({
        ...input,
        nowMs: signal.ts,
        spaceName: "Design",
        threadParticipantProfileIds: signalContext ? ["monica"] : undefined,
        firstContactAgentProfileIds: recordSpaceInboxFirstContacts(input),
      });
      if (!record) {
        throw new Error("Expected a published conversation projection");
      }
      insertSpaceInboxProjectionOutboxRecord(sql, record);
      return record;
    },
  };
}
