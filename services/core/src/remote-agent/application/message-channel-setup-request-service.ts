import type {
  PostgresDatabase,
  QueryConfig,
  QueryResult,
} from "@openmeld/db/postgresql";
import type { MessageChannelProvider } from "@openmeld/schemas/types";
import {
  prepareEnsureInboxItemStatements,
  prepareResolveInboxItemsBySourceStatements,
} from "../../inbox/application/inbox-item-service";

const INBOX_SOURCE_KIND = "organization_member_request" as const;
const MESSAGE_CHANNEL_PROVIDER_NAMES: Record<MessageChannelProvider, string> = {
  feishu: "Feishu",
  lark: "Lark",
  slack: "Slack",
};
type SetupRequestRecord = {
  createdAtMs: number;
  id: string;
};
export async function createMessageChannelSetupRequest(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  provider: MessageChannelProvider;
  recipients: readonly string[];
  requester: {
    displayName: string;
    userId: string;
  };
}): Promise<{
  recipientCount: number;
  requestId: string;
  status: "created" | "already_requested";
}> {
  const recipients = [...new Set(input.recipients)].sort();
  if (recipients.length === 0) {
    throw new TypeError("At least one setup-request recipient is required");
  }
  const existing = await readOpenSetupRequest(input);
  if (existing) {
    await ensureRecipientInboxItems({
      ...input,
      recipients,
      request: existing,
    });
    return {
      recipientCount: recipients.length,
      requestId: existing.id,
      status: "already_requested",
    };
  }
  const request = { createdAtMs: input.nowMs, id: crypto.randomUUID() };
  const inboxStatements = await prepareRecipientInboxStatements({
    ...input,
    recipients,
    request,
  });
  try {
    await input.db.transaction(async (client) =>
      Promise.all([
        client.query({
          text: `
            INSERT INTO "openmeld"."organization_message_channel_setup_requests" (
              id,
              organization_id,
              requester_user_id,
              provider,
              status,
              created_at_ms,
              updated_at_ms,
              resolved_at_ms
            ) VALUES ($1, $2, $3, $4, 'open', $5, $6, NULL)
          `,
          values: [
            request.id,
            input.organizationId,
            input.requester.userId,
            input.provider,
            input.nowMs,
            input.nowMs,
          ],
        }),
        ...inboxStatements.map((query) => client.query(query)),
      ])
    );
  } catch (error) {
    const raced = await readOpenSetupRequest(input);
    if (!raced) {
      throw error;
    }
    await ensureRecipientInboxItems({ ...input, recipients, request: raced });
    return {
      recipientCount: recipients.length,
      requestId: raced.id,
      status: "already_requested",
    };
  }
  return {
    recipientCount: recipients.length,
    requestId: request.id,
    status: "created",
  };
}
export async function resolveMessageChannelSetupRequests(input: {
  db: PostgresDatabase;
  organizationId: string;
  provider: MessageChannelProvider;
  resolvedAtMs: number;
}): Promise<number> {
  const rows = await input.db.query<{
    id: string;
  }>({
    text: `
        SELECT id
        FROM "openmeld"."organization_message_channel_setup_requests"
        WHERE organization_id = $1
          AND provider = $2
          AND status = 'open'
        ORDER BY created_at_ms ASC NULLS FIRST, id ASC NULLS FIRST
      `,
    values: [input.organizationId, input.provider],
  });
  const requestIds = rows.rows.map((row) => row.id);
  if (requestIds.length === 0) {
    return 0;
  }
  const statements = requestIds.flatMap((requestId) => [
    {
      text: `
          UPDATE "openmeld"."organization_message_channel_setup_requests"
          SET
            status = 'resolved',
            resolved_at_ms = $1,
            updated_at_ms = GREATEST(updated_at_ms, $2)
          WHERE id = $3
            AND organization_id = $4
            AND provider = $5
            AND status = 'open'
        `,
      values: [
        input.resolvedAtMs,
        input.resolvedAtMs,
        requestId,
        input.organizationId,
        input.provider,
      ],
    },
    ...prepareResolveInboxItemsBySourceStatements({
      db: input.db,
      organizationId: input.organizationId,
      resolvedAtMs: input.resolvedAtMs,
      sourceKey: requestId,
      sourceKind: INBOX_SOURCE_KIND,
    }),
  ]);
  const results = await input.db.transaction(async (client) => {
    const results: QueryResult[] = [];
    for (const query of statements) {
      results.push(await client.query(query));
    }
    return results;
  });
  return results.reduce(
    (count, result, index) =>
      index % 3 === 0 ? count + Number(result.rowCount ?? 0) : count,
    0
  );
}
async function readOpenSetupRequest(input: {
  db: PostgresDatabase;
  organizationId: string;
  provider: MessageChannelProvider;
  requester: {
    userId: string;
  };
}): Promise<SetupRequestRecord | null> {
  const row = await input.db
    .query<{
      created_at_ms: number;
      id: string;
    }>({
      text: `
        SELECT id, created_at_ms
        FROM "openmeld"."organization_message_channel_setup_requests"
        WHERE organization_id = $1
          AND requester_user_id = $2
          AND provider = $3
          AND status = 'open'
        LIMIT 1
      `,
      values: [input.organizationId, input.requester.userId, input.provider],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? { createdAtMs: row.created_at_ms, id: row.id } : null;
}
async function ensureRecipientInboxItems(
  input: Parameters<typeof prepareRecipientInboxStatements>[0]
): Promise<void> {
  await input.db.transaction(async (client) => {
    const results: QueryResult[] = [];
    for (const query of await prepareRecipientInboxStatements(input)) {
      results.push(await client.query(query));
    }
    return results;
  });
}
async function prepareRecipientInboxStatements(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  provider: MessageChannelProvider;
  recipients: readonly string[];
  request: SetupRequestRecord;
  requester: {
    displayName: string;
    userId: string;
  };
}): Promise<QueryConfig[]> {
  const providerName = formatMessageChannelProviderName(input.provider);
  const writes = await Promise.all(
    input.recipients.map((recipientUserId) =>
      prepareEnsureInboxItemStatements({
        candidate: {
          attention: "action_required",
          contextLabel: "Channels",
          importance: "normal",
          kind: "organization_request",
          occurredAtMs: input.request.createdAtMs,
          organizationId: input.organizationId,
          preview: `${input.requester.displayName} asked an admin to set up ${providerName} for this Organization.`,
          recipientUserId,
          sourceKey: input.request.id,
          sourceKind: INBOX_SOURCE_KIND,
          sourceTarget: { kind: "settings", section: "channels" },
          title: `${providerName} setup requested`,
        },
        db: input.db,
        nowMs: input.nowMs,
      })
    )
  );
  return writes.flatMap((write) => write.statements);
}
export function formatMessageChannelProviderName(
  provider: MessageChannelProvider
): string {
  return MESSAGE_CHANNEL_PROVIDER_NAMES[provider];
}
