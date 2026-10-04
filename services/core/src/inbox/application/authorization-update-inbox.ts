import type {
  PostgresDatabase,
  QueryConfig,
  QueryResult,
} from "@openmeld/db/postgresql";
import type { InboxSourceTarget } from "@openmeld/schemas/types";
import type { InboxSourceWriteGuard } from "../infrastructure/postgresql/inbox-item-repo";
import {
  prepareEnsureInboxItemStatements,
  prepareResolveInboxItemsBySourceStatements,
} from "./inbox-item-service";

const SOURCE_KIND = "system_attention_event" as const;
const SOURCE_COMPONENT = /^[a-zA-Z0-9._-]{1,100}$/u;
export const AUTHORIZATION_UPDATE_SOURCE_PREFIX = "authorization-update:";
export function authorizationUpdateSourcePrefix(sourceId: string): string {
  if (!SOURCE_COMPONENT.test(sourceId)) {
    throw new Error("Invalid authorization update source identity");
  }
  return `${AUTHORIZATION_UPDATE_SOURCE_PREFIX}${sourceId}:`;
}
/** The source owns permission truth. Inbox only projects its guarded consent request. */
export async function requireAuthorizationUpdateInbox(input: {
  db: PostgresDatabase;
  organizationId: string;
  sourceId: string;
  requirementRevision: string;
  displayName: string;
  target: InboxSourceTarget;
  occurredAtMs: number;
  nowMs: number;
  members: readonly {
    userId: string;
    role: string;
  }[];
  sourceGuard: InboxSourceWriteGuard;
}): Promise<void> {
  if (!SOURCE_COMPONENT.test(input.requirementRevision)) {
    throw new Error("Invalid authorization requirement revision");
  }
  const sourceKey = `${authorizationUpdateSourcePrefix(input.sourceId)}${input.requirementRevision}`;
  const recipients = [
    ...new Set(
      input.members
        .filter((member) => member.role === "owner" || member.role === "admin")
        .map((member) => member.userId)
    ),
  ];
  const statements: QueryConfig[] = [];
  for (const recipientUserId of recipients) {
    const prepared = await prepareEnsureInboxItemStatements({
      db: input.db,
      nowMs: input.nowMs,
      sourceGuard: input.sourceGuard,
      candidate: {
        attention: "action_required",
        importance: "urgent",
        kind: "system_issue",
        contextLabel: "Authorization update",
        organizationId: input.organizationId,
        recipientUserId,
        sourceKind: SOURCE_KIND,
        sourceKey,
        sourceTarget: input.target,
        occurredAtMs: input.occurredAtMs,
        title: `Update ${input.displayName} permissions`,
        preview: `An owner or admin needs to reconnect ${input.displayName} and approve the updated permissions. Once one person completes this, the request is cleared for everyone.`,
      },
    });
    statements.push(...prepared.statements);
  }
  if (statements.length) {
    await input.db.transaction(async (client) => {
      const results: QueryResult[] = [];
      for (const query of statements) {
        results.push(await client.query(query));
      }
      return results;
    });
  }
}
export async function resolveAuthorizationUpdateInbox(input: {
  db: PostgresDatabase;
  organizationId: string;
  sourceId: string;
  nowMs: number;
  sourceGuard: InboxSourceWriteGuard;
}): Promise<void> {
  const prefix = authorizationUpdateSourcePrefix(input.sourceId);
  const rows = await input.db.query<{
    source_key: string;
  }>({
    text: 'SELECT DISTINCT source_key FROM "openmeld"."inbox_items" WHERE organization_id = $1 AND source_kind = $2 AND substr(source_key, 1, $3) = $4 AND resolution_status = \'open\'',
    values: [input.organizationId, SOURCE_KIND, prefix.length, prefix],
  });
  for (const row of rows.rows) {
    await input.db.transaction(async (client) => {
      const results: QueryResult[] = [];
      for (const query of prepareResolveInboxItemsBySourceStatements({
        db: input.db,
        organizationId: input.organizationId,
        sourceKind: SOURCE_KIND,
        sourceKey: row.source_key,
        resolvedAtMs: input.nowMs,
        markRead: true,
        sourceGuard: input.sourceGuard,
      })) {
        results.push(await client.query(query));
      }
      return results;
    });
  }
}
