import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcReadAiBilling,
  rpcUpdateAiBilling,
} from "../src/usage/ai-billing-rpc";
import {
  admitRemoteAiRequest,
  readAiBilling,
} from "../src/usage/ai-billing-service";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const org = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const key = "sk-or-test-customer-key";
// Captured OpenRouter /key and /keys fields from the disposable native limit
// test. Costs and limits are provider facts, independent of application credits.
const budget = {
  limit: 5,
  limit_reset: "monthly",
  limit_remaining: 3.75,
  usage_monthly: 1.25,
  is_management_key: false,
};
const context = {
  activeOrganizationId: org,
  actorContext: {
    callerPrincipalId: "creator",
    profileKind: "human" as const,
    requestId: "test",
    openMeldProfileId: "33333333-3333-4333-8333-333333333333",
  },
};

// Funding selection for one small hosted request; reservations have their own suite.
function authorizeAiProvider(env: CoreBindings, organizationId: string) {
  return admitRemoteAiRequest(env, {
    providerAuthorizationVersion: 2,
    creditHold: {
      status: "estimated",
      nanoUsd: 1_000_000,
      estimatedInputTokens: 10,
      maxOutputTokens: 10,
    },
    record: {
      organizationId,
      eventId: `openrouter:${crypto.randomUUID()}`,
      provider: "openrouter",
      model: "x-ai/grok-4.5",
      source: "openrouter_response",
      status: "pending",
      providerRequestId: null,
      occurredAtMs: Date.now(),
      runtime: "remote",
      purpose: "agent",
      agentProfileId: null,
      spaceId: null,
      taskId: null,
      attemptId: null,
      computerId: null,
      controller: null,
      tokens: null,
      cost: null,
    },
  });
}

describe("AI funding at the native database and provider boundary", () => {
  let harness: Awaited<ReturnType<typeof createPostgresHarness>>;
  let env: CoreBindings;
  let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(async () => {
    harness = await createPostgresHarness();
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"users\" (id,name,email) VALUES ('creator','Creator','billing@example.test')",
    });
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"organizations\" (id,name,slug,created_at,created_by_user_id) VALUES ($1,$1,$1,0,'creator'),($2,$2,$2,1,'creator')",
      values: [org, other],
    });
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"members\" (id,organization_id,user_id,role,created_at) VALUES ('member',$1,'creator','owner',0)",
      values: [org],
    });
    env = {
      OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      OPENROUTER_MANAGEMENT_API_KEY: "sk-or-test-management",
      OPENMELD_AI_CREDENTIAL_CRYPTO_KEY: btoa(
        "01234567890123456789012345678901"
      ),
    } as CoreBindings;
    fetchSpy = vi.fn<typeof fetch>((url, init) => {
      if (String(url).endsWith("/keys")) {
        const body = JSON.parse(String(init?.body));
        return Promise.resolve(
          Response.json({
            key: "sk-or-test-managed-key",
            data: {
              ...budget,
              hash: "test-hash",
              disabled: false,
              limit: body.limit,
              limit_reset: body.limit_reset,
            },
          })
        );
      }
      return Promise.resolve(Response.json({ data: budget }));
    });
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness?.close();
  });

  it("shares one monthly key under concurrent first use and preserves the grant after workspace deletion", async () => {
    const authorized = await Promise.all(
      Array.from({ length: 3 }, () => authorizeAiProvider(env, org))
    );
    expect(authorized.map((value) => value.source)).toEqual([
      "free",
      "free",
      "free",
    ]);
    const creates = fetchSpy.mock.calls.filter(([url]) =>
      String(url).endsWith("/keys")
    );
    expect(creates).toHaveLength(1);
    expect(JSON.parse(String(creates[0]?.[1]?.body))).toMatchObject({
      limit: 5,
      limit_reset: "monthly",
      include_byok_in_limit: false,
    });
    expect(await readAiBilling(env, org, true)).toMatchObject({
      monthlyCredits: 5000,
      usedCredits: 1250,
      remainingCredits: 3750,
    });
    await expect(authorizeAiProvider(env, other)).rejects.toMatchObject({
      code: "ai_usage.monthly_limit_reached",
    });
    await harness.query({
      text: 'DELETE FROM "openmeld"."organizations" WHERE id=$1',
      values: [org],
    });
    await expect(authorizeAiProvider(env, other)).rejects.toMatchObject({
      code: "ai_usage.monthly_limit_reached",
    });
  });

  it("switches to encrypted BYOK and back without minting a new official allowance", async () => {
    const official = await authorizeAiProvider(env, org);
    const saved = await rpcUpdateAiBilling(env, {
      context,
      settings: { source: "byok", apiKey: key },
    });
    expect(saved).toMatchObject({
      source: "byok",
      keySuffix: "-key",
      remainingCredits: 3750,
    });
    expect(JSON.stringify(saved)).not.toContain(key);
    const rows = await harness.db.query(
      'SELECT encrypted_key FROM "openmeld"."organization_ai_credentials"'
    );
    expect(JSON.stringify(rows.rows)).not.toContain("sk-or-");
    fetchSpy.mockClear();
    expect(await authorizeAiProvider(env, org)).toEqual({
      source: "byok",
      apiKey: key,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    await rpcUpdateAiBilling(env, { context, settings: { source: "free" } });
    expect(await authorizeAiProvider(env, org)).toEqual(official);
    expect(
      fetchSpy.mock.calls.some(([url]) => String(url).endsWith("/keys"))
    ).toBe(false);
  });

  it.each([
    "revoked",
    "exhausted",
  ])("reports a %s customer key without consuming or replacing sponsored credits", async (failure) => {
    await authorizeAiProvider(env, org);
    await rpcUpdateAiBilling(env, {
      context,
      settings: { source: "byok", apiKey: key },
    });
    fetchSpy.mockClear();
    fetchSpy.mockImplementation((_url, init) => {
      const customer =
        new Headers(init?.headers).get("Authorization") === `Bearer ${key}`;
      if (customer && failure === "revoked") {
        return Promise.resolve(new Response(null, { status: 401 }));
      }
      return Promise.resolve(
        Response.json({
          data: { ...budget, limit_remaining: customer ? 0 : 3.75 },
        })
      );
    });
    expect(await readAiBilling(env, org, true)).toMatchObject({
      source: "byok",
      status: failure === "revoked" ? "unavailable" : "exhausted",
      remainingCredits: 3750,
    });
    expect(await authorizeAiProvider(env, org)).toEqual({
      source: "byok",
      apiKey: key,
    });
    expect(
      fetchSpy.mock.calls.every(([url]) => String(url).endsWith("/key"))
    ).toBe(true);
  });

  it("requires a current owner or admin and rejects another workspace or management key", async () => {
    await expect(
      rpcReadAiBilling(env, {
        context: { ...context, activeOrganizationId: other },
      })
    ).rejects.toMatchObject({ status: 403 });
    await harness.query({
      text: 'UPDATE "openmeld"."members" SET role=\'member\'',
    });
    await expect(
      rpcUpdateAiBilling(env, {
        context,
        settings: { source: "byok", apiKey: key },
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(fetchSpy).not.toHaveBeenCalled();
    await harness.query({
      text: 'UPDATE "openmeld"."members" SET role=\'admin\'',
    });
    fetchSpy.mockResolvedValue(
      Response.json({ data: { ...budget, is_management_key: true } })
    );
    await expect(
      rpcUpdateAiBilling(env, {
        context,
        settings: { source: "byok", apiKey: key },
      })
    ).rejects.toMatchObject({ code: "ai_billing.key_invalid" });
    expect(
      (
        await harness.db.query(
          'SELECT 1 FROM "openmeld"."organization_ai_credentials"'
        )
      ).rowCount
    ).toBe(0);
  });

  it.each([
    "empty",
    "wrong_budget",
    "provider_down",
    "encryption_lost",
  ])("stops official requests without rotating the key when %s", async (failure) => {
    await authorizeAiProvider(env, org);
    fetchSpy.mockClear();
    if (failure === "encryption_lost") {
      env.OPENMELD_AI_CREDENTIAL_CRYPTO_KEY = btoa(
        "99999999999999999999999999999999"
      );
    } else if (failure === "provider_down") {
      fetchSpy.mockRejectedValue(new Error("network unavailable"));
    } else {
      fetchSpy.mockResolvedValue(
        Response.json({
          data: {
            ...budget,
            ...(failure === "empty" ? { limit_remaining: 0 } : { limit: null }),
          },
        })
      );
    }
    await expect(authorizeAiProvider(env, org)).rejects.toMatchObject({
      code:
        failure === "empty"
          ? "ai_usage.monthly_limit_reached"
          : "ai_billing.unavailable",
    });
    expect(
      fetchSpy.mock.calls.some(([url]) => String(url).endsWith("/keys"))
    ).toBe(false);
  });

  it("ignores retired internal credentials and configuration for both eligible and ineligible workspaces", async () => {
    Object.assign(env, { OPENMELD_INTERNAL_BILLING_ORGANIZATION_ID: org });
    await harness.query({
      text: `INSERT INTO "openmeld"."organization_ai_credentials"
        (organization_id, source, encrypted_key, provider_key_hash, key_suffix, updated_at_ms)
        VALUES ($1, 'internal', 'retired-key-must-not-be-decrypted', 'old-hash', 'old1', 0),
               ($2, 'internal', 'retired-key-must-not-be-decrypted', 'other-old-hash', 'old2', 0)`,
      values: [org, other],
    });
    await authorizeAiProvider(env, org);
    expect(await authorizeAiProvider(env, org)).toMatchObject({
      source: "free",
      apiKey: "sk-or-test-managed-key",
    });
    expect(await readAiBilling(env, org, true)).toMatchObject({
      plan: "free",
      monthlyCredits: 5000,
      remainingCredits: 3750,
    });
    Object.assign(env, { OPENMELD_INTERNAL_BILLING_ORGANIZATION_ID: other });
    await expect(authorizeAiProvider(env, other)).rejects.toMatchObject({
      code: "ai_usage.monthly_limit_reached",
    });
    expect(await readAiBilling(env, other, true)).toMatchObject({
      plan: "free",
      source: "free",
      monthlyCredits: 0,
      status: "exhausted",
    });
    const creates = fetchSpy.mock.calls.filter(([url]) =>
      String(url).endsWith("/keys")
    );
    expect(creates).toHaveLength(1);
    expect(JSON.parse(String(creates[0]?.[1]?.body))).toMatchObject({
      name: `openmeld:${org}:free`,
      limit: 5,
      limit_reset: "monthly",
    });
  });
});
