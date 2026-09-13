import { spaceFileUpdateSettingsSchema } from "@openmeld/schemas";
import type {
  SpaceFileActor,
  SpaceFileDescriptor,
  SpaceFileUpdateSettings,
} from "@openmeld/schemas/types";

/** Space-owned notification intent. File versions and Wake execution retain their owners. */
export class SpaceFileUpdateRepository {
  private readonly sql: SqlStorage;
  constructor(sql: SqlStorage) {
    this.sql = sql;
  }

  initialize(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS space_file_update_settings (
      file_id TEXT PRIMARY KEY, settings_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS space_file_update_outbox (
      id TEXT PRIMARY KEY, file_id TEXT NOT NULL, revision INTEGER NOT NULL,
      settings_json TEXT NOT NULL, next_attempt_ms INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
    );`);
  }

  read(fileId: string): SpaceFileUpdateSettings {
    const row = this.sql
      .exec<{ settings_json: string }>(
        "SELECT settings_json FROM space_file_update_settings WHERE file_id = ?",
        fileId
      )
      .toArray()[0];
    return row
      ? spaceFileUpdateSettingsSchema.parse(JSON.parse(row.settings_json))
      : { fileId, version: 0, recipientProfileIds: [], configuredBy: null };
  }

  configure(input: {
    fileId: string;
    actor: SpaceFileActor;
    recipientProfileIds: string[];
    baseVersion: number;
  }): SpaceFileUpdateSettings | null {
    const current = this.read(input.fileId);
    const recipients = [...new Set(input.recipientProfileIds)].sort();
    if (
      current.configuredBy?.profileId === input.actor.profileId &&
      JSON.stringify(recipients) === JSON.stringify(current.recipientProfileIds)
    ) {
      return current;
    }
    if (current.version !== input.baseVersion) {
      return null;
    }
    const next = spaceFileUpdateSettingsSchema.parse({
      fileId: input.fileId,
      version: current.version + 1,
      recipientProfileIds: recipients,
      configuredBy: input.actor,
    });
    this.sql.exec(
      "INSERT INTO space_file_update_settings VALUES (?, ?) ON CONFLICT(file_id) DO UPDATE SET settings_json = excluded.settings_json",
      input.fileId,
      JSON.stringify(next)
    );
    return next;
  }

  enqueue(file: SpaceFileDescriptor, nowMs: number): void {
    const settings = this.read(file.id);
    if (!settings.recipientProfileIds.length) {
      return;
    }
    this.sql.exec(
      "INSERT OR IGNORE INTO space_file_update_outbox (id, file_id, revision, settings_json, next_attempt_ms) VALUES (?, ?, ?, ?, ?)",
      `file-update:${file.id}:${file.latestRevision.revision}`,
      file.id,
      file.latestRevision.revision,
      JSON.stringify(settings),
      nowMs
    );
  }

  pending(nowMs: number) {
    return this.sql
      .exec<{
        id: string;
        file_id: string;
        revision: number;
        settings_json: string;
        attempts: number;
      }>(
        "SELECT * FROM space_file_update_outbox WHERE next_attempt_ms <= ? ORDER BY next_attempt_ms, id LIMIT 20",
        nowMs
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        fileId: row.file_id,
        revision: row.revision,
        attempts: row.attempts,
        settings: spaceFileUpdateSettingsSchema.parse(
          JSON.parse(row.settings_json)
        ),
      }));
  }

  complete(id: string): void {
    this.sql.exec("DELETE FROM space_file_update_outbox WHERE id = ?", id);
  }
  retry(id: string, nowMs: number, error: string): void {
    this.sql.exec(
      "UPDATE space_file_update_outbox SET attempts = attempts + 1, next_attempt_ms = ?, last_error = ? WHERE id = ?",
      nowMs + 60_000,
      error.slice(0, 500),
      id
    );
  }
  nextAttempt(): number | null {
    return (
      this.sql
        .exec<{ next: number | null }>(
          "SELECT MIN(next_attempt_ms) AS next FROM space_file_update_outbox"
        )
        .toArray()[0]?.next ?? null
    );
  }
}
