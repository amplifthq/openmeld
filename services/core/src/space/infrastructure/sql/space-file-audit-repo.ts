import { spaceFileAuditEventSchema } from "@openmeld/schemas";
import type { SpaceFileAuditEvent } from "@openmeld/schemas/types";

type SpaceFileAuditEventRow = {
  actor_kind: SpaceFileAuditEvent["actorKind"];
  actor_profile_id: string | null;
  created_at_ms: number;
  entry_id: string;
  error_code: string | null;
  event_id: string;
  operation: SpaceFileAuditEvent["operation"];
  operation_id: string;
  organization_id: string;
  represented_human_profile_id: string | null;
  request_id: string;
  result: SpaceFileAuditEvent["result"];
  revision_id: string | null;
  space_id: string;
};

export class SpaceFileAuditRepository {
  private readonly sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
  }

  record(rawEvent: SpaceFileAuditEvent): void {
    const event = spaceFileAuditEventSchema.parse(rawEvent);
    const legacyEventId = `${event.operation}:${event.requestId}`;
    if (legacyEventId !== event.eventId) {
      const legacyEvent = this.read(legacyEventId);
      if (legacyEvent?.operationId === event.operationId) {
        if (
          sameLogicalEvent(legacyEvent, {
            ...event,
            eventId: legacyEventId,
          })
        ) {
          return;
        }
        throw new Error(
          `Space File audit event ${event.eventId} conflicts with legacy event ${legacyEventId}.`
        );
      }
    }
    this.sql.exec(
      `
        INSERT OR IGNORE INTO space_file_audit_events (
          event_id,
          operation_id,
          request_id,
          organization_id,
          space_id,
          entry_id,
          revision_id,
          operation,
          actor_kind,
          actor_profile_id,
          represented_human_profile_id,
          result,
          error_code,
          created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      event.eventId,
      event.operationId,
      event.requestId,
      event.organizationId,
      event.spaceId,
      event.entryId,
      event.revisionId,
      event.operation,
      event.actorKind,
      event.actorProfileId,
      event.representedHumanProfileId,
      event.result,
      event.errorCode,
      event.occurredAtMs
    );

    const stored = this.read(event.eventId);
    if (!(stored && sameLogicalEvent(stored, event))) {
      throw new Error(
        `Space File audit event ${event.eventId} conflicts with an existing event.`
      );
    }
  }

  private read(eventId: string): SpaceFileAuditEvent | null {
    const row = this.sql
      .exec<SpaceFileAuditEventRow>(
        `
          SELECT
            event_id,
            operation_id,
            request_id,
            organization_id,
            space_id,
            entry_id,
            revision_id,
            operation,
            actor_kind,
            actor_profile_id,
            represented_human_profile_id,
            result,
            error_code,
            created_at_ms
          FROM space_file_audit_events
          WHERE event_id = ?
          LIMIT 1
        `,
        eventId
      )
      .toArray()[0];
    if (!row) {
      return null;
    }
    return spaceFileAuditEventSchema.parse({
      actorKind: row.actor_kind,
      actorProfileId: row.actor_profile_id,
      entryId: row.entry_id,
      errorCode: row.error_code,
      eventId: row.event_id,
      occurredAtMs: Number(row.created_at_ms),
      operation: row.operation,
      operationId: row.operation_id,
      organizationId: row.organization_id,
      representedHumanProfileId: row.represented_human_profile_id,
      requestId: row.request_id,
      result: row.result,
      revisionId: row.revision_id,
      spaceId: row.space_id,
    });
  }
}

function sameLogicalEvent(
  stored: SpaceFileAuditEvent,
  candidate: SpaceFileAuditEvent
): boolean {
  const { occurredAtMs: _storedOccurredAtMs, ...storedIdentity } = stored;
  const { occurredAtMs: _candidateOccurredAtMs, ...candidateIdentity } =
    candidate;
  return JSON.stringify(storedIdentity) === JSON.stringify(candidateIdentity);
}
