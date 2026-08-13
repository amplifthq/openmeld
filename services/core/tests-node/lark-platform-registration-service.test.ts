import { describe, expect, it, vi } from "vitest";
import capturedBegin from "../../../scripts/lark-platform/fixtures/registration-begin.lark.json";
import capturedPending from "../../../scripts/lark-platform/fixtures/registration-pending.lark.json";
import capturedSuccess from "../../../scripts/lark-platform/fixtures/registration-success.lark.json";
import { LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE } from "../src/remote-agent/application/lark-platform-permission-bundles";
import { runLarkPlatformRegistrationTick } from "../src/remote-agent/application/lark-platform-registration-scheduler";
import {
  beginRemoteAgentLarkPlatformRegistration,
  disconnectRemoteAgentLarkPlatformRegistration,
  LarkPlatformRegistrationServiceError,
  listRemoteAgentActiveLarkPlatformRegistrations,
  pollRemoteAgentLarkPlatformRegistration,
} from "../src/remote-agent/application/lark-platform-registration-service";
import {
  readRemoteAgentLarkPlatformChannelConnection,
  readRemoteAgentLarkPlatformChannelCredentials,
} from "../src/remote-agent/infrastructure/d1/lark-platform-channel-connection-repo";
import {
  readRemoteAgentLarkPlatformContextCursor,
  upsertRemoteAgentLarkPlatformContextCursor,
} from "../src/remote-agent/infrastructure/d1/lark-platform-context-cursor-repo";
import { readRemoteAgentLarkPlatformIdentityLink } from "../src/remote-agent/infrastructure/d1/lark-platform-identity-link-repo";
import {
  claimRemoteAgentLarkPlatformRegistrationAttempt,
  createRemoteAgentLarkPlatformRegistrationAttempt,
  expireRemoteAgentLarkPlatformRegistrationAttempt,
  readActiveRemoteAgentLarkPlatformRegistrationAttempt,
  readRemoteAgentLarkPlatformRegistrationAttempt,
  recordRemoteAgentLarkPlatformWebhookReachability,
  replacePendingRemoteAgentLarkPlatformRegistrationAttempt,
} from "../src/remote-agent/infrastructure/d1/lark-platform-registration-attempt-repo";
import {
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const CRYPTO_KEY = btoa("0123456789abcdef0123456789abcdef");
const ACTOR = {
  organizationId: "org_1",
  profileId: "profile_1",
  userId: "user_1",
} as const;
const SECOND_MANAGER = {
  organizationId: "org_1",
  profileId: "profile_2",
  userId: "user_2",
} as const;
const ENV = {
  OPENMELD_FEISHU_CHANNEL_ENABLED: "false",
  OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS: "",
  OPENMELD_GATEWAY_URL: "https://gateway-dev.openmeld.ai",
  OPENMELD_LARK_CHANNEL_ENABLED: "true",
  OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS: "org_1",
  LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY: CRYPTO_KEY,
} as const;
const classifyOrganizationWorkspace = async () =>
  ({ ok: true, personal: false }) as const;
describe("Lark-platform registration service", () => {
  it("projects active setup without decrypting its setup URL", async () => {
    const harness = createRegistrationHarness();
    try {
      await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_active_projection",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });

      await expect(
        listRemoteAgentActiveLarkPlatformRegistrations({
          db: harness.db,
          organizationId: ACTOR.organizationId,
          providers: ["lark"],
          viewer: { ...ACTOR, canManage: true },
        })
      ).resolves.toEqual([
        {
          canResume: true,
          expiresAt: "1970-01-01T01:00:01.000Z",
          id: "attempt_active_projection",
          nextPollAt: "1970-01-01T00:00:01.000Z",
          provider: "lark",
          reasonCode: null,
          status: "pending_registration",
        },
      ]);
      await expect(
        listRemoteAgentActiveLarkPlatformRegistrations({
          db: harness.db,
          organizationId: ACTOR.organizationId,
          providers: ["lark"],
          viewer: {
            canManage: true,
            organizationId: ACTOR.organizationId,
            profileId: "human_profile_other_admin",
            userId: "user_other_admin",
          },
        })
      ).resolves.toEqual([
        expect.objectContaining({
          canResume: false,
          id: "attempt_active_projection",
        }),
      ]);
    } finally {
      harness.close();
    }
  });

  it("continues a due registration after Web stops polling", async () => {
    const harness = createRegistrationHarness();
    try {
      await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_background",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });

      await runLarkPlatformRegistrationTick({
        classifyOrganization: classifyOrganizationWorkspace,
        createId: () => "claim_provider",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch({ user_info: { tenant_brand: "lark" } }),
        nowMs: 1100,
      });

      const summary = await runLarkPlatformRegistrationTick({
        classifyOrganization: classifyOrganizationWorkspace,
        createId: vi
          .fn<() => string>()
          .mockReturnValueOnce("claim_background")
          .mockReturnValueOnce("connection_background"),
        createSecret: vi
          .fn<() => string>()
          .mockReturnValueOnce("verification-token")
          .mockReturnValueOnce("event-encrypt-key"),
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedSuccess),
        nowMs: 1200,
      });

      expect(summary).toEqual({
        errors: 0,
        processed: 1,
        scanned: 1,
      });
      await expect(
        readActiveRemoteAgentLarkPlatformRegistrationAttempt({
          db: harness.db,
          organizationId: ACTOR.organizationId,
          provider: "lark",
        })
      ).resolves.toMatchObject({
        attemptId: "attempt_background",
        connectionId: "connection_background",
        status: "configuring",
      });
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_background",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        appId: "<redacted-development-app-id>",
        organizationId: ACTOR.organizationId,
        provider: "lark",
        status: "configuring",
      });
    } finally {
      harness.close();
    }
  });

  it("stops a due Personal Workspace registration before calling the provider", async () => {
    const harness = createRegistrationHarness();
    try {
      await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_personal_background",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });
      const fetchImpl = vi.fn<typeof fetch>();

      await expect(
        runLarkPlatformRegistrationTick({
          classifyOrganization: async () => ({ ok: true, personal: true }),
          db: harness.db,
          env: ENV,
          fetchImpl,
          nowMs: 1100,
        })
      ).resolves.toEqual({ errors: 0, processed: 1, scanned: 1 });
      await expect(
        readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_personal_background",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        consumedAtMs: 1100,
        failureReasonCode: "lark.organization_required",
        status: "repair_required",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("quarantines a due registration when its Organization cannot be classified", async () => {
    const harness = createRegistrationHarness();
    try {
      await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_unclassified_background",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });
      const classifyOrganization = vi.fn(async () => ({ ok: false }) as const);
      const fetchImpl = vi.fn<typeof fetch>();

      await expect(
        runLarkPlatformRegistrationTick({
          classifyOrganization,
          db: harness.db,
          env: ENV,
          fetchImpl,
          nowMs: 1100,
        })
      ).resolves.toEqual({ errors: 0, processed: 1, scanned: 1 });
      await expect(
        readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_unclassified_background",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        consumedAtMs: 1100,
        failureReasonCode: "organization.context_unavailable",
        status: "repair_required",
      });
      await expect(
        runLarkPlatformRegistrationTick({
          classifyOrganization,
          db: harness.db,
          env: ENV,
          fetchImpl,
          nowMs: 1200,
        })
      ).resolves.toEqual({ errors: 0, processed: 0, scanned: 0 });
      expect(classifyOrganization).toHaveBeenCalledTimes(1);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("expires a durable attempt without another Web request", async () => {
    const harness = createRegistrationHarness();
    try {
      const started = await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_expired_background",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });
      const fetchImpl = vi.fn<typeof fetch>();

      await expect(
        runLarkPlatformRegistrationTick({
          classifyOrganization: classifyOrganizationWorkspace,
          db: harness.db,
          env: ENV,
          fetchImpl,
          nowMs: Date.parse(started.attempt.expiresAt),
        })
      ).resolves.toEqual({ errors: 0, processed: 1, scanned: 1 });
      await expect(
        readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_expired_background",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        failureReasonCode: "lark.registration_expired",
        status: "repair_required",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("does not call the provider when an open Web poll owns the lease", async () => {
    const harness = createRegistrationHarness();
    try {
      await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_web_claim",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });
      await claimRemoteAgentLarkPlatformRegistrationAttempt({
        attemptId: "attempt_web_claim",
        claimExpiresAtMs: 31_100,
        claimId: "web_claim",
        db: harness.db,
        nowMs: 1100,
      });
      const fetchImpl = vi.fn<typeof fetch>();

      await expect(
        runLarkPlatformRegistrationTick({
          classifyOrganization: classifyOrganizationWorkspace,
          db: harness.db,
          env: ENV,
          fetchImpl,
          nowMs: 1100,
        })
      ).resolves.toEqual({ errors: 0, processed: 0, scanned: 0 });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("aborts a provider request before its registration claim can expire", async () => {
    const harness = createRegistrationHarness();
    const deadline = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(deadline.signal);
    try {
      await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_provider_deadline",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });
      const fetchImpl = vi.fn<typeof fetch>(
        (_resource, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) {
              reject(new Error("expected provider request deadline"));
              return;
            }
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
            deadline.abort(
              new DOMException(
                "The provider request timed out.",
                "TimeoutError"
              )
            );
          })
      );

      await expect(
        pollRemoteAgentLarkPlatformRegistration({
          actor: ACTOR,
          attemptId: "attempt_provider_deadline",
          createId: () => "deadline_claim",
          db: harness.db,
          env: ENV,
          fetchImpl,
          nowMs: 1100,
          provider: "lark",
          providerRequestTimeoutMs: 1,
        })
      ).resolves.toMatchObject({
        attempt: {
          reasonCode: "lark.registration_transport_failed",
          status: "pending_registration",
        },
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await expect(
        readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_provider_deadline",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        pollClaimExpiresAtMs: null,
        pollClaimId: null,
      });
      expect(timeout).toHaveBeenCalledWith(1);
    } finally {
      timeout.mockRestore();
      harness.close();
    }
  });

  it("keeps the Web Crypto receiver when creating default registration IDs", async () => {
    const harness = createRegistrationHarness();
    const ids = [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ] as const;
    let idIndex = 0;
    const randomUuid = vi
      .spyOn(crypto, "randomUUID")
      .mockImplementation(function (this: Crypto) {
        if (this !== crypto) {
          throw new TypeError("Illegal invocation");
        }
        const id = ids[idIndex];
        if (!id) {
          throw new Error("Unexpected registration ID request");
        }
        idIndex += 1;
        return id;
      });
    try {
      const started = await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });
      expect(started.attempt.id).toBe(ids[0]);

      await expect(
        pollRemoteAgentLarkPlatformRegistration({
          actor: ACTOR,
          attemptId: ids[0],
          db: harness.db,
          env: ENV,
          fetchImpl: jsonFetch(capturedPending, 400),
          nowMs: 1100,
          provider: "lark",
        })
      ).resolves.toMatchObject({
        attempt: {
          id: ids[0],
          status: "pending_registration",
        },
      });
      expect(randomUuid).toHaveBeenCalledTimes(2);
    } finally {
      randomUuid.mockRestore();
      harness.close();
    }
  });

  it("resumes one encrypted pending attempt without starting another device flow", async () => {
    const harness = createRegistrationHarness();
    try {
      const fetchImpl = vi.fn<typeof fetch>(() =>
        Promise.resolve(Response.json(capturedBegin))
      );
      const first = await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_1",
        db: harness.db,
        env: ENV,
        fetchImpl,
        nowMs: 1000,
        provider: "lark",
      });

      expect(first).toMatchObject({
        attempt: {
          id: "attempt_1",
          provider: "lark",
          registrationUrl: expect.any(String),
          status: "pending_registration",
        },
        connection: null,
        organizationId: "org_1",
      });
      expect(
        first.attempt.registrationUrl?.startsWith(
          "https://open.feishu.cn/page/launcher"
        )
      ).toBe(true);

      const record = await readActiveRemoteAgentLarkPlatformRegistrationAttempt(
        {
          db: harness.db,
          organizationId: "org_1",
          provider: "lark",
        }
      );
      expect(record).toMatchObject({
        initiatedByProfileId: "profile_1",
        initiatedByUserId: "user_1",
        returnPath: "/center-agent/channels",
      });
      expect(record?.encryptedDeviceCode).not.toContain(
        "<redacted-device-code>"
      );
      expect(record?.encryptedRegistrationUrl).not.toContain("open.feishu.cn");

      const resumed = await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "must_not_be_used",
        db: harness.db,
        env: ENV,
        fetchImpl,
        nowMs: 1100,
        provider: "lark",
      });
      expect(resumed).toEqual(first);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("does not treat a pending device flow as an existing-app repair", async () => {
    const harness = createRegistrationHarness();
    try {
      const fetchImpl = vi.fn<typeof fetch>(() =>
        Promise.resolve(Response.json(capturedBegin))
      );
      await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_pending_repair",
        db: harness.db,
        env: ENV,
        fetchImpl,
        nowMs: 1000,
        provider: "lark",
      });

      await expect(
        beginRemoteAgentLarkPlatformRegistration({
          actor: ACTOR,
          createId: () => "must_not_be_used",
          db: harness.db,
          env: ENV,
          fetchImpl,
          nowMs: 1100,
          provider: "lark",
          repairExisting: true,
        })
      ).rejects.toMatchObject({
        reasonCode: "lark.repair_unavailable",
        status: 409,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("replaces a pending attempt when the user explicitly starts over", async () => {
    const harness = createRegistrationHarness();
    try {
      const fetchImpl = vi.fn<typeof fetch>(() =>
        Promise.resolve(Response.json(capturedBegin))
      );
      await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_1",
        db: harness.db,
        env: ENV,
        fetchImpl,
        nowMs: 1000,
        provider: "lark",
      });

      const restartInput = {
        actor: ACTOR,
        createId: () => "attempt_2",
        db: harness.db,
        env: ENV,
        fetchImpl,
        nowMs: 1100,
        provider: "lark" as const,
        restartPending: true,
      };
      const restarted =
        await beginRemoteAgentLarkPlatformRegistration(restartInput);

      expect(restarted).toMatchObject({
        attempt: {
          id: "attempt_2",
          provider: "lark",
          registrationUrl: expect.any(String),
          status: "pending_registration",
        },
        connection: null,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await expect(
        readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_1",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        consumedAtMs: 1100,
        failureReasonCode: "lark.registration_restarted",
        status: "repair_required",
      });
    } finally {
      harness.close();
    }
  });

  it("returns the concurrent replacement when another restart wins the race", async () => {
    const harness = createRegistrationHarness();
    try {
      await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_1",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });
      const first = await readRemoteAgentLarkPlatformRegistrationAttempt({
        attemptId: "attempt_1",
        db: harness.db,
      });
      expect(first).not.toBeNull();
      if (!first) {
        throw new Error("Expected the first registration attempt");
      }
      harness.run({
        params: [1050, 1050, first.attemptId],
        sql: `
          UPDATE openMeldRemoteAgent_lark_platform_registration_attempts
          SET
            status = 'repair_required',
            failure_reason_code = 'lark.registration_restarted',
            consumed_at_ms = ?,
            updated_at_ms = ?
          WHERE attempt_id = ?
        `,
      });
      const commonInput = {
        accountDomain: first.accountDomain,
        db: harness.db,
        encryptedDeviceCode: first.encryptedDeviceCode,
        encryptedRegistrationUrl: first.encryptedRegistrationUrl,
        expiresAtMs: first.expiresAtMs,
        initiatedByProfileId: first.initiatedByProfileId,
        initiatedByUserId: first.initiatedByUserId,
        nextPollAtMs: 1200,
        organizationId: first.organizationId,
        permissionBundleVersion: first.permissionBundleVersion,
        permissionMode: first.permissionMode,
        pollIntervalMs: first.pollIntervalMs,
        provider: first.provider,
        returnPath: first.returnPath,
      };
      await createRemoteAgentLarkPlatformRegistrationAttempt({
        ...commonInput,
        attemptId: "attempt_race_winner",
        nowMs: 1060,
      });

      await expect(
        replacePendingRemoteAgentLarkPlatformRegistrationAttempt({
          ...commonInput,
          attemptId: "attempt_race_loser",
          nowMs: 1070,
          replacedAttemptId: first.attemptId,
        })
      ).resolves.toMatchObject({ attemptId: "attempt_race_winner" });
      await expect(
        readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_race_loser",
          db: harness.db,
        })
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it("persists credentials, resumes Webhook configuration, and connects only after verification", async () => {
    const harness = createRegistrationHarness();
    try {
      await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_1",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });

      const switched = await pollRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        attemptId: "attempt_1",
        createId: () => "claim_switch",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch({ user_info: { tenant_brand: "lark" } }),
        nowMs: 1100,
        provider: "lark",
      });
      expect(switched.attempt).toMatchObject({
        provider: "lark",
        status: "pending_registration",
      });

      const credentialIds = vi
        .fn<() => string>()
        .mockReturnValueOnce("claim_credentials")
        .mockReturnValueOnce("connection_1");
      const credentialSecrets = vi
        .fn<() => string>()
        .mockReturnValueOnce("verification-token")
        .mockReturnValueOnce("event-encrypt-key");
      const configuring = await pollRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        attemptId: "attempt_1",
        createId: credentialIds,
        createSecret: credentialSecrets,
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedSuccess),
        nowMs: 1200,
        provider: "lark",
      });
      expect(configuring).toMatchObject({
        attempt: {
          registrationUrl: null,
          status: "configuring",
        },
        connection: {
          id: "connection_1",
          provider: "lark",
          status: "configuring",
        },
      });
      const credentials = await readRemoteAgentLarkPlatformChannelCredentials({
        connectionId: "connection_1",
        db: harness.db,
      });
      expect(credentials?.encryptedAppSecret).not.toContain(
        "<redacted-development-app-secret>"
      );

      const configureFetch = configuredAppFetch();
      const awaitingWebhook = await pollRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        attemptId: "attempt_1",
        createId: () => "claim_configure",
        db: harness.db,
        env: ENV,
        fetchImpl: configureFetch,
        nowMs: 1300,
        provider: "lark",
      });
      expect(awaitingWebhook).toMatchObject({
        attempt: {
          registrationUrl: null,
          status: "configuring",
        },
        connection: {
          externalAccountName: "OpenMeld Center Agent",
          grantedCapabilityGroups: ["conversation.text"],
          id: "connection_1",
          status: "configuring",
          transport: "webhook",
        },
      });
      expect(configureFetch).toHaveBeenCalledTimes(4);
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_1",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        botOpenId: "ou_bot",
        lastVerifiedAtMs: null,
        status: "configuring",
      });
      await recordRemoteAgentLarkPlatformWebhookReachability({
        connectionId: "connection_1",
        db: harness.db,
        organizationId: ACTOR.organizationId,
        provider: "lark",
        surface: "callbacks",
        verifiedAtMs: 1400,
      });
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_1",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        callbacksWebhookVerifiedAtMs: 1400,
        eventsWebhookVerifiedAtMs: null,
        lastVerifiedAtMs: null,
        status: "configuring",
      });
      await recordRemoteAgentLarkPlatformWebhookReachability({
        connectionId: "connection_1",
        db: harness.db,
        organizationId: ACTOR.organizationId,
        provider: "lark",
        surface: "events",
        verifiedAtMs: 1450,
      });
      const finalizeFetch = vi.fn<typeof fetch>();
      const connected = await pollRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        attemptId: "attempt_1",
        createId: () => "claim_verified_webhook",
        db: harness.db,
        env: ENV,
        fetchImpl: finalizeFetch,
        nowMs: 3_700_000,
        provider: "lark",
      });
      expect(connected).toMatchObject({
        attempt: { status: "connected" },
        connection: {
          id: "connection_1",
          lastVerifiedAt: "1970-01-01T00:00:01.450Z",
          status: "connected",
        },
      });
      expect(finalizeFetch).not.toHaveBeenCalled();
      await expect(
        beginRemoteAgentLarkPlatformRegistration({
          actor: SECOND_MANAGER,
          createId: () => "must_not_be_used",
          db: harness.db,
          env: ENV,
          fetchImpl: finalizeFetch,
          nowMs: 3_700_001,
          provider: "lark",
          repairExisting: true,
        })
      ).rejects.toMatchObject({
        reasonCode: "lark.connection_already_exists",
        status: 409,
      });
      await upsertRemoteAgentLarkPlatformContextCursor({
        chatId: "chat_1",
        connectionGeneration: 1,
        connectionId: "connection_1",
        db: harness.db,
        nowMs: 3_700_050,
        organizationId: "org_1",
        provider: "lark",
        rootMessageId: "root_1",
        syncedThroughAtMs: 3_700_050,
        syncedThroughMessageId: "message_1",
      });
      await expect(
        readRemoteAgentLarkPlatformIdentityLink({
          connectionId: "connection_1",
          db: harness.db,
          provider: "lark",
          providerUserId: "<redacted-operator-open-id>",
        })
      ).resolves.toMatchObject({
        resolutionSource: "installer",
        openmeldUserId: "user_1",
      });

      const disconnected = await disconnectRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        db: harness.db,
        nowMs: 3_700_100,
        provider: "lark",
      });
      expect(disconnected).toMatchObject({
        id: "connection_1",
        provider: "lark",
        status: "disconnected",
      });
      await expect(
        readRemoteAgentLarkPlatformChannelCredentials({
          connectionId: "connection_1",
          db: harness.db,
        })
      ).resolves.toBeNull();
      await expect(
        readRemoteAgentLarkPlatformIdentityLink({
          connectionId: "connection_1",
          db: harness.db,
          provider: "lark",
          providerUserId: "<redacted-operator-open-id>",
        })
      ).resolves.toBeNull();
      await expect(
        readRemoteAgentLarkPlatformContextCursor({
          chatId: "chat_1",
          connectionGeneration: 1,
          connectionId: "connection_1",
          db: harness.db,
          organizationId: "org_1",
          rootMessageId: "root_1",
        })
      ).resolves.toBeNull();

      const restarted = await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_2",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 3_700_200,
        provider: "lark",
      });
      expect(restarted).toMatchObject({
        attempt: {
          id: "attempt_2",
          provider: "lark",
          status: "pending_registration",
        },
        connection: null,
      });
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_1",
          db: harness.db,
        })
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it("keeps saved app credentials alive beyond the device flow and repairs the same app", async () => {
    const harness = createRegistrationHarness();
    try {
      await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_repair",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });
      await pollRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        attemptId: "attempt_repair",
        createId: () => "claim_brand",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch({ user_info: { tenant_brand: "lark" } }),
        nowMs: 1100,
        provider: "lark",
      });
      const ids = vi
        .fn<() => string>()
        .mockReturnValueOnce("claim_credentials")
        .mockReturnValueOnce("connection_repair");
      const secrets = vi
        .fn<() => string>()
        .mockReturnValueOnce("verification-token")
        .mockReturnValueOnce("event-encrypt-key");
      await pollRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        attemptId: "attempt_repair",
        createId: ids,
        createSecret: secrets,
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedSuccess),
        nowMs: 1200,
        provider: "lark",
      });

      const configuring = await readRemoteAgentLarkPlatformRegistrationAttempt({
        attemptId: "attempt_repair",
        db: harness.db,
      });
      expect(configuring?.expiresAtMs).toBeGreaterThan(3_601_000);
      const initialConfigurationFetch = configuredAppFetch();
      await pollRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        attemptId: "attempt_repair",
        createId: () => "claim_initial_configuration",
        db: harness.db,
        env: ENV,
        fetchImpl: initialConfigurationFetch,
        nowMs: 1300,
        provider: "lark",
      });
      expect(initialConfigurationFetch).toHaveBeenCalledTimes(4);
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_repair",
          db: harness.db,
        })
      ).resolves.toMatchObject({ botOpenId: "ou_bot" });
      const credentialsBefore =
        await readRemoteAgentLarkPlatformChannelCredentials({
          connectionId: "connection_repair",
          db: harness.db,
        });
      expect(credentialsBefore).not.toBeNull();

      const repairAtMs = configuring?.expiresAtMs ?? 0;
      await expireRemoteAgentLarkPlatformRegistrationAttempt({
        attemptId: "attempt_repair",
        db: harness.db,
        nowMs: repairAtMs,
      });
      const providerFetch = vi.fn<typeof fetch>();
      const repaired = await beginRemoteAgentLarkPlatformRegistration({
        actor: SECOND_MANAGER,
        createId: () => "attempt_repair_2",
        db: harness.db,
        env: ENV,
        fetchImpl: providerFetch,
        nowMs: repairAtMs + 1,
        provider: "lark",
        repairExisting: true,
      });

      expect(repaired).toMatchObject({
        attempt: {
          id: "attempt_repair_2",
          reasonCode: null,
          registrationUrl: null,
          status: "configuring",
        },
        connection: {
          id: "connection_repair",
          reasonCode: null,
          status: "configuring",
        },
      });
      await expect(
        readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_repair_2",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        initiatedByProfileId: SECOND_MANAGER.profileId,
        initiatedByUserId: SECOND_MANAGER.userId,
      });
      expect(providerFetch).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_repair",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        botName: null,
        botOpenId: null,
        grantedCapabilityGroups: [],
      });
      await expect(
        beginRemoteAgentLarkPlatformRegistration({
          actor: ACTOR,
          createId: () => "must_not_be_used",
          db: harness.db,
          env: ENV,
          fetchImpl: providerFetch,
          nowMs: repairAtMs + 1,
          provider: "lark",
          repairExisting: true,
        })
      ).resolves.toMatchObject({
        attempt: { id: "attempt_repair_2", status: "configuring" },
        connection: { id: "connection_repair", status: "configuring" },
      });
      await expect(
        readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_repair",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        failureReasonCode: "lark.registration_expired",
        status: "repair_required",
      });
      await expect(
        readRemoteAgentLarkPlatformChannelCredentials({
          connectionId: "connection_repair",
          db: harness.db,
        })
      ).resolves.toEqual(credentialsBefore);

      const repairConfigurationFetch = configuredAppFetch();
      await expect(
        pollRemoteAgentLarkPlatformRegistration({
          actor: SECOND_MANAGER,
          attemptId: "attempt_repair_2",
          createId: () => "claim_repair",
          db: harness.db,
          env: ENV,
          fetchImpl: repairConfigurationFetch,
          nowMs: repairAtMs + 2,
          provider: "lark",
        })
      ).resolves.toMatchObject({
        attempt: { status: "configuring" },
        connection: {
          externalAccountName: "OpenMeld Center Agent",
          id: "connection_repair",
          status: "configuring",
        },
      });
      expect(repairConfigurationFetch).toHaveBeenCalledTimes(4);
      const firstRepairRetry =
        await readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_repair_2",
          db: harness.db,
        });
      expect(firstRepairRetry).toMatchObject({
        nextPollAtMs: repairAtMs + 10_002,
        pollIntervalMs: 10_000,
      });
      const awaitingWebhookFetch = vi.fn<typeof fetch>();
      await pollRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        attemptId: "attempt_repair_2",
        createId: () => "claim_repair_webhook",
        db: harness.db,
        env: ENV,
        fetchImpl: awaitingWebhookFetch,
        nowMs: repairAtMs + 10_002,
        provider: "lark",
      });
      expect(awaitingWebhookFetch).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_repair_2",
          db: harness.db,
        })
      ).resolves.toMatchObject({
        nextPollAtMs: repairAtMs + 30_002,
        pollIntervalMs: 20_000,
      });

      const repairedAttempt =
        await readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_repair_2",
          db: harness.db,
        });
      const repairedExpiresAtMs = repairedAttempt?.expiresAtMs ?? 0;
      await expect(
        expireRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: "attempt_repair_2",
          db: harness.db,
          nowMs: repairedExpiresAtMs,
        })
      ).resolves.toMatchObject({
        failureReasonCode: "lark.registration_expired",
        status: "repair_required",
      });
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_repair",
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

  it("does not connect when platform verification outlives its poll claim", async () => {
    const harness = createRegistrationHarness();
    try {
      await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_slow_configuration",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });
      await pollRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        attemptId: "attempt_slow_configuration",
        createId: () => "claim_slow_switch",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch({ user_info: { tenant_brand: "lark" } }),
        nowMs: 1100,
        provider: "lark",
      });
      const credentialIds = vi
        .fn<() => string>()
        .mockReturnValueOnce("claim_slow_credentials")
        .mockReturnValueOnce("connection_slow_configuration");
      const credentialSecrets = vi
        .fn<() => string>()
        .mockReturnValueOnce("verification-token")
        .mockReturnValueOnce("event-encrypt-key");
      await pollRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        attemptId: "attempt_slow_configuration",
        createId: credentialIds,
        createSecret: credentialSecrets,
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedSuccess),
        nowMs: 1200,
        provider: "lark",
      });

      const result = await pollRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        attemptId: "attempt_slow_configuration",
        clock: () => 32_000,
        createId: () => "claim_slow_configuration",
        db: harness.db,
        env: ENV,
        fetchImpl: configuredAppFetch(),
        nowMs: 1300,
        provider: "lark",
      });

      expect(result).toMatchObject({
        attempt: { status: "configuring" },
        connection: {
          id: "connection_slow_configuration",
          status: "configuring",
        },
      });
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_slow_configuration",
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

  it("keeps the scheduler on a live clock through provider settlement", async () => {
    const harness = createRegistrationHarness();
    try {
      await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_slow_scheduler",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });
      await pollRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        attemptId: "attempt_slow_scheduler",
        createId: () => "claim_scheduler_switch",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch({ user_info: { tenant_brand: "lark" } }),
        nowMs: 1100,
        provider: "lark",
      });
      await pollRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        attemptId: "attempt_slow_scheduler",
        createId: vi
          .fn<() => string>()
          .mockReturnValueOnce("claim_scheduler_credentials")
          .mockReturnValueOnce("connection_slow_scheduler"),
        createSecret: vi
          .fn<() => string>()
          .mockReturnValueOnce("verification-token")
          .mockReturnValueOnce("event-encrypt-key"),
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedSuccess),
        nowMs: 1200,
        provider: "lark",
      });
      const clock = vi
        .fn<() => number>()
        .mockReturnValueOnce(1300)
        .mockReturnValue(32_000);

      await expect(
        runLarkPlatformRegistrationTick({
          classifyOrganization: classifyOrganizationWorkspace,
          clock,
          createId: () => "claim_slow_scheduler",
          db: harness.db,
          env: ENV,
          fetchImpl: configuredAppFetch(),
          nowMs: 1200,
        })
      ).resolves.toEqual({ errors: 0, processed: 1, scanned: 1 });
      expect(clock).toHaveBeenCalledTimes(2);
      await expect(
        readRemoteAgentLarkPlatformChannelConnection({
          connectionId: "connection_slow_scheduler",
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

  it("fails closed before registration when the provider gate is disabled", async () => {
    const harness = createRegistrationHarness();
    const fetchImpl = vi.fn<typeof fetch>();
    try {
      await expect(
        beginRemoteAgentLarkPlatformRegistration({
          actor: ACTOR,
          createId: () => "attempt_1",
          db: harness.db,
          env: ENV,
          fetchImpl,
          nowMs: 1000,
          provider: "feishu",
        })
      ).rejects.toBeInstanceOf(LarkPlatformRegistrationServiceError);
      await expect(
        beginRemoteAgentLarkPlatformRegistration({
          actor: ACTOR,
          createId: () => "attempt_1",
          db: harness.db,
          env: ENV,
          fetchImpl,
          nowMs: 1000,
          provider: "feishu",
        })
      ).rejects.toMatchObject({
        reasonCode: "feishu.provider_gate_disabled",
        status: 503,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("does not expose one administrator's registration attempt to another", async () => {
    const harness = createRegistrationHarness();
    const fetchImpl = jsonFetch(capturedBegin);
    const otherActor = {
      organizationId: ACTOR.organizationId,
      profileId: "profile_2",
      userId: "user_2",
    };
    try {
      await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_1",
        db: harness.db,
        env: ENV,
        fetchImpl,
        nowMs: 1000,
        provider: "lark",
      });

      await expect(
        beginRemoteAgentLarkPlatformRegistration({
          actor: otherActor,
          db: harness.db,
          env: ENV,
          fetchImpl,
          nowMs: 1100,
          provider: "lark",
          restartPending: true,
        })
      ).rejects.toMatchObject({
        reasonCode: "lark.registration_not_found",
        status: 404,
      });
      await expect(
        pollRemoteAgentLarkPlatformRegistration({
          actor: otherActor,
          attemptId: "attempt_1",
          db: harness.db,
          env: ENV,
          fetchImpl,
          nowMs: 1100,
          provider: "lark",
        })
      ).rejects.toMatchObject({
        reasonCode: "lark.registration_not_found",
        status: 404,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("keeps a globally enabled provider closed outside its Organization allowlist", async () => {
    const harness = createRegistrationHarness();
    const fetchImpl = vi.fn<typeof fetch>();
    try {
      await expect(
        beginRemoteAgentLarkPlatformRegistration({
          actor: ACTOR,
          db: harness.db,
          env: {
            ...ENV,
            OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS: "org_pilot",
          },
          fetchImpl,
          nowMs: 1000,
          provider: "lark",
        })
      ).rejects.toMatchObject({
        reasonCode: "lark.provider_gate_disabled",
        status: 503,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });
});

function createRegistrationHarness() {
  const harness = createSqliteD1Harness();
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
  harness.run({ sql: "INSERT INTO organizations (id) VALUES ('org_1')" });
  harness.run({
    sql: `
      INSERT INTO members (id, organization_id, user_id)
      VALUES
        ('member_1', 'org_1', 'user_1'),
        ('member_2', 'org_1', 'user_2')
    `,
  });
  applyMigrationForTable(
    harness,
    "openMeldRemoteAgent_lark_platform_channel_connections"
  );
  applyMigrationForTable(
    harness,
    "openMeldRemoteAgent_lark_platform_registration_attempts"
  );
  return harness;
}

function jsonFetch(payload: unknown, status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    Response.json(payload, {
      status,
    })
  );
}

function configuredAppFetch() {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        code: 0,
        expire: 7200,
        tenant_access_token: "tenant-token",
      })
    )
    .mockResolvedValueOnce(Response.json({ code: 0, data: {}, msg: "ok" }))
    .mockResolvedValueOnce(
      Response.json({
        code: 0,
        data: {
          scopes: LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.scopes.map(
            (scopeName) => ({
              grant_status: 1,
              scope_name: scopeName,
              scope_type: "tenant",
            })
          ),
        },
        msg: "success",
      })
    )
    .mockResolvedValueOnce(
      Response.json({
        bot: {
          app_name: "OpenMeld Center Agent",
          open_id: "ou_bot",
        },
        code: 0,
        msg: "success",
      })
    );
}
