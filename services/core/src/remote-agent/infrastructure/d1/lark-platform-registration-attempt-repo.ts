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
  FROM openMeldRemoteAgent_lark_platform_registration_attempts
`;

const CAPABILITY_GROUP_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

export async function recordClaimedLarkPlatformApplicationVersion(input: {
  attemptId: string;
  claimId: string;
  db: D1Database;
  nowMs: number;
  versionId: string;
}): Promise<void> {
  const result = await input.db
    .prepare(`
    UPDATE openMeldRemoteAgent_lark_platform_registration_attempts
    SET application_version_id = ?, updated_at_ms = ?
    WHERE attempt_id = ? AND poll_claim_id = ?
      AND poll_claim_expires_at_ms > ? AND expires_at_ms > ?
      AND consumed_at_ms IS NULL AND status = 'configuring'
      AND application_version_id IS NULL
  `)
    .bind(
      input.versionId,
      input.nowMs,
      input.attemptId,
      input.claimId,
      input.nowMs,
      input.nowMs
    )
    .run();
  if (result.meta.changes !== 1) {
    throw new Error("Lark-platform publication claim lost");
  }
}

type CreateRemoteAgentLarkPlatformRegistrationAttemptInput = {
  accountDomain: string;
  attemptId: string;
  db: D1Database;
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
  await prepareRegistrationAttemptInsert(input).run();
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
  const retirePrevious = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_lark_platform_registration_attempts
        SET
          status = 'repair_required',
          failure_reason_code = provider || '.registration_restarted',
          consumed_at_ms = ?,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE attempt_id = ?
          AND organization_id = ?
          AND provider = ?
          AND initiated_by_user_id = ?
          AND initiated_by_profile_id = ?
          AND consumed_at_ms IS NULL
          AND status = 'pending_registration'
      `
    )
    .bind(
      input.nowMs,
      input.nowMs,
      input.replacedAttemptId,
      input.organizationId,
      input.provider,
      input.initiatedByUserId,
      input.initiatedByProfileId
    );
  const [retireResult, insertResult] = await input.db.batch([
    retirePrevious,
    insertReplacement,
  ]);
  if (!(retireResult && insertResult)) {
    throw new Error(
      "Lark-platform registration replacement lost its batch result"
    );
  }
  const replaced =
    Number(insertResult.meta?.changes ?? 0) === 1 &&
    Number(retireResult.meta?.changes ?? 0) === 1;
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
  options: { onlyWhenNoActiveAttemptExists?: boolean } = {}
): D1PreparedStatement {
  const valuesSql =
    "?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, ?, ?, ?, 'pending_registration', NULL, NULL, ?, ?";
  const insertionSql = options.onlyWhenNoActiveAttemptExists
    ? `
        SELECT ${valuesSql}
        WHERE NOT EXISTS (
          SELECT 1
          FROM openMeldRemoteAgent_lark_platform_registration_attempts
          WHERE organization_id = ?
            AND provider = ?
            AND consumed_at_ms IS NULL
            AND status IN ('pending_registration', 'credentials_received', 'configuring')
        )
      `
    : `VALUES (${valuesSql})`;
  return input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_lark_platform_registration_attempts (
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
      `
    )
    .bind(
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
      ...(options.onlyWhenNoActiveAttemptExists
        ? [input.organizationId, input.provider]
        : [])
    );
}

export async function readRemoteAgentLarkPlatformRegistrationAttempt(input: {
  attemptId: string;
  db: D1Database;
}): Promise<RemoteAgentLarkPlatformRegistrationAttemptRecord | null> {
  const row = await input.db
    .prepare(`${REGISTRATION_SELECT} WHERE attempt_id = ? LIMIT 1`)
    .bind(input.attemptId)
    .first<RemoteAgentLarkPlatformRegistrationAttemptRow>();
  return row ? mapRegistrationAttemptRow(row) : null;
}

export async function readActiveRemoteAgentLarkPlatformRegistrationAttempt(input: {
  db: D1Database;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
}): Promise<RemoteAgentLarkPlatformRegistrationAttemptRecord | null> {
  const row = await input.db
    .prepare(
      `${REGISTRATION_SELECT}
       WHERE organization_id = ?
         AND provider = ?
         AND consumed_at_ms IS NULL
         AND status IN ('pending_registration', 'credentials_received', 'configuring')
       ORDER BY created_at_ms DESC
       LIMIT 1`
    )
    .bind(input.organizationId, input.provider)
    .first<RemoteAgentLarkPlatformRegistrationAttemptRow>();
  return row ? mapRegistrationAttemptRow(row) : null;
}

export async function listDueRemoteAgentLarkPlatformRegistrationAttempts(input: {
  db: D1Database;
  limit: number;
  nowMs: number;
}): Promise<RemoteAgentLarkPlatformRegistrationAttemptRecord[]> {
  if (!(Number.isInteger(input.limit) && input.limit > 0)) {
    throw new Error(
      "Lark-platform registration limit must be a positive integer"
    );
  }
  const rows = await input.db
    .prepare(
      `${REGISTRATION_SELECT}
       WHERE consumed_at_ms IS NULL
         AND status IN ('pending_registration', 'credentials_received', 'configuring')
         AND (next_poll_at_ms <= ? OR expires_at_ms <= ?)
         AND (
           poll_claim_id IS NULL
           OR poll_claim_expires_at_ms IS NULL
           OR poll_claim_expires_at_ms <= ?
         )
       ORDER BY next_poll_at_ms ASC, created_at_ms ASC, attempt_id ASC
       LIMIT ?`
    )
    .bind(input.nowMs, input.nowMs, input.nowMs, input.limit)
    .all<RemoteAgentLarkPlatformRegistrationAttemptRow>();
  return (rows.results ?? []).map(mapRegistrationAttemptRow);
}

export async function repairRemoteAgentLarkPlatformRegistrationAttempt(input: {
  attemptId: string;
  configurationExpiresAtMs: number;
  connectionId: string;
  db: D1Database;
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
    .prepare(
      `${REGISTRATION_SELECT}
       WHERE connection_id = ?
         AND organization_id = ?
         AND provider = ?
         AND consumed_at_ms IS NOT NULL
         AND status IN ('connected', 'repair_required')
       ORDER BY updated_at_ms DESC
       LIMIT 1`
    )
    .bind(input.connectionId, input.organizationId, input.provider)
    .first<RemoteAgentLarkPlatformRegistrationAttemptRow>();
  if (!candidate) {
    return null;
  }

  const createRepairAttempt = input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_lark_platform_registration_attempts (
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
          ?,
          previous.organization_id,
          ?,
          ?,
          previous.provider,
          previous.encrypted_device_code,
          previous.encrypted_registration_url,
          previous.account_domain,
          previous.detected_brand,
          previous.connection_id,
          ?,
          ?,
          ?,
          NULL,
          NULL,
          previous.permission_mode,
          previous.permission_bundle_version,
          previous.return_path,
          'configuring',
          NULL,
          NULL,
          ?,
          ?
        FROM openMeldRemoteAgent_lark_platform_registration_attempts previous
        INNER JOIN openMeldRemoteAgent_lark_platform_channel_connections connection
          ON connection.connection_id = previous.connection_id
         AND connection.organization_id = previous.organization_id
         AND connection.provider = previous.provider
        INNER JOIN openMeldRemoteAgent_lark_platform_channel_credentials credentials
          ON credentials.connection_id = connection.connection_id
        WHERE previous.attempt_id = ?
          AND previous.connection_id = ?
          AND previous.organization_id = ?
          AND previous.provider = ?
          AND previous.consumed_at_ms IS NOT NULL
          AND previous.status IN ('connected', 'repair_required')
          AND connection.status IN ('repair_required', 'revoked')
          AND NOT EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_lark_platform_registration_attempts active
            WHERE active.organization_id = ?
              AND active.provider = ?
              AND active.consumed_at_ms IS NULL
              AND active.status IN (
                'pending_registration',
                'credentials_received',
                'configuring'
              )
          )
      `
    )
    .bind(
      input.attemptId,
      input.initiatedByUserId,
      input.initiatedByProfileId,
      input.pollIntervalMs,
      input.nowMs,
      input.configurationExpiresAtMs,
      input.nowMs,
      input.nowMs,
      candidate.attempt_id,
      input.connectionId,
      input.organizationId,
      input.provider,
      input.organizationId,
      input.provider
    );
  const repairConnection = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_lark_platform_channel_connections
        SET
          status = 'configuring',
          bot_open_id = NULL,
          bot_name = NULL,
          granted_capability_groups_json = '[]',
          failure_reason_code = NULL,
          last_verified_at_ms = NULL,
          events_webhook_verified_at_ms = NULL,
          callbacks_webhook_verified_at_ms = NULL,
          updated_at_ms = ?
        WHERE connection_id = ?
          AND organization_id = ?
          AND provider = ?
          AND status IN ('repair_required', 'revoked')
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_lark_platform_registration_attempts attempt
            WHERE attempt.attempt_id = ?
              AND attempt.connection_id =
                openMeldRemoteAgent_lark_platform_channel_connections.connection_id
              AND attempt.organization_id =
                openMeldRemoteAgent_lark_platform_channel_connections.organization_id
              AND attempt.provider =
                openMeldRemoteAgent_lark_platform_channel_connections.provider
              AND attempt.status = 'configuring'
              AND attempt.consumed_at_ms IS NULL
              AND attempt.expires_at_ms = ?
          )
      `
    )
    .bind(
      input.nowMs,
      input.connectionId,
      input.organizationId,
      input.provider,
      input.attemptId,
      input.configurationExpiresAtMs
    );
  const [attemptResult, connectionResult] = await input.db.batch([
    createRepairAttempt,
    repairConnection,
  ]);
  if (
    Number(attemptResult?.meta?.changes ?? 0) !== 1 ||
    Number(connectionResult?.meta?.changes ?? 0) !== 1
  ) {
    return null;
  }
  return await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
}

export async function replaceClaimedLarkPlatformCallbackCredentials(input: {
  attemptId: string;
  claimId: string;
  connectionId: string;
  db: D1Database;
  encryptedEventEncryptKey: string;
  encryptedVerificationToken: string;
  previousEncryptedEventEncryptKey: string | null;
  previousEncryptedVerificationToken: string | null;
  nowMs: number;
}): Promise<boolean> {
  const replaceCredentials = input.db
    .prepare(`
    UPDATE openMeldRemoteAgent_lark_platform_channel_credentials
    SET encrypted_event_encrypt_key = ?, encrypted_verification_token = ?, updated_at_ms = ?
    WHERE connection_id = ?
      AND encrypted_event_encrypt_key = ? AND encrypted_verification_token = ?
      AND EXISTS (
        SELECT 1 FROM openMeldRemoteAgent_lark_platform_registration_attempts attempt
        JOIN openMeldRemoteAgent_lark_platform_channel_connections connection
          ON connection.connection_id = attempt.connection_id
          AND connection.organization_id = attempt.organization_id
          AND connection.provider = attempt.provider
        WHERE attempt.attempt_id = ? AND attempt.connection_id = ?
          AND attempt.poll_claim_id = ? AND attempt.poll_claim_expires_at_ms > ?
          AND attempt.expires_at_ms > ? AND attempt.consumed_at_ms IS NULL
          AND attempt.status = 'configuring' AND connection.status = 'configuring'
          AND connection.bot_open_id IS NULL
      )
  `)
    .bind(
      input.encryptedEventEncryptKey,
      input.encryptedVerificationToken,
      input.nowMs,
      input.connectionId,
      input.previousEncryptedEventEncryptKey,
      input.previousEncryptedVerificationToken,
      input.attemptId,
      input.connectionId,
      input.claimId,
      input.nowMs,
      input.nowMs
    );
  // Only the successful preceding replacement may invalidate proof in this transaction.
  const clearProofs = input.db
    .prepare(`
    UPDATE openMeldRemoteAgent_lark_platform_channel_connections
    SET events_webhook_verified_at_ms = NULL, callbacks_webhook_verified_at_ms = NULL,
      last_verified_at_ms = NULL, updated_at_ms = ?
    WHERE connection_id = ? AND status = 'configuring' AND bot_open_id IS NULL
      AND changes() = 1
      AND EXISTS (
        SELECT 1 FROM openMeldRemoteAgent_lark_platform_channel_credentials credentials
        WHERE credentials.connection_id = openMeldRemoteAgent_lark_platform_channel_connections.connection_id
          AND credentials.encrypted_event_encrypt_key = ?
          AND credentials.encrypted_verification_token = ?
      )
  `)
    .bind(
      input.nowMs,
      input.connectionId,
      input.encryptedEventEncryptKey,
      input.encryptedVerificationToken
    );
  const [credentialsResult, proofsResult] = await input.db.batch([
    replaceCredentials,
    clearProofs,
  ]);
  return (
    Number(credentialsResult?.meta?.changes ?? 0) === 1 &&
    Number(proofsResult?.meta?.changes ?? 0) === 1
  );
}

export async function claimRemoteAgentLarkPlatformRegistrationAttempt(input: {
  attemptId: string;
  claimExpiresAtMs: number;
  claimId: string;
  db: D1Database;
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
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_lark_platform_registration_attempts
        SET
          poll_claim_id = ?,
          poll_claim_expires_at_ms = ?,
          updated_at_ms = ?
        WHERE attempt_id = ?
          AND consumed_at_ms IS NULL
          AND status IN ('pending_registration', 'credentials_received', 'configuring')
          AND next_poll_at_ms <= ?
          AND expires_at_ms > ?
          AND (
            poll_claim_id IS NULL
            OR poll_claim_expires_at_ms IS NULL
            OR poll_claim_expires_at_ms <= ?
          )
      `
    )
    .bind(
      input.claimId,
      input.claimExpiresAtMs,
      input.nowMs,
      input.attemptId,
      input.nowMs,
      input.nowMs,
      input.nowMs
    )
    .run();
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
  db: D1Database;
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
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_lark_platform_registration_attempts
        SET
          account_domain = ?,
          detected_brand = COALESCE(?, detected_brand),
          poll_interval_ms = ?,
          next_poll_at_ms = ?,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          status = ?,
          failure_reason_code = ?,
          updated_at_ms = ?
        WHERE attempt_id = ?
          AND poll_claim_id = ?
          AND poll_claim_expires_at_ms > ?
          AND consumed_at_ms IS NULL
          AND expires_at_ms > ?
          AND (? IS NULL OR ? = provider)
      `
    )
    .bind(
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
      input.detectedBrand
    )
    .run();
  const attempt = await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
  return Number(result.meta?.changes ?? 0) === 1
    ? { attempt, status: "advanced" }
    : { attempt, status: "claim_lost" };
}

export async function failRemoteAgentLarkPlatformRegistrationAttempt(input: {
  attemptId: string;
  claimId: string;
  db: D1Database;
  failureReasonCode: string;
  nowMs: number;
}): Promise<{
  attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord | null;
  status: "claim_lost" | "failed";
}> {
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_lark_platform_registration_attempts
        SET
          status = 'repair_required',
          failure_reason_code = ?,
          consumed_at_ms = ?,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE attempt_id = ?
          AND poll_claim_id = ?
          AND poll_claim_expires_at_ms > ?
          AND consumed_at_ms IS NULL
          AND status IN ('pending_registration', 'credentials_received', 'configuring')
      `
    )
    .bind(
      input.failureReasonCode,
      input.nowMs,
      input.nowMs,
      input.attemptId,
      input.claimId,
      input.nowMs
    )
    .run();
  const attempt = await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
  return Number(result.meta?.changes ?? 0) === 1
    ? { attempt, status: "failed" }
    : { attempt, status: "claim_lost" };
}

export async function rejectRemoteAgentLarkPlatformRegistrationAttempt(input: {
  attemptId: string;
  db: D1Database;
  failureReasonCode: string;
  nowMs: number;
}): Promise<RemoteAgentLarkPlatformRegistrationAttemptRecord | null> {
  const rejectAttempt = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_lark_platform_registration_attempts
        SET
          status = 'repair_required',
          failure_reason_code = ?,
          consumed_at_ms = ?,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE attempt_id = ?
          AND consumed_at_ms IS NULL
          AND status IN ('pending_registration', 'credentials_received', 'configuring')
      `
    )
    .bind(input.failureReasonCode, input.nowMs, input.nowMs, input.attemptId);
  const requireConnectionRepair = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_lark_platform_channel_connections
        SET
          status = 'repair_required',
          failure_reason_code = ?,
          updated_at_ms = ?
        WHERE status = 'configuring'
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_lark_platform_registration_attempts attempt
            WHERE attempt.attempt_id = ?
              AND attempt.connection_id =
                openMeldRemoteAgent_lark_platform_channel_connections.connection_id
              AND attempt.organization_id =
                openMeldRemoteAgent_lark_platform_channel_connections.organization_id
              AND attempt.provider =
                openMeldRemoteAgent_lark_platform_channel_connections.provider
              AND attempt.permission_bundle_version =
                openMeldRemoteAgent_lark_platform_channel_connections.permission_bundle_version
              AND attempt.status = 'repair_required'
              AND attempt.consumed_at_ms = ?
              AND attempt.failure_reason_code = ?
          )
      `
    )
    .bind(
      input.failureReasonCode,
      input.nowMs,
      input.attemptId,
      input.nowMs,
      input.failureReasonCode
    );
  await input.db.batch([rejectAttempt, requireConnectionRepair]);
  return await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
}

export async function expireRemoteAgentLarkPlatformRegistrationAttempt(input: {
  attemptId: string;
  db: D1Database;
  nowMs: number;
}): Promise<RemoteAgentLarkPlatformRegistrationAttemptRecord | null> {
  const expireAttempt = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_lark_platform_registration_attempts
        SET
          status = 'repair_required',
          failure_reason_code = provider || '.registration_expired',
          consumed_at_ms = ?,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE attempt_id = ?
          AND consumed_at_ms IS NULL
          AND expires_at_ms <= ?
          AND status IN ('pending_registration', 'credentials_received', 'configuring')
      `
    )
    .bind(input.nowMs, input.nowMs, input.attemptId, input.nowMs);
  const requireConnectionRepair = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_lark_platform_channel_connections
        SET
          status = 'repair_required',
          failure_reason_code = (
            SELECT failure_reason_code
            FROM openMeldRemoteAgent_lark_platform_registration_attempts attempt
            WHERE attempt.attempt_id = ?
          ),
          updated_at_ms = ?
        WHERE status = 'configuring'
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_lark_platform_registration_attempts attempt
            WHERE attempt.attempt_id = ?
              AND attempt.connection_id =
                openMeldRemoteAgent_lark_platform_channel_connections.connection_id
              AND attempt.organization_id =
                openMeldRemoteAgent_lark_platform_channel_connections.organization_id
              AND attempt.provider =
                openMeldRemoteAgent_lark_platform_channel_connections.provider
              AND attempt.permission_bundle_version =
                openMeldRemoteAgent_lark_platform_channel_connections.permission_bundle_version
              AND attempt.status = 'repair_required'
              AND attempt.consumed_at_ms = ?
              AND attempt.failure_reason_code =
                attempt.provider || '.registration_expired'
          )
      `
    )
    .bind(input.attemptId, input.nowMs, input.attemptId, input.nowMs);
  await input.db.batch([expireAttempt, requireConnectionRepair]);
  return await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
}

export async function recordRemoteAgentLarkPlatformWebhookReachability(input: {
  connectionId: string;
  encryptedVerificationToken: string | null;
  db: D1Database;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
  surface: RemoteAgentLarkPlatformWebhookSurface;
  verifiedAtMs: number;
}): Promise<RemoteAgentLarkPlatformChannelConnectionRecord | null> {
  const verificationColumn =
    input.surface === "events"
      ? "events_webhook_verified_at_ms"
      : "callbacks_webhook_verified_at_ms";
  const recordSurfaceEvidence = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_lark_platform_channel_connections
        SET
          ${verificationColumn} = CASE
            WHEN ${verificationColumn} IS NULL OR ${verificationColumn} < ?
              THEN ?
            ELSE ${verificationColumn}
          END,
          updated_at_ms = CASE
            WHEN updated_at_ms < ? THEN ?
            ELSE updated_at_ms
          END
        WHERE connection_id = ?
          AND organization_id = ?
          AND provider = ?
          AND transport = 'webhook'
          AND status IN ('configuring', 'connected')
          AND EXISTS (
            SELECT 1 FROM openMeldRemoteAgent_lark_platform_channel_credentials credentials
            WHERE credentials.connection_id = openMeldRemoteAgent_lark_platform_channel_connections.connection_id
              AND credentials.encrypted_verification_token IS ?
          )
      `
    )
    .bind(
      input.verifiedAtMs,
      input.verifiedAtMs,
      input.verifiedAtMs,
      input.verifiedAtMs,
      input.connectionId,
      input.organizationId,
      input.provider,
      input.encryptedVerificationToken
    );
  const connectVerifiedWebhook = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_lark_platform_channel_connections
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
            WHEN updated_at_ms < ? THEN ?
            ELSE updated_at_ms
          END
        WHERE connection_id = ?
          AND organization_id = ?
          AND provider = ?
          AND transport = 'webhook'
          AND status IN ('configuring', 'connected')
          AND bot_open_id IS NOT NULL
          AND events_webhook_verified_at_ms IS NOT NULL
          AND callbacks_webhook_verified_at_ms IS NOT NULL
          AND (
            status = 'connected'
            OR EXISTS (
              SELECT 1
              FROM openMeldRemoteAgent_lark_platform_registration_attempts active_attempt
              WHERE active_attempt.connection_id =
                  openMeldRemoteAgent_lark_platform_channel_connections.connection_id
                AND active_attempt.organization_id =
                  openMeldRemoteAgent_lark_platform_channel_connections.organization_id
                AND active_attempt.provider =
                  openMeldRemoteAgent_lark_platform_channel_connections.provider
                AND active_attempt.consumed_at_ms IS NULL
                AND active_attempt.expires_at_ms > ?
                AND active_attempt.status = 'configuring'
                AND events_webhook_verified_at_ms <
                  active_attempt.expires_at_ms
                AND callbacks_webhook_verified_at_ms <
                  active_attempt.expires_at_ms
            )
          )
      `
    )
    .bind(
      input.verifiedAtMs,
      input.verifiedAtMs,
      input.connectionId,
      input.organizationId,
      input.provider,
      input.verifiedAtMs
    );
  const completeAttempt = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_lark_platform_registration_attempts
        SET
          status = 'connected',
          consumed_at_ms = ?,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          failure_reason_code = NULL,
          updated_at_ms = ?
        WHERE connection_id = ?
          AND organization_id = ?
          AND provider = ?
          AND consumed_at_ms IS NULL
          AND expires_at_ms > ?
          AND status = 'configuring'
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_lark_platform_channel_connections connection
            WHERE connection.connection_id =
              openMeldRemoteAgent_lark_platform_registration_attempts.connection_id
              AND connection.organization_id =
                openMeldRemoteAgent_lark_platform_registration_attempts.organization_id
              AND connection.provider =
                openMeldRemoteAgent_lark_platform_registration_attempts.provider
              AND connection.status = 'connected'
              AND connection.events_webhook_verified_at_ms IS NOT NULL
              AND connection.callbacks_webhook_verified_at_ms IS NOT NULL
              AND connection.events_webhook_verified_at_ms <
                openMeldRemoteAgent_lark_platform_registration_attempts.expires_at_ms
              AND connection.callbacks_webhook_verified_at_ms <
                openMeldRemoteAgent_lark_platform_registration_attempts.expires_at_ms
          )
      `
    )
    .bind(
      input.verifiedAtMs,
      input.verifiedAtMs,
      input.connectionId,
      input.organizationId,
      input.provider,
      input.verifiedAtMs
    );
  const [surfaceResult] = await input.db.batch([
    recordSurfaceEvidence,
    connectVerifiedWebhook,
    completeAttempt,
  ]);
  if (Number(surfaceResult?.meta?.changes ?? 0) !== 1) {
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
  db: D1Database;
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
  const connectionInsert = input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_lark_platform_channel_connections (
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
          ?,
          organization_id,
          provider,
          ?,
          ?,
          NULL,
          NULL,
          ?,
          'configuring',
          initiated_by_user_id,
          permission_bundle_version,
          '[]',
          ?,
          NULL,
          NULL,
          ?,
          ?
        FROM openMeldRemoteAgent_lark_platform_registration_attempts
        WHERE attempt_id = ?
          AND poll_claim_id = ?
          AND poll_claim_expires_at_ms > ?
          AND consumed_at_ms IS NULL
          AND expires_at_ms > ?
          AND (detected_brand IS NULL OR detected_brand = provider)
          AND EXISTS (
            SELECT 1
            FROM members
            WHERE members.organization_id =
              openMeldRemoteAgent_lark_platform_registration_attempts.organization_id
              AND members.user_id =
                openMeldRemoteAgent_lark_platform_registration_attempts.initiated_by_user_id
          )
      `
    )
    .bind(
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
      input.nowMs
    );
  const credentialsInsert = input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_lark_platform_channel_credentials (
          connection_id,
          encrypted_app_secret,
          encrypted_verification_token,
          encrypted_event_encrypt_key,
          credential_format_version,
          created_at_ms,
          updated_at_ms
        )
        SELECT ?, ?, ?, ?, ?, ?, ?
        FROM openMeldRemoteAgent_lark_platform_channel_connections connection
        JOIN openMeldRemoteAgent_lark_platform_registration_attempts attempt
          ON attempt.attempt_id = ?
         AND attempt.poll_claim_id = ?
         AND attempt.poll_claim_expires_at_ms > ?
         AND attempt.consumed_at_ms IS NULL
        WHERE connection.connection_id = ?
          AND connection.organization_id = attempt.organization_id
          AND connection.provider = attempt.provider
          AND connection.created_at_ms = ?
      `
    )
    .bind(
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
      input.nowMs
    );
  const identityLinkInsert = input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_lark_platform_identity_links (
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
          ?,
          connection.organization_id,
          connection.installed_by_user_id,
          'installer',
          ?
        FROM openMeldRemoteAgent_lark_platform_channel_connections connection
        INNER JOIN openMeldRemoteAgent_lark_platform_registration_attempts attempt
          ON attempt.attempt_id = ?
         AND attempt.poll_claim_id = ?
         AND attempt.poll_claim_expires_at_ms > ?
         AND attempt.consumed_at_ms IS NULL
        WHERE connection.connection_id = ?
          AND connection.organization_id = attempt.organization_id
          AND connection.provider = attempt.provider
          AND connection.installed_by_user_id = attempt.initiated_by_user_id
          AND connection.created_at_ms = ?
      `
    )
    .bind(
      input.operatorOpenId,
      input.nowMs,
      input.attemptId,
      input.claimId,
      input.nowMs,
      input.connectionId,
      input.nowMs
    );
  const advanceAttempt = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_lark_platform_registration_attempts
        SET
          detected_brand = provider,
          connection_id = ?,
          status = 'configuring',
          expires_at_ms = ?,
          next_poll_at_ms = ?,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          failure_reason_code = NULL,
          updated_at_ms = ?
        WHERE attempt_id = ?
          AND poll_claim_id = ?
          AND poll_claim_expires_at_ms > ?
          AND consumed_at_ms IS NULL
          AND expires_at_ms > ?
          AND (detected_brand IS NULL OR detected_brand = provider)
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_lark_platform_channel_credentials credentials
            INNER JOIN openMeldRemoteAgent_lark_platform_channel_connections connection
              ON connection.connection_id = credentials.connection_id
            INNER JOIN openMeldRemoteAgent_lark_platform_identity_links identity_link
              ON identity_link.provider = connection.provider
             AND identity_link.connection_id = connection.connection_id
             AND identity_link.provider_user_id = ?
            WHERE credentials.connection_id = ?
              AND connection.organization_id =
                openMeldRemoteAgent_lark_platform_registration_attempts.organization_id
              AND connection.provider =
                openMeldRemoteAgent_lark_platform_registration_attempts.provider
              AND connection.installed_by_user_id =
                openMeldRemoteAgent_lark_platform_registration_attempts.initiated_by_user_id
              AND connection.permission_bundle_version =
                openMeldRemoteAgent_lark_platform_registration_attempts.permission_bundle_version
              AND connection.status = 'configuring'
              AND identity_link.organization_id = connection.organization_id
              AND identity_link.openmeld_user_id = connection.installed_by_user_id
              AND identity_link.resolution_source = 'installer'
              AND connection.created_at_ms = ?
          )
      `
    )
    .bind(
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
      input.nowMs
    );

  const batchResults = await input.db.batch([
    connectionInsert,
    credentialsInsert,
    identityLinkInsert,
    advanceAttempt,
  ]);
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
    batchResults.some((result) => Number(result.meta?.changes ?? 0) !== 1) ||
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
  db: D1Database;
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
  const connectionUpdate = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_lark_platform_channel_connections
        SET
          bot_open_id = ?,
          bot_name = ?,
          status = CASE
            WHEN events_webhook_verified_at_ms IS NOT NULL
              AND callbacks_webhook_verified_at_ms IS NOT NULL
              AND events_webhook_verified_at_ms < ?
              AND callbacks_webhook_verified_at_ms < ?
              THEN 'connected'
            ELSE 'configuring'
          END,
          granted_capability_groups_json = ?,
          last_verified_at_ms = CASE
            WHEN events_webhook_verified_at_ms IS NOT NULL
              AND callbacks_webhook_verified_at_ms IS NOT NULL
              AND events_webhook_verified_at_ms < ?
              AND callbacks_webhook_verified_at_ms < ?
              AND events_webhook_verified_at_ms >=
                callbacks_webhook_verified_at_ms
              THEN events_webhook_verified_at_ms
            WHEN events_webhook_verified_at_ms IS NOT NULL
              AND callbacks_webhook_verified_at_ms IS NOT NULL
              AND events_webhook_verified_at_ms < ?
              AND callbacks_webhook_verified_at_ms < ?
              THEN callbacks_webhook_verified_at_ms
            ELSE last_verified_at_ms
          END,
          failure_reason_code = NULL,
          updated_at_ms = ?
        WHERE connection_id = ?
          AND organization_id = ?
          AND provider = ?
          AND permission_bundle_version = ?
          AND status = 'configuring'
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_lark_platform_channel_credentials credentials
            WHERE credentials.connection_id =
              openMeldRemoteAgent_lark_platform_channel_connections.connection_id
          )
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_lark_platform_registration_attempts active_attempt
            WHERE active_attempt.attempt_id = ?
              AND active_attempt.connection_id =
                openMeldRemoteAgent_lark_platform_channel_connections.connection_id
              AND active_attempt.organization_id =
                openMeldRemoteAgent_lark_platform_channel_connections.organization_id
              AND active_attempt.provider =
                openMeldRemoteAgent_lark_platform_channel_connections.provider
              AND active_attempt.permission_bundle_version =
                openMeldRemoteAgent_lark_platform_channel_connections.permission_bundle_version
              AND active_attempt.poll_claim_id = ?
              AND active_attempt.poll_claim_expires_at_ms > ?
              AND active_attempt.consumed_at_ms IS NULL
              AND active_attempt.expires_at_ms > ?
              AND active_attempt.status = 'configuring'
          )
      `
    )
    .bind(
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
      input.nowMs
    );
  const consumeAttempt = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_lark_platform_registration_attempts
        SET
          status = CASE
            WHEN EXISTS (
              SELECT 1
              FROM openMeldRemoteAgent_lark_platform_channel_connections connection
              WHERE connection.connection_id = ?
                AND connection.organization_id =
                  openMeldRemoteAgent_lark_platform_registration_attempts.organization_id
                AND connection.provider =
                  openMeldRemoteAgent_lark_platform_registration_attempts.provider
                AND connection.status = 'connected'
                AND connection.events_webhook_verified_at_ms IS NOT NULL
                AND connection.callbacks_webhook_verified_at_ms IS NOT NULL
                AND connection.events_webhook_verified_at_ms <
                  openMeldRemoteAgent_lark_platform_registration_attempts.expires_at_ms
                AND connection.callbacks_webhook_verified_at_ms <
                  openMeldRemoteAgent_lark_platform_registration_attempts.expires_at_ms
            ) THEN 'connected'
            ELSE 'configuring'
          END,
          consumed_at_ms = CASE
            WHEN EXISTS (
              SELECT 1
              FROM openMeldRemoteAgent_lark_platform_channel_connections connection
              WHERE connection.connection_id = ?
                AND connection.organization_id =
                  openMeldRemoteAgent_lark_platform_registration_attempts.organization_id
                AND connection.provider =
                  openMeldRemoteAgent_lark_platform_registration_attempts.provider
                AND connection.status = 'connected'
                AND connection.events_webhook_verified_at_ms IS NOT NULL
                AND connection.callbacks_webhook_verified_at_ms IS NOT NULL
                AND connection.events_webhook_verified_at_ms <
                  openMeldRemoteAgent_lark_platform_registration_attempts.expires_at_ms
                AND connection.callbacks_webhook_verified_at_ms <
                  openMeldRemoteAgent_lark_platform_registration_attempts.expires_at_ms
            ) THEN ?
            ELSE NULL
          END,
          next_poll_at_ms = CASE
            WHEN EXISTS (
              SELECT 1
              FROM openMeldRemoteAgent_lark_platform_channel_connections connection
              WHERE connection.connection_id = ?
                AND connection.organization_id =
                  openMeldRemoteAgent_lark_platform_registration_attempts.organization_id
                AND connection.provider =
                  openMeldRemoteAgent_lark_platform_registration_attempts.provider
                AND connection.status = 'connected'
                AND connection.events_webhook_verified_at_ms IS NOT NULL
                AND connection.callbacks_webhook_verified_at_ms IS NOT NULL
                AND connection.events_webhook_verified_at_ms <
                  openMeldRemoteAgent_lark_platform_registration_attempts.expires_at_ms
                AND connection.callbacks_webhook_verified_at_ms <
                  openMeldRemoteAgent_lark_platform_registration_attempts.expires_at_ms
            ) THEN next_poll_at_ms
            ELSE ?
          END,
          poll_interval_ms = ?,
          poll_claim_id = NULL,
          poll_claim_expires_at_ms = NULL,
          failure_reason_code = NULL,
          updated_at_ms = ?
        WHERE attempt_id = ?
          AND poll_claim_id = ?
          AND poll_claim_expires_at_ms > ?
          AND consumed_at_ms IS NULL
          AND expires_at_ms > ?
          AND status = 'configuring'
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_lark_platform_channel_connections connection
            WHERE connection.connection_id = ?
              AND connection.organization_id =
                openMeldRemoteAgent_lark_platform_registration_attempts.organization_id
              AND connection.provider =
                openMeldRemoteAgent_lark_platform_registration_attempts.provider
              AND connection.permission_bundle_version =
                openMeldRemoteAgent_lark_platform_registration_attempts.permission_bundle_version
              AND connection.status IN ('configuring', 'connected')
          )
      `
    )
    .bind(
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
      input.connectionId
    );
  const batchResults = await input.db.batch([connectionUpdate, consumeAttempt]);
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
    batchResults.some((result) => Number(result.meta?.changes ?? 0) !== 1) ||
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
