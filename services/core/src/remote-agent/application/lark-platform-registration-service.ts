import {
  LARK_PLATFORM_REGISTRATION_DOMAINS,
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
  advanceRemoteAgentLarkPlatformRegistrationAttempt,
  claimRemoteAgentLarkPlatformRegistrationAttempt,
  completeRemoteAgentLarkPlatformRegistration,
  createRemoteAgentLarkPlatformRegistrationAttempt,
  expireRemoteAgentLarkPlatformRegistrationAttempt,
  failRemoteAgentLarkPlatformRegistrationAttempt,
  persistRemoteAgentLarkPlatformRegistrationCredentials,
  type RemoteAgentLarkPlatformRegistrationAttemptRecord,
  readActiveRemoteAgentLarkPlatformRegistrationAttempt,
  readRemoteAgentLarkPlatformRegistrationAttempt,
  repairRemoteAgentLarkPlatformRegistrationAttempt,
  replaceClaimedLarkPlatformCallbackCredentials,
  replacePendingRemoteAgentLarkPlatformRegistrationAttempt,
} from "../infrastructure/d1/lark-platform-registration-attempt-repo";
import { configureAndVerifyLarkPlatformWebhookApp } from "./lark-platform-app-configuration";
import {
  decryptLarkPlatformCredential,
  encryptLarkPlatformCredential,
  LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION,
} from "./lark-platform-credential-crypto";
import { LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE } from "./lark-platform-permission-bundles";
import { isLarkPlatformProviderEnabledForOrganization } from "./lark-platform-provider-policy";
import {
  beginLarkPlatformRegistration,
  isLarkPlatformRegistrationRouteCompatible,
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
const BASE64_PADDING_PATTERN = /=+$/u;

type RegistrationActor = {
  organizationId: string;
  profileId: string;
  userId: string;
};

export type RegistrationEnvironment = Pick<
  CoreBindings,
  | "OPENMELD_FEISHU_CHANNEL_ENABLED"
  | "OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS"
  | "OPENMELD_GATEWAY_URL"
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
    if (input.repairExisting && activeAttempt.connectionId === null) {
      throw serviceError(input.provider, "repair_unavailable", 409);
    }
    if (
      !(await shouldRestartPendingRegistration({
        attempt: activeAttempt,
        cryptoKey: configuration.cryptoKey,
        requested: input.restartPending === true,
      }))
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

async function shouldRestartPendingRegistration(input: {
  attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord;
  cryptoKey: string;
  requested: boolean;
}): Promise<boolean> {
  if (input.attempt.status !== "pending_registration") {
    return false;
  }
  if (input.requested) {
    return true;
  }
  const registrationUrl = await decryptLarkPlatformCredential({
    credentialName: "registration URL",
    cryptoKey: input.cryptoKey,
    encryptedCredential: input.attempt.encryptedRegistrationUrl,
  });
  return !isLarkPlatformRegistrationRouteCompatible({
    accountDomain: input.attempt.accountDomain,
    provider: input.attempt.provider,
    registrationUrl,
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
    attempt
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
  createSecret?: () => string;
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
    createSecret: input.createSecret,
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
  createSecret?: () => string;
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
    createSecret: input.createSecret,
    db: input.db,
    fetchImpl: input.fetchImpl,
    nowMs,
    providerRequestTimeoutMs: input.providerRequestTimeoutMs,
  });
}

async function continueRegistrationAttempt(input: {
  attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord;
  clock: () => number;
  configuration: { cryptoKey: string; gatewayOrigin: string };
  createId?: () => string;
  createSecret?: () => string;
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
    createSecret: input.createSecret ?? createOpaqueSecret,
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
  configuration: { cryptoKey: string; gatewayOrigin: string };
  createId: () => string;
  createSecret: () => string;
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
  const verificationToken = input.createSecret();
  const eventEncryptKey = input.createSecret();
  const [
    encryptedAppSecret,
    encryptedVerificationToken,
    encryptedEventEncryptKey,
  ] = await Promise.all([
    encryptLarkPlatformCredential({
      credential: result.credential.appSecret,
      credentialName: "app secret",
      cryptoKey: input.configuration.cryptoKey,
    }),
    encryptLarkPlatformCredential({
      credential: verificationToken,
      credentialName: "verification token",
      cryptoKey: input.configuration.cryptoKey,
    }),
    encryptLarkPlatformCredential({
      credential: eventEncryptKey,
      credentialName: "event encrypt key",
      cryptoKey: input.configuration.cryptoKey,
    }),
  ]);
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
      encryptedEventEncryptKey,
      encryptedVerificationToken,
      nowMs: credentialsPersistedAtMs,
      operatorOpenId: result.credential.operatorOpenId,
      tenantKey: null,
      transport: "webhook",
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
  configuration: { cryptoKey: string; gatewayOrigin: string };
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
  if (connection.botOpenId) {
    return await settleConfiguredRegistration({
      attempt: input.attempt,
      botName: connection.botName,
      botOpenId: connection.botOpenId,
      claimId: input.claimId,
      connectionId,
      cryptoKey: input.configuration.cryptoKey,
      db: input.db,
      grantedCapabilityGroups: connection.grantedCapabilityGroups,
      nowMs: input.clock(),
    });
  }

  try {
    const [appSecret, savedVerificationToken, savedEventEncryptKey] =
      await Promise.all([
        decryptLarkPlatformCredential({
          credentialName: "app secret",
          cryptoKey: input.configuration.cryptoKey,
          encryptedCredential: credentials.encryptedAppSecret,
        }),
        credentials.encryptedVerificationToken
          ? decryptLarkPlatformCredential({
              credentialName: "verification token",
              cryptoKey: input.configuration.cryptoKey,
              encryptedCredential: credentials.encryptedVerificationToken,
            })
          : Promise.reject(new Error("verification token is unavailable")),
        credentials.encryptedEventEncryptKey
          ? decryptLarkPlatformCredential({
              credentialName: "event encrypt key",
              cryptoKey: input.configuration.cryptoKey,
              encryptedCredential: credentials.encryptedEventEncryptKey,
            })
          : Promise.reject(new Error("event encrypt key is unavailable")),
      ]);
    const verificationToken =
      savedVerificationToken.length > 32
        ? createOpaqueSecret()
        : savedVerificationToken;
    const eventEncryptKey =
      savedEventEncryptKey.length > 32
        ? createOpaqueSecret()
        : savedEventEncryptKey;
    if (
      verificationToken !== savedVerificationToken ||
      eventEncryptKey !== savedEventEncryptKey
    ) {
      const [encryptedVerificationToken, encryptedEventEncryptKey] =
        await Promise.all([
          encryptLarkPlatformCredential({
            credential: verificationToken,
            credentialName: "verification token",
            cryptoKey: input.configuration.cryptoKey,
          }),
          encryptLarkPlatformCredential({
            credential: eventEncryptKey,
            credentialName: "event encrypt key",
            cryptoKey: input.configuration.cryptoKey,
          }),
        ]);
      const replaced = await replaceClaimedLarkPlatformCallbackCredentials({
        attemptId: input.attempt.attemptId,
        claimId: input.claimId,
        connectionId,
        db: input.db,
        encryptedEventEncryptKey,
        encryptedVerificationToken,
        previousEncryptedEventEncryptKey: credentials.encryptedEventEncryptKey,
        previousEncryptedVerificationToken:
          credentials.encryptedVerificationToken,
        nowMs: input.clock(),
      });
      if (!replaced) {
        const current = await readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: input.attempt.attemptId,
          db: input.db,
        });
        return await projectRegistrationResponse({
          attempt: current ?? input.attempt,
          cryptoKey: input.configuration.cryptoKey,
          db: input.db,
        });
      }
    }
    const configured = await configureAndVerifyLarkPlatformWebhookApp({
      appId: connection.appId,
      appSecret,
      connectionId,
      eventEncryptKey,
      fetchImpl: input.fetchImpl,
      gatewayOrigin: input.configuration.gatewayOrigin,
      provider: connection.provider,
      verificationToken,
    });
    return await settleConfiguredRegistration({
      attempt: input.attempt,
      botName: configured.botName,
      botOpenId: configured.botOpenId,
      claimId: input.claimId,
      connectionId,
      cryptoKey: input.configuration.cryptoKey,
      db: input.db,
      grantedCapabilityGroups: configured.grantedCapabilityGroups,
      nowMs: input.clock(),
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

async function settleConfiguredRegistration(input: {
  attempt: RemoteAgentLarkPlatformRegistrationAttemptRecord;
  botName: string | null;
  botOpenId: string;
  claimId: string;
  connectionId: string;
  cryptoKey: string;
  db: D1Database;
  grantedCapabilityGroups: readonly string[];
  nowMs: number;
}): Promise<LarkPlatformRegistrationResponse> {
  const retryDelayMs = resolveConfigurationRetryDelayMs(
    input.attempt.pollIntervalMs
  );
  const completed = await completeRemoteAgentLarkPlatformRegistration({
    attemptId: input.attempt.attemptId,
    botName: input.botName,
    botOpenId: input.botOpenId,
    claimId: input.claimId,
    connectionId: input.connectionId,
    db: input.db,
    grantedCapabilityGroups: input.grantedCapabilityGroups,
    nextPollAtMs: Math.min(
      input.attempt.expiresAtMs,
      input.nowMs + retryDelayMs
    ),
    nowMs: input.nowMs,
    pollIntervalMs: retryDelayMs,
  });
  const completedAttempt =
    completed.status === "completed"
      ? await readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: input.attempt.attemptId,
          db: input.db,
        })
      : completed.attempt;
  return await projectRegistrationResponse({
    attempt: completedAttempt ?? input.attempt,
    cryptoKey: input.cryptoKey,
    db: input.db,
  });
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
  let registrationUrl =
    input.attempt.status === "pending_registration"
      ? await decryptLarkPlatformCredential({
          credentialName: "registration URL",
          cryptoKey: input.cryptoKey,
          encryptedCredential: input.attempt.encryptedRegistrationUrl,
        })
      : null;
  if (registrationUrl && input.attempt.provider === "lark") {
    const url = new URL(registrationUrl);
    if (url.host === LARK_PLATFORM_REGISTRATION_DOMAINS.feishu.launcherHost) {
      // Legacy shared-issuer links keep their code and attempt while polling.
      // Validate the resulting URL below; this does not rewrite durable state.
      url.hostname = LARK_PLATFORM_REGISTRATION_DOMAINS.lark.launcherHost;
      registrationUrl = url.toString();
    }
  }
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
}): { cryptoKey: string; gatewayOrigin: string } {
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
  const gatewayOrigin = input.env.OPENMELD_GATEWAY_URL?.trim();
  if (!(cryptoKey && gatewayOrigin)) {
    throw serviceError(
      input.provider,
      "registration_configuration_unavailable",
      503
    );
  }
  return { cryptoKey, gatewayOrigin };
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

function createOpaqueSecret(): string {
  // 24 random bytes encode to 32 base64url characters, the provider's limit.
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(BASE64_PADDING_PATTERN, "");
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
