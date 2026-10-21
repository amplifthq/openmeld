import type {
  AiUsageRecord,
  RemoteAiCreditHold,
  RemoteAiUsageWrite,
} from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMeteredRemoteFetch } from "../../remote-agent/agent-core/ai-usage";
import { InMemoryDurableObjectStorage } from "../../remote-agent/tests/storage";
import type { CoreBindings } from "../src/lib/bindings";
import { rpcUpdateAiBilling } from "../src/usage/ai-billing-rpc";
import { admitRemoteAiRequest } from "../src/usage/ai-billing-service";
import {
  AI_CREDIT_HOLD_TTL_MS,
  readAiCreditBalance,
} from "../src/usage/ai-credit-reservation";
import { recordAiUsage } from "../src/usage/ai-usage-repository";
import { rpcRecordRemoteAiUsage } from "../src/usage/ai-usage-rpc";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const org = "11111111-1111-4111-8111-111111111111";
const credits = (value: number) => value * 1_000_000;
// Captured OpenRouter /key fields for a Free managed key with its full balance.
const budget = {
  limit: 5,
  limit_reset: "monthly",
  limit_remaining: 5,
  usage_monthly: 0,
  is_management_key: false,
};

function pending(input: {
  attemptId?: string | null;
  occurredAtMs?: number;
}): AiUsageRecord {
  return {
    organizationId: org,
    eventId: `openrouter:${crypto.randomUUID()}`,
    provider: "openrouter",
    model: "x-ai/grok-4.5",
    source: "openrouter_response",
    status: "pending",
    providerRequestId: null,
    occurredAtMs: input.occurredAtMs ?? Date.now(),
    runtime: "remote",
    purpose: "agent",
    agentProfileId: null,
    spaceId: null,
    taskId: null,
    attemptId: input.attemptId ?? null,
    computerId: null,
    controller: null,
    tokens: null,
    cost: null,
  };
}

function hold(nanoUsd: number): RemoteAiCreditHold {
  return {
    status: "estimated",
    nanoUsd,
    estimatedInputTokens: 1000,
    maxOutputTokens: 1000,
  };
}

describe("Hosted AI credit reservations on real PostgreSQL", () => {
  let harness: Awaited<ReturnType<typeof createPostgresHarness>>;
  let env: CoreBindings;
  let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;
  const keyReads = () =>
    fetchSpy.mock.calls.filter(([url]) => String(url).endsWith("/key")).length;
  const admit = (record: AiUsageRecord, creditHold?: RemoteAiCreditHold) =>
    admitRemoteAiRequest(env, {
      record,
      creditHold,
      providerAuthorizationVersion: 2,
    });
  const balance = (nowMs = Date.now()) =>
    readAiCreditBalance(harness.db, {
      organizationId: org,
      attemptId: null,
      nowMs,
    });
  const holdRows = async () =>
    (
      await harness.db.query<{ funding_source: string | null; hold: number }>(
        `SELECT funding_source, credit_hold_nano_usd AS hold
        FROM "openmeld"."ai_usage_records" ORDER BY occurred_at_ms, event_id`
      )
    ).rows;

  beforeEach(async () => {
    harness = await createPostgresHarness();
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"users\" (id,name,email) VALUES ('creator','Creator','billing@example.test')",
    });
    await harness.query({
      text: 'INSERT INTO "openmeld"."organizations" (id,name,slug,created_at,created_by_user_id) VALUES ($1,$1,$1,0,\'creator\')',
      values: [org],
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

  it("serializes concurrent new tasks so their holds never exceed the monthly allowance", async () => {
    // Provision the managed key once so concurrency exercises only admission.
    await admit(pending({}), hold(1));
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => admit(pending({}), hold(credits(1000))))
    );
    const admitted = results.filter((result) => result.status === "fulfilled");
    expect(admitted).toHaveLength(4);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({
          code: "ai_usage.monthly_limit_reached",
          status: 402,
        });
      }
    }
    const current = await balance();
    expect(current.committedNanoUsd).toBe(credits(4000) + 1);
    expect(current.availableNanoUsd).toBeGreaterThanOrEqual(0);
    expect((await holdRows()).length).toBe(5);
  });

  it("subtracts in-flight holds from a provider balance lower than the local one", async () => {
    await admit(pending({}), hold(1));
    // The provider sees $1 (1000 credits) left while the local ledger has ~$5.
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        Response.json({
          data: { ...budget, limit_remaining: 1, usage_monthly: 4 },
        })
      )
    );
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => admit(pending({}), hold(credits(400))))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(4);
  });

  it("still nets a request that settles between the provider read and admission", async () => {
    const running = pending({ attemptId: "attempt-a" });
    await admit(running, hold(credits(800)));
    // The provider read sees $1 left, before A's $0.80 reaches it; A settles
    // while the read is in flight.
    fetchSpy.mockImplementation(async () => {
      await rpcRecordRemoteAiUsage(env, {
        phase: "settle",
        record: {
          ...running,
          fundingSource: "free",
          status: "reported",
          tokens: {
            input: 1,
            output: 1,
            total: 2,
            cacheRead: null,
            cacheWrite: null,
            reasoning: null,
          },
          cost: { nanoUsd: credits(800), kind: "provider_reported" },
        },
      });
      return Response.json({
        data: { ...budget, limit_remaining: 1, usage_monthly: 4 },
      });
    });
    await expect(
      admit(pending({ attemptId: "attempt-b" }), hold(credits(150)))
    ).rejects.toMatchObject({ code: "ai_usage.monthly_limit_reached" });
  });

  it("applies the new-task floor but lets an admitted attempt continue with one-request grace", async () => {
    await recordAiUsage(harness.db, {
      ...pending({}),
      fundingSource: "free",
      status: "reported",
      tokens: {
        input: 1,
        output: 1,
        total: 2,
        cacheRead: null,
        cacheWrite: null,
        reasoning: null,
      },
      cost: { nanoUsd: credits(4500), kind: "provider_reported" },
    });
    await admit(pending({ attemptId: "attempt-1" }), hold(credits(10)));
    // Spend down to 190 credits, below the 300-credit new-task floor.
    await recordAiUsage(harness.db, {
      ...pending({}),
      fundingSource: "free",
      status: "reported",
      tokens: {
        input: 1,
        output: 1,
        total: 2,
        cacheRead: null,
        cacheWrite: null,
        reasoning: null,
      },
      cost: { nanoUsd: credits(300), kind: "provider_reported" },
    });
    await expect(
      admit(pending({ attemptId: "attempt-2" }), hold(credits(1)))
    ).rejects.toMatchObject({ code: "ai_usage.monthly_limit_reached" });
    const reads = keyReads();
    // The grace admits a continuation larger than the remaining balance once.
    await expect(
      admit(pending({ attemptId: "attempt-1" }), hold(credits(400)))
    ).resolves.toMatchObject({ source: "free" });
    expect(keyReads()).toBe(reads);
    await expect(
      admit(pending({ attemptId: "attempt-1" }), hold(credits(1)))
    ).rejects.toMatchObject({ code: "ai_usage.monthly_limit_reached" });
    expect((await balance()).availableNanoUsd).toBe(credits(-210));
  });

  it("replaces a hold with the reported cost and expires unsettled holds", async () => {
    const admitted = pending({ attemptId: "attempt-1" });
    await admit(admitted, hold(credits(1000)));
    const unknown = pending({ attemptId: "attempt-1" });
    await admit(unknown, hold(credits(500)));
    expect((await balance()).committedNanoUsd).toBe(credits(1500));
    await rpcRecordRemoteAiUsage(env, {
      phase: "settle",
      record: {
        ...admitted,
        fundingSource: "free",
        status: "reported",
        tokens: {
          input: 1,
          output: 1,
          total: 2,
          cacheRead: null,
          cacheWrite: null,
          reasoning: null,
        },
        cost: { nanoUsd: credits(12), kind: "provider_reported" },
      },
    });
    // A settlement without a provider cost keeps its hold until expiry.
    await rpcRecordRemoteAiUsage(env, {
      phase: "settle",
      record: {
        ...unknown,
        fundingSource: "free",
        status: "collection_failed",
        collectionFailure: "stream_interrupted",
      },
    });
    expect((await balance()).committedNanoUsd).toBe(credits(512));
    expect(
      (await balance(Date.now() + AI_CREDIT_HOLD_TTL_MS + 1)).committedNanoUsd
    ).toBe(credits(12));
  });

  it("assigns a held request to the period in which Core admitted it", async () => {
    const periodStart = Date.UTC(2026, 10, 1);
    vi.spyOn(Date, "now").mockReturnValue(periodStart + 1000);
    try {
      // Observed by the Remote Agent before midnight, admitted after it.
      await admit(
        pending({ occurredAtMs: periodStart - 1000 }),
        hold(credits(4800))
      );
      await expect(admit(pending({}), hold(credits(10)))).rejects.toMatchObject(
        { code: "ai_usage.monthly_limit_reached" }
      );
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("counts legacy platform receipts but not previous months, BYOK, or holdless pending rows", async () => {
    const legacy = { ...pending({}), fundingSource: "free" as const };
    await recordAiUsage(harness.db, {
      ...legacy,
      status: "reported",
      tokens: {
        input: 1,
        output: 1,
        total: 2,
        cacheRead: null,
        cacheWrite: null,
        reasoning: null,
      },
      cost: { nanoUsd: credits(70), kind: "provider_reported" },
    });
    // Rows recorded before the migration have no funding_source projection.
    await harness.query({
      text: 'UPDATE "openmeld"."ai_usage_records" SET funding_source = NULL',
    });
    const lastMonth = new Date();
    lastMonth.setUTCDate(0);
    for (const row of [
      { ...legacy, occurredAtMs: lastMonth.getTime() },
      { ...legacy, fundingSource: "byok" as const },
    ]) {
      await recordAiUsage(harness.db, {
        ...row,
        eventId: `openrouter:${crypto.randomUUID()}`,
        status: "reported",
        tokens: {
          input: 1,
          output: 1,
          total: 2,
          cacheRead: null,
          cacheWrite: null,
          reasoning: null,
        },
        cost: { nanoUsd: credits(900), kind: "provider_reported" },
      });
    }
    await recordAiUsage(harness.db, pending({}));
    expect((await balance()).committedNanoUsd).toBe(credits(70));
  });

  it("keeps BYOK requests outside reservations and fails closed for unpriced platform requests", async () => {
    await expect(
      admit(pending({}), {
        status: "unavailable",
        reason: "unknown_model_price",
      })
    ).rejects.toMatchObject({ code: "ai_usage.credit_hold_unavailable" });
    await expect(admit(pending({}))).rejects.toMatchObject({
      code: "ai_billing.provider_authorization_required",
    });
    await expect(
      admitRemoteAiRequest(env, {
        record: pending({}),
        creditHold: hold(1),
        providerAuthorizationVersion: 1,
      })
    ).rejects.toMatchObject({
      code: "ai_billing.provider_authorization_required",
    });
    expect(await holdRows()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    await rpcUpdateAiBilling(env, {
      context: {
        activeOrganizationId: org,
        actorContext: {
          callerPrincipalId: "creator",
          profileKind: "human",
          requestId: "test",
          openMeldProfileId: "33333333-3333-4333-8333-333333333333",
        },
      },
      settings: { source: "byok", apiKey: "sk-or-test-customer-key" },
    });
    fetchSpy.mockClear();
    await expect(
      admitRemoteAiRequest(env, {
        record: pending({}),
        creditHold: { status: "unavailable", reason: "unknown_model_price" },
        providerAuthorizationVersion: 1,
      })
    ).resolves.toEqual({ source: "byok", apiKey: "sk-or-test-customer-key" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await holdRows()).toEqual([{ funding_source: "byok", hold: null }]);
  });

  it("admits a real metered request through the Core receiver and releases its hold at settlement", async () => {
    const provider = vi.fn<typeof globalThis.fetch>((_url, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer sk-or-test-managed-key"
      );
      return Promise.resolve(
        Response.json({
          id: "gen-1",
          model: "x-ai/grok-4.5",
          usage: {
            prompt_tokens: 20,
            completion_tokens: 5,
            total_tokens: 25,
            cost: 0.000_07,
          },
        })
      );
    });
    const request = createMeteredRemoteFetch({
      coreWorker: {
        recordRemoteAiUsage: (input: RemoteAiUsageWrite) =>
          rpcRecordRemoteAiUsage(env, input),
      },
      storage: new InMemoryDurableObjectStorage(),
      fetch: provider,
      model: "x-ai/grok-4.5",
      scope: {
        organizationId: org,
        purpose: "agent",
        agentProfileId: null,
        spaceId: null,
        taskId: null,
        attemptId: "attempt-1",
      },
    });
    const response = await request(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({
          model: "x-ai/grok-4.5",
          max_tokens: 1000,
          messages: [{ role: "user", content: "Hello" }],
        }),
      }
    );
    expect(response.status).toBe(200);
    expect(provider).toHaveBeenCalledOnce();
    const [row] = await holdRows();
    // 1.25 x (a short prompt at $2/M + 1000 output tokens at $6/M).
    expect(row?.hold).toBeGreaterThan(credits(7.5));
    expect(row?.hold).toBeLessThan(credits(8));
    expect((await balance()).committedNanoUsd).toBe(70_000);
  });
});
