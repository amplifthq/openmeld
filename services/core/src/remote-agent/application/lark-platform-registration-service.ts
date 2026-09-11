import {
  larkPlatformActiveRegistrationProjectionSchema,
  larkPlatformRegistrationResponseSchema,
  type MessageChannelConnectionProjection,
} from "@openmeld/schemas";
import type {
  LarkPlatformActiveRegistrationProjection,
  LarkPlatformRegistrationResponse,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import {
  deleteDisconnectedRemoteAgentLarkPlatformChannelConnection,
  disconnectRemoteAgentLarkPlatformChannelConnection,
  type RemoteAgentLarkPlatformChannelConnectionRecord,
  type RemoteAgentLarkPlatformProvider,
  readRemoteAgentLarkPlatformChannelConnection,
  readRemoteAgentLarkPlatformChannelConnectionForOrganization,
  readRemoteAgentLarkPlatformChannelCredentials,
} from "../infrastructure/d1/lark-platform-channel-connection-repo";
import {
  completeLarkPlatformPersistentRegistration,
  prepareLarkPlatformPersistentConnection,
} from "../infrastructure/d1/lark-platform-persistent-registration-repo";
import {
  advanceRemoteAgentLarkPlatformRegistrationAttempt,
  claimRemoteAgentLarkPlatformRegistrationAttempt,
  createRemoteAgentLarkPlatformRegistrationAttempt,
  expireRemoteAgentLarkPlatformRegistrationAttempt,
  failRemoteAgentLarkPlatformRegistrationAttempt,
  persistRemoteAgentLarkPlatformRegistrationCredentials,
  type RemoteAgentLarkPlatformRegistrationAttemptRecord,
  readActiveRemoteAgentLarkPlatformRegistrationAttempt,
  readRemoteAgentLarkPlatformRegistrationAttempt,
  recordClaimedLarkPlatformApplicationVersion,
  repairRemoteAgentLarkPlatformRegistrationAttempt,
  replacePendingRemoteAgentLarkPlatformRegistrationAttempt,
} from "../infrastructure/d1/lark-platform-registration-attempt-repo";
import { configureAndVerifyLarkPlatformPersistentApp } from "./lark-platform-app-configuration";
import {
  decryptLarkPlatformCredential,
  encryptLarkPlatformCredential,
  LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION,
} from "./lark-platform-credential-crypto";
import { LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE } from "./lark-platform-permission-bundles";
import { isLarkPlatformProviderEnabledForOrganization } from "./lark-platform-provider-policy";
import {
  beginLarkPlatformRegistration,
  LarkPlatformRegistrationError,
  pollLarkPlatformRegistration,
} from "./lark-platform-registration-client";
import { projectRemoteAgentLarkPlatformConnection } from "./message-channel-connection-projection";

const REGISTRATION_CLAIM_TTL_MS = 30_000;
export const LARK_PLATFORM_REGISTRATION_PROVIDER_REQUEST_TIMEOUT_MS = 20_000;
const REGISTRATION_RETRY_DELAY_MS = 5000;
const REGISTRATION_MAX_RETRY_DELAY_MS = 5 * 60 * 1000;
const LARK_PLATFORM_CONFIGURATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REGISTRATION_RETURN_PATH = "/center-agent/channels";

type RegistrationActor = {
  organizationId: string;
  profileId: string;
  userId: string;
};

export type RegistrationEnvironment = Pick<
  CoreBindings,
  | "OPENMELD_FEISHU_CHANNEL_ENABLED"
  | "OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS"
  | "OPENMELD_LARK_CHANNEL_CONNECTOR"
  | "OPENMELD_LARK_CHANNEL_ENABLED"
  | "OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS"
  | "LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY"
>;

export class LarkPlatformRegistrationServiceError extends Error {
  readonly reasonCode: string;
  readonly status: number;

  constructor(input: { reasonCode: string; status: number }) {
    super(input.reasonCode);
    this.name = "LarkPlatformRegistrationServiceError";
    this.reasonCode = input.reasonCode;
    this.status = input.status;
  }
}

export async function beginRemoteAgentLarkPlatformRegistration(input: {
  actor: RegistrationActor;
  createId?: () => string;
  db: D1Database;
  env: RegistrationEnvironment;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  provider: RemoteAgentLarkPlatformProvider;
  repairExisting?: boolean;
  reauthorize?: boolean;
  restartPending?: boolean;
}): Promise<LarkPlatformRegistrationResponse> {
  const nowMs = input.nowMs ?? Date.now();
  assertRegistrationActor(input.actor, input.provider);
  const configuration = requireRegistrationConfiguration({
    env: input.env,
    organizationId: input.actor.organizationId,
    provider: input.provider,
  });
  const createId = input.createId ?? (() => crypto.randomUUID());
  if (input.reauthorize) {
    return await reauthorizeExistingRegistration({
      ...input,
      createId,
      cryptoKey: configuration.cryptoKey,
      nowMs,
    });
  }
  let activeAttempt =
    await readActiveRemoteAgentLarkPlatformRegistrationAttempt({
      db: input.db,
      organizationId: input.actor.organizationId,
      provider: input.provider,
    });
  if (activeAttempt && activeAttempt.expiresAtMs <= nowMs) {
    await expireRemoteAgentLarkPlatformRegistrationAttempt({
      attemptId: activeAttempt.attemptId,
      db: input.db,
      nowMs,
    });
    activeAttempt = null;
  }
  if (activeAttempt) {
    assertAttemptAuthority({
      actor: input.actor,
      attempt: activeAttempt,
      provider: input.provider,
    });
    assertRepairableAttempt(input.repairExisting, activeAttempt);
    if (
      !(input.restartPending && activeAttempt.status === "pending_registration")
    ) {
      return await projectRegistrationResponse({
        attempt: activeAttempt,
        cryptoKey: configuration.cryptoKey,
        db: input.db,
      });
    }
  }
  const existingConnection =
    await readRemoteAgentLarkPlatformChannelConnectionForOrganization({
      db: input.db,
      organizationId: input.actor.organizationId,
      provider: input.provider,
    });
  const disconnectedConnection =
    existingConnection?.status === "disconnected" ? existingConnection : null;
  if (input.repairExisting) {
    return await repairExistingRegistration({
      actor: input.actor,
      connection: existingConnection,
      createId,
      cryptoKey: configuration.cryptoKey,
      db: input.db,
      nowMs,
      provider: input.provider,
    });
  }
  if (existingConnection && !disconnectedConnection) {
    throw serviceError(input.provider, "connection_already_exists", 409);
  }

  let started: Awaited<ReturnType<typeof beginLarkPlatformRegistration>>;
  try {
    started = await beginLarkPlatformRegistration({
      appDescription:
        "Connect your OpenMeld Center Agent to conversations in your workspace.",
      appName: "OpenMeld Center Agent",
      expectedProvider: input.provider,
      fetchImpl: input.fetchImpl,
      nowMs,
      source: "openmeld-core",
    });
  } catch (error) {
    throw normalizeRegistrationClientError(error, input.provider);
  }
  if (disconnectedConnection) {
    const deleted =
      await deleteDisconnectedRemoteAgentLarkPlatformChannelConnection({
        connectionId: disconnectedConnection.connectionId,
        db: input.db,
        organizationId: input.actor.organizationId,
        provider: input.provider,
      });
    if (!deleted) {
      throw serviceError(input.provider, "connection_changed", 409);
    }
  }
  const attemptInput = {
    accountDomain: started.accountDomain,
    attemptId: createId(),
    db: input.db,
    encryptedDeviceCode: await encryptLarkPlatformCredential({
      credential: started.deviceCode,
      credentialName: "registration device code",
      cryptoKey: configuration.cryptoKey,
    }),
    encryptedRegistrationUrl: await encryptLarkPlatformCredential({
      credential: started.registrationUrl,
      credentialName: "registration URL",
      cryptoKey: configuration.cryptoKey,
    }),
    expiresAtMs: started.expiresAtMs,
    initiatedByProfileId: input.actor.profileId,
    initiatedByUserId: input.actor.userId,
    nextPollAtMs: started.nextPollAtMs,
    nowMs,
    organizationId: input.actor.organizationId,
    permissionBundleVersion:
      LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.version,
    permissionMode: LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.mode,
    pollIntervalMs: started.pollIntervalMs,
    provider: input.provider,
    returnPath: REGISTRATION_RETURN_PATH,
  };
  const attempt = activeAttempt
    ? await replacePendingRegistrationAttempt({
        actor: input.actor,
        attemptInput,
        replacedAttemptId: activeAttempt.attemptId,
      })
    : await createRemoteAgentLarkPlatformRegistrationAttempt(attemptInput);
  return await projectRegistrationResponse({
    attempt,
    cryptoKey: configuration.cryptoKey,
    db: input.db,
  });
}

function assertRepairableAttempt(
  repairExisting: boolean | undefined,
  attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord
): void {
  if (repairExisting && attempt.connectionId === null) {
    throw serviceError(attempt.provider, "repair_unavailable", 409);
  }
}

async function reauthorizeExistingRegistration(input: {
  actor: RegistrationActor;
  createId: () => string;
  cryptoKey: string;
  db: D1Database;
  fetchImpl?: typeof fetch;
  nowMs: number;
  provider: RemoteAgentLarkPlatformProvider;
}): Promise<LarkPlatformRegistrationResponse> {
  let attempt = await readActiveRemoteAgentLarkPlatformRegistrationAttempt({
    db: input.db,
    organizationId: input.actor.organizationId,
    provider: input.provider,
  });
  assertAttemptAuthority({
    actor: input.actor,
    attempt,
    provider: input.provider,
  });
  if (!attempt) {
    const connected =
      await readRemoteAgentLarkPlatformChannelConnectionForOrganization({
        db: input.db,
        organizationId: input.actor.organizationId,
        provider: input.provider,
      });
    if (
      connected?.status !== "connected" ||
      connected.permissionBundleVersion ===
        LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.version
    ) {
      throw serviceError(input.provider, "repair_unavailable", 409);
    }
    attempt = await repairRemoteAgentLarkPlatformRegistrationAttempt({
      attemptId: input.createId(),
      configurationExpiresAtMs:
        input.nowMs + LARK_PLATFORM_CONFIGURATION_WINDOW_MS,
      connectionId: connected.connectionId,
      db: input.db,
      initiatedByProfileId: input.actor.profileId,
      initiatedByUserId: input.actor.userId,
      nowMs: input.nowMs,
      organizationId: input.actor.organizationId,
      pollIntervalMs: REGISTRATION_RETRY_DELAY_MS,
      provider: input.provider,
      updatePermissionBundleVersion:
        LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.version,
    });
  }
  if (
    !attempt?.connectionId ||
    attempt.status !== "configuring" ||
    (attempt.failureReasonCode !== null &&
      attempt.failureReasonCode !==
        `${input.provider}.application_config_permission_required` &&
      attempt.failureReasonCode !==
        `${input.provider}.authorization_update_required` &&
      attempt.failureReasonCode !==
        `${input.provider}.permission_bundle_mismatch`)
  ) {
    throw serviceError(input.provider, "repair_unavailable", 409);
  }
  const connection = await readRemoteAgentLarkPlatformChannelConnection({
    db: input.db,
    connectionId: attempt.connectionId,
  });
  if (
    !connection ||
    connection.organizationId !== input.actor.organizationId ||
    connection.provider !== input.provider
  ) {
    throw serviceError(input.provider, "registration_connection_invalid", 503);
  }
  // Consent updates this existing app. Its stored credentials remain authoritative;
  // the normal configuration worker verifies the grant before declaring success.
  const started = await beginLarkPlatformRegistration({
    appId: connection.appId,
    appDescription:
      "Connect your OpenMeld Center Agent to conversations in your workspace.",
    appName: "OpenMeld Center Agent",
    expectedProvider: input.provider,
    fetchImpl: input.fetchImpl,
    nowMs: input.nowMs,
    source: "openmeld-core",
  });
  const response = await projectRegistrationResponse({
    attempt,
    cryptoKey: input.cryptoKey,
    db: input.db,
  });
  return larkPlatformRegistrationResponseSchema.parse({
    ...response,
    attempt: { ...response.attempt, registrationUrl: started.registrationUrl },
  });
}

async function repairExistingRegistration(input: {
  actor: RegistrationActor;
  connection: RemoteAgentLarkPlatformChannelConnectionRecord | null;
  createId: () => string;
  cryptoKey: string;
  db: D1Database;
  nowMs: number;
  provider: RemoteAgentLarkPlatformProvider;
}): Promise<LarkPlatformRegistrationResponse> {
  if (input.connection?.status === "connected") {
    throw serviceError(input.provider, "connection_already_exists", 409);
  }
  if (
    !(
      input.connection &&
      (input.connection.status === "repair_required" ||
        input.connection.status === "revoked")
    )
  ) {
    throw serviceError(input.provider, "repair_unavailable", 409);
  }
  const repaired = await repairRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.createId(),
    configurationExpiresAtMs:
      input.nowMs + LARK_PLATFORM_CONFIGURATION_WINDOW_MS,
    connectionId: input.connection.connectionId,
    db: input.db,
    initiatedByProfileId: input.actor.profileId,
    initiatedByUserId: input.actor.userId,
    nowMs: input.nowMs,
    organizationId: input.actor.organizationId,
    pollIntervalMs: REGISTRATION_RETRY_DELAY_MS,
    provider: input.provider,
  });
  if (repaired) {
    return await projectRegistrationResponse({
      attempt: repaired,
      cryptoKey: input.cryptoKey,
      db: input.db,
    });
  }
  const concurrentAttempt =
    await readActiveRemoteAgentLarkPlatformRegistrationAttempt({
      db: input.db,
      organizationId: input.actor.organizationId,
      provider: input.provider,
    });
  if (
    !concurrentAttempt ||
    concurrentAttempt.connectionId !== input.connection.connectionId
  ) {
    throw serviceError(input.provider, "repair_unavailable", 409);
  }
  return await projectRegistrationResponse({
    attempt: concurrentAttempt,
    cryptoKey: input.cryptoKey,
    db: input.db,
  });
}

async function replacePendingRegistrationAttempt(input: {
  actor: RegistrationActor;
  attemptInput: Parameters<
    typeof createRemoteAgentLarkPlatformRegistrationAttempt
  >[0];
  replacedAttemptId: string;
}): Promise<RemoteAgentLarkPlatformRegistrationAttemptRecord> {
  const replacement =
    await replacePendingRemoteAgentLarkPlatformRegistrationAttempt({
      ...input.attemptInput,
      replacedAttemptId: input.replacedAttemptId,
    });
  if (!replacement || replacement.attemptId === input.replacedAttemptId) {
    throw serviceError(input.attemptInput.provider, "connection_changed", 409);
  }
  assertAttemptAuthority({
    actor: input.actor,
    attempt: replacement,
    provider: input.attemptInput.provider,
  });
  return replacement;
}

export async function disconnectRemoteAgentLarkPlatformRegistration(input: {
  actor: RegistrationActor;
  db: D1Database;
  nowMs?: number;
  provider: RemoteAgentLarkPlatformProvider;
}): Promise<MessageChannelConnectionProjection | null> {
  assertRegistrationActor(input.actor, input.provider);
  const disconnected = await disconnectRemoteAgentLarkPlatformChannelConnection(
    {
      db: input.db,
      nowMs: input.nowMs ?? Date.now(),
      organizationId: input.actor.organizationId,
      provider: input.provider,
    }
  );
  return disconnected
    ? projectRemoteAgentLarkPlatformConnection(disconnected)
    : null;
}

export async function listRemoteAgentActiveLarkPlatformRegistrations(input: {
  db: D1Database;
  nowMs?: number;
  organizationId: string;
  providers: readonly RemoteAgentLarkPlatformProvider[];
  viewer: RegistrationActor & { canManage: boolean };
}): Promise<LarkPlatformActiveRegistrationProjection[]> {
  const attempts = await Promise.all(
    input.providers.map(
      async (provider) =>
        await readActiveRemoteAgentLarkPlatformRegistrationAttempt({
          db: input.db,
          organizationId: input.organizationId,
          provider,
        })
    )
  );
  return attempts.flatMap((attempt) =>
    attempt && attempt.expiresAtMs > (input.nowMs ?? Date.now())
      ? [
          larkPlatformActiveRegistrationProjectionSchema.parse({
            canResume:
              input.viewer.canManage &&
              input.viewer.organizationId === attempt.organizationId &&
              (attempt.connectionId !== null ||
                (input.viewer.userId === attempt.initiatedByUserId &&
                  input.viewer.profileId === attempt.initiatedByProfileId)),
            expiresAt: new Date(attempt.expiresAtMs).toISOString(),
            id: attempt.attemptId,
            nextPollAt: new Date(attempt.nextPollAtMs).toISOString(),
            provider: attempt.provider,
            reasonCode: attempt.failureReasonCode,
            status: attempt.status,
          }),
        ]
      : []
  );
}

export async function pollRemoteAgentLarkPlatformRegistration(input: {
  actor: RegistrationActor;
  attemptId: string;
  clock?: () => number;
  createId?: () => string;
  db: D1Database;
  env: RegistrationEnvironment;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  providerRequestTimeoutMs?: number;
  provider: RemoteAgentLarkPlatformProvider;
}): Promise<LarkPlatformRegistrationResponse> {
  const clock =
    input.clock ??
    (input.nowMs === undefined ? Date.now : () => input.nowMs as number);
  const nowMs = input.nowMs ?? clock();
  assertRegistrationActor(input.actor, input.provider);
  const configuration = requireRegistrationConfiguration({
    env: input.env,
    organizationId: input.actor.organizationId,
    provider: input.provider,
  });
  const attempt = await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
  assertAttemptAuthority({
    actor: input.actor,
    attempt,
    provider: input.provider,
  });
  if (!attempt) {
    throw serviceError(input.provider, "registration_not_found", 404);
  }
  return await continueRegistrationAttempt({
    attempt,
    clock,
    configuration,
    createId: input.createId,
    db: input.db,
    fetchImpl: input.fetchImpl,
    nowMs,
    providerRequestTimeoutMs: input.providerRequestTimeoutMs,
  });
}

export async function continueRemoteAgentLarkPlatformRegistration(input: {
  attemptId: string;
  clock?: () => number;
  createId?: () => string;
  db: D1Database;
  env: RegistrationEnvironment;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  providerRequestTimeoutMs?: number;
}): Promise<LarkPlatformRegistrationResponse | null> {
  const clock =
    input.clock ??
    (input.nowMs === undefined ? Date.now : () => input.nowMs as number);
  const nowMs = input.nowMs ?? clock();
  const attempt = await readRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attemptId,
    db: input.db,
  });
  if (!attempt) {
    return null;
  }
  const configuration = requireRegistrationConfiguration({
    env: input.env,
    organizationId: attempt.organizationId,
    provider: attempt.provider,
  });
  return await continueRegistrationAttempt({
    attempt,
    clock,
    configuration,
    createId: input.createId,
    db: input.db,
    fetchImpl: input.fetchImpl,
    nowMs,
    providerRequestTimeoutMs: input.providerRequestTimeoutMs,
  });
}

async function continueRegistrationAttempt(input: {
  attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord;
  clock: () => number;
  configuration: {
    cryptoKey: string;
    connector: CoreBindings["OPENMELD_LARK_CHANNEL_CONNECTOR"];
  };
  createId?: () => string;
  db: D1Database;
  fetchImpl?: typeof fetch;
  nowMs: number;
  providerRequestTimeoutMs?: number;
}): Promise<LarkPlatformRegistrationResponse> {
  const { attempt, nowMs } = input;
  if (attempt.expiresAtMs <= nowMs && attempt.consumedAtMs === null) {
    const expired = await expireRemoteAgentLarkPlatformRegistrationAttempt({
      attemptId: attempt.attemptId,
      db: input.db,
      nowMs,
    });
    if (!expired) {
      throw serviceError(attempt.provider, "registration_not_found", 404);
    }
    return await projectRegistrationResponse({
      attempt: expired,
      cryptoKey: input.configuration.cryptoKey,
      db: input.db,
    });
  }
  if (attempt.consumedAtMs !== null || attempt.nextPollAtMs > nowMs) {
    return await projectRegistrationResponse({
      attempt,
      cryptoKey: input.configuration.cryptoKey,
      db: input.db,
    });
  }

  const createId = input.createId ?? (() => crypto.randomUUID());
  const claim = await claimRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: attempt.attemptId,
    claimExpiresAtMs: nowMs + REGISTRATION_CLAIM_TTL_MS,
    claimId: createId(),
    db: input.db,
    nowMs,
  });
  if (claim.status !== "claimed" || !claim.record) {
    return await projectRegistrationResponse({
      attempt: claim.record ?? attempt,
      cryptoKey: input.configuration.cryptoKey,
      db: input.db,
    });
  }
  const fetchImpl = createClaimDeadlineFetch({
    fetchImpl: input.fetchImpl ?? fetch,
    timeoutMs: normalizeProviderRequestTimeoutMs(
      input.providerRequestTimeoutMs
    ),
  });
  if (claim.record.status === "configuring") {
    return await configurePersistedRegistration({
      attempt: claim.record,
      claimId: claim.record.pollClaimId ?? "",
      clock: input.clock,
      configuration: input.configuration,
      db: input.db,
      fetchImpl,
      nowMs,
    });
  }
  return await pollPendingRegistration({
    attempt: claim.record,
    claimId: claim.record.pollClaimId ?? "",
    clock: input.clock,
    configuration: input.configuration,
    createId,
    db: input.db,
    fetchImpl,
    nowMs,
  });
}

function createClaimDeadlineFetch(input: {
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): typeof fetch {
  const fetchImpl = input.fetchImpl;
  const deadline = AbortSignal.timeout(input.timeoutMs);
  return ((resource: RequestInfo | URL, init?: RequestInit) =>
    fetchImpl(resource, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, deadline])
        : deadline,
    })) as typeof fetch;
}

function normalizeProviderRequestTimeoutMs(
  timeoutMs: number | undefined
): number {
  const value =
    timeoutMs ?? LARK_PLATFORM_REGISTRATION_PROVIDER_REQUEST_TIMEOUT_MS;
  if (
    !(Number.isInteger(value) && value > 0 && value < REGISTRATION_CLAIM_TTL_MS)
  ) {
    throw new Error(
      "Lark-platform provider request timeout must be a positive integer below the claim TTL"
    );
  }
  return value;
}

async function pollPendingRegistration(input: {
  attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord;
  claimId: string;
  clock: () => number;
  configuration: {
    cryptoKey: string;
    connector: CoreBindings["OPENMELD_LARK_CHANNEL_CONNECTOR"];
  };
  createId: () => string;
  db: D1Database;
  fetchImpl?: typeof fetch;
  nowMs: number;
}): Promise<LarkPlatformRegistrationResponse> {
  let result: Awaited<ReturnType<typeof pollLarkPlatformRegistration>>;
  try {
    result = await pollLarkPlatformRegistration({
      accountDomain: input.attempt.accountDomain,
      deviceCode: await decryptLarkPlatformCredential({
        credentialName: "registration device code",
        cryptoKey: input.configuration.cryptoKey,
        encryptedCredential: input.attempt.encryptedDeviceCode,
      }),
      expectedProvider: input.attempt.provider,
      expiresAtMs: input.attempt.expiresAtMs,
      fetchImpl: input.fetchImpl,
      nextPollAtMs: input.attempt.nextPollAtMs,
      nowMs: input.nowMs,
      pollIntervalMs: input.attempt.pollIntervalMs,
    });
  } catch (error) {
    return await handleRegistrationPollFailure({
      attempt: input.attempt,
      claimId: input.claimId,
      cryptoKey: input.configuration.cryptoKey,
      db: input.db,
      error,
      nowMs: input.clock(),
    });
  }
  if (!result.credential) {
    const settledAtMs = input.clock();
    const advanced = await advanceRemoteAgentLarkPlatformRegistrationAttempt({
      accountDomain: result.accountDomain,
      attemptId: input.attempt.attemptId,
      claimId: input.claimId,
      db: input.db,
      detectedBrand: result.detectedBrand,
      failureReasonCode: null,
      nextPollAtMs: result.nextPollAtMs,
      nowMs: settledAtMs,
      pollIntervalMs: result.pollIntervalMs,
      status: "pending_registration",
    });
    return await projectRegistrationResponse({
      attempt: advanced.attempt ?? input.attempt,
      cryptoKey: input.configuration.cryptoKey,
      db: input.db,
    });
  }

  const connectionId = input.createId();
  const encryptedAppSecret = await encryptLarkPlatformCredential({
    credential: result.credential.appSecret,
    credentialName: "app secret",
    cryptoKey: input.configuration.cryptoKey,
  });
  const credentialsPersistedAtMs = input.clock();
  const persisted = await persistRemoteAgentLarkPlatformRegistrationCredentials(
    {
      appId: result.credential.appId,
      attemptId: input.attempt.attemptId,
      claimId: input.claimId,
      connectionGeneration: 1,
      connectionId,
      configurationExpiresAtMs:
        credentialsPersistedAtMs + LARK_PLATFORM_CONFIGURATION_WINDOW_MS,
      credentialFormatVersion: LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION,
      db: input.db,
      encryptedAppSecret,
      encryptedEventEncryptKey: null,
      encryptedVerificationToken: null,
      nowMs: credentialsPersistedAtMs,
      operatorOpenId: result.credential.operatorOpenId,
      tenantKey: null,
      transport: "websocket",
    }
  );
  return await projectRegistrationResponse({
    attempt:
      persisted.status === "persisted"
        ? ((await readRemoteAgentLarkPlatformRegistrationAttempt({
            attemptId: input.attempt.attemptId,
            db: input.db,
          })) ?? input.attempt)
        : (persisted.attempt ?? input.attempt),
    cryptoKey: input.configuration.cryptoKey,
    db: input.db,
  });
}

async function configurePersistedRegistration(input: {
  attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord;
  claimId: string;
  clock: () => number;
  configuration: {
    cryptoKey: string;
    connector: CoreBindings["OPENMELD_LARK_CHANNEL_CONNECTOR"];
  };
  db: D1Database;
  fetchImpl?: typeof fetch;
  nowMs: number;
}): Promise<LarkPlatformRegistrationResponse> {
  const connectionId = input.attempt.connectionId;
  if (!connectionId) {
    return await failClaimedAttempt({
      attempt: input.attempt,
      claimId: input.claimId,
      cryptoKey: input.configuration.cryptoKey,
      db: input.db,
      failureReasonCode: `${input.attempt.provider}.registration_connection_missing`,
      nowMs: input.clock(),
    });
  }
  const [connection, credentials] = await Promise.all([
    readRemoteAgentLarkPlatformChannelConnection({
      connectionId,
      db: input.db,
    }),
    readRemoteAgentLarkPlatformChannelCredentials({
      connectionId,
      db: input.db,
    }),
  ]);
  if (
    !(connection && credentials) ||
    connection.organizationId !== input.attempt.organizationId ||
    connection.provider !== input.attempt.provider
  ) {
    return await failClaimedAttempt({
      attempt: input.attempt,
      claimId: input.claimId,
      cryptoKey: input.configuration.cryptoKey,
      db: input.db,
      failureReasonCode: `${input.attempt.provider}.registration_connection_invalid`,
      nowMs: input.clock(),
    });
  }
  try {
    const connector = input.configuration.connector;
    if (!connector) {
      throw serviceError(
        input.attempt.provider,
        "persistent_connector_unavailable",
        503
      );
    }
    const appSecret = await decryptLarkPlatformCredential({
      credentialName: "app secret",
      cryptoKey: input.configuration.cryptoKey,
      encryptedCredential: credentials.encryptedAppSecret,
    });
    const configured = await configureAndVerifyLarkPlatformPersistentApp({
      appId: connection.appId,
      appSecret,
      provider: connection.provider,
      migrateWebhook: connection.transport === "webhook",
      applicationVersionId: input.attempt.applicationVersionId,
      onPublicationSubmitted: async (versionId) => {
        await recordClaimedLarkPlatformApplicationVersion({
          attemptId: input.attempt.attemptId,
          claimId: input.claimId,
          db: input.db,
          nowMs: input.clock(),
          versionId,
        });
      },
      fetchImpl: input.fetchImpl,
    });
    const prepared = await prepareLarkPlatformPersistentConnection({
      db: input.db,
      connectionId,
      attemptId: input.attempt.attemptId,
      claimId: input.claimId,
      nowMs: input.clock(),
      botOpenId: configured.botOpenId,
      botName: configured.botName,
    });
    if (prepared) {
      let connected: boolean;
      try {
        connected = await connector
          .getByName(connectionId)
          .ensureConnected(connectionId);
      } catch {
        throw serviceError(
          input.attempt.provider,
          "persistent_connection_failed",
          503
        );
      }
      if (!connected) {
        throw serviceError(
          input.attempt.provider,
          "persistent_connection_failed",
          503
        );
      }
      await completeLarkPlatformPersistentRegistration({
        db: input.db,
        connectionId,
        attemptId: input.attempt.attemptId,
        claimId: input.claimId,
        nowMs: input.clock(),
      });
      await connector.getByName(connectionId).ensureConnected(connectionId);
    }
    const attempt = await readRemoteAgentLarkPlatformRegistrationAttempt({
      attemptId: input.attempt.attemptId,
      db: input.db,
    });
    return await projectRegistrationResponse({
      attempt: attempt ?? input.attempt,
      cryptoKey: input.configuration.cryptoKey,
      db: input.db,
    });
  } catch (error) {
    const failedAtMs = input.clock();
    const retryDelayMs = resolveConfigurationRetryDelayMs(
      input.attempt.pollIntervalMs
    );
    const failureReasonCode = normalizeFailureReasonCode(
      error,
      input.attempt.provider,
      "application_config_failed"
    );
    await advanceRemoteAgentLarkPlatformRegistrationAttempt({
      accountDomain: input.attempt.accountDomain,
      attemptId: input.attempt.attemptId,
      claimId: input.claimId,
      db: input.db,
      detectedBrand: input.attempt.detectedBrand,
      failureReasonCode,
      nextPollAtMs: Math.min(
        input.attempt.expiresAtMs,
        failedAtMs + retryDelayMs
      ),
      nowMs: failedAtMs,
      pollIntervalMs: retryDelayMs,
      status: "configuring",
    });
    const retryAttempt = await readRemoteAgentLarkPlatformRegistrationAttempt({
      attemptId: input.attempt.attemptId,
      db: input.db,
    });
    return await projectRegistrationResponse({
      attempt: retryAttempt ?? input.attempt,
      cryptoKey: input.configuration.cryptoKey,
      db: input.db,
    });
  }
}

async function handleRegistrationPollFailure(input: {
  attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord;
  claimId: string;
  cryptoKey: string;
  db: D1Database;
  error: unknown;
  nowMs: number;
}): Promise<LarkPlatformRegistrationResponse> {
  const failureReasonCode = normalizeFailureReasonCode(
    input.error,
    input.attempt.provider,
    "registration_response_unknown"
  );
  const retryable =
    failureReasonCode.endsWith(".registration_transport_failed") ||
    failureReasonCode.endsWith(".registration_http_failed");
  if (retryable) {
    const advanced = await advanceRemoteAgentLarkPlatformRegistrationAttempt({
      accountDomain: input.attempt.accountDomain,
      attemptId: input.attempt.attemptId,
      claimId: input.claimId,
      db: input.db,
      detectedBrand: input.attempt.detectedBrand,
      failureReasonCode,
      nextPollAtMs: Math.min(
        input.attempt.expiresAtMs,
        input.nowMs + REGISTRATION_RETRY_DELAY_MS
      ),
      nowMs: input.nowMs,
      pollIntervalMs: input.attempt.pollIntervalMs,
      status: "pending_registration",
    });
    return await projectRegistrationResponse({
      attempt: advanced.attempt ?? input.attempt,
      cryptoKey: input.cryptoKey,
      db: input.db,
    });
  }
  return await failClaimedAttempt({
    attempt: input.attempt,
    claimId: input.claimId,
    cryptoKey: input.cryptoKey,
    db: input.db,
    failureReasonCode,
    nowMs: input.nowMs,
  });
}

async function failClaimedAttempt(input: {
  attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord;
  claimId: string;
  cryptoKey: string;
  db: D1Database;
  failureReasonCode: string;
  nowMs: number;
}): Promise<LarkPlatformRegistrationResponse> {
  const failed = await failRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: input.attempt.attemptId,
    claimId: input.claimId,
    db: input.db,
    failureReasonCode: input.failureReasonCode,
    nowMs: input.nowMs,
  });
  return await projectRegistrationResponse({
    attempt: failed.attempt ?? input.attempt,
    cryptoKey: input.cryptoKey,
    db: input.db,
  });
}

async function projectRegistrationResponse(input: {
  attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord;
  cryptoKey: string;
  db: D1Database;
}): Promise<LarkPlatformRegistrationResponse> {
  let connection: MessageChannelConnectionProjection | null = null;
  if (input.attempt.connectionId) {
    const record = await readRemoteAgentLarkPlatformChannelConnection({
      connectionId: input.attempt.connectionId,
      db: input.db,
    });
    if (
      !record ||
      record.organizationId !== input.attempt.organizationId ||
      record.provider !== input.attempt.provider
    ) {
      throw serviceError(
        input.attempt.provider,
        "registration_connection_invalid",
        503
      );
    }
    connection = projectRemoteAgentLarkPlatformConnection(record);
  }
  const registrationUrl =
    input.attempt.status === "pending_registration"
      ? await decryptLarkPlatformCredential({
          credentialName: "registration URL",
          cryptoKey: input.cryptoKey,
          encryptedCredential: input.attempt.encryptedRegistrationUrl,
        })
      : null;
  return larkPlatformRegistrationResponseSchema.parse({
    attempt: {
      expiresAt: new Date(input.attempt.expiresAtMs).toISOString(),
      id: input.attempt.attemptId,
      nextPollAt: new Date(input.attempt.nextPollAtMs).toISOString(),
      provider: input.attempt.provider,
      reasonCode: input.attempt.failureReasonCode,
      registrationUrl,
      status: input.attempt.status,
    },
    connection,
    organizationId: input.attempt.organizationId,
  });
}

function requireRegistrationConfiguration(input: {
  env: RegistrationEnvironment;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
}): {
  cryptoKey: string;
  connector: CoreBindings["OPENMELD_LARK_CHANNEL_CONNECTOR"];
} {
  if (
    !isLarkPlatformProviderEnabledForOrganization({
      env: input.env,
      organizationId: input.organizationId,
      provider: input.provider,
    })
  ) {
    throw serviceError(input.provider, "provider_gate_disabled", 503);
  }
  const cryptoKey =
    input.env.LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY?.trim();
  if (!cryptoKey) {
    throw serviceError(
      input.provider,
      "registration_configuration_unavailable",
      503
    );
  }
  return {
    cryptoKey,
    connector: input.env.OPENMELD_LARK_CHANNEL_CONNECTOR,
  };
}

function assertRegistrationActor(
  actor: RegistrationActor,
  provider: RemoteAgentLarkPlatformProvider
): void {
  if (
    !(
      actor.organizationId.trim() &&
      actor.profileId.trim() &&
      actor.userId.trim()
    )
  ) {
    throw serviceError(provider, "registration_actor_invalid", 403);
  }
}

function assertAttemptAuthority(input: {
  actor: RegistrationActor;
  attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord | null;
  provider: RemoteAgentLarkPlatformProvider;
}): void {
  if (!input.attempt) {
    return;
  }
  if (
    input.attempt.organizationId !== input.actor.organizationId ||
    input.attempt.provider !== input.provider ||
    (input.attempt.connectionId === null &&
      (input.attempt.initiatedByUserId !== input.actor.userId ||
        input.attempt.initiatedByProfileId !== input.actor.profileId))
  ) {
    throw serviceError(input.provider, "registration_not_found", 404);
  }
}

function normalizeRegistrationClientError(
  error: unknown,
  provider: RemoteAgentLarkPlatformProvider
): LarkPlatformRegistrationServiceError {
  return new LarkPlatformRegistrationServiceError({
    reasonCode:
      error instanceof LarkPlatformRegistrationError
        ? error.reasonCode
        : `${provider}.registration_start_failed`,
    status: 502,
  });
}

function normalizeFailureReasonCode(
  error: unknown,
  provider: RemoteAgentLarkPlatformProvider,
  fallback: string
): string {
  if (
    error instanceof Error &&
    "reasonCode" in error &&
    typeof error.reasonCode === "string" &&
    error.reasonCode.startsWith(`${provider}.`)
  ) {
    return error.reasonCode;
  }
  return `${provider}.${fallback}`;
}

function resolveConfigurationRetryDelayMs(currentDelayMs: number): number {
  return Math.min(
    REGISTRATION_MAX_RETRY_DELAY_MS,
    Math.max(REGISTRATION_RETRY_DELAY_MS, currentDelayMs * 2)
  );
}

function serviceError(
  provider: RemoteAgentLarkPlatformProvider,
  reason: string,
  status: number
): LarkPlatformRegistrationServiceError {
  return new LarkPlatformRegistrationServiceError({
    reasonCode: `${provider}.${reason}`,
    status,
  });
}
