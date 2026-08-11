import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getCoreDbSchemaSources, spaceAttachments } from "../src/core";
import { schema } from "../src/schema";

const ATTACHMENT_MIGRATION_JOURNAL_INDEX = 19;
const ATTACHMENT_MIGRATION_TAG_PATTERN = /^0020_.+/u;
const FILE_NAME_LENGTH_CHECK_ERROR_PATTERN =
  /space_attachments_file_name_length_check/u;
const HEIGHT_RANGE_CHECK_ERROR_PATTERN =
  /space_attachments_height_range_check/u;
const MIME_TYPE_CHECK_ERROR_PATTERN = /space_attachments_mime_type_check/u;
const SIZE_RANGE_CHECK_ERROR_PATTERN = /space_attachments_size_range_check/u;
const WIDTH_RANGE_CHECK_ERROR_PATTERN = /space_attachments_width_range_check/u;

type DrizzleJournal = {
  entries: Array<{
    idx: number;
    tag: string;
  }>;
};

const migrationDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle"
);

const readAttachmentMigrationEntry = () => {
  const journal = JSON.parse(
    fs.readFileSync(
      path.join(migrationDirectoryPath, "meta/_journal.json"),
      "utf8"
    )
  ) as DrizzleJournal;

  return journal.entries.find(
    (entry) => entry.idx === ATTACHMENT_MIGRATION_JOURNAL_INDEX
  );
};

const readMigrationStatements = (): readonly string[] => {
  return fs
    .readdirSync(migrationDirectoryPath)
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) =>
      fs.readFileSync(path.join(migrationDirectoryPath, entry), "utf8")
    )
    .join("\n")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
};

const applySharedMigrations = (database: DatabaseSync): void => {
  for (const statement of readMigrationStatements()) {
    database.exec(statement);
  }
};

describe("Space attachment metadata storage", () => {
  it("exports the Core-owned attachment table through the shared schema", () => {
    expect(spaceAttachments).toBeDefined();
    expect(schema.spaceAttachments).toBe(spaceAttachments);
    expect(getCoreDbSchemaSources()).toContainEqual({
      kind: "schema_module",
      owner: "packages/db",
      path: "packages/db/src/core/space-attachment.schema.ts",
      note: "Space attachment metadata is Core-owned and migrates through the shared OPENMELD_DB history.",
    });
  });

  it("keeps the public migration tag at 0020 while the Drizzle index stays 19", () => {
    const entry = readAttachmentMigrationEntry();

    expect(entry).toMatchObject({
      idx: ATTACHMENT_MIGRATION_JOURNAL_INDEX,
      tag: expect.stringMatching(ATTACHMENT_MIGRATION_TAG_PATTERN),
    });
    expect(
      fs.existsSync(
        path.join(
          migrationDirectoryPath,
          "meta",
          `${String(ATTACHMENT_MIGRATION_JOURNAL_INDEX).padStart(4, "0")}_snapshot.json`
        )
      )
    ).toBe(true);
  });

  it("creates attachment metadata columns and lookup indexes", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);

      const columns = database
        .prepare("PRAGMA table_info('space_attachments')")
        .all()
        .map((column) => column.name);
      expect(columns).toEqual([
        "id",
        "organization_id",
        "space_id",
        "uploader_user_id",
        "mime_type",
        "size_bytes",
        "width",
        "height",
        "file_name",
        "created_at",
      ]);

      const indexes = database
        .prepare("PRAGMA index_list('space_attachments')")
        .all()
        .map((index) => index.name);
      expect(indexes).toContain("space_attachments_space_created_idx");
      expect(indexes).toContain("space_attachments_organization_idx");
    } finally {
      database.close();
    }
  });

  it("persists required and client-declared attachment metadata", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);
      insertAttachmentOrganizationFixture(database);

      insertAttachment(database);

      expect(
        database
          .prepare(
            `
              SELECT
                id,
                organization_id AS organizationId,
                space_id AS spaceId,
                uploader_user_id AS uploaderUserId,
                mime_type AS mimeType,
                size_bytes AS sizeBytes,
                width,
                height,
                file_name AS fileName,
                created_at AS createdAt
              FROM space_attachments
              WHERE id = ?
            `
          )
          .get("att_123")
      ).toEqual({
        id: "att_123",
        organizationId: "org_123",
        spaceId: "space_123",
        uploaderUserId: "user_123",
        mimeType: "image/png",
        sizeBytes: 1024,
        width: 800,
        height: 600,
        fileName: "photo.png",
        createdAt: 1_752_172_800_000,
      });
    } finally {
      database.close();
    }
  });

  it("rejects metadata outside the shared attachment limits", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);
      insertAttachmentOrganizationFixture(database);

      expect(() =>
        insertAttachment(database, {
          id: "att_bad_mime",
          mimeType: "image/gif",
        })
      ).toThrow(MIME_TYPE_CHECK_ERROR_PATTERN);
      expect(() =>
        insertAttachment(database, {
          id: "att_too_large",
          sizeBytes: 5_242_881,
        })
      ).toThrow(SIZE_RANGE_CHECK_ERROR_PATTERN);
      expect(() =>
        insertAttachment(database, {
          id: "att_too_wide",
          width: 20_001,
        })
      ).toThrow(WIDTH_RANGE_CHECK_ERROR_PATTERN);
      expect(() =>
        insertAttachment(database, {
          height: 20_001,
          id: "att_too_tall",
        })
      ).toThrow(HEIGHT_RANGE_CHECK_ERROR_PATTERN);
      expect(() =>
        insertAttachment(database, {
          fileName: "x".repeat(256),
          id: "att_file_name_too_long",
        })
      ).toThrow(FILE_NAME_LENGTH_CHECK_ERROR_PATTERN);
    } finally {
      database.close();
    }
  });

  it("keeps shared attachment metadata when the uploader account is deleted", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);
      insertAttachmentOrganizationFixture(database);
      database
        .prepare(
          `
            INSERT INTO users (id, name, email, email_verified)
            VALUES ('user_123', 'Attachment Uploader', 'uploader@example.com', 1)
          `
        )
        .run();
      insertAttachment(database);

      expect(
        database
          .prepare("PRAGMA foreign_key_list('space_attachments')")
          .all()
          .map((foreignKey) => ({
            from: foreignKey.from,
            table: foreignKey.table,
          }))
      ).toEqual([{ from: "organization_id", table: "organizations" }]);

      database.prepare("DELETE FROM users WHERE id = ?").run("user_123");

      expect(
        database
          .prepare(
            "SELECT uploader_user_id AS uploaderUserId FROM space_attachments WHERE id = ?"
          )
          .get("att_123")
      ).toEqual({ uploaderUserId: "user_123" });
    } finally {
      database.close();
    }
  });
});

const insertAttachmentOrganizationFixture = (database: DatabaseSync): void => {
  database
    .prepare(
      `
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES ('org_123', 'Attachment Organization', 'attachment-org', 1752172800000)
      `
    )
    .run();
};

const insertAttachment = (
  database: DatabaseSync,
  input?: {
    fileName?: string;
    height?: number;
    id?: string;
    mimeType?: string;
    sizeBytes?: number;
    width?: number;
  }
): void => {
  database
    .prepare(
      `
        INSERT INTO space_attachments (
          id,
          organization_id,
          space_id,
          uploader_user_id,
          mime_type,
          size_bytes,
          width,
          height,
          file_name,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      input?.id ?? "att_123",
      "org_123",
      "space_123",
      "user_123",
      input?.mimeType ?? "image/png",
      input?.sizeBytes ?? 1024,
      input?.width ?? 800,
      input?.height ?? 600,
      input?.fileName ?? "photo.png",
      1_752_172_800_000
    );
};
