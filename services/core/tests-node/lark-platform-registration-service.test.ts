import { describe, expect, it, vi } from "vitest";
import capturedBegin from "../../../scripts/lark-platform/fixtures/registration-begin.lark.json";
import capturedPending from "../../../scripts/lark-platform/fixtures/registration-pending.lark.json";
import capturedSuccess from "../../../scripts/lark-platform/fixtures/registration-success.lark.json";
import {
  decryptLarkPlatformCredential,
  encryptLarkPlatformCredential,
} from "../src/remote-agent/application/lark-platform-credential-crypto";
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
  replaceClaimedLarkPlatformCallbackCredentials,
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
  it.each([
    "accounts.feishu.cn",
    "accounts.larksuite.com",
  ])("keeps polling a legacy Lark attempt on %s without requiring resume", async (accountDomain) => {
    const harness = createRegistrationHarness();
    try {
      const started = await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });
      const encryptedRegistrationUrl = await encryptLarkPlatformCredential({
        cryptoKey: CRYPTO_KEY,
        credentialName: "registration URL",
        credential:
          "https://open.feishu.cn/page/launcher?user_code=legacy-code&name=Existing+app",
      });
      harness.run({
        sql: "UPDATE openMeldRemoteAgent_lark_platform_registration_attempts SET account_domain = ?, encrypted_registration_url = ? WHERE attempt_id = ?",
        params: [accountDomain, encryptedRegistrationUrl, started.attempt.id],
      });
      const fetchImpl = jsonFetch(capturedPending, 400);
      for (const nowMs of [1100, 1200]) {
        const polled = await pollRemoteAgentLarkPlatformRegistration({
          actor: ACTOR,
          attemptId: started.attempt.id,
          db: harness.db,
          env: ENV,
          fetchImpl,
          nowMs,
          provider: "lark",
        });
        expect(polled.attempt).toMatchObject({
          id: started.attempt.id,
          provider: "lark",
          status: "pending_registration",
          registrationUrl:
            "https://open.feishu.cn/page/launcher?user_code=legacy-code&name=Existing+app",
        });
      }
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await expect(
        readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: started.attempt.id,
          db: harness.db,
        })
      ).resolves.toMatchObject({
        encryptedRegistrationUrl,
        consumedAtMs: null,
      });
    } finally {
      harness.close();
    }
  });

  it.each([
    false,
    true,
  ])("preserves unreadable setup diagnostics and permits an explicit restart (rotated key: %s)", async (rotatedKey) => {
    const harness = createRegistrationHarness();
    try {
      const started = await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });
      if (!rotatedKey) {
        harness.run({
          sql: "UPDATE openMeldRemoteAgent_lark_platform_registration_attempts SET encrypted_registration_url = ? WHERE attempt_id = ?",
          params: ["corrupt-ciphertext", started.attempt.id],
        });
      }
      const env = rotatedKey
        ? {
            ...ENV,
            LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY: btoa(
              "fedcba9876543210fedcba9876543210"
            ),
          }
        : ENV;
      const fetchImpl = jsonFetch(capturedBegin);
      await expect(
        beginRemoteAgentLarkPlatformRegistration({
          actor: ACTOR,
          db: harness.db,
          env,
          fetchImpl,
          nowMs: 1100,
          provider: "lark",
        })
      ).rejects.toThrow(
        rotatedKey ? "decryption failed" : "ciphertext is invalid"
      );
      expect(fetchImpl).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: started.attempt.id,
          db: harness.db,
        })
      ).resolves.toMatchObject({
        status: "pending_registration",
        consumedAtMs: null,
      });
      const restarted = await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        db: harness.db,
        env,
        fetchImpl,
        nowMs: 1200,
        provider: "lark",
        restartPending: true,
      });
      expect(restarted.attempt.id).not.toBe(started.attempt.id);
      expect(restarted.attempt.status).toBe("pending_registration");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it.each([
    "accounts.feishu.cn",
    "accounts.larksuite.com",
  ])("resumes the same legacy attempt without another provider request on %s", async (accountDomain) => {
    const harness = createRegistrationHarness();
    try {
      const started = await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });
      const encryptedRegistrationUrl = await encryptLarkPlatformCredential({
        cryptoKey: CRYPTO_KEY,
        credentialName: "registration URL",
        credential:
          "https://open.feishu.cn/page/launcher?user_code=legacy-code",
      });
      harness.run({
        sql: "UPDATE openMeldRemoteAgent_lark_platform_registration_attempts SET account_domain = ?, encrypted_registration_url = ? WHERE attempt_id = ?",
        params: [accountDomain, encryptedRegistrationUrl, started.attempt.id],
      });
      const fetchImpl = jsonFetch(capturedBegin);
      const resumed = await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        db: harness.db,
        env: ENV,
        fetchImpl,
        nowMs: 1100,
        provider: "lark",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(resumed.attempt.id).toBe(started.attempt.id);
      expect(new URL(resumed.attempt.registrationUrl ?? "").host).toBe(
        "open.feishu.cn"
      );
      await expect(
        readRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: started.attempt.id,
          db: harness.db,
        })
      ).resolves.toMatchObject({
        status: "pending_registration",
        encryptedRegistrationUrl,
        consumedAtMs: null,
      });
    } finally {
      harness.close();
    }
  });

  it.each([
    "lark",
    "feishu",
  ] as const)("repairs %s legacy callback secrets before configuring the saved app", async (provider) => {
    const harness = createRegistrationHarness();
    const env = {
      ...ENV,
      OPENMELD_FEISHU_CHANNEL_ENABLED: "true",
      OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS: "org_1",
    };
    try {
      const started = await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        db: harness.db,
        env,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider,
      });
      const success = {
        ...capturedSuccess,
        user_info: { ...capturedSuccess.user_info, tenant_brand: provider },
      };
      const poll = (nowMs: number) =>
        pollRemoteAgentLarkPlatformRegistration({
          actor: ACTOR,
          attemptId: started.attempt.id,
          createSecret: () => "x".repeat(43),
          db: harness.db,
          env,
          fetchImpl: jsonFetch(success),
          nowMs,
          provider,
        });
      const firstPoll = await poll(1100);
      const registered = provider === "lark" ? await poll(1200) : firstPoll;
      const connectionId = registered.connection?.id ?? "";
      const credentialsBefore =
        await readRemoteAgentLarkPlatformChannelCredentials({
          connectionId,
          db: harness.db,
        });
      const expiresAtMs = Date.parse(registered.attempt.expiresAt);
      await expireRemoteAgentLarkPlatformRegistrationAttempt({
        attemptId: started.attempt.id,
        db: harness.db,
        nowMs: expiresAtMs,
      });
      const repaired = await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        db: harness.db,
        env,
        nowMs: expiresAtMs + 1,
        provider,
        repairExisting: true,
      });
      // An old proof must not survive a callback-secret replacement.
      harness.run({
        sql: "UPDATE openMeldRemoteAgent_lark_platform_channel_connections SET events_webhook_verified_at_ms = ?, callbacks_webhook_verified_at_ms = ? WHERE connection_id = ?",
        params: [expiresAtMs + 1, expiresAtMs + 1, connectionId],
      });
      await claimRemoteAgentLarkPlatformRegistrationAttempt({
        attemptId: repaired.attempt.id,
        claimId: "old-claim",
        claimExpiresAtMs: expiresAtMs + 3,
        db: harness.db,
        nowMs: expiresAtMs + 1,
      });
      const replacement = {
        attemptId: repaired.attempt.id,
        claimId: "old-claim",
        connectionId,
        db: harness.db,
        encryptedEventEncryptKey: "new-encrypted-key",
        encryptedVerificationToken: "new-encrypted-token",
        previousEncryptedEventEncryptKey:
          credentialsBefore?.encryptedEventEncryptKey ?? null,
        previousEncryptedVerificationToken:
          credentialsBefore?.encryptedVerificationToken ?? null,
        nowMs: expiresAtMs + 2,
      };
      expect(
        await replaceClaimedLarkPlatformCallbackCredentials({
          ...replacement,
          claimId: "wrong-claim",
        })
      ).toBe(false);
      expect(
        await replaceClaimedLarkPlatformCallbackCredentials({
          ...replacement,
          nowMs: expiresAtMs + 3,
        })
      ).toBe(false);
      harness.run({
        sql: "UPDATE openMeldRemoteAgent_lark_platform_channel_connections SET status = 'connected' WHERE connection_id = ?",
        params: [connectionId],
      });
      expect(
        await replaceClaimedLarkPlatformCallbackCredentials(replacement)
      ).toBe(false);
      expect(
        await readRemoteAgentLarkPlatformChannelCredentials({
          connectionId,
          db: harness.db,
        })
      ).toEqual(credentialsBefore);
      harness.run({
        sql: "UPDATE openMeldRemoteAgent_lark_platform_channel_connections SET status = 'configuring' WHERE connection_id = ?",
        params: [connectionId],
      });
      const responses = configuredAppFetch();
      const fetchImpl = vi.fn<typeof fetch>(async (resource, init) => {
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body));
          const saved = await readRemoteAgentLarkPlatformChannelCredentials({
            connectionId,
            db: harness.db,
          });
          for (const [name, encrypted] of [
            ["encryption_key", saved?.encryptedEventEncryptKey],
            ["verification_token", saved?.encryptedVerificationToken],
          ] as const) {
            const secret = body.event_and_callback_encrypt_strategy[name];
            expect(secret).toHaveLength(32);
            expect(
              await decryptLarkPlatformCredential({
                credentialName: name,
                cryptoKey: CRYPTO_KEY,
                encryptedCredential: encrypted ?? "",
              })
            ).toBe(secret);
          }
          expect(saved?.encryptedAppSecret).toBe(
            credentialsBefore?.encryptedAppSecret
          );
          expect(
            await readRemoteAgentLarkPlatformChannelConnection({
              connectionId,
              db: harness.db,
            })
          ).toMatchObject({
            eventsWebhookVerifiedAtMs: null,
            callbacksWebhookVerifiedAtMs: null,
          });
        }
        return responses(resource, init);
      });
      const result = await pollRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        attemptId: repaired.attempt.id,
        db: harness.db,
        env,
        fetchImpl,
        nowMs: expiresAtMs + 4,
        provider,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(6);
      expect(result.connection).toMatchObject({
        id: connectionId,
        status: "configuring",
      });
      expect(
        await recordRemoteAgentLarkPlatformWebhookReachability({
          connectionId,
          db: harness.db,
          encryptedVerificationToken:
            credentialsBefore?.encryptedVerificationToken ?? null,
          organizationId: ACTOR.organizationId,
          provider,
          surface: "events",
          verifiedAtMs: expiresAtMs + 5,
        })
      ).toBeNull();
      expect(
        await readRemoteAgentLarkPlatformChannelConnection({
          connectionId,
          db: harness.db,
        })
      ).toMatchObject({
        status: "configuring",
        eventsWebhookVerifiedAtMs: null,
        callbacksWebhookVerifiedAtMs: null,
      });
    } finally {
      harness.close();
    }
  });

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
          nowMs: 1001,
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
          nowMs: 1001,
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

  it("does not show expired setup and cannot revive cancelled setup through a late poll", async () => {
    const harness = createRegistrationHarness();
    try {
      const started = await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        createId: () => "attempt_cancelled",
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });
      const expiresAtMs = Date.parse(started.attempt.expiresAt);
      expect(
        await listRemoteAgentActiveLarkPlatformRegistrations({
          db: harness.db,
          nowMs: expiresAtMs,
          organizationId: ACTOR.organizationId,
          providers: ["lark"],
          viewer: { ...ACTOR, canManage: true },
        })
      ).toEqual([]);
      await disconnectRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        db: harness.db,
        nowMs: 2000,
        provider: "lark",
      });
      const fetchImpl = jsonFetch(capturedBegin);
      const result = await pollRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        attemptId: started.attempt.id,
        db: harness.db,
        env: ENV,
        fetchImpl,
        nowMs: 3000,
        provider: "lark",
      });
      expect(result.attempt.status).toBe("disconnected");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(
        await listRemoteAgentActiveLarkPlatformRegistrations({
          db: harness.db,
          nowMs: 3000,
          organizationId: ACTOR.organizationId,
          providers: ["lark"],
          viewer: { ...ACTOR, canManage: true },
        })
      ).toEqual([]);
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
      // Workers' native fetch rejects an object receiver before sending a request.
      expect(fetchImpl.mock.contexts[0]).toBeUndefined();
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

  it("generates callback credentials within the provider's 32-character limit", async () => {
    const harness = createRegistrationHarness();
    try {
      const started = await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1000,
        provider: "lark",
      });
      const poll = (nowMs: number) =>
        pollRemoteAgentLarkPlatformRegistration({
          actor: ACTOR,
          attemptId: started.attempt.id,
          db: harness.db,
          env: ENV,
          fetchImpl: jsonFetch(capturedSuccess),
          nowMs,
          provider: "lark",
        });
      await poll(1100);
      const registered = await poll(1200);
      const credentials = await readRemoteAgentLarkPlatformChannelCredentials({
        connectionId: registered.connection?.id ?? "",
        db: harness.db,
      });
      for (const encryptedCredential of [
        credentials?.encryptedVerificationToken,
        credentials?.encryptedEventEncryptKey,
      ]) {
        const secret = await decryptLarkPlatformCredential({
          credentialName: "test callback secret",
          cryptoKey: ENV.LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY,
          encryptedCredential: encryptedCredential ?? "",
        });
        expect(secret).toHaveLength(32);
      }
    } finally {
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
      harness.run({
        sql: "UPDATE openMeldRemoteAgent_lark_platform_registration_attempts SET failure_reason_code = ? WHERE attempt_id = ?",
        params: ["lark.application_config_permission_required", "attempt_1"],
      });
      const reauthorization = await beginRemoteAgentLarkPlatformRegistration({
        actor: ACTOR,
        db: harness.db,
        env: ENV,
        fetchImpl: jsonFetch(capturedBegin),
        nowMs: 1250,
        provider: "lark",
        reauthorize: true,
      });
      const authorizationUrl = new URL(
        reauthorization.attempt.registrationUrl ?? ""
      );
      expect(authorizationUrl.searchParams.get("clientID")).toBe(
        capturedSuccess.client_id
      );
      expect(authorizationUrl.searchParams.has("createOnly")).toBe(false);
      expect(reauthorization.connection?.id).toBe("connection_1");
      expect(
        await readRemoteAgentLarkPlatformChannelCredentials({
          connectionId: "connection_1",
          db: harness.db,
        })
      ).toEqual(credentials);
      await expect(
        beginRemoteAgentLarkPlatformRegistration({
          actor: { ...ACTOR, organizationId: "other_org" },
          db: harness.db,
          env: ENV,
          fetchImpl: jsonFetch(capturedBegin),
          nowMs: 1250,
          provider: "lark",
          reauthorize: true,
        })
      ).rejects.toBeInstanceOf(LarkPlatformRegistrationServiceError);
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
      expect(configureFetch).toHaveBeenCalledTimes(6);
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
        encryptedVerificationToken:
          (
            await readRemoteAgentLarkPlatformChannelCredentials({
              connectionId: "connection_1",
              db: harness.db,
            })
          )?.encryptedVerificationToken ?? null,
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
        encryptedVerificationToken:
          (
            await readRemoteAgentLarkPlatformChannelCredentials({
              connectionId: "connection_1",
              db: harness.db,
            })
          )?.encryptedVerificationToken ?? null,
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
      expect(initialConfigurationFetch).toHaveBeenCalledTimes(6);
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
      expect(repairConfigurationFetch).toHaveBeenCalledTimes(6);
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
      expect(clock).toHaveBeenCalledTimes(3);
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
        code: 0,
        data: { version: "1.0.1", version_id: "oav_test" },
        msg: "success",
      })
    )
    .mockResolvedValueOnce(
      Response.json({
        code: 0,
        data: {
          app_version: {
            app_id: capturedSuccess.client_id,
            version_id: "oav_test",
            status: 1,
            event_infos:
              LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.events.map(
                (event_type) => ({ event_type })
              ),
          },
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
