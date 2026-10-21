import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ensureSpaceSqlSchema,
  SPACE_SQL_SCHEMA_CHECKSUM,
  SPACE_SQL_SCHEMA_VERSION,
} from "../src/space/infrastructure/sql/space-schema-repo";
import type { Space } from "../src/space/transport/do/space";
import { env } from "../test-support/worker-env";

/**
 * Real-SQLite behavior coverage for the Space Files `origin` backfill. This
 * runs against a genuine Cloudflare Durable Object SqlStorage instance (the
 * same storage `ensureSpaceSqlSchema` runs against in production), not a
 * fake that only records which SQL strings were issued. It exists because a
 * SQL-string assertion can prove the migration *called* the right
 * statements while still leaving a real database's rows unrepaired if the
 * gating logic around those calls is wrong — exactly the defect this test
 * would have caught before the gating fix.
 */
describe("Space Files origin migration (real SQLite)", () => {
  it("repairs NULL origin file rows left by an interrupted or earlier migration, leaves folders untouched, and is safe to rerun", async () => {
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const spaceId = `space-origin-migration-${crypto.randomUUID()}`;
    const stub = namespace.getByName(spaceId);

    type EntryRow = {
      entry_id: string;
      kind: string;
      name: string;
      origin: string | null;
      parent_id: string | null;
    };
    type SchemaMigrationRow = { checksum: string; version: number };

    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql;

      // Establish a fully current, real schema first — this is a genuine
      // CREATE TABLE pass, not a hand-authored table shape, so it always
      // matches whatever space_file_entries currently looks like.
      ensureSpaceSqlSchema(sql);

      // Build nested Files content directly against the real table:
      // a root file, a folder, and a file inside that folder.
      const nowMs = Date.parse("2026-08-22T08:00:00.000Z");
      const actorJson = JSON.stringify({
        profileId: "profile-migration-test",
        profileKind: "human",
        displayName: "Migration Test",
      });
      const insertEntry = (input: {
        entryId: string;
        kind: "file" | "folder";
        name: string;
        parentId: string | null;
      }) => {
        sql.exec(
          `
            INSERT INTO space_file_entries (
              entry_id, space_id, kind, parent_id, parent_key, name, name_key,
              created_at_ms, updated_at_ms, created_by_json, updated_by_json,
              trashed_at_ms, trashed_by_json, origin
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
          `,
          input.entryId,
          spaceId,
          input.kind,
          input.parentId,
          input.parentId ?? "",
          input.name,
          input.name.toLowerCase(),
          nowMs,
          nowMs,
          actorJson,
          actorJson
        );
      };
      insertEntry({
        entryId: "root-file",
        kind: "file",
        name: "root.txt",
        parentId: null,
      });
      insertEntry({
        entryId: "folder-1",
        kind: "folder",
        name: "Launch",
        parentId: null,
      });
      insertEntry({
        entryId: "nested-file",
        kind: "file",
        name: "nested.txt",
        parentId: "folder-1",
      });

      // Every entry above was inserted with a real, unpatched NULL origin —
      // this is the exact "historical row" shape the backfill must repair.
      // Simulate a database that reached this exact state through an
      // earlier, buggy v44 pass (column already present, rows still NULL)
      // by removing the just-recorded schema_migrations row, so the next
      // `ensureSpaceSqlSchema` call believes this schema version has not
      // been applied yet and re-enters the full migration.
      sql.exec(
        "DELETE FROM schema_migrations WHERE version = ?",
        SPACE_SQL_SCHEMA_VERSION
      );

      // First repair pass: this is what a database stuck in the
      // interrupted/earlier-buggy-v44 state actually needs to self-heal.
      ensureSpaceSqlSchema(sql);

      const entriesAfterFirstRepair = sql
        .exec<EntryRow>(
          "SELECT entry_id, kind, name, origin, parent_id FROM space_file_entries ORDER BY entry_id"
        )
        .toArray();
      const byId = new Map(
        entriesAfterFirstRepair.map((row) => [row.entry_id, row])
      );

      expect(byId.get("root-file")).toMatchObject({
        kind: "file",
        origin: "artifact",
        parent_id: null,
      });
      expect(byId.get("nested-file")).toMatchObject({
        kind: "file",
        origin: "artifact",
        parent_id: "folder-1",
        name: "nested.txt",
      });
      // Folders are never backfilled: they carry no origin, and their
      // placement (parent, name) must be exactly what it was before repair.
      expect(byId.get("folder-1")).toMatchObject({
        kind: "folder",
        origin: null,
        parent_id: null,
        name: "Launch",
      });

      const migrationRowsAfterFirstRepair = sql
        .exec<SchemaMigrationRow>(
          "SELECT version, checksum FROM schema_migrations WHERE version = ?",
          SPACE_SQL_SCHEMA_VERSION
        )
        .toArray();
      expect(migrationRowsAfterFirstRepair).toEqual([
        {
          version: SPACE_SQL_SCHEMA_VERSION,
          checksum: SPACE_SQL_SCHEMA_CHECKSUM,
        },
      ]);

      // Idempotent rerun, path 1: calling the schema pass again while the
      // current version is recorded short-circuits immediately and must not
      // change already-classified rows, duplicate the migration marker, or
      // throw.
      expect(() => ensureSpaceSqlSchema(sql)).not.toThrow();

      const entriesAfterShortCircuitRerun = sql
        .exec<EntryRow>(
          "SELECT entry_id, kind, name, origin, parent_id FROM space_file_entries ORDER BY entry_id"
        )
        .toArray();
      expect(entriesAfterShortCircuitRerun).toEqual(entriesAfterFirstRepair);

      // Idempotent rerun, path 2: force the full migration body to run a
      // second time (not just hit the early-exit shortcut), the same way a
      // database could need a later schema version applied again. Already
      // classified rows must stay exactly as they are — the backfill's own
      // `WHERE origin IS NULL` guard makes a second real pass a no-op for
      // rows already repaired — and the migration marker must not
      // duplicate.
      sql.exec(
        "DELETE FROM schema_migrations WHERE version = ?",
        SPACE_SQL_SCHEMA_VERSION
      );
      expect(() => ensureSpaceSqlSchema(sql)).not.toThrow();

      const entriesAfterForcedRerun = sql
        .exec<EntryRow>(
          "SELECT entry_id, kind, name, origin, parent_id FROM space_file_entries ORDER BY entry_id"
        )
        .toArray();
      expect(entriesAfterForcedRerun).toEqual(entriesAfterFirstRepair);

      const migrationRowsAfterForcedRerun = sql
        .exec<SchemaMigrationRow>(
          "SELECT version, checksum FROM schema_migrations WHERE version = ?",
          SPACE_SQL_SCHEMA_VERSION
        )
        .toArray();
      expect(migrationRowsAfterForcedRerun).toHaveLength(1);
    });
  });
});

describe("Space Files copy request schema (real SQLite)", () => {
  it("adds copy reservations to a Space whose prior schema migration is complete", async () => {
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.getByName(
      `space-copy-schema-${crypto.randomUUID()}`
    );
    await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql;
      ensureSpaceSqlSchema(sql);
      sql.exec("DROP TABLE file_root_copy_requests");
      ensureSpaceSqlSchema(sql);
      sql.exec(
        "INSERT INTO file_root_copy_requests (client_mutation_id, request_json) VALUES (?, ?)",
        "copy-request",
        "{}"
      );
      expect(
        sql
          .exec<{ request_json: string }>(
            "SELECT request_json FROM file_root_copy_requests WHERE client_mutation_id = ?",
            "copy-request"
          )
          .toArray()
      ).toEqual([{ request_json: "{}" }]);
    });
  });
});
