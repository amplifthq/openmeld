import type { DispatchResult } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { getSpaceDispatchResult } from "../dispatch/application/dispatch-result-read-service";
import {
  readDispatchResultByDispatchId,
  readDispatchResultByResultRef,
  upsertDispatchResult,
} from "../dispatch/infrastructure/d1/dispatch-result-repo";

type DispatchResultRow = {
  resultRef: string;
  dispatchId: string;
  spaceId: string;
  actorProfileId: string;
  actorName: string | null;
  replyToSignalId: string | null;
  resultKind: string;
  finalText: string | null;
  messageEnvelopeJson: string | null;
  statusType: string | null;
  previewText: string | null;
  publicOutcome: string;
  publishedSignalId: string | null;
  createdAtMs: number;
};

const createInMemoryDispatchResultDb = () => {
  const rows = new Map<string, DispatchResultRow>();
  const schemaObjects = new Set<string>();
  let hasActorNameColumn = false;
  let hasMessageEnvelopeColumn = false;

  const db = {
    prepare: (query: string) => {
      const normalizedQuery = query.toLowerCase().replace(/\s+/g, " ").trim();
      const queryIncludes = (sql: string) =>
        normalizedQuery.includes(sql.toLowerCase());

      const run = () => {
        if (
          queryIncludes(
            "create table if not exists openMeldDaemon_dispatch_results"
          )
        ) {
          schemaObjects.add("openMeldDaemon_dispatch_results");
          return Promise.resolve({ meta: { changes: 0 } });
        }
        if (
          queryIncludes(
            "create index if not exists idx_openMeldDaemon_dispatch_results_space_created"
          )
        ) {
          schemaObjects.add(
            "idx_openMeldDaemon_dispatch_results_space_created"
          );
          return Promise.resolve({ meta: { changes: 0 } });
        }
        if (
          queryIncludes(
            "create index if not exists idx_openMeldDaemon_dispatch_results_actor_created"
          )
        ) {
          schemaObjects.add(
            "idx_openMeldDaemon_dispatch_results_actor_created"
          );
          return Promise.resolve({ meta: { changes: 0 } });
        }
        if (
          queryIncludes("alter table openMeldDaemon_dispatch_results") &&
          queryIncludes("add column actor_name")
        ) {
          hasActorNameColumn = true;
          return Promise.resolve({ meta: { changes: 0 } });
        }
        if (
          queryIncludes("alter table openMeldDaemon_dispatch_results") &&
          queryIncludes("add column message_envelope_json")
        ) {
          hasMessageEnvelopeColumn = true;
          return Promise.resolve({ meta: { changes: 0 } });
        }

        throw new Error(`unsupported run() query: ${query}`);
      };

      return {
        run,
        all: <T>() => {
          if (
            queryIncludes("pragma table_info(openMeldDaemon_dispatch_results)")
          ) {
            return Promise.resolve({
              results: [
                { name: "result_ref" },
                { name: "dispatch_id" },
                { name: "space_id" },
                { name: "actor_profile_id" },
                ...(hasActorNameColumn ? [{ name: "actor_name" }] : []),
                ...(hasMessageEnvelopeColumn
                  ? [{ name: "message_envelope_json" }]
                  : []),
              ],
            } as T);
          }
          throw new Error(`unsupported all() query: ${query}`);
        },
        bind: (...args: unknown[]) => ({
          run: () => {
            if (queryIncludes("insert into openMeldDaemon_dispatch_results")) {
              const [
                resultRef,
                dispatchId,
                spaceId,
                actorProfileId,
                actorName,
                replyToSignalId,
                resultKind,
                finalText,
                messageEnvelopeJson,
                statusType,
                previewText,
                publicOutcome,
                publishedSignalId,
                createdAtMs,
              ] = args;

              rows.set(String(resultRef), {
                resultRef: String(resultRef),
                dispatchId: String(dispatchId),
                spaceId: String(spaceId),
                actorProfileId: String(actorProfileId),
                actorName: actorName === null ? null : String(actorName),
                replyToSignalId:
                  replyToSignalId === null ? null : String(replyToSignalId),
                resultKind: String(resultKind),
                finalText: finalText === null ? null : String(finalText),
                messageEnvelopeJson:
                  messageEnvelopeJson === null
                    ? null
                    : String(messageEnvelopeJson),
                statusType: statusType === null ? null : String(statusType),
                previewText: previewText === null ? null : String(previewText),
                publicOutcome: String(publicOutcome),
                publishedSignalId:
                  publishedSignalId === null ? null : String(publishedSignalId),
                createdAtMs: Number(createdAtMs),
              });

              return { meta: { changes: 1 } };
            }

            throw new Error(`unsupported run() query: ${query}`);
          },
          first: <T>() => {
            if (
              queryIncludes("from sqlite_master") &&
              queryIncludes("where type = 'table'")
            ) {
              const objectName = String(args[0] ?? "");
              return schemaObjects.has(objectName)
                ? ({ name: objectName } as T)
                : (null as T | null);
            }
            if (
              queryIncludes("from sqlite_master") &&
              queryIncludes("where type = 'index'")
            ) {
              const objectName = String(args[0] ?? "");
              return schemaObjects.has(objectName)
                ? ({ name: objectName } as T)
                : (null as T | null);
            }
            if (
              queryIncludes("from openMeldDaemon_dispatch_results") &&
              queryIncludes("where result_ref = ?")
            ) {
              const row = rows.get(String(args[0] ?? ""));
              if (!row) {
                return null as T | null;
              }
              return {
                result_ref: row.resultRef,
                dispatch_id: row.dispatchId,
                space_id: row.spaceId,
                actor_profile_id: row.actorProfileId,
                actor_name: row.actorName,
                reply_to_signal_id: row.replyToSignalId,
                result_kind: row.resultKind,
                final_text: row.finalText,
                message_envelope_json: row.messageEnvelopeJson,
                status_type: row.statusType,
                preview_text: row.previewText,
                public_outcome: row.publicOutcome,
                published_signal_id: row.publishedSignalId,
                created_at_ms: row.createdAtMs,
              } as T;
            }

            if (
              queryIncludes("from openMeldDaemon_dispatch_results") &&
              queryIncludes("where dispatch_id = ?")
            ) {
              const dispatchId = String(args[0] ?? "");
              const row =
                [...rows.values()].find(
                  (value) => value.dispatchId === dispatchId
                ) ?? null;
              if (!row) {
                return null as T | null;
              }
              return {
                result_ref: row.resultRef,
                dispatch_id: row.dispatchId,
                space_id: row.spaceId,
                actor_profile_id: row.actorProfileId,
                actor_name: row.actorName,
                reply_to_signal_id: row.replyToSignalId,
                result_kind: row.resultKind,
                final_text: row.finalText,
                message_envelope_json: row.messageEnvelopeJson,
                status_type: row.statusType,
                preview_text: row.previewText,
                public_outcome: row.publicOutcome,
                published_signal_id: row.publishedSignalId,
                created_at_ms: row.createdAtMs,
              } as T;
            }

            throw new Error(`unsupported first() query: ${query}`);
          },
        }),
      };
    },
  } as unknown as D1Database;

  return db;
};

describe("dispatch-result-repo", () => {
  it("fails fast when the shared OPENMELD_DB migration has not created dispatch results", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          run: () => {
            throw new Error("no such table: openMeldDaemon_dispatch_results");
          },
        }),
      }),
    } as unknown as D1Database;

    await expect(
      upsertDispatchResult(db, {
        resultRef: "result-missing-schema",
        dispatchId: "dispatch-missing-schema",
        spaceId: "space-missing-schema",
        actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
        actorName: "agent",
        replyToSignalId: "evt-missing-schema",
        resultKind: "text",
        finalText: "hello",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          replyToSignalId: "evt-missing-schema",
          text: "hello",
        },
        previewText: "hello",
        publicOutcome: "post_message",
        publishedSignalId: "evt-status-missing-schema",
        createdAt: "2026-03-19T00:00:00.000Z",
      })
    ).rejects.toThrow("no such table: openMeldDaemon_dispatch_results");
  });

  it("writes and reads a dispatch result by resultRef and dispatchId", async () => {
    const db = createInMemoryDispatchResultDb();
    const result: DispatchResult = {
      resultRef: "result-1",
      dispatchId: "dispatch-1",
      spaceId: "space-1",
      actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
      actorName: "hi-agent",
      replyToSignalId: "evt-1",
      resultKind: "text",
      finalText: "The poem is ready.",
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "evt-1",
        text: "The poem is ready.",
      },
      previewText: "The poem is ready.",
      publicOutcome: "post_message",
      publishedSignalId: "evt-status-1",
      createdAt: "2026-03-19T00:00:00.000Z",
    };

    await upsertDispatchResult(db, result);

    await expect(
      readDispatchResultByResultRef(db, "result-1")
    ).resolves.toEqual(result);
    await expect(
      readDispatchResultByDispatchId(db, "dispatch-1")
    ).resolves.toEqual(result);
  });

  it("rejects invalid dispatch results before writing", async () => {
    const db = createInMemoryDispatchResultDb();

    await expect(
      upsertDispatchResult(db, {
        resultRef: "result-2",
        dispatchId: "dispatch-2",
        spaceId: "space-1",
        actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
        resultKind: "text",
        publicOutcome: "stay_silent",
        createdAt: "2026-03-19T00:00:00.000Z",
      } as DispatchResult)
    ).rejects.toThrow("dispatch result is invalid");
  });

  it("reads dispatch results only within the requested space", async () => {
    const db = createInMemoryDispatchResultDb();
    const result: DispatchResult = {
      resultRef: "dispatch-result:result-2",
      dispatchId: "dispatch-2",
      spaceId: "space-2",
      actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
      actorName: "status-agent",
      resultKind: "status",
      statusType: "done",
      previewText: "Done.",
      publicOutcome: "post_status",
      createdAt: "2026-03-21T00:00:00.000Z",
    };

    await upsertDispatchResult(db, result);

    await expect(
      getSpaceDispatchResult({
        db,
        spaceId: "space-2",
        dispatchId: "dispatch-2",
      })
    ).resolves.toEqual(result);
    await expect(
      getSpaceDispatchResult({
        db,
        spaceId: "space-2",
        resultRef: "dispatch-result:result-2",
      })
    ).resolves.toEqual(result);
    await expect(
      getSpaceDispatchResult({
        db,
        spaceId: "other-space",
        dispatchId: "dispatch-2",
      })
    ).resolves.toBeNull();
  });
});
