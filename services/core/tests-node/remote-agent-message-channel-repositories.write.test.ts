import { describe, expect, it } from "vitest";
import {
  deleteRemoteAgentMessageChannelIdentityLinkTarget,
  findRemoteAgentMessageChannelIdentityLinkTarget,
  listRemoteAgentMessageChannelIdentityLinkProjections,
  projectRemoteAgentLarkPlatformConnection,
} from "../src/remote-agent/application/message-channel-connection-projection";
import {
  readRemoteAgentLarkPlatformChannelConnection,
  readRemoteAgentLarkPlatformChannelCredentials,
  setRemoteAgentLarkPlatformChannelConnectionStatus,
} from "../src/remote-agent/infrastructure/d1/lark-platform-channel-connection-repo";
import {
  readRemoteAgentLarkPlatformContextCursor,
  upsertRemoteAgentLarkPlatformContextCursor,
} from "../src/remote-agent/infrastructure/d1/lark-platform-context-cursor-repo";
import {
  insertRemoteAgentLarkPlatformIdentityLinkIfAbsent,
  readRemoteAgentLarkPlatformIdentityLink,
} from "../src/remote-agent/infrastructure/d1/lark-platform-identity-link-repo";
import {
  advanceRemoteAgentLarkPlatformRegistrationAttempt,
  claimRemoteAgentLarkPlatformRegistrationAttempt,
  completeRemoteAgentLarkPlatformRegistration,
  createRemoteAgentLarkPlatformRegistrationAttempt,
  expireRemoteAgentLarkPlatformRegistrationAttempt,
  persistRemoteAgentLarkPlatformRegistrationCredentials,
  readRemoteAgentLarkPlatformRegistrationAttempt,
  recordRemoteAgentLarkPlatformWebhookReachability,
} from "../src/remote-agent/infrastructure/d1/lark-platform-registration-attempt-repo";
import {
  buildRemoteAgentMessageChannelEventKey,
  claimRemoteAgentMessageChannelEventIngress,
  completeRemoteAgentMessageChannelEventIngress,
  failRemoteAgentMessageChannelEventIngress,
  readRemoteAgentMessageChannelEventIngress,
  releaseRemoteAgentMessageChannelEventIngressForRetry,
} from "../src/remote-agent/infrastructure/d1/message-channel-event-ingress-repo";
import {
  claimRemoteAgentMessageChannelIdentityLinkToken,
  consumeRemoteAgentMessageChannelIdentityLinkToken,
  insertRemoteAgentMessageChannelIdentityLinkToken,
  readActiveRemoteAgentMessageChannelIdentityLinkToken,
  readRemoteAgentMessageChannelIdentityLinkTokenForUser,
} from "../src/remote-agent/infrastructure/d1/message-channel-identity-link-token-repo";
import {
  applyDrizzleMigrationsForTables,
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const MESSAGE_CHANNEL_IDENTITY_LINK_ID_PATTERN =
  /^channel_identity_[0-9a-f]{64}$/u;

describe("Remote Agent Message Channel repositories", () => {
  it("persists QR credentials before resumable configuration can complete", async () => {
    const harness = createSqliteD1Harness();
    applyLarkPlatformMigrations(harness);
    try {
      await createRemoteAgentLarkPlatformRegistrationAttempt({
        accountDomain: "https://open.larksuite.com",
        db: harness.db,
        encryptedDeviceCode: "encrypted-device-code",
        encryptedRegistrationUrl: "encrypted-registration-url",
        expiresAtMs: 10_000,
        initiatedByProfileId: "profile_1",
        initiatedByUserId: "user_1",
        nextPollAtMs: 2000,
        nowMs: 1000,
        organizationId: "org_1",
        permissionBundleVersion: "channel-v1",
        permissionMode: "channel_only_template",
        pollIntervalMs: 1000,
        provider: "lark",
        attemptId: "attempt_lark_1",
        returnPath: "/center-agent/channels",
      });
      await expect(
        claimRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_lark_1",
          claimExpiresAtMs: 4000,
          claimId: "claim_lark_1",
          db: harness.db,
          nowMs: 2000,
        })
      ).resolves.toMatchObject({ status: "claimed" });

      await expect(
        persistRemoteAgentLarkPlatformRegistrationCredentials({
          appId: "cli_lark_1",
          attemptId: "attempt_lark_1",
          claimId: "claim_lark_1",
          connectionGeneration: 1,
          connectionId: "connection_lark_1",
          configurationExpiresAtMs: 10_000,
          credentialFormatVersion: 1,
          db: harness.db,
          encryptedAppSecret: "encrypted-app-secret",
          encryptedEventEncryptKey: "encrypted-event-key",
          encryptedVerificationToken: "encrypted-verification-token",
          nowMs: 2500,
          operatorOpenId: "ou_installer_1",
          tenantKey: "tenant_lark_1",
          transport: "webhook",
        })
      ).resolves.toMatchObject({
        connection: {
          connectionId: "connection_lark_1",
          organizationId: "org_1",
          provider: "lark",
          status: "configuring",
        },
        status: "persisted",
      });

      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_lark_1",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        grantedCapabilityGroups: [],
        installedByUserId: "user_1",
        permissionBundleVersion: "channel-v1",
        status: "configuring",
      });
      await expect(
        readRemoteAgentLarkPlatformChannelCredentials({
          connectionId: "connection_lark_1",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        encryptedAppSecret: "encrypted-app-secret",
        encryptedEventEncryptKey: "encrypted-event-key",
        encryptedVerificationToken: "encrypted-verification-token",
      });
      await expect(
        readRemoteAgentLarkPlatformIdentityLink({
          connectionId: "connection_lark_1",
          db: harness.db,
          provider: "lark",
          providerUserId: "ou_installer_1",
        })
      ).resolves.toMatchObject({
        organizationId: "org_1",
        resolutionSource: "installer",
        openmeldUserId: "user_1",
      });
      await expect(
        claimRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_lark_1",
          claimExpiresAtMs: 5000,
          claimId: "claim_lark_configure",
          db: harness.db,
          nowMs: 2600,
        })
      ).resolves.toMatchObject({ status: "claimed" });
      await expect(
        completeRemoteAgentLarkPlatformRegistration({
          attemptId: "attempt_lark_1",
          botName: "Center Agent",
          botOpenId: "ou_bot_1",
          claimId: "claim_lark_configure",
          connectionId: "connection_lark_1",
          db: harness.db,
          grantedCapabilityGroups: ["conversation.text"],
          nextPollAtMs: 3700,
          nowMs: 2700,
        })
      ).resolves.toMatchObject({
        connection: {
          botOpenId: "ou_bot_1",
          connectionId: "connection_lark_1",
          grantedCapabilityGroups: ["conversation.text"],
          status: "configuring",
        },
        status: "awaiting_webhook",
      });
      await expect(
        recordRemoteAgentLarkPlatformWebhookReachability({
          connectionId: "connection_lark_1",
          db: harness.db,
          organizationId: "org_1",
          provider: "lark",
          surface: "events",
          verifiedAtMs: 2800,
        })
      ).resolves.toMatchObject({
        eventsWebhookVerifiedAtMs: 2800,
        lastVerifiedAtMs: null,
        status: "configuring",
      });
      await expect(
        recordRemoteAgentLarkPlatformWebhookReachability({
          connectionId: "connection_lark_1",
          db: harness.db,
          organizationId: "org_1",
          provider: "lark",
          surface: "callbacks",
          verifiedAtMs: 2900,
        })
      ).resolves.toMatchObject({
        callbacksWebhookVerifiedAtMs: 2900,
        lastVerifiedAtMs: 2900,
        status: "connected",
      });
      await expect(
        readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_lark_1",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        consumedAtMs: 2900,
        status: "connected",
      });
      await expect(
        setRemoteAgentLarkPlatformChannelConnectionStatus({
          connectionId: "connection_lark_1",
          db: harness.db,
          failureReasonCode: "wrong_org",
          lastVerifiedAtMs: 3900,
          nowMs: 3900,
          organizationId: "org_2",
          provider: "lark",
          status: "repair_required",
        })
      ).resolves.toBeNull();
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_lark_1",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        failureReasonCode: null,
        organizationId: "org_1",
        status: "connected",
        updatedAtMs: 2900,
      });
    } finally {
      harness.close();
    }
  });

  it("moves a dangling configuring connection to repair required when registration expires", async () => {
    const harness = createSqliteD1Harness();
    applyLarkPlatformMigrations(harness);
    try {
      await seedConfiguringRegistration(harness);
      await completeRemoteAgentLarkPlatformRegistration({
        attemptId: "attempt_lark_1",
        botName: "Center Agent",
        botOpenId: "ou_bot_1",
        claimId: "claim_lark_configure",
        connectionId: "connection_lark_1",
        db: harness.db,
        grantedCapabilityGroups: ["conversation.text"],
        nextPollAtMs: 3700,
        nowMs: 2700,
      });
      await recordRemoteAgentLarkPlatformWebhookReachability({
        connectionId: "connection_lark_1",
        db: harness.db,
        organizationId: "org_1",
        provider: "lark",
        surface: "events",
        verifiedAtMs: 10_000,
      });
      await expect(
        recordRemoteAgentLarkPlatformWebhookReachability({
          connectionId: "connection_lark_1",
          db: harness.db,
          organizationId: "org_1",
          provider: "lark",
          surface: "callbacks",
          verifiedAtMs: 10_000,
        })
      ).resolves.toMatchObject({
        lastVerifiedAtMs: null,
        status: "configuring",
      });

      await expect(
        expireRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_lark_1",
          db: harness.db,
          nowMs: 10_001,
        })
      ).resolves.toMatchObject({
        consumedAtMs: 10_001,
        failureReasonCode: "lark.registration_expired",
        status: "repair_required",
      });
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_lark_1",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        failureReasonCode: "lark.registration_expired",
        status: "repair_required",
        updatedAtMs: 10_001,
      });
    } finally {
      harness.close();
    }
  });

  it("refuses an expired QR poll claim without leaving partial connection state", async () => {
    const harness = createSqliteD1Harness();
    applyLarkPlatformMigrations(harness);
    try {
      await createRemoteAgentLarkPlatformRegistrationAttempt({
        accountDomain: "https://open.larksuite.com",
        attemptId: "attempt_lark_expired",
        db: harness.db,
        encryptedDeviceCode: "encrypted-device-code",
        encryptedRegistrationUrl: "encrypted-registration-url",
        expiresAtMs: 10_000,
        initiatedByProfileId: "profile_1",
        initiatedByUserId: "user_1",
        nextPollAtMs: 2000,
        nowMs: 1000,
        organizationId: "org_1",
        permissionBundleVersion: "channel-v1",
        permissionMode: "channel_only_template",
        pollIntervalMs: 1000,
        provider: "lark",
        returnPath: "/center-agent/channels",
      });
      await expect(
        claimRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_lark_expired",
          claimExpiresAtMs: 2500,
          claimId: "claim_lark_expired",
          db: harness.db,
          nowMs: 2000,
        })
      ).resolves.toMatchObject({ status: "claimed" });
      await expect(
        advanceRemoteAgentLarkPlatformRegistrationAttempt({
          accountDomain: "accounts.larksuite.com",
          attemptId: "attempt_lark_expired",
          claimId: "claim_lark_expired",
          db: harness.db,
          detectedBrand: "lark",
          failureReasonCode: null,
          nextPollAtMs: 3500,
          nowMs: 2500,
          pollIntervalMs: 1000,
          status: "credentials_received",
        })
      ).resolves.toMatchObject({
        attempt: {
          pollClaimId: "claim_lark_expired",
          status: "pending_registration",
        },
        status: "claim_lost",
      });

      await expect(
        persistRemoteAgentLarkPlatformRegistrationCredentials({
          appId: "cli_lark_expired",
          attemptId: "attempt_lark_expired",
          claimId: "claim_lark_expired",
          connectionGeneration: 1,
          connectionId: "connection_lark_expired",
          configurationExpiresAtMs: 10_000,
          credentialFormatVersion: 1,
          db: harness.db,
          encryptedAppSecret: "encrypted-app-secret",
          encryptedEventEncryptKey: null,
          encryptedVerificationToken: null,
          nowMs: 2500,
          operatorOpenId: "ou_installer_expired",
          tenantKey: "tenant_lark_expired",
          transport: "webhook",
        })
      ).resolves.toMatchObject({ status: "claim_lost" });
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_lark_expired",
          db: harness.db,
        })
      ).resolves.toBeNull();
      await expect(
        readRemoteAgentLarkPlatformChannelCredentials({
          connectionId: "connection_lark_expired",
          db: harness.db,
        })
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it("does not connect after another poll reclaims the configuration attempt", async () => {
    const harness = createSqliteD1Harness();
    applyLarkPlatformMigrations(harness);
    try {
      await seedConfiguringRegistration(harness);
      const racingDb = {
        ...harness.db,
        batch: (async (statements: D1PreparedStatement[]) => {
          await harness.db
            .prepare(
              `
                UPDATE openMeldRemoteAgent_lark_platform_registration_attempts
                SET
                  poll_claim_id = 'claim_lark_reclaimed',
                  poll_claim_expires_at_ms = 6000,
                  updated_at_ms = 3000
                WHERE attempt_id = 'attempt_lark_1'
                  AND poll_claim_id = 'claim_lark_configure'
              `
            )
            .run();
          return await harness.db.batch(statements);
        }) as D1Database["batch"],
      } as D1Database;

      await expect(
        completeRemoteAgentLarkPlatformRegistration({
          attemptId: "attempt_lark_1",
          botName: "Center Agent",
          botOpenId: "ou_bot_stale",
          claimId: "claim_lark_configure",
          connectionId: "connection_lark_1",
          db: racingDb,
          grantedCapabilityGroups: ["conversation.text"],
          nextPollAtMs: 4000,
          nowMs: 3000,
        })
      ).resolves.toMatchObject({
        attempt: {
          pollClaimId: "claim_lark_reclaimed",
          status: "configuring",
        },
        status: "claim_lost",
      });
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_lark_1",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        botOpenId: null,
        lastVerifiedAtMs: null,
        status: "configuring",
      });
    } finally {
      harness.close();
    }
  });

  it("rejects a QR registration when the detected brand changes", async () => {
    const harness = createSqliteD1Harness();
    applyLarkPlatformMigrations(harness);
    try {
      await createRemoteAgentLarkPlatformRegistrationAttempt({
        accountDomain: "https://open.larksuite.com",
        attemptId: "attempt_brand_mismatch",
        db: harness.db,
        encryptedDeviceCode: "encrypted-device-code",
        encryptedRegistrationUrl: "encrypted-registration-url",
        expiresAtMs: 10_000,
        initiatedByProfileId: "profile_1",
        initiatedByUserId: "user_1",
        nextPollAtMs: 2000,
        nowMs: 1000,
        organizationId: "org_1",
        permissionBundleVersion: "channel-v1",
        permissionMode: "channel_only_template",
        pollIntervalMs: 1000,
        provider: "lark",
        returnPath: "/center-agent/channels",
      });
      await claimRemoteAgentLarkPlatformRegistrationAttempt({
        attemptId: "attempt_brand_mismatch",
        claimExpiresAtMs: 4000,
        claimId: "claim_brand_mismatch",
        db: harness.db,
        nowMs: 2000,
      });

      await expect(
        advanceRemoteAgentLarkPlatformRegistrationAttempt({
          accountDomain: "accounts.larksuite.com",
          attemptId: "attempt_brand_mismatch",
          claimId: "claim_brand_mismatch",
          db: harness.db,
          detectedBrand: "feishu",
          failureReasonCode: null,
          nextPollAtMs: 3000,
          nowMs: 2500,
          pollIntervalMs: 1000,
          status: "credentials_received",
        })
      ).rejects.toThrow("brand that does not match its provider");
      await expect(
        readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_brand_mismatch",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        detectedBrand: null,
        pollClaimId: "claim_brand_mismatch",
        provider: "lark",
        status: "pending_registration",
        updatedAtMs: 2000,
      });
    } finally {
      harness.close();
    }
  });

  it("scopes external identity links to provider and connection", async () => {
    const harness = createSqliteD1Harness();
    applyLarkPlatformMigrations(harness);
    try {
      await seedConnectedRegistration(harness);
      await expect(
        insertRemoteAgentLarkPlatformIdentityLinkIfAbsent({
          connectionId: "connection_lark_1",
          db: harness.db,
          nowMs: 3000,
          organizationId: "org_1",
          provider: "lark",
          providerUserId: "ou_user_1",
          resolutionSource: "explicit",
          openmeldUserId: "user_1",
        })
      ).resolves.toMatchObject({
        status: "created",
        record: {
          connectionId: "connection_lark_1",
          provider: "lark",
          providerUserId: "ou_user_1",
          openmeldUserId: "user_1",
        },
      });
      await expect(
        readRemoteAgentLarkPlatformIdentityLink({
          connectionId: "connection_lark_1",
          db: harness.db,
          provider: "lark",
          providerUserId: "ou_user_1",
        })
      ).resolves.toMatchObject({ openmeldUserId: "user_1" });
      await expect(
        insertRemoteAgentLarkPlatformIdentityLinkIfAbsent({
          connectionId: "connection_lark_1",
          db: harness.db,
          nowMs: 3100,
          organizationId: "org_1",
          provider: "feishu",
          providerUserId: "ou_user_1",
          resolutionSource: "explicit",
          openmeldUserId: "user_1",
        })
      ).rejects.toThrow("does not match its connection");
      await expect(
        insertRemoteAgentLarkPlatformIdentityLinkIfAbsent({
          connectionId: "connection_lark_1",
          db: harness.db,
          nowMs: 3200,
          organizationId: "org_2",
          provider: "lark",
          providerUserId: "ou_user_1",
          resolutionSource: "explicit",
          openmeldUserId: "user_1",
        })
      ).rejects.toThrow("conflicts with an existing scoped mapping");
      await expect(
        insertRemoteAgentLarkPlatformIdentityLinkIfAbsent({
          connectionId: "connection_lark_1",
          db: harness.db,
          nowMs: 3300,
          organizationId: "org_1",
          provider: "lark",
          providerUserId: "ou_user_1",
          resolutionSource: "explicit",
          openmeldUserId: "user_2",
        })
      ).rejects.toThrow("conflicts with an existing scoped mapping");
      await expect(
        insertRemoteAgentLarkPlatformIdentityLinkIfAbsent({
          connectionId: "connection_lark_1",
          db: harness.db,
          nowMs: 3400,
          organizationId: "org_1",
          provider: "lark",
          providerUserId: "ou_user_not_member",
          resolutionSource: "explicit",
          openmeldUserId: "user_2",
        })
      ).rejects.toThrow("Organization member");

      const connection = await readRemoteAgentLarkPlatformChannelConnection({
        connectionId: "connection_lark_1",
        db: harness.db,
      });
      if (!connection) {
        throw new Error("expected a connected Lark channel");
      }
      const identityLinks =
        await listRemoteAgentMessageChannelIdentityLinkProjections({
          connections: [projectRemoteAgentLarkPlatformConnection(connection)],
          identityDb: harness.db,
          organizationId: "org_1",
          stateDb: harness.db,
        });
      expect(identityLinks).toContainEqual({
        connectedAt: "1970-01-01T00:00:03.000Z",
        id: expect.stringMatching(MESSAGE_CHANNEL_IDENTITY_LINK_ID_PATTERN),
        openMeldUserId: "user_1",
        provider: "lark",
        providerAccountName: null,
      });
      const identityLinkId = identityLinks.find(
        (identityLink) =>
          identityLink.connectedAt === "1970-01-01T00:00:03.000Z"
      )?.id;
      if (!identityLinkId) {
        throw new Error("expected an opaque identity-link id");
      }
      const target = await findRemoteAgentMessageChannelIdentityLinkTarget({
        connections: [projectRemoteAgentLarkPlatformConnection(connection)],
        identityDb: harness.db,
        identityLinkId,
        organizationId: "org_1",
        stateDb: harness.db,
      });
      if (!target) {
        throw new Error("expected the identity-link deletion target");
      }
      await deleteRemoteAgentMessageChannelIdentityLinkTarget({
        identityDb: harness.db,
        organizationId: "org_1",
        stateDb: harness.db,
        target,
      });
      await expect(
        readRemoteAgentLarkPlatformIdentityLink({
          connectionId: "connection_lark_1",
          db: harness.db,
          provider: "lark",
          providerUserId: "ou_user_1",
        })
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it("idempotently consumes a claimed Message Channel identity token for an Organization member", async () => {
    const harness = createSqliteD1Harness();
    applyLarkPlatformMigrations(harness);
    try {
      await seedConnectedRegistration(harness);
      const token = await insertRemoteAgentMessageChannelIdentityLinkToken({
        connectionId: "connection_lark_1",
        db: harness.db,
        expiresAtMs: 10_000,
        issuedAtMs: 3000,
        organizationId: "org_1",
        provider: "lark",
        providerUserDisplayName: "Ada",
        providerUserId: "ou_user_1",
        tokenHash: "identity-token-hash",
      });

      await expect(
        readActiveRemoteAgentMessageChannelIdentityLinkToken({
          db: harness.db,
          nowMs: 3400,
          tokenHash: "identity-token-hash",
        })
      ).resolves.toEqual(token);
      const claimedToken =
        await claimRemoteAgentMessageChannelIdentityLinkToken({
          claimedAtMs: 3450,
          db: harness.db,
          token,
          openmeldUserId: "user_1",
        });
      if (!claimedToken) {
        throw new Error("expected the identity token to be claimed");
      }
      await setRemoteAgentLarkPlatformChannelConnectionStatus({
        connectionId: "connection_lark_1",
        db: harness.db,
        failureReasonCode: "provider.temporarily_unavailable",
        lastVerifiedAtMs: 2700,
        nowMs: 3500,
        organizationId: "org_1",
        provider: "lark",
        status: "repair_required",
      });
      await expect(
        consumeRemoteAgentMessageChannelIdentityLinkToken({
          db: harness.db,
          nowMs: 3600,
          token: claimedToken,
          openmeldUserId: "user_1",
        })
      ).resolves.toBe(false);
      await setRemoteAgentLarkPlatformChannelConnectionStatus({
        connectionId: "connection_lark_1",
        db: harness.db,
        failureReasonCode: null,
        lastVerifiedAtMs: 3900,
        nowMs: 3900,
        organizationId: "org_1",
        provider: "lark",
        status: "connected",
      });
      await expect(
        consumeRemoteAgentMessageChannelIdentityLinkToken({
          db: harness.db,
          nowMs: 4000,
          token: claimedToken,
          openmeldUserId: "user_1",
        })
      ).resolves.toBe(true);
      await expect(
        readActiveRemoteAgentMessageChannelIdentityLinkToken({
          db: harness.db,
          nowMs: 4000,
          tokenHash: "identity-token-hash",
        })
      ).resolves.toBeNull();
      await expect(
        readRemoteAgentLarkPlatformIdentityLink({
          connectionId: "connection_lark_1",
          db: harness.db,
          provider: "lark",
          providerUserId: "ou_user_1",
        })
      ).resolves.toMatchObject({
        organizationId: "org_1",
        resolutionSource: "explicit",
        openmeldUserId: "user_1",
      });
      await expect(
        consumeRemoteAgentMessageChannelIdentityLinkToken({
          db: harness.db,
          nowMs: 4100,
          token: claimedToken,
          openmeldUserId: "user_1",
        })
      ).resolves.toBe(true);
    } finally {
      harness.close();
    }
  });

  it("pre-claims a Message Channel connection token for the account selected by Center Agent", async () => {
    const harness = createSqliteD1Harness();
    applyLarkPlatformMigrations(harness);
    try {
      await seedConnectedRegistration(harness);
      const token = await insertRemoteAgentMessageChannelIdentityLinkToken({
        claimedByUserId: "user_1",
        connectionId: "connection_lark_1",
        db: harness.db,
        expiresAtMs: 10_000,
        issuedAtMs: 3000,
        organizationId: "org_1",
        provider: "lark",
        providerUserDisplayName: "Ada",
        providerUserId: "ou_user_1",
        tokenHash: "targeted-identity-token-hash",
      });

      expect(token).toMatchObject({
        claimedAtMs: 3000,
        claimedByUserId: "user_1",
      });
      await expect(
        readRemoteAgentMessageChannelIdentityLinkTokenForUser({
          db: harness.db,
          nowMs: 3500,
          tokenHash: token.tokenHash,
          openmeldUserId: "user_2",
        })
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it("keeps Message Channel identity tokens active when identity ownership conflicts", async () => {
    const harness = createSqliteD1Harness();
    applyLarkPlatformMigrations(harness);
    try {
      await seedConnectedRegistration(harness);
      const conflictingToken =
        await insertRemoteAgentMessageChannelIdentityLinkToken({
          connectionId: "connection_lark_1",
          db: harness.db,
          expiresAtMs: 10_000,
          issuedAtMs: 3000,
          organizationId: "org_1",
          provider: "lark",
          providerUserDisplayName: "Ada",
          providerUserId: "ou_user_1",
          tokenHash: "conflicting-token-hash",
        });
      await insertRemoteAgentLarkPlatformIdentityLinkIfAbsent({
        connectionId: "connection_lark_1",
        db: harness.db,
        nowMs: 4000,
        organizationId: "org_1",
        provider: "lark",
        providerUserId: "ou_user_1",
        resolutionSource: "explicit",
        openmeldUserId: "user_1",
      });
      await expect(
        consumeRemoteAgentMessageChannelIdentityLinkToken({
          db: harness.db,
          nowMs: 4100,
          token: conflictingToken,
          openmeldUserId: "user_2",
        })
      ).resolves.toBe(false);
      await expect(
        readActiveRemoteAgentMessageChannelIdentityLinkToken({
          db: harness.db,
          nowMs: 4100,
          tokenHash: conflictingToken.tokenHash,
        })
      ).resolves.toEqual(conflictingToken);
    } finally {
      harness.close();
    }
  });

  it("moves a Message Channel account after the provider user proves control with a claimed token", async () => {
    const harness = createSqliteD1Harness();
    applyLarkPlatformMigrations(harness);
    try {
      await seedConnectedRegistration(harness);
      await insertRemoteAgentLarkPlatformIdentityLinkIfAbsent({
        connectionId: "connection_lark_1",
        db: harness.db,
        nowMs: 3000,
        organizationId: "org_1",
        provider: "lark",
        providerUserId: "ou_user_1",
        resolutionSource: "explicit",
        openmeldUserId: "user_1",
      });
      const token = await insertRemoteAgentMessageChannelIdentityLinkToken({
        connectionId: "connection_lark_1",
        db: harness.db,
        expiresAtMs: 10_000,
        issuedAtMs: 4000,
        organizationId: "org_1",
        provider: "lark",
        providerUserDisplayName: "Ada",
        providerUserId: "ou_user_1",
        tokenHash: "replacement-token-hash",
      });
      const claimedToken =
        await claimRemoteAgentMessageChannelIdentityLinkToken({
          claimedAtMs: 4100,
          db: harness.db,
          token,
          openmeldUserId: "user_2",
        });
      if (!claimedToken) {
        throw new Error("expected the replacement token to be claimed");
      }

      await expect(
        consumeRemoteAgentMessageChannelIdentityLinkToken({
          db: harness.db,
          nowMs: 4200,
          token: claimedToken,
          openmeldUserId: "user_2",
        })
      ).resolves.toBe(true);
      await expect(
        readRemoteAgentLarkPlatformIdentityLink({
          connectionId: "connection_lark_1",
          db: harness.db,
          provider: "lark",
          providerUserId: "ou_user_1",
        })
      ).resolves.toMatchObject({
        organizationId: "org_1",
        resolutionSource: "explicit",
        openmeldUserId: "user_2",
      });
    } finally {
      harness.close();
    }
  });

  it("keeps context cursors isolated by connection generation", async () => {
    const harness = createSqliteD1Harness();
    applyLarkPlatformMigrations(harness);
    try {
      await seedConnectedRegistration(harness);
      await upsertRemoteAgentLarkPlatformContextCursor({
        chatId: "oc_chat_1",
        connectionGeneration: 1,
        connectionId: "connection_lark_1",
        db: harness.db,
        nowMs: 3000,
        organizationId: "org_1",
        provider: "lark",
        rootMessageId: "om_root_1",
        syncedThroughAtMs: 2900,
        syncedThroughMessageId: "om_message_1",
      });
      harness.run({
        params: [2, 3050, "connection_lark_1"],
        sql: `
          UPDATE openMeldRemoteAgent_lark_platform_channel_connections
          SET connection_generation = ?, updated_at_ms = ?
          WHERE connection_id = ?
        `,
      });
      await upsertRemoteAgentLarkPlatformContextCursor({
        chatId: "oc_chat_1",
        connectionGeneration: 2,
        connectionId: "connection_lark_1",
        db: harness.db,
        nowMs: 3100,
        organizationId: "org_1",
        provider: "lark",
        rootMessageId: "om_root_1",
        syncedThroughAtMs: 3050,
        syncedThroughMessageId: "om_message_2",
      });
      await expect(
        upsertRemoteAgentLarkPlatformContextCursor({
          chatId: "oc_chat_1",
          connectionGeneration: 1,
          connectionId: "connection_lark_1",
          db: harness.db,
          nowMs: 3200,
          organizationId: "org_1",
          provider: "lark",
          rootMessageId: "om_root_1",
          syncedThroughAtMs: 3150,
          syncedThroughMessageId: "om_stale_message",
        })
      ).rejects.toThrow("current connection generation");

      await expect(
        readRemoteAgentLarkPlatformContextCursor({
          chatId: "oc_chat_1",
          connectionGeneration: 1,
          connectionId: "connection_lark_1",
          db: harness.db,
          organizationId: "org_1",
          rootMessageId: "om_root_1",
        })
      ).resolves.toMatchObject({
        syncedThroughMessageId: "om_message_1",
      });
      await expect(
        readRemoteAgentLarkPlatformContextCursor({
          chatId: "oc_chat_1",
          connectionGeneration: 2,
          connectionId: "connection_lark_1",
          db: harness.db,
          organizationId: "org_1",
          rootMessageId: "om_root_1",
        })
      ).resolves.toMatchObject({
        syncedThroughMessageId: "om_message_2",
      });
    } finally {
      harness.close();
    }
  });

  it("namespaces the same raw provider event id across providers", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(
      harness,
      "openMeldRemoteAgent_message_channel_event_ingress"
    );
    try {
      const larkEventKey = buildRemoteAgentMessageChannelEventKey({
        connectionId: "connection_lark_1",
        provider: "lark",
        providerEventId: "event_same",
      });
      const feishuEventKey = buildRemoteAgentMessageChannelEventKey({
        connectionId: "connection_feishu_1",
        provider: "feishu",
        providerEventId: "event_same",
      });
      expect(larkEventKey).not.toBe(feishuEventKey);

      await expect(
        claimRemoteAgentMessageChannelEventIngress({
          claimExpiresAtMs: 2000,
          claimId: "claim_lark_1",
          connectionId: "connection_lark_1",
          db: harness.db,
          gatewayRequestId: "gateway_lark_1",
          nowMs: 1000,
          provider: "lark",
          providerEventId: "event_same",
          providerRetrySequence: null,
          queueAttempts: 1,
          queueMessageId: "queue_lark_1",
          receivedAtMs: 900,
          retryReasonCode: null,
        })
      ).resolves.toMatchObject({
        record: { eventKey: larkEventKey },
        status: "claimed",
      });
      await expect(
        claimRemoteAgentMessageChannelEventIngress({
          claimExpiresAtMs: 2000,
          claimId: "claim_feishu_1",
          connectionId: "connection_feishu_1",
          db: harness.db,
          gatewayRequestId: "gateway_feishu_1",
          nowMs: 1000,
          provider: "feishu",
          providerEventId: "event_same",
          providerRetrySequence: null,
          queueAttempts: 1,
          queueMessageId: "queue_feishu_1",
          receivedAtMs: 900,
          retryReasonCode: null,
        })
      ).resolves.toMatchObject({
        record: { eventKey: feishuEventKey },
        status: "claimed",
      });
    } finally {
      harness.close();
    }
  });

  it("refuses stale ingress workers after their event claim expires", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(
      harness,
      "openMeldRemoteAgent_message_channel_event_ingress"
    );
    try {
      const transitions = [
        {
          eventId: "event_complete",
          run: (eventKey: string) =>
            completeRemoteAgentMessageChannelEventIngress({
              claimId: "claim_event_complete",
              db: harness.db,
              eventKey,
              nativeDeliveryId: "delivery_1",
              nowMs: 2000,
              outcomeStatus: "submitted",
            }),
        },
        {
          eventId: "event_retry",
          run: (eventKey: string) =>
            releaseRemoteAgentMessageChannelEventIngressForRetry({
              claimId: "claim_event_retry",
              db: harness.db,
              eventKey,
              failureReasonCode: "provider_temporarily_unavailable",
              nowMs: 2000,
            }),
        },
        {
          eventId: "event_fail",
          run: (eventKey: string) =>
            failRemoteAgentMessageChannelEventIngress({
              claimId: "claim_event_fail",
              db: harness.db,
              eventKey,
              failureReasonCode: "invalid_event",
              nowMs: 2000,
            }),
        },
      ] as const;

      for (const transition of transitions) {
        const claimId = `claim_${transition.eventId}`;
        const claimed = await claimRemoteAgentMessageChannelEventIngress({
          claimExpiresAtMs: 2000,
          claimId,
          connectionId: "connection_lark_1",
          db: harness.db,
          gatewayRequestId: `gateway_${transition.eventId}`,
          nowMs: 1000,
          provider: "lark",
          providerEventId: transition.eventId,
          providerRetrySequence: null,
          queueAttempts: 1,
          queueMessageId: `queue_${transition.eventId}`,
          receivedAtMs: 900,
          retryReasonCode: null,
        });
        expect(claimed.status).toBe("claimed");

        await expect(transition.run(claimed.record.eventKey)).resolves.toBe(
          false
        );
        await expect(
          readRemoteAgentMessageChannelEventIngress({
            db: harness.db,
            eventKey: claimed.record.eventKey,
          })
        ).resolves.toMatchObject({
          claimExpiresAtMs: 2000,
          claimId,
          state: "processing",
          updatedAtMs: 1000,
        });
      }
    } finally {
      harness.close();
    }
  });

  it("keeps a durably failed event terminal when the provider delivers it again", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(
      harness,
      "openMeldRemoteAgent_message_channel_event_ingress"
    );
    try {
      const firstClaim = await claimRemoteAgentMessageChannelEventIngress({
        claimExpiresAtMs: 5000,
        claimId: "claim_event_terminal_1",
        connectionId: "connection_lark_1",
        db: harness.db,
        gatewayRequestId: "gateway_event_terminal_1",
        nowMs: 1000,
        provider: "lark",
        providerEventId: "event_terminal",
        providerRetrySequence: null,
        queueAttempts: 4,
        queueMessageId: "queue_event_terminal_1",
        receivedAtMs: 900,
        retryReasonCode: null,
      });
      expect(firstClaim.status).toBe("claimed");
      await expect(
        failRemoteAgentMessageChannelEventIngress({
          claimId: "claim_event_terminal_1",
          db: harness.db,
          eventKey: firstClaim.record.eventKey,
          failureReasonCode: "lark.message_http_429",
          nowMs: 2000,
        })
      ).resolves.toBe(true);

      await expect(
        claimRemoteAgentMessageChannelEventIngress({
          claimExpiresAtMs: 6000,
          claimId: "claim_event_terminal_2",
          connectionId: "connection_lark_1",
          db: harness.db,
          gatewayRequestId: "gateway_event_terminal_2",
          nowMs: 3000,
          provider: "lark",
          providerEventId: "event_terminal",
          providerRetrySequence: 1,
          queueAttempts: 1,
          queueMessageId: "queue_event_terminal_2",
          receivedAtMs: 2900,
          retryReasonCode: "provider_retry",
        })
      ).resolves.toMatchObject({
        record: {
          failureReasonCode: "lark.message_http_429",
          state: "failed",
        },
        status: "duplicate",
      });
    } finally {
      harness.close();
    }
  });

  it("never repairs a connection that no longer matches the expired registration owner", async () => {
    const harness = createSqliteD1Harness();
    applyLarkPlatformMigrations(harness);
    try {
      await seedConfiguringRegistration(harness);
      harness.run({
        params: ["org_2", "attempt_lark_1"],
        sql: `
          UPDATE openMeldRemoteAgent_lark_platform_registration_attempts
          SET organization_id = ?
          WHERE attempt_id = ?
        `,
      });

      await expect(
        expireRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_lark_1",
          db: harness.db,
          nowMs: 10_001,
        })
      ).resolves.toMatchObject({
        consumedAtMs: 10_001,
        organizationId: "org_2",
        status: "repair_required",
      });
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_lark_1",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        failureReasonCode: null,
        organizationId: "org_1",
        status: "configuring",
      });
    } finally {
      harness.close();
    }
  });

  it("never combines late and out-of-order Webhook evidence to revive an expired registration", async () => {
    const harness = createSqliteD1Harness();
    applyLarkPlatformMigrations(harness);
    try {
      await seedConfiguringRegistration(harness);
      await completeRemoteAgentLarkPlatformRegistration({
        attemptId: "attempt_lark_1",
        botName: "Center Agent",
        botOpenId: "ou_bot_1",
        claimId: "claim_lark_configure",
        connectionId: "connection_lark_1",
        db: harness.db,
        grantedCapabilityGroups: ["conversation.text"],
        nextPollAtMs: 3700,
        nowMs: 2700,
      });

      await recordRemoteAgentLarkPlatformWebhookReachability({
        connectionId: "connection_lark_1",
        db: harness.db,
        organizationId: "org_1",
        provider: "lark",
        surface: "callbacks",
        verifiedAtMs: 10_001,
      });
      await expect(
        recordRemoteAgentLarkPlatformWebhookReachability({
          connectionId: "connection_lark_1",
          db: harness.db,
          organizationId: "org_1",
          provider: "lark",
          surface: "events",
          verifiedAtMs: 9999,
        })
      ).resolves.toMatchObject({
        callbacksWebhookVerifiedAtMs: 10_001,
        eventsWebhookVerifiedAtMs: 9999,
        lastVerifiedAtMs: null,
        status: "configuring",
      });
      await expect(
        readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_lark_1",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        consumedAtMs: null,
        status: "configuring",
      });

      await expect(
        expireRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_lark_1",
          db: harness.db,
          nowMs: 10_002,
        })
      ).resolves.toMatchObject({
        consumedAtMs: 10_002,
        failureReasonCode: "lark.registration_expired",
        status: "repair_required",
      });
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_lark_1",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        failureReasonCode: "lark.registration_expired",
        status: "repair_required",
      });
    } finally {
      harness.close();
    }
  });
});

function applyLarkPlatformMigrations(
  harness: Parameters<typeof applyMigrationForTable>[0]
): void {
  harness.run({ sql: "CREATE TABLE users (id TEXT PRIMARY KEY)" });
  harness.run({ sql: "CREATE TABLE organizations (id TEXT PRIMARY KEY)" });
  harness.run({
    sql: `
      CREATE TABLE members (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        user_id TEXT NOT NULL
      )
    `,
  });
  harness.run({
    sql: "INSERT INTO users (id) VALUES ('user_1'), ('user_2')",
  });
  harness.run({
    sql: "INSERT INTO organizations (id) VALUES ('org_1'), ('org_2')",
  });
  harness.run({
    sql: `
      INSERT INTO members (id, organization_id, user_id)
      VALUES ('member_1', 'org_1', 'user_1')
    `,
  });
  applyDrizzleMigrationsForTables(harness, [
    "openMeldRemoteAgent_lark_platform_channel_connections",
    "openMeldRemoteAgent_message_channel_identity_link_tokens",
  ]);
  applyMigrationForTable(
    harness,
    "openMeldRemoteAgent_lark_platform_registration_attempts"
  );
}

async function seedConnectedRegistration(
  harness: ReturnType<typeof createSqliteD1Harness>
): Promise<void> {
  await seedConfiguringRegistration(harness);
  await recordRemoteAgentLarkPlatformWebhookReachability({
    connectionId: "connection_lark_1",
    db: harness.db,
    organizationId: "org_1",
    provider: "lark",
    surface: "events",
    verifiedAtMs: 2650,
  });
  await recordRemoteAgentLarkPlatformWebhookReachability({
    connectionId: "connection_lark_1",
    db: harness.db,
    organizationId: "org_1",
    provider: "lark",
    surface: "callbacks",
    verifiedAtMs: 2675,
  });
  await completeRemoteAgentLarkPlatformRegistration({
    attemptId: "attempt_lark_1",
    botName: "Center Agent",
    botOpenId: "ou_bot_1",
    claimId: "claim_lark_configure",
    connectionId: "connection_lark_1",
    db: harness.db,
    grantedCapabilityGroups: ["conversation.text"],
    nextPollAtMs: 3700,
    nowMs: 2700,
  });
}

async function seedConfiguringRegistration(
  harness: ReturnType<typeof createSqliteD1Harness>
): Promise<void> {
  await createRemoteAgentLarkPlatformRegistrationAttempt({
    accountDomain: "https://open.larksuite.com",
    attemptId: "attempt_lark_1",
    db: harness.db,
    encryptedDeviceCode: "encrypted-device-code",
    encryptedRegistrationUrl: "encrypted-registration-url",
    expiresAtMs: 10_000,
    initiatedByProfileId: "profile_1",
    initiatedByUserId: "user_1",
    nextPollAtMs: 2000,
    nowMs: 1000,
    organizationId: "org_1",
    permissionBundleVersion: "channel-v1",
    permissionMode: "channel_only_template",
    pollIntervalMs: 1000,
    provider: "lark",
    returnPath: "/center-agent/channels",
  });
  await claimRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: "attempt_lark_1",
    claimExpiresAtMs: 4000,
    claimId: "claim_lark_1",
    db: harness.db,
    nowMs: 2000,
  });
  await persistRemoteAgentLarkPlatformRegistrationCredentials({
    appId: "cli_lark_1",
    attemptId: "attempt_lark_1",
    claimId: "claim_lark_1",
    connectionGeneration: 1,
    connectionId: "connection_lark_1",
    configurationExpiresAtMs: 10_000,
    credentialFormatVersion: 1,
    db: harness.db,
    encryptedAppSecret: "encrypted-app-secret",
    encryptedEventEncryptKey: null,
    encryptedVerificationToken: null,
    nowMs: 2500,
    operatorOpenId: "ou_installer_1",
    tenantKey: "tenant_lark_1",
    transport: "webhook",
  });
  await claimRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: "attempt_lark_1",
    claimExpiresAtMs: 5000,
    claimId: "claim_lark_configure",
    db: harness.db,
    nowMs: 2600,
  });
}
