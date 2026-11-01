import {
  getPostgresDatabase,
  withPostgresRequest,
} from "@openmeld/db/postgresql";
import {
  type AccountDeletionCleanupInput,
  type AccountDeletionCleanupResult,
  accountDeletionCleanupInputSchema,
  accountDeletionConnectionCleanupSchema,
  accountDeletionPlanSchema,
} from "@openmeld/schemas";
import { requestAgentActivitySessionInventoryMemberCleanup } from "../agent-activity/activity-session-inventory-repository";
import {
  clearCoreCenterAgentMemberNativeDeliveryData,
  createCoreCenterAgentMemoryService,
} from "../center-agent-memory/core-memory-service";
import { organizationFileRootName } from "../files/file-root-identity";
import { purgeFileObjectPrefix } from "../files/purge-file-objects";
import type { CoreBindings } from "../lib/bindings";
import { disconnectRemoteAgentLarkPlatformChannelConnection } from "../remote-agent/infrastructure/postgresql/lark-platform-channel-connection-repo";
import { deleteRemoteAgentSlackWorkspaceBindingByOrganization } from "../remote-agent/infrastructure/postgresql/slack-workspace-binding-repo";
import { prepareDeleteSlackWorkspaceTokenByOrganizationStatement } from "../remote-agent/infrastructure/postgresql/slack-workspace-token-repo";
import { resolveSpaceStub } from "../rpc/space-ref";
import {
  eraseAccountConversation,
  stopAccountConversation,
} from "./account-conversation-deletion";

export async function cleanupDeletedAccountConnection(
  env: CoreBindings,
  raw: unknown
): Promise<void> {
  const input = accountDeletionConnectionCleanupSchema.parse(raw);
  return await withPostgresRequest(env.OPENMELD_POSTGRESQL, async () => {
    const db = getPostgresDatabase(env);
    const row = (
      await db.query<{ plan_json: string }>({
        text: 'SELECT plan_json FROM "openmeld"."account_deletion_requests" WHERE user_id = $1',
        values: [input.userId],
      })
    ).rows[0];
    if (
      !(
        row &&
        accountDeletionPlanSchema
          .parse(JSON.parse(row.plan_json))
          .connections.some(
            (target) =>
              target.connectionName === input.connectionName &&
              target.service === input.service
          )
      )
    ) {
      throw new Error("Connection cleanup is not authorized.");
    }
    if (!env.OPENMELD_ACCOUNT_DELETION_GATEWAY) {
      throw new Error("App connection cleanup is unavailable.");
    }
    await env.OPENMELD_ACCOUNT_DELETION_GATEWAY.disconnectAccountConnection({
      connectionName: input.connectionName,
      service: input.service,
    });
    await db.query({
      text: 'DELETE FROM "openmeld"."connector_connections" WHERE connection_name = $1',
      values: [input.connectionName],
    });
  });
}

/** Core cleans its resources only after Auth has committed irreversible acceptance. */
export async function cleanupDeletedAccount(
  env: CoreBindings,
  raw: AccountDeletionCleanupInput
): Promise<AccountDeletionCleanupResult> {
  const input = accountDeletionCleanupInputSchema.parse(raw);
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keep the ordered, resumable erasure stages together for lifecycle review.
  return await withPostgresRequest(env.OPENMELD_POSTGRESQL, async () => {
    const db = getPostgresDatabase(env);
    const request = (
      await db.query<{ plan_json: string; private_root_index: number }>({
        text: `SELECT r.plan_json, r.private_root_index FROM "openmeld"."account_deletion_requests" r JOIN "openmeld"."users" u ON u.id = r.user_id WHERE r.user_id = $1 AND u.deleted_at IS NOT NULL`,
        values: [input.userId],
      })
    ).rows[0];
    if (
      !request ||
      input.privateRootIndex > Number(request.private_root_index)
    ) {
      throw new Error("Account deletion was not accepted.");
    }
    const plan = accountDeletionPlanSchema.parse(JSON.parse(request.plan_json));
    let privateRootIndex = input.privateRootIndex;
    const pending = () => ({ complete: false, privateRootIndex });
    // Stop external ingress before erasing the tenant's conversations.
    for (const organizationId of plan.deleteOrganizationIds) {
      await deleteRemoteAgentSlackWorkspaceBindingByOrganization({
        db,
        organizationId,
        atomicDeleteStatements: [
          prepareDeleteSlackWorkspaceTokenByOrganizationStatement({
            db,
            organizationId,
          }),
        ],
      });
      // Also clear an orphan credential if an earlier disconnect lost its binding.
      await db.query(
        prepareDeleteSlackWorkspaceTokenByOrganizationStatement({
          db,
          organizationId,
        })
      );
      for (const provider of ["lark", "feishu"] as const) {
        const connection =
          await disconnectRemoteAgentLarkPlatformChannelConnection({
            db,
            organizationId,
            provider,
            nowMs: Date.now(),
          });
        if (connection) {
          if (!env.OPENMELD_LARK_CHANNEL_CONNECTOR) {
            throw new Error("Channel cleanup is unavailable.");
          }
          await env.OPENMELD_LARK_CHANNEL_CONNECTOR.getByName(
            connection.connectionId
          ).disconnect();
        }
      }
    }
    if (
      (
        await db.query({
          text: `SELECT 1 FROM "openmeld"."openmeld_profile_deletion_outbox" WHERE profile_id = ANY($1::text[]) AND profile_kind = 'agent' LIMIT 1`,
          values: [plan.profileIds],
        })
      ).rows.length
    ) {
      return pending();
    }
    const roots = env.OPENMELD_FILE_ROOTS;
    if (!roots) {
      throw new Error("File root cleanup is unavailable.");
    }
    const end = Math.min(
      plan.privateOrganizationIds.length,
      privateRootIndex + 10
    );
    for (; privateRootIndex < end; privateRootIndex++) {
      const organizationId = plan.privateOrganizationIds[privateRootIndex];
      if (!organizationId) {
        throw new Error("Invalid cleanup cursor.");
      }
      const root = {
        kind: "member" as const,
        organizationId,
        memberUserId: input.userId,
      };
      const stub = roots.get(roots.idFromName(organizationFileRootName(root)));
      if (
        !(await stub.purgeDeletedAccountRoot({ root, userId: input.userId }))
      ) {
        return pending();
      }
      await requestAgentActivitySessionInventoryMemberCleanup({
        db,
        finalize: true,
        nowMs: Date.now(),
        organizationId,
        ownerUserId: input.userId,
      });
    }
    if (privateRootIndex < plan.privateOrganizationIds.length) {
      return pending();
    }
    const spaces = (
      await db.query<{ space_id: string }>({
        text: `SELECT s.space_id FROM "openmeld"."space_index_spaces" s WHERE s.status <> 'deleted' AND
        (s.organization_id = ANY($2::text[]) OR (s.direct_message_pair_key IS NOT NULL AND s.direct_message_converted_at_ms IS NULL
          AND EXISTS (SELECT 1 FROM "openmeld"."space_index_memberships" m WHERE m.space_id = s.space_id AND m.profile_kind_snapshot = 'human' AND m.owner_user_id_snapshot = $1)
          AND NOT EXISTS (SELECT 1 FROM "openmeld"."space_index_memberships" m WHERE m.space_id = s.space_id AND m.profile_kind_snapshot = 'human' AND m.owner_user_id_snapshot IS DISTINCT FROM $1))) LIMIT 20`,
        values: [input.userId, plan.deleteOrganizationIds],
      })
    ).rows;
    for (const space of spaces) {
      const stub = resolveSpaceStub(env.OPENMELD_SPACES, space.space_id);
      if (
        !(
          stub &&
          (await stub.rpcPurgeDeletedAccountSpace({
            userId: input.userId,
            spaceId: space.space_id,
          }))
        )
      ) {
        return pending();
      }
    }
    if (spaces.length === 20) {
      return pending();
    }
    // Native Channel conversations and previously deleted Spaces have no live
    // Space owner. Only an explicitly closed tenant authorizes their erasure.
    const remainingConversations = (
      await db.query<{ organization_id: string; space_id: string }>({
        text: 'SELECT DISTINCT organization_id, space_id FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE organization_id = ANY($1::text[]) LIMIT 20',
        values: [plan.deleteOrganizationIds],
      })
    ).rows;
    for (const conversation of remainingConversations) {
      const target = {
        db,
        env,
        organizationId: conversation.organization_id,
        spaceId: conversation.space_id,
        deleteSharedComputer: true,
      };
      await stopAccountConversation(target);
      if (
        (
          await db.query({
            text: `SELECT 1 FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE space_id = $1 AND status IN ('submitted','accepted','retry_observed') LIMIT 1`,
            values: [conversation.space_id],
          })
        ).rows.length
      ) {
        return pending();
      }
      await eraseAccountConversation(target);
    }
    if (remainingConversations.length === 20) {
      return pending();
    }
    const subjects = (
      await db.query<{
        organization_id: string;
        subject_kind: string;
        member_user_id: string;
        space_id: string | null;
      }>({
        text: `SELECT organization_id, subject_kind, member_user_id, space_id FROM "openmeld"."center_agent_memory_subjects" WHERE status <> 'deleted' AND (member_user_id = $1 OR organization_id = ANY($2::text[]))`,
        values: [input.userId, plan.deleteOrganizationIds],
      })
    ).rows;
    const memory = createCoreCenterAgentMemoryService(env);
    for (const subject of subjects) {
      if (!memory) {
        throw new Error("Private memory cleanup is unavailable.");
      }
      if (subject.subject_kind === "organization") {
        await memory.deleteOrganizationMemory({
          organizationId: subject.organization_id,
        });
      } else if (subject.subject_kind === "space" && subject.space_id) {
        await memory.deleteSpaceMemory({
          organizationId: subject.organization_id,
          spaceId: subject.space_id,
        });
      } else {
        await memory.deleteMemberMemory({
          organizationId: subject.organization_id,
          userId: subject.member_user_id,
        });
      }
    }
    for (const organizationId of plan.deleteOrganizationIds) {
      const root = { kind: "team" as const, organizationId };
      const stub = roots.get(roots.idFromName(organizationFileRootName(root)));
      if (
        !(await stub.purgeDeletedAccountRoot({ root, userId: input.userId }))
      ) {
        return pending();
      }
      if (
        !(env.OPENMELD_ORGANIZATION_SKILLS && env.OPENMELD_SPACE_ATTACHMENTS)
      ) {
        throw new Error("Organization file storage unavailable.");
      }
      if (
        !(await purgeFileObjectPrefix(
          env.OPENMELD_ORGANIZATION_SKILLS,
          `organizations/${organizationId}/`
        ))
      ) {
        return pending();
      }
      // Also removes bytes left by earlier explicit Space deletion in this tenant.
      if (
        !(await purgeFileObjectPrefix(
          env.OPENMELD_SPACE_ATTACHMENTS,
          `org/${organizationId}/`
        ))
      ) {
        return pending();
      }
    }
    if (!env.OPENMELD_ACCOUNT_AVATARS) {
      throw new Error("Avatar storage unavailable.");
    }
    for (const profileId of plan.profileIds) {
      if (
        !(await purgeFileObjectPrefix(
          env.OPENMELD_ACCOUNT_AVATARS,
          `profiles/${profileId}/avatars/`
        ))
      ) {
        return pending();
      }
    }
    for (const organizationId of plan.privateOrganizationIds) {
      await clearCoreCenterAgentMemberNativeDeliveryData(
        env,
        organizationId,
        input.userId
      );
    }
    // Human membership reconciliation may wait on its existing retry interval.
    // It must not keep the account's private Computer and processes alive.
    const computers = await db.query<{ id: string }>({
      text: 'SELECT id FROM "openmeld"."cloud_computers" WHERE owner_user_id = $1',
      values: [input.userId],
    });
    for (const computer of computers.rows) {
      const erase = env.OPENMELD_REMOTE_AGENT_WORKER?.eraseAccountComputer;
      if (!erase) {
        throw new Error("Personal Computer cleanup is unavailable.");
      }
      await erase({ computerId: computer.id });
      await db.query({
        text: 'DELETE FROM "openmeld"."cloud_computers" WHERE id = $1 AND owner_user_id = $2',
        values: [computer.id, input.userId],
      });
    }
    if (
      (
        await db.query({
          text: 'SELECT 1 FROM "openmeld"."openmeld_profile_deletion_outbox" WHERE profile_id = ANY($1::text[]) LIMIT 1',
          values: [plan.profileIds],
        })
      ).rows.length
    ) {
      return pending();
    }
    for (const [column, tables] of Object.entries({
      user_id: [
        "account_sidebar_preferences",
        "inbox_notification_preferences",
        "inbox_message_notification_defaults",
        "inbox_conversation_notification_preferences",
        "agent_profile_creation_defaults",
        "organization_binding_authorization_preferences",
      ],
      recipient_user_id: [
        "inbox_feed_snapshots",
        "inbox_items",
        "inbox_center_agent_read_watermarks",
        "inbox_space_thread_read_watermarks",
      ],
      owner_user_id: [
        "desktop_update_installations",
        "openMeldDaemon_prepare_session_tokens",
        "openMeldDaemon_prepare_session_events",
        "openMeldDaemon_prepare_sessions",
        "openMeldDaemon_connected_computers",
        "openMeldDaemon_owned_devices",
        "openMeldDaemon_current_device_targets",
        "openmeld_service_connection_incidents",
      ],
    })) {
      for (const table of tables) {
        await db.query({
          text: `DELETE FROM "openmeld"."${table}" WHERE "${column}" = $1`,
          values: [input.userId],
        });
      }
    }
    return { complete: true, privateRootIndex };
  });
}
