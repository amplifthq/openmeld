import type { PostgresDatabase, QueryConfig } from "@openmeld/db/postgresql";
import type { MessageChannelConnectionStatus } from "@openmeld/schemas/types";
import {
  type RemoteAgentLarkPlatformChannelConnectionRecord,
  type RemoteAgentLarkPlatformProvider,
  type RemoteAgentLarkPlatformTransport,
  type RemoteAgentLarkPlatformWebhookSurface,
  readRemoteAgentLarkPlatformChannelConnection,
  readRemoteAgentLarkPlatformChannelCredentials,
} from "./lark-platform-channel-connection-repo";
export type RemoteAgentLarkPlatformPermissionMode =
  | "channel_only_template"
  | "official_preset";
export type RemoteAgentLarkPlatformRegistrationAttemptRecord = {
  applicationVersionId: string | null;
  accountDomain: string;
  attemptId: string;
  connectionId: string | null;
  consumedAtMs: number | null;
  createdAtMs: number;
  detectedBrand: RemoteAgentLarkPlatformProvider | null;
  encryptedDeviceCode: string;
  encryptedRegistrationUrl: string;
  expiresAtMs: number;
  failureReasonCode: string | null;
  initiatedByProfileId: string;
  initiatedByUserId: string;
  nextPollAtMs: number;
  organizationId: string;
  permissionBundleVersion: string;
  permissionMode: RemoteAgentLarkPlatformPermissionMode;
  pollClaimExpiresAtMs: number | null;
  pollClaimId: string | null;
  pollIntervalMs: number;
  provider: RemoteAgentLarkPlatformProvider;
  returnPath: string;
  status: MessageChannelConnectionStatus;
  updatedAtMs: number;
};
type RemoteAgentLarkPlatformRegistrationAttemptRow = {
  application_version_id: string | null;
  account_domain: string;
  attempt_id: string;
  connection_id: string | null;
  consumed_at_ms: number | null;
  created_at_ms: number;
  detected_brand: RemoteAgentLarkPlatformProvider | null;
  encrypted_device_code: string;
  encrypted_registration_url: string;
  expires_at_ms: number;
  failure_reason_code: string | null;
  initiated_by_profile_id: string;
  initiated_by_user_id: string;
  next_poll_at_ms: number;
  organization_id: string;
  permission_bundle_version: string;
  permission_mode: RemoteAgentLarkPlatformPermissionMode;
  poll_claim_expires_at_ms: number | null;
  poll_claim_id: string | null;
  poll_interval_ms: number;
  provider: RemoteAgentLarkPlatformProvider;
  return_path: string;
  status: MessageChannelConnectionStatus;
  updated_at_ms: number;
};
const REGISTRATION_SELECT = `
  SELECT
    application_version_id,
    attempt_id,
    organization_id,
    initiated_by_user_id,
    initiated_by_profile_id,
    provider,
    encrypted_device_code,
    encrypted_registration_url,
    account_domain,
    detected_brand,
    connection_id,
    poll_interval_ms,
    next_poll_at_ms,
    expires_at_ms,
    poll_claim_id,
    poll_claim_expires_at_ms,
    permission_mode,
    permission_bundle_version,
    return_path,
    status,
    failure_reason_code,
    consumed_at_ms,
    created_at_ms,
    updated_at_ms
  FROM "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts"
`;
const CAPABILITY_GROUP_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
export async function recordClaimedLarkPlatformApplicationVersion(input: {
  attemptId: string;
  claimId: string;
  db: PostgresDatabase;
  nowMs: number;
  versionId: string;
}): Promise<void> {
  const result = await input.db.query({
    text: `
    UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts"
    SET application_version_id = $1, updated_at_ms = $2
    WHERE attempt_id = $3 AND poll_claim_id = $4
      AND poll_claim_expires_at_ms > $5 AND expires_at_ms > $6
      AND consumed_at_ms IS NULL AND status = 'configuring'
      AND application_version_id IS NULL
  `,
    values: [
      input.versionId,
      input.nowMs,
      input.attemptId,
      input.claimId,
      input.nowMs,
      input.nowMs,
    ],
  });
  if (result.rowCount !== 1) {
    throw new Error("Lark-platform publication claim lost");
  }
}
type CreateRemoteAgentLarkPlatformRegistrationAttemptInput = {
  accountDomain: string;
  attemptId: string;
  db: PostgresDatabase;
  encryptedDeviceCode: string;
  encryptedRegistrationUrl: string;
  expiresAtMs: number;
  initiatedByProfileId: string;
  initiatedByUserId: string;
  nextPollAtMs: number;
  nowMs: number;
  organizationId: string;
  permissionBundleVersion: string;
  permissionMode: RemoteAgentLarkPlatformPermissionMode;
  pollIntervalMs: number;
  provider: RemoteAgentLarkPlatformProvider;
  returnPath: string;
};
export async function createRemoteAgentLarkPlatformRegistrationAttempt(
  input: CreateRemoteAgentLarkPlatformRegistrationAttemptInput
): Promise<RemoteAgentLarkPlatformRegistrationAttemptRecord> {
  await input.db.query(prepareRegistrationAttemptInsert(input));
  const record = await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
  if (!record) {
    throw new Error("Lark-platform registration attempt write lost its row");
  }
  return record;
}
export async function replacePendingRemoteAgentLarkPlatformRegistrationAttempt(
  input: CreateRemoteAgentLarkPlatformRegistrationAttemptInput & {
    replacedAttemptId: string;
  }
): Promise<RemoteAgentLarkPlatformRegistrationAttemptRecord | null> {
  const insertReplacement = prepareRegistrationAttemptInsert(input, {
    onlyWhenNoActiveAttemptExists: true,
  });
  const retirePrevious = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts"
        SET
          status = 'repair_required',
          failure_reason_code = provider || '.registration_restarted',
          consumed_at_ms = $1,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          updated_at_ms = $2
        WHERE attempt_id = $3
          AND organization_id = $4
          AND provider = $5
          AND initiated_by_user_id = $6
          AND initiated_by_profile_id = $7
          AND consumed_at_ms IS NULL
          AND status = 'pending_registration'
      `,
    values: [
      input.nowMs,
      input.nowMs,
      input.replacedAttemptId,
      input.organizationId,
      input.provider,
      input.initiatedByUserId,
      input.initiatedByProfileId,
    ],
  };
  const [retireResult, insertResult] = await input.db.transaction(
    async (client) =>
      [
        await client.query(retirePrevious),
        await client.query(insertReplacement),
      ] as const
  );
  if (!(retireResult && insertResult)) {
    throw new Error(
      "Lark-platform registration replacement lost its batch result"
    );
  }
  const replaced =
    Number(insertResult.rowCount ?? 0) === 1 &&
    Number(retireResult.rowCount ?? 0) === 1;
  const record = replaced
    ? await readRemoteAgentLarkPlatformRegistrationAttempt({
        attemptId: input.attemptId,
        db: input.db,
      })
    : await readActiveRemoteAgentLarkPlatformRegistrationAttempt({
        db: input.db,
        organizationId: input.organizationId,
        provider: input.provider,
      });
  return record;
}
function prepareRegistrationAttemptInsert(
  input: CreateRemoteAgentLarkPlatformRegistrationAttemptInput,
  options: {
    onlyWhenNoActiveAttemptExists?: boolean;
  } = {}
): QueryConfig {
  const valuesSql =
    "$1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL, $9, $10, $11, NULL, NULL, $12, $13, $14, 'pending_registration', NULL, NULL, $15, $16";
  const insertionSql = options.onlyWhenNoActiveAttemptExists
    ? `
        SELECT ${valuesSql}
        WHERE NOT EXISTS (
          SELECT 1
          FROM "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts"
          WHERE organization_id = $2
            AND provider = $5
            AND consumed_at_ms IS NULL
            AND status IN ('pending_registration', 'credentials_received', 'configuring')
        )
      `
    : `VALUES (${valuesSql})`;
  return {
    text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts" (
          attempt_id,
          organization_id,
          initiated_by_user_id,
          initiated_by_profile_id,
          provider,
          encrypted_device_code,
          encrypted_registration_url,
          account_domain,
          detected_brand,
          connection_id,
          poll_interval_ms,
          next_poll_at_ms,
          expires_at_ms,
          poll_claim_id,
          poll_claim_expires_at_ms,
          permission_mode,
          permission_bundle_version,
          return_path,
          status,
          failure_reason_code,
          consumed_at_ms,
          created_at_ms,
          updated_at_ms
        )
        ${insertionSql}
      `,
    values: [
      input.attemptId,
      input.organizationId,
      input.initiatedByUserId,
      input.initiatedByProfileId,
      input.provider,
      input.encryptedDeviceCode,
      input.encryptedRegistrationUrl,
      input.accountDomain,
      input.pollIntervalMs,
      input.nextPollAtMs,
      input.expiresAtMs,
      input.permissionMode,
      input.permissionBundleVersion,
      input.returnPath,
      input.nowMs,
      input.nowMs,
    ],
  };
}
export async function readRemoteAgentLarkPlatformRegistrationAttempt(input: {
  attemptId: string;
  db: PostgresDatabase;
}): Promise<RemoteAgentLarkPlatformRegistrationAttemptRecord | null> {
  const row = await input.db
    .query<RemoteAgentLarkPlatformRegistrationAttemptRow>({
      text: `${REGISTRATION_SELECT} WHERE attempt_id = $1 LIMIT 1`,
      values: [input.attemptId],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapRegistrationAttemptRow(row) : null;
}
export async function readActiveRemoteAgentLarkPlatformRegistrationAttempt(input: {
  db: PostgresDatabase;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
}): Promise<RemoteAgentLarkPlatformRegistrationAttemptRecord | null> {
  const row = await input.db
    .query<RemoteAgentLarkPlatformRegistrationAttemptRow>({
      text: `${REGISTRATION_SELECT}
       WHERE organization_id = $1
         AND provider = $2
         AND consumed_at_ms IS NULL
         AND status IN ('pending_registration', 'credentials_received', 'configuring')
       ORDER BY created_at_ms DESC NULLS LAST
       LIMIT 1`,
      values: [input.organizationId, input.provider],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapRegistrationAttemptRow(row) : null;
}
export async function listDueRemoteAgentLarkPlatformRegistrationAttempts(input: {
  db: PostgresDatabase;
  limit: number;
  nowMs: number;
}): Promise<RemoteAgentLarkPlatformRegistrationAttemptRecord[]> {
  if (!(Number.isInteger(input.limit) && input.limit > 0)) {
    throw new Error(
      "Lark-platform registration limit must be a positive integer"
    );
  }
  const rows =
    await input.db.query<RemoteAgentLarkPlatformRegistrationAttemptRow>({
      text: `${REGISTRATION_SELECT}
       WHERE consumed_at_ms IS NULL
         AND status IN ('pending_registration', 'credentials_received', 'configuring')
         AND (next_poll_at_ms <= $1 OR expires_at_ms <= $2)
         AND (
           poll_claim_id IS NULL
           OR poll_claim_expires_at_ms IS NULL
           OR poll_claim_expires_at_ms <= $3
         )
       ORDER BY next_poll_at_ms ASC NULLS FIRST, created_at_ms ASC NULLS FIRST, attempt_id ASC NULLS FIRST
       LIMIT $4`,
      values: [input.nowMs, input.nowMs, input.nowMs, input.limit],
    });
  return (rows.rows ?? []).map(mapRegistrationAttemptRow);
}
export async function repairRemoteAgentLarkPlatformRegistrationAttempt(input: {
  updatePermissionBundleVersion?: string;
  attemptId: string;
  configurationExpiresAtMs: number;
  connectionId: string;
  db: PostgresDatabase;
  initiatedByProfileId: string;
  initiatedByUserId: string;
  nowMs: number;
  organizationId: string;
  pollIntervalMs: number;
  provider: RemoteAgentLarkPlatformProvider;
}): Promise<RemoteAgentLarkPlatformRegistrationAttemptRecord | null> {
  if (input.configurationExpiresAtMs <= input.nowMs) {
    throw new Error(
      "Lark-platform configuration repair must expire in the future"
    );
  }
  const candidate = await input.db
    .query<RemoteAgentLarkPlatformRegistrationAttemptRow>({
      text: `${REGISTRATION_SELECT}
       WHERE connection_id = $1
         AND organization_id = $2
         AND provider = $3
         AND consumed_at_ms IS NOT NULL
         AND status IN ('connected', 'repair_required')
       ORDER BY updated_at_ms DESC NULLS LAST
       LIMIT 1`,
      values: [input.connectionId, input.organizationId, input.provider],
    })
    .then((result) => result.rows[0] ?? null);
  if (!candidate) {
    return null;
  }
  const createRepairAttempt = {
    text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts" (
          attempt_id,
          organization_id,
          initiated_by_user_id,
          initiated_by_profile_id,
          provider,
          encrypted_device_code,
          encrypted_registration_url,
          account_domain,
          detected_brand,
          connection_id,
          poll_interval_ms,
          next_poll_at_ms,
          expires_at_ms,
          poll_claim_id,
          poll_claim_expires_at_ms,
          permission_mode,
          permission_bundle_version,
          return_path,
          status,
          failure_reason_code,
          consumed_at_ms,
          created_at_ms,
          updated_at_ms
        )
        SELECT
          $1,
          previous.organization_id,
          $2,
          $3,
          previous.provider,
          previous.encrypted_device_code,
          previous.encrypted_registration_url,
          previous.account_domain,
          previous.detected_brand,
          previous.connection_id,
          $4,
          $5,
          $6,
          NULL,
          NULL,
          previous.permission_mode,
          coalesce($7, previous.permission_bundle_version),
          previous.return_path,
          'configuring',
          CASE WHEN $8::text IS NOT NULL THEN previous.provider || '.authorization_update_required' ELSE NULL END,
          NULL,
          $9,
          $10
        FROM "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts" previous
        INNER JOIN "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" connection
          ON connection.connection_id = previous.connection_id
         AND connection.organization_id = previous.organization_id
         AND connection.provider = previous.provider
        INNER JOIN "openmeld"."openMeldRemoteAgent_lark_platform_channel_credentials" credentials
          ON credentials.connection_id = connection.connection_id
        WHERE previous.attempt_id = $11
          AND previous.connection_id = $12
          AND previous.organization_id = $13
          AND previous.provider = $14
          AND previous.consumed_at_ms IS NOT NULL
          AND previous.status IN ('connected', 'repair_required')
          AND (connection.status IN ('repair_required', 'revoked')
            OR (connection.status = 'connected' AND $15::text IS NOT NULL AND connection.permission_bundle_version != $16))
          AND NOT EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts" active
            WHERE active.organization_id = $17
              AND active.provider = $18
              AND active.consumed_at_ms IS NULL
              AND active.status IN (
                'pending_registration',
                'credentials_received',
                'configuring'
              )
          )
      `,
    values: [
      input.attemptId,
      input.initiatedByUserId,
      input.initiatedByProfileId,
      input.pollIntervalMs,
      input.nowMs,
      input.configurationExpiresAtMs,
      input.updatePermissionBundleVersion ?? null,
      input.updatePermissionBundleVersion ?? null,
      input.nowMs,
      input.nowMs,
      candidate.attempt_id,
      input.connectionId,
      input.organizationId,
      input.provider,
      input.updatePermissionBundleVersion ?? null,
      input.updatePermissionBundleVersion ?? null,
      input.organizationId,
      input.provider,
    ],
  };
  const repairConnection = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"
        SET
          status = 'configuring',
          permission_bundle_version = coalesce($1, permission_bundle_version),
          bot_open_id = NULL,
          bot_name = NULL,
          granted_capability_groups_json = '[]',
          failure_reason_code = NULL,
          last_verified_at_ms = NULL,
          events_webhook_verified_at_ms = NULL,
          callbacks_webhook_verified_at_ms = NULL,
          updated_at_ms = $2
        WHERE connection_id = $3
          AND organization_id = $4
          AND provider = $5
          AND (status IN ('repair_required', 'revoked')
            OR (status = 'connected' AND $6::text IS NOT NULL AND permission_bundle_version != $7))
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts" attempt
            WHERE attempt.attempt_id = $8
              AND attempt.connection_id =
                "openMeldRemoteAgent_lark_platform_channel_connections".connection_id
              AND attempt.organization_id =
                "openMeldRemoteAgent_lark_platform_channel_connections".organization_id
              AND attempt.provider =
                "openMeldRemoteAgent_lark_platform_channel_connections".provider
              AND attempt.status = 'configuring'
              AND attempt.consumed_at_ms IS NULL
              AND attempt.expires_at_ms = $9
          )
      `,
    values: [
      input.updatePermissionBundleVersion ?? null,
      input.nowMs,
      input.connectionId,
      input.organizationId,
      input.provider,
      input.updatePermissionBundleVersion ?? null,
      input.updatePermissionBundleVersion ?? null,
      input.attemptId,
      input.configurationExpiresAtMs,
    ],
  };
  const [attemptResult, connectionResult] = await input.db.transaction(
    async (client) =>
      [
        await client.query(createRepairAttempt),
        await client.query(repairConnection),
      ] as const
  );
  if (
    Number(attemptResult.rowCount ?? 0) !== 1 ||
    Number(connectionResult.rowCount ?? 0) !== 1
  ) {
    return null;
  }
  return await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
}
export async function claimRemoteAgentLarkPlatformRegistrationAttempt(input: {
  attemptId: string;
  claimExpiresAtMs: number;
  claimId: string;
  db: PostgresDatabase;
  nowMs: number;
}): Promise<{
  record: RemoteAgentLarkPlatformRegistrationAttemptRecord | null;
  status: "claimed" | "not_due";
}> {
  if (input.claimExpiresAtMs <= input.nowMs) {
    throw new Error(
      "Lark-platform registration claim must expire in the future"
    );
  }
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts"
        SET
          poll_claim_id = $1,
          poll_claim_expires_at_ms = $2,
          updated_at_ms = $3
        WHERE attempt_id = $4
          AND consumed_at_ms IS NULL
          AND status IN ('pending_registration', 'credentials_received', 'configuring')
          AND next_poll_at_ms <= $5
          AND expires_at_ms > $6
          AND (
            poll_claim_id IS NULL
            OR poll_claim_expires_at_ms IS NULL
            OR poll_claim_expires_at_ms <= $7
          )
      `,
    values: [
      input.claimId,
      input.claimExpiresAtMs,
      input.nowMs,
      input.attemptId,
      input.nowMs,
      input.nowMs,
      input.nowMs,
    ],
  });
  const record = await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
  return record?.pollClaimId === input.claimId
    ? { record, status: "claimed" }
    : { record, status: "not_due" };
}
export async function advanceRemoteAgentLarkPlatformRegistrationAttempt(input: {
  accountDomain: string;
  attemptId: string;
  claimId: string;
  db: PostgresDatabase;
  detectedBrand: RemoteAgentLarkPlatformProvider | null;
  failureReasonCode: string | null;
  nextPollAtMs: number;
  nowMs: number;
  pollIntervalMs: number;
  status: Extract<
    MessageChannelConnectionStatus,
    "configuring" | "credentials_received" | "pending_registration"
  >;
}): Promise<{
  attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord | null;
  status: "advanced" | "claim_lost";
}> {
  const currentAttempt = await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
  if (
    input.detectedBrand &&
    currentAttempt &&
    input.detectedBrand !== currentAttempt.provider
  ) {
    throw new Error(
      "Lark-platform registration detected a brand that does not match its provider"
    );
  }
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts"
        SET
          account_domain = $1,
          detected_brand = COALESCE($2, detected_brand),
          poll_interval_ms = $3,
          next_poll_at_ms = $4,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          status = $5,
          failure_reason_code = $6,
          updated_at_ms = $7
        WHERE attempt_id = $8
          AND poll_claim_id = $9
          AND poll_claim_expires_at_ms > $10
          AND consumed_at_ms IS NULL
          AND expires_at_ms > $11
          AND ($12::text IS NULL OR $13 = provider)
      `,
    values: [
      input.accountDomain,
      input.detectedBrand,
      input.pollIntervalMs,
      input.nextPollAtMs,
      input.status,
      input.failureReasonCode,
      input.nowMs,
      input.attemptId,
      input.claimId,
      input.nowMs,
      input.nowMs,
      input.detectedBrand,
      input.detectedBrand,
    ],
  });
  const attempt = await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
  return Number(result.rowCount ?? 0) === 1
    ? { attempt, status: "advanced" }
    : { attempt, status: "claim_lost" };
}
export async function failRemoteAgentLarkPlatformRegistrationAttempt(input: {
  attemptId: string;
  claimId: string;
  db: PostgresDatabase;
  failureReasonCode: string;
  nowMs: number;
}): Promise<{
  attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord | null;
  status: "claim_lost" | "failed";
}> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts"
        SET
          status = 'repair_required',
          failure_reason_code = $1,
          consumed_at_ms = $2,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          updated_at_ms = $3
        WHERE attempt_id = $4
          AND poll_claim_id = $5
          AND poll_claim_expires_at_ms > $6
          AND consumed_at_ms IS NULL
          AND status IN ('pending_registration', 'credentials_received', 'configuring')
      `,
    values: [
      input.failureReasonCode,
      input.nowMs,
      input.nowMs,
      input.attemptId,
      input.claimId,
      input.nowMs,
    ],
  });
  const attempt = await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
  return Number(result.rowCount ?? 0) === 1
    ? { attempt, status: "failed" }
    : { attempt, status: "claim_lost" };
}
export async function rejectRemoteAgentLarkPlatformRegistrationAttempt(input: {
  attemptId: string;
  db: PostgresDatabase;
  failureReasonCode: string;
  nowMs: number;
}): Promise<RemoteAgentLarkPlatformRegistrationAttemptRecord | null> {
  const rejectAttempt = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts"
        SET
          status = 'repair_required',
          failure_reason_code = $1,
          consumed_at_ms = $2,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          updated_at_ms = $3
        WHERE attempt_id = $4
          AND consumed_at_ms IS NULL
          AND status IN ('pending_registration', 'credentials_received', 'configuring')
      `,
    values: [
      input.failureReasonCode,
      input.nowMs,
      input.nowMs,
      input.attemptId,
    ],
  };
  const requireConnectionRepair = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"
        SET
          status = 'repair_required',
          failure_reason_code = $1,
          updated_at_ms = $2
        WHERE status = 'configuring'
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts" attempt
            WHERE attempt.attempt_id = $3
              AND attempt.connection_id =
                "openMeldRemoteAgent_lark_platform_channel_connections".connection_id
              AND attempt.organization_id =
                "openMeldRemoteAgent_lark_platform_channel_connections".organization_id
              AND attempt.provider =
                "openMeldRemoteAgent_lark_platform_channel_connections".provider
              AND attempt.permission_bundle_version =
                "openMeldRemoteAgent_lark_platform_channel_connections".permission_bundle_version
              AND attempt.status = 'repair_required'
              AND attempt.consumed_at_ms = $4
              AND attempt.failure_reason_code = $5
          )
      `,
    values: [
      input.failureReasonCode,
      input.nowMs,
      input.attemptId,
      input.nowMs,
      input.failureReasonCode,
    ],
  };
  await input.db.transaction(
    async (client) =>
      [
        await client.query(rejectAttempt),
        await client.query(requireConnectionRepair),
      ] as const
  );
  return await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
}
export async function expireRemoteAgentLarkPlatformRegistrationAttempt(input: {
  attemptId: string;
  db: PostgresDatabase;
  nowMs: number;
}): Promise<RemoteAgentLarkPlatformRegistrationAttemptRecord | null> {
  const expireAttempt = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts"
        SET
          status = 'repair_required',
          failure_reason_code = provider || '.registration_expired',
          consumed_at_ms = $1,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          updated_at_ms = $2
        WHERE attempt_id = $3
          AND consumed_at_ms IS NULL
          AND expires_at_ms <= $4
          AND status IN ('pending_registration', 'credentials_received', 'configuring')
      `,
    values: [input.nowMs, input.nowMs, input.attemptId, input.nowMs],
  };
  const requireConnectionRepair = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"
        SET
          status = 'repair_required',
          failure_reason_code = (
            SELECT failure_reason_code
            FROM "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts" attempt
            WHERE attempt.attempt_id = $1
          ),
          updated_at_ms = $2
        WHERE status = 'configuring'
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts" attempt
            WHERE attempt.attempt_id = $3
              AND attempt.connection_id =
                "openMeldRemoteAgent_lark_platform_channel_connections".connection_id
              AND attempt.organization_id =
                "openMeldRemoteAgent_lark_platform_channel_connections".organization_id
              AND attempt.provider =
                "openMeldRemoteAgent_lark_platform_channel_connections".provider
              AND attempt.permission_bundle_version =
                "openMeldRemoteAgent_lark_platform_channel_connections".permission_bundle_version
              AND attempt.status = 'repair_required'
              AND attempt.consumed_at_ms = $4
              AND attempt.failure_reason_code =
                attempt.provider || '.registration_expired'
          )
      `,
    values: [input.attemptId, input.nowMs, input.attemptId, input.nowMs],
  };
  await input.db.transaction(
    async (client) =>
      [
        await client.query(expireAttempt),
        await client.query(requireConnectionRepair),
      ] as const
  );
  return await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
}
export async function recordRemoteAgentLarkPlatformWebhookReachability(input: {
  connectionId: string;
  encryptedVerificationToken: string | null;
  db: PostgresDatabase;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
  surface: RemoteAgentLarkPlatformWebhookSurface;
  verifiedAtMs: number;
}): Promise<RemoteAgentLarkPlatformChannelConnectionRecord | null> {
  const verificationColumn =
    input.surface === "events"
      ? "events_webhook_verified_at_ms"
      : "callbacks_webhook_verified_at_ms";
  const recordSurfaceEvidence = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"
        SET
          ${verificationColumn} = CASE
            WHEN ${verificationColumn} IS NULL OR ${verificationColumn} < $1
              THEN $2
            ELSE ${verificationColumn}
          END,
          updated_at_ms = CASE
            WHEN updated_at_ms < $3 THEN $4
            ELSE updated_at_ms
          END
        WHERE connection_id = $5
          AND organization_id = $6
          AND provider = $7
          AND transport = 'webhook'
          AND status IN ('configuring', 'connected')
          AND EXISTS (
            SELECT 1 FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_credentials" credentials
            WHERE credentials.connection_id = "openMeldRemoteAgent_lark_platform_channel_connections".connection_id
              AND credentials.encrypted_verification_token IS NOT DISTINCT FROM $8
          )
      `,
    values: [
      input.verifiedAtMs,
      input.verifiedAtMs,
      input.verifiedAtMs,
      input.verifiedAtMs,
      input.connectionId,
      input.organizationId,
      input.provider,
      input.encryptedVerificationToken,
    ],
  };
  const connectVerifiedWebhook = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"
        SET
          status = 'connected',
          last_verified_at_ms = CASE
            WHEN events_webhook_verified_at_ms >=
              callbacks_webhook_verified_at_ms
              THEN events_webhook_verified_at_ms
            ELSE callbacks_webhook_verified_at_ms
          END,
          failure_reason_code = NULL,
          updated_at_ms = CASE
            WHEN updated_at_ms < $1 THEN $2
            ELSE updated_at_ms
          END
        WHERE connection_id = $3
          AND organization_id = $4
          AND provider = $5
          AND transport = 'webhook'
          AND status IN ('configuring', 'connected')
          AND bot_open_id IS NOT NULL
          AND events_webhook_verified_at_ms IS NOT NULL
          AND callbacks_webhook_verified_at_ms IS NOT NULL
          AND (
            status = 'connected'
            OR EXISTS (
              SELECT 1
              FROM "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts" active_attempt
              WHERE active_attempt.connection_id =
                  "openMeldRemoteAgent_lark_platform_channel_connections".connection_id
                AND active_attempt.organization_id =
                  "openMeldRemoteAgent_lark_platform_channel_connections".organization_id
                AND active_attempt.provider =
                  "openMeldRemoteAgent_lark_platform_channel_connections".provider
                AND active_attempt.consumed_at_ms IS NULL
                AND active_attempt.expires_at_ms > $6
                AND active_attempt.status = 'configuring'
                AND events_webhook_verified_at_ms <
                  active_attempt.expires_at_ms
                AND callbacks_webhook_verified_at_ms <
                  active_attempt.expires_at_ms
            )
          )
      `,
    values: [
      input.verifiedAtMs,
      input.verifiedAtMs,
      input.connectionId,
      input.organizationId,
      input.provider,
      input.verifiedAtMs,
    ],
  };
  const completeAttempt = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts"
        SET
          status = 'connected',
          consumed_at_ms = $1,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          failure_reason_code = NULL,
          updated_at_ms = $2
        WHERE connection_id = $3
          AND organization_id = $4
          AND provider = $5
          AND consumed_at_ms IS NULL
          AND expires_at_ms > $6
          AND status = 'configuring'
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" connection
            WHERE connection.connection_id =
              "openMeldRemoteAgent_lark_platform_registration_attempts".connection_id
              AND connection.organization_id =
                "openMeldRemoteAgent_lark_platform_registration_attempts".organization_id
              AND connection.provider =
                "openMeldRemoteAgent_lark_platform_registration_attempts".provider
              AND connection.status = 'connected'
              AND connection.events_webhook_verified_at_ms IS NOT NULL
              AND connection.callbacks_webhook_verified_at_ms IS NOT NULL
              AND connection.events_webhook_verified_at_ms <
                "openMeldRemoteAgent_lark_platform_registration_attempts".expires_at_ms
              AND connection.callbacks_webhook_verified_at_ms <
                "openMeldRemoteAgent_lark_platform_registration_attempts".expires_at_ms
          )
      `,
    values: [
      input.verifiedAtMs,
      input.verifiedAtMs,
      input.connectionId,
      input.organizationId,
      input.provider,
      input.verifiedAtMs,
    ],
  };
  const [surfaceResult] = await input.db.transaction(
    async (client) =>
      [
        await client.query(recordSurfaceEvidence),
        await client.query(connectVerifiedWebhook),
        await client.query(completeAttempt),
      ] as const
  );
  if (Number(surfaceResult.rowCount ?? 0) !== 1) {
    return null;
  }
  return await readRemoteAgentLarkPlatformChannelConnection({
    connectionId: input.connectionId,
    db: input.db,
  });
}
export async function persistRemoteAgentLarkPlatformRegistrationCredentials(input: {
  appId: string;
  attemptId: string;
  claimId: string;
  connectionGeneration: number;
  connectionId: string;
  configurationExpiresAtMs: number;
  credentialFormatVersion: number;
  db: PostgresDatabase;
  encryptedAppSecret: string;
  encryptedEventEncryptKey: string | null;
  encryptedVerificationToken: string | null;
  nowMs: number;
  operatorOpenId: string;
  tenantKey: string | null;
  transport: RemoteAgentLarkPlatformTransport;
}): Promise<
  | {
      connection: RemoteAgentLarkPlatformChannelConnectionRecord;
      status: "persisted";
    }
  | {
      attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord | null;
      status: "claim_lost";
    }
> {
  const attempt = await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
  if (
    !attempt ||
    attempt.pollClaimId !== input.claimId ||
    attempt.pollClaimExpiresAtMs === null ||
    attempt.pollClaimExpiresAtMs <= input.nowMs ||
    attempt.consumedAtMs !== null ||
    attempt.expiresAtMs <= input.nowMs
  ) {
    return { attempt, status: "claim_lost" };
  }
  const connectionInsert = {
    text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" (
          connection_id,
          organization_id,
          provider,
          app_id,
          tenant_key,
          bot_open_id,
          bot_name,
          transport,
          status,
          installed_by_user_id,
          permission_bundle_version,
          granted_capability_groups_json,
          connection_generation,
          last_verified_at_ms,
          failure_reason_code,
          created_at_ms,
          updated_at_ms
        )
        SELECT
          $1,
          organization_id,
          provider,
          $2,
          $3,
          NULL,
          NULL,
          $4,
          'configuring',
          initiated_by_user_id,
          permission_bundle_version,
          '[]',
          $5,
          NULL,
          NULL,
          $6,
          $7
        FROM "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts"
        WHERE attempt_id = $8
          AND poll_claim_id = $9
          AND poll_claim_expires_at_ms > $10
          AND consumed_at_ms IS NULL
          AND expires_at_ms > $11
          AND (detected_brand IS NULL OR detected_brand = provider)
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."members"
            WHERE members.organization_id =
              "openMeldRemoteAgent_lark_platform_registration_attempts".organization_id
              AND members.user_id =
                "openMeldRemoteAgent_lark_platform_registration_attempts".initiated_by_user_id
          )
      `,
    values: [
      input.connectionId,
      input.appId,
      input.tenantKey,
      input.transport,
      input.connectionGeneration,
      input.nowMs,
      input.nowMs,
      input.attemptId,
      input.claimId,
      input.nowMs,
      input.nowMs,
    ],
  };
  const credentialsInsert = {
    text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_lark_platform_channel_credentials" (
          connection_id,
          encrypted_app_secret,
          encrypted_verification_token,
          encrypted_event_encrypt_key,
          credential_format_version,
          created_at_ms,
          updated_at_ms
        )
        SELECT $1, $2, $3, $4, $5, $6, $7
        FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" connection
        JOIN "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts" attempt
          ON attempt.attempt_id = $8
         AND attempt.poll_claim_id = $9
         AND attempt.poll_claim_expires_at_ms > $10
         AND attempt.consumed_at_ms IS NULL
        WHERE connection.connection_id = $11
          AND connection.organization_id = attempt.organization_id
          AND connection.provider = attempt.provider
          AND connection.created_at_ms = $12
      `,
    values: [
      input.connectionId,
      input.encryptedAppSecret,
      input.encryptedVerificationToken,
      input.encryptedEventEncryptKey,
      input.credentialFormatVersion,
      input.nowMs,
      input.nowMs,
      input.attemptId,
      input.claimId,
      input.nowMs,
      input.connectionId,
      input.nowMs,
    ],
  };
  const identityLinkInsert = {
    text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_lark_platform_identity_links" (
          provider,
          connection_id,
          provider_user_id,
          organization_id,
          openmeld_user_id,
          resolution_source,
          created_at_ms
        )
        SELECT
          connection.provider,
          connection.connection_id,
          $1,
          connection.organization_id,
          connection.installed_by_user_id,
          'installer',
          $2
        FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" connection
        INNER JOIN "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts" attempt
          ON attempt.attempt_id = $3
         AND attempt.poll_claim_id = $4
         AND attempt.poll_claim_expires_at_ms > $5
         AND attempt.consumed_at_ms IS NULL
        WHERE connection.connection_id = $6
          AND connection.organization_id = attempt.organization_id
          AND connection.provider = attempt.provider
          AND connection.installed_by_user_id = attempt.initiated_by_user_id
          AND connection.created_at_ms = $7
      `,
    values: [
      input.operatorOpenId,
      input.nowMs,
      input.attemptId,
      input.claimId,
      input.nowMs,
      input.connectionId,
      input.nowMs,
    ],
  };
  const advanceAttempt = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts"
        SET
          detected_brand = provider,
          connection_id = $1,
          status = 'configuring',
          expires_at_ms = $2,
          next_poll_at_ms = $3,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          failure_reason_code = NULL,
          updated_at_ms = $4
        WHERE attempt_id = $5
          AND poll_claim_id = $6
          AND poll_claim_expires_at_ms > $7
          AND consumed_at_ms IS NULL
          AND expires_at_ms > $8
          AND (detected_brand IS NULL OR detected_brand = provider)
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_credentials" credentials
            INNER JOIN "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" connection
              ON connection.connection_id = credentials.connection_id
            INNER JOIN "openmeld"."openMeldRemoteAgent_lark_platform_identity_links" identity_link
              ON identity_link.provider = connection.provider
             AND identity_link.connection_id = connection.connection_id
             AND identity_link.provider_user_id = $9
            WHERE credentials.connection_id = $10
              AND connection.organization_id =
                "openMeldRemoteAgent_lark_platform_registration_attempts".organization_id
              AND connection.provider =
                "openMeldRemoteAgent_lark_platform_registration_attempts".provider
              AND connection.installed_by_user_id =
                "openMeldRemoteAgent_lark_platform_registration_attempts".initiated_by_user_id
              AND connection.permission_bundle_version =
                "openMeldRemoteAgent_lark_platform_registration_attempts".permission_bundle_version
              AND connection.status = 'configuring'
              AND identity_link.organization_id = connection.organization_id
              AND identity_link.openmeld_user_id = connection.installed_by_user_id
              AND identity_link.resolution_source = 'installer'
              AND connection.created_at_ms = $11
          )
      `,
    values: [
      input.connectionId,
      input.configurationExpiresAtMs,
      input.nowMs,
      input.nowMs,
      input.attemptId,
      input.claimId,
      input.nowMs,
      input.nowMs,
      input.operatorOpenId,
      input.connectionId,
      input.nowMs,
    ],
  };
  const batchResults = await input.db.transaction(
    async (client) =>
      [
        await client.query(connectionInsert),
        await client.query(credentialsInsert),
        await client.query(identityLinkInsert),
        await client.query(advanceAttempt),
      ] as const
  );
  const [connection, credentials, completedAttempt] = await Promise.all([
    readRemoteAgentLarkPlatformChannelConnection({
      connectionId: input.connectionId,
      db: input.db,
    }),
    readRemoteAgentLarkPlatformChannelCredentials({
      connectionId: input.connectionId,
      db: input.db,
    }),
    readRemoteAgentLarkPlatformRegistrationAttempt({
      attemptId: input.attemptId,
      db: input.db,
    }),
  ]);
  if (
    batchResults.some((result) => Number(result.rowCount ?? 0) !== 1) ||
    !(connection && credentials && completedAttempt) ||
    completedAttempt.status !== "configuring" ||
    completedAttempt.consumedAtMs !== null ||
    connection.organizationId !== completedAttempt.organizationId ||
    connection.provider !== completedAttempt.provider ||
    connection.installedByUserId !== completedAttempt.initiatedByUserId ||
    connection.permissionBundleVersion !==
      completedAttempt.permissionBundleVersion
  ) {
    return { attempt: completedAttempt, status: "claim_lost" };
  }
  return { connection, status: "persisted" };
}
export async function completeRemoteAgentLarkPlatformRegistration(input: {
  attemptId: string;
  botName: string | null;
  botOpenId: string;
  claimId: string;
  connectionId: string;
  db: PostgresDatabase;
  grantedCapabilityGroups: readonly string[];
  nextPollAtMs: number;
  nowMs: number;
  pollIntervalMs?: number;
}): Promise<
  | {
      connection: RemoteAgentLarkPlatformChannelConnectionRecord;
      status: "completed";
    }
  | {
      attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord;
      connection: RemoteAgentLarkPlatformChannelConnectionRecord;
      status: "awaiting_webhook";
    }
  | {
      attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord | null;
      status: "claim_lost";
    }
> {
  const attempt = await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
  if (
    !attempt ||
    attempt.status !== "configuring" ||
    attempt.pollClaimId !== input.claimId ||
    attempt.pollClaimExpiresAtMs === null ||
    attempt.pollClaimExpiresAtMs <= input.nowMs ||
    attempt.consumedAtMs !== null ||
    attempt.expiresAtMs <= input.nowMs
  ) {
    return { attempt, status: "claim_lost" };
  }
  const capabilityGroupsJson = serializeGrantedCapabilityGroups(
    input.grantedCapabilityGroups
  );
  const pollIntervalMs = input.pollIntervalMs ?? attempt.pollIntervalMs;
  const connectionUpdate = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"
        SET
          bot_open_id = $1,
          bot_name = $2,
          status = CASE
            WHEN events_webhook_verified_at_ms IS NOT NULL
              AND callbacks_webhook_verified_at_ms IS NOT NULL
              AND events_webhook_verified_at_ms < $3
              AND callbacks_webhook_verified_at_ms < $4
              THEN 'connected'
            ELSE 'configuring'
          END,
          granted_capability_groups_json = $5,
          last_verified_at_ms = CASE
            WHEN events_webhook_verified_at_ms IS NOT NULL
              AND callbacks_webhook_verified_at_ms IS NOT NULL
              AND events_webhook_verified_at_ms < $6
              AND callbacks_webhook_verified_at_ms < $7
              AND events_webhook_verified_at_ms >=
                callbacks_webhook_verified_at_ms
              THEN events_webhook_verified_at_ms
            WHEN events_webhook_verified_at_ms IS NOT NULL
              AND callbacks_webhook_verified_at_ms IS NOT NULL
              AND events_webhook_verified_at_ms < $8
              AND callbacks_webhook_verified_at_ms < $9
              THEN callbacks_webhook_verified_at_ms
            ELSE last_verified_at_ms
          END,
          failure_reason_code = NULL,
          updated_at_ms = $10
        WHERE connection_id = $11
          AND organization_id = $12
          AND provider = $13
          AND permission_bundle_version = $14
          AND status = 'configuring'
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_credentials" credentials
            WHERE credentials.connection_id =
              "openMeldRemoteAgent_lark_platform_channel_connections".connection_id
          )
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts" active_attempt
            WHERE active_attempt.attempt_id = $15
              AND active_attempt.connection_id =
                "openMeldRemoteAgent_lark_platform_channel_connections".connection_id
              AND active_attempt.organization_id =
                "openMeldRemoteAgent_lark_platform_channel_connections".organization_id
              AND active_attempt.provider =
                "openMeldRemoteAgent_lark_platform_channel_connections".provider
              AND active_attempt.permission_bundle_version =
                "openMeldRemoteAgent_lark_platform_channel_connections".permission_bundle_version
              AND active_attempt.poll_claim_id = $16
              AND active_attempt.poll_claim_expires_at_ms > $17
              AND active_attempt.consumed_at_ms IS NULL
              AND active_attempt.expires_at_ms > $18
              AND active_attempt.status = 'configuring'
          )
      `,
    values: [
      input.botOpenId,
      input.botName,
      attempt.expiresAtMs,
      attempt.expiresAtMs,
      capabilityGroupsJson,
      attempt.expiresAtMs,
      attempt.expiresAtMs,
      attempt.expiresAtMs,
      attempt.expiresAtMs,
      input.nowMs,
      input.connectionId,
      attempt.organizationId,
      attempt.provider,
      attempt.permissionBundleVersion,
      input.attemptId,
      input.claimId,
      input.nowMs,
      input.nowMs,
    ],
  };
  const consumeAttempt = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts"
        SET
          status = CASE
            WHEN EXISTS (
              SELECT 1
              FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" connection
              WHERE connection.connection_id = $1
                AND connection.organization_id =
                  "openMeldRemoteAgent_lark_platform_registration_attempts".organization_id
                AND connection.provider =
                  "openMeldRemoteAgent_lark_platform_registration_attempts".provider
                AND connection.status = 'connected'
                AND connection.events_webhook_verified_at_ms IS NOT NULL
                AND connection.callbacks_webhook_verified_at_ms IS NOT NULL
                AND connection.events_webhook_verified_at_ms <
                  "openMeldRemoteAgent_lark_platform_registration_attempts".expires_at_ms
                AND connection.callbacks_webhook_verified_at_ms <
                  "openMeldRemoteAgent_lark_platform_registration_attempts".expires_at_ms
            ) THEN 'connected'
            ELSE 'configuring'
          END,
          consumed_at_ms = CASE
            WHEN EXISTS (
              SELECT 1
              FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" connection
              WHERE connection.connection_id = $2
                AND connection.organization_id =
                  "openMeldRemoteAgent_lark_platform_registration_attempts".organization_id
                AND connection.provider =
                  "openMeldRemoteAgent_lark_platform_registration_attempts".provider
                AND connection.status = 'connected'
                AND connection.events_webhook_verified_at_ms IS NOT NULL
                AND connection.callbacks_webhook_verified_at_ms IS NOT NULL
                AND connection.events_webhook_verified_at_ms <
                  "openMeldRemoteAgent_lark_platform_registration_attempts".expires_at_ms
                AND connection.callbacks_webhook_verified_at_ms <
                  "openMeldRemoteAgent_lark_platform_registration_attempts".expires_at_ms
            ) THEN $3::bigint
            ELSE NULL
          END,
          next_poll_at_ms = CASE
            WHEN EXISTS (
              SELECT 1
              FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" connection
              WHERE connection.connection_id = $4
                AND connection.organization_id =
                  "openMeldRemoteAgent_lark_platform_registration_attempts".organization_id
                AND connection.provider =
                  "openMeldRemoteAgent_lark_platform_registration_attempts".provider
                AND connection.status = 'connected'
                AND connection.events_webhook_verified_at_ms IS NOT NULL
                AND connection.callbacks_webhook_verified_at_ms IS NOT NULL
                AND connection.events_webhook_verified_at_ms <
                  "openMeldRemoteAgent_lark_platform_registration_attempts".expires_at_ms
                AND connection.callbacks_webhook_verified_at_ms <
                  "openMeldRemoteAgent_lark_platform_registration_attempts".expires_at_ms
            ) THEN next_poll_at_ms
            ELSE $5
          END,
          poll_interval_ms = $6,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          failure_reason_code = NULL,
          updated_at_ms = $7
        WHERE attempt_id = $8
          AND poll_claim_id = $9
          AND poll_claim_expires_at_ms > $10
          AND consumed_at_ms IS NULL
          AND expires_at_ms > $11
          AND status = 'configuring'
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" connection
            WHERE connection.connection_id = $12
              AND connection.organization_id =
                "openMeldRemoteAgent_lark_platform_registration_attempts".organization_id
              AND connection.provider =
                "openMeldRemoteAgent_lark_platform_registration_attempts".provider
              AND connection.permission_bundle_version =
                "openMeldRemoteAgent_lark_platform_registration_attempts".permission_bundle_version
              AND connection.status IN ('configuring', 'connected')
          )
      `,
    values: [
      input.connectionId,
      input.connectionId,
      input.nowMs,
      input.connectionId,
      input.nextPollAtMs,
      pollIntervalMs,
      input.nowMs,
      input.attemptId,
      input.claimId,
      input.nowMs,
      input.nowMs,
      input.connectionId,
    ],
  };
  const batchResults = await input.db.transaction(
    async (client) =>
      [
        await client.query(connectionUpdate),
        await client.query(consumeAttempt),
      ] as const
  );
  const [connection, completedAttempt] = await Promise.all([
    readRemoteAgentLarkPlatformChannelConnection({
      connectionId: input.connectionId,
      db: input.db,
    }),
    readRemoteAgentLarkPlatformRegistrationAttempt({
      attemptId: input.attemptId,
      db: input.db,
    }),
  ]);
  if (
    batchResults.some((result) => Number(result.rowCount ?? 0) !== 1) ||
    !connection ||
    !completedAttempt
  ) {
    return { attempt: completedAttempt, status: "claim_lost" };
  }
  if (
    completedAttempt.status === "connected" &&
    completedAttempt.consumedAtMs === input.nowMs &&
    connection.status === "connected" &&
    connection.lastVerifiedAtMs !== null &&
    connection.eventsWebhookVerifiedAtMs !== null &&
    connection.callbacksWebhookVerifiedAtMs !== null &&
    connection.eventsWebhookVerifiedAtMs < completedAttempt.expiresAtMs &&
    connection.callbacksWebhookVerifiedAtMs < completedAttempt.expiresAtMs
  ) {
    return { connection, status: "completed" };
  }
  if (
    completedAttempt.status === "configuring" &&
    completedAttempt.consumedAtMs === null &&
    completedAttempt.pollClaimId === null &&
    completedAttempt.pollClaimExpiresAtMs === null &&
    completedAttempt.nextPollAtMs === input.nextPollAtMs &&
    connection.status === "configuring"
  ) {
    return {
      attempt: completedAttempt,
      connection,
      status: "awaiting_webhook",
    };
  }
  return { attempt: completedAttempt, status: "claim_lost" };
}
function mapRegistrationAttemptRow(
  row: RemoteAgentLarkPlatformRegistrationAttemptRow
): RemoteAgentLarkPlatformRegistrationAttemptRecord {
  return {
    applicationVersionId: row.application_version_id,
    accountDomain: row.account_domain,
    attemptId: row.attempt_id,
    connectionId: row.connection_id,
    consumedAtMs: row.consumed_at_ms,
    createdAtMs: row.created_at_ms,
    detectedBrand: row.detected_brand,
    encryptedDeviceCode: row.encrypted_device_code,
    encryptedRegistrationUrl: row.encrypted_registration_url,
    expiresAtMs: row.expires_at_ms,
    failureReasonCode: row.failure_reason_code,
    initiatedByProfileId: row.initiated_by_profile_id,
    initiatedByUserId: row.initiated_by_user_id,
    nextPollAtMs: row.next_poll_at_ms,
    organizationId: row.organization_id,
    permissionBundleVersion: row.permission_bundle_version,
    permissionMode: row.permission_mode,
    pollClaimExpiresAtMs: row.poll_claim_expires_at_ms,
    pollClaimId: row.poll_claim_id,
    pollIntervalMs: row.poll_interval_ms,
    provider: row.provider,
    returnPath: row.return_path,
    status: row.status,
    updatedAtMs: row.updated_at_ms,
  };
}
function serializeGrantedCapabilityGroups(groups: readonly string[]): string {
  if (
    groups.length > 32 ||
    groups.some((group) => !CAPABILITY_GROUP_PATTERN.test(group)) ||
    new Set(groups).size !== groups.length
  ) {
    throw new Error("Granted capability groups are invalid");
  }
  return JSON.stringify(groups);
}
