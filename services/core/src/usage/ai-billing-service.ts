import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  AI_CREDIT_POLICY_VERSION,
  AI_CREDITS_PER_USD,
  AI_FREE_MONTHLY_CREDITS,
} from "@openmeld/schemas";
import type {
  AiFundingSource,
  OrganizationAiBilling,
  RemoteAiProviderAuthorization,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import {
  decryptAesGcmSecret,
  encryptAesGcmSecret,
} from "../remote-agent/application/aes-gcm-secret-crypto";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  aiBillingUnavailable,
  createOpenRouterKey,
  readOpenRouterKey,
} from "./openrouter-keys";

type CredentialRow = {
  source: AiFundingSource;
  encrypted_key: string;
  key_suffix: string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export const MONTHLY_AI_LIMIT_MESSAGE =
  "This workspace has used its included AI credits. Add an OpenRouter API key in AI usage settings, or wait for the monthly reset.";
export const BYOK_UNAVAILABLE_MESSAGE =
  "OpenRouter could not use this workspace's API key. Check its balance and status, or replace or remove it in AI usage settings. Included credits were not used.";

export function isInternalBillingOrganization(
  env: CoreBindings,
  organizationId: string
) {
  const configured = env.OPENMELD_INTERNAL_BILLING_ORGANIZATION_ID?.trim();
  return Boolean(
    configured && UUID.test(configured) && configured === organizationId
  );
}
export function nextAiCreditReset(nowMs: number) {
  const now = new Date(nowMs);
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  ).toISOString();
}
export function monthlyAiLimitError() {
  return createCoreRpcHttpError({
    code: "ai_usage.monthly_limit_reached",
    status: 402,
    reason: MONTHLY_AI_LIMIT_MESSAGE,
  });
}

// One automatic grant for the creator's first workspace. The retained user row
// prevents deletion/recreation or another workspace from minting new credits.
async function freeGrant(input: {
  db: PostgresDatabase;
  organizationId: string;
  claim: boolean;
}) {
  const result = await input.db.query<{
    user_id: string;
    organization_id: string | null;
    eligible: boolean;
  }>(
    `
    SELECT o.created_by_user_id AS user_id, g.organization_id,
      CASE WHEN g.user_id IS NOT NULL THEN g.organization_id = o.id
        ELSE o.id = (SELECT first_org.id FROM "openmeld"."organizations" first_org
          WHERE first_org.created_by_user_id = o.created_by_user_id
          ORDER BY first_org.created_at, first_org.id LIMIT 1) END AS eligible
    FROM "openmeld"."organizations" o
    LEFT JOIN "openmeld"."ai_free_grants" g ON g.user_id = o.created_by_user_id
    WHERE o.id = $1`,
    [input.organizationId]
  );
  const candidate = result.rows[0];
  if (!(candidate?.eligible && candidate.user_id)) {
    return false;
  }
  if (!input.claim || candidate.organization_id === input.organizationId) {
    return true;
  }
  await input.db.query(
    `INSERT INTO "openmeld"."ai_free_grants" (user_id, organization_id, created_at_ms)
    VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [candidate.user_id, input.organizationId, Date.now()]
  );
  const granted = await input.db.query(
    `SELECT 1 FROM "openmeld"."ai_free_grants"
    WHERE user_id = $1 AND organization_id = $2`,
    [candidate.user_id, input.organizationId]
  );
  return granted.rowCount === 1;
}
async function readCredentials(db: PostgresDatabase, organizationId: string) {
  return (
    await db.query<CredentialRow>(
      `SELECT source, encrypted_key, key_suffix
    FROM "openmeld"."organization_ai_credentials" WHERE organization_id = $1`,
      [organizationId]
    )
  ).rows;
}
function cryptoConfiguration(env: CoreBindings) {
  const cryptoKey = env.OPENMELD_AI_CREDENTIAL_CRYPTO_KEY?.trim();
  if (!cryptoKey) {
    throw aiBillingUnavailable();
  }
  return {
    cryptoKey,
    cryptoKeyName: "OPENMELD_AI_CREDENTIAL_CRYPTO_KEY",
    secretName: "AI provider credential",
  };
}
export function encryptAiCredential(
  env: CoreBindings,
  organizationId: string,
  source: AiFundingSource,
  apiKey: string
) {
  return encryptAesGcmSecret({
    ...cryptoConfiguration(env),
    secret: JSON.stringify({ organizationId, source, apiKey }),
  });
}
async function decryptCredential(
  env: CoreBindings,
  organizationId: string,
  row: CredentialRow
) {
  try {
    const value = JSON.parse(
      await decryptAesGcmSecret({
        ...cryptoConfiguration(env),
        encryptedSecret: row.encrypted_key,
      })
    );
    if (
      value.organizationId !== organizationId ||
      value.source !== row.source ||
      typeof value.apiKey !== "string"
    ) {
      throw aiBillingUnavailable();
    }
    return value.apiKey as string;
  } catch {
    throw aiBillingUnavailable();
  }
}

async function managedCredential(
  env: CoreBindings,
  organizationId: string,
  source: "free" | "internal"
) {
  const db = getPostgresDatabase(env);
  const existing = (await readCredentials(db, organizationId)).find(
    (row) => row.source === source
  );
  if (existing) {
    return decryptCredential(env, organizationId, existing);
  }
  const managementKey = env.OPENROUTER_MANAGEMENT_API_KEY?.trim();
  if (!managementKey) {
    throw aiBillingUnavailable();
  }
  // Validate encryption configuration before provisioning an upstream resource.
  await encryptAiCredential(env, organizationId, source, "configuration-check");
  return db.transaction(async (client) => {
    await client.query("SET LOCAL lock_timeout = '12s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`ai-provider:${organizationId}:${source}`]
    );
    const found = (
      await client.query<CredentialRow>(
        `SELECT source, encrypted_key, key_suffix
      FROM "openmeld"."organization_ai_credentials" WHERE organization_id = $1 AND source = $2`,
        [organizationId, source]
      )
    ).rows[0];
    if (found) {
      return decryptCredential(env, organizationId, found);
    }
    const created = await createOpenRouterKey({
      managementKey,
      organizationId,
      source,
      limitUsd:
        source === "free" ? AI_FREE_MONTHLY_CREDITS / AI_CREDITS_PER_USD : null,
    });
    const encrypted = await encryptAiCredential(
      env,
      organizationId,
      source,
      created.apiKey
    );
    await client.query(
      `INSERT INTO "openmeld"."organization_ai_credentials"
      (organization_id, source, encrypted_key, provider_key_hash, key_suffix, updated_at_ms)
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        organizationId,
        source,
        encrypted,
        created.hash,
        created.apiKey.slice(-4),
        Date.now(),
      ]
    );
    // An ambiguous commit must never cause automatic rotation or a new grant.
    // A provider key whose creation response was lost has no usable plaintext.
    return created.apiKey;
  });
}

export async function authorizeAiProvider(
  env: CoreBindings,
  organizationId: string
): Promise<RemoteAiProviderAuthorization> {
  const db = getPostgresDatabase(env);
  const byok = (await readCredentials(db, organizationId)).find(
    (row) => row.source === "byok"
  );
  if (byok) {
    return {
      source: "byok",
      apiKey: await decryptCredential(env, organizationId, byok),
    };
  }
  const source = isInternalBillingOrganization(env, organizationId)
    ? "internal"
    : "free";
  if (
    source === "free" &&
    !(await freeGrant({ db, organizationId, claim: true }))
  ) {
    throw monthlyAiLimitError();
  }
  const apiKey = await managedCredential(env, organizationId, source);
  const budget = await readOpenRouterKey(apiKey);
  const credits = sponsoredCredits(budget, source);
  if (credits.remainingCredits !== null && credits.remainingCredits <= 0) {
    throw monthlyAiLimitError();
  }
  return { source, apiKey };
}

export async function readAiBilling(
  env: CoreBindings,
  organizationId: string,
  canManage: boolean
): Promise<OrganizationAiBilling> {
  const db = getPostgresDatabase(env);
  const rows = await readCredentials(db, organizationId);
  const byok = rows.find((row) => row.source === "byok");
  const internal = isInternalBillingOrganization(env, organizationId);
  const eligible =
    internal || (await freeGrant({ db, organizationId, claim: false }));
  const sponsoredSource = internal ? "internal" : "free";
  const source = byok ? "byok" : sponsoredSource;
  const freeCredits = eligible ? AI_FREE_MONTHLY_CREDITS : 0;
  const monthlyCredits = internal ? null : freeCredits;
  const result: OrganizationAiBilling = {
    plan: internal ? "internal" : "free",
    source,
    policyVersion: AI_CREDIT_POLICY_VERSION,
    monthlyCredits,
    usedCredits: 0,
    remainingCredits: monthlyCredits,
    resetsAt: internal ? null : nextAiCreditReset(Date.now()),
    keySuffix: byok?.key_suffix ?? null,
    canManage,
    status: "available",
  };
  const sponsored = rows.find(
    (row) => row.source === (internal ? "internal" : "free")
  );
  if (sponsored) {
    try {
      const budget = await readOpenRouterKey(
        await decryptCredential(env, organizationId, sponsored)
      );
      Object.assign(result, sponsoredCredits(budget, sponsoredSource));
    } catch {
      result.usedCredits = null;
      result.remainingCredits = null;
      if (!byok) {
        result.status = "unavailable";
      }
    }
  } else if (
    !(
      byok ||
      (env.OPENROUTER_MANAGEMENT_API_KEY?.trim() &&
        env.OPENMELD_AI_CREDENTIAL_CRYPTO_KEY?.trim())
    )
  ) {
    result.status = "unavailable";
  }
  if (!byok && result.remainingCredits === 0) {
    result.status = "exhausted";
  }
  if (byok) {
    result.status = await readByokStatus(env, organizationId, byok);
  }
  return result;
}

async function readByokStatus(
  env: CoreBindings,
  organizationId: string,
  byok: CredentialRow
): Promise<OrganizationAiBilling["status"]> {
  try {
    const budget = await readOpenRouterKey(
      await decryptCredential(env, organizationId, byok)
    );
    return budget.limit_remaining !== null && budget.limit_remaining <= 0
      ? "exhausted"
      : "available";
  } catch {
    return "unavailable";
  }
}

function sponsoredCredits(
  budget: Awaited<ReturnType<typeof readOpenRouterKey>>,
  source: "free" | "internal"
) {
  const internal = source === "internal";
  if (
    budget.limit !==
      (internal ? null : AI_FREE_MONTHLY_CREDITS / AI_CREDITS_PER_USD) ||
    budget.limit_reset !== (internal ? null : "monthly") ||
    (!internal && budget.limit_remaining === null)
  ) {
    throw aiBillingUnavailable();
  }
  return {
    usedCredits: budget.usage_monthly * AI_CREDITS_PER_USD,
    remainingCredits: internal
      ? null
      : Math.max(0, (budget.limit_remaining ?? 0) * AI_CREDITS_PER_USD),
  };
}
