import { AI_CREDITS_PER_USD, AI_FREE_MONTHLY_CREDITS } from "@openmeld/schemas";
// biome-ignore lint/performance/noNamespaceImport: Worker-safe Zod import avoids bundling unused locales.
import * as z from "zod/v4";
import { createCoreRpcHttpError } from "../rpc/errors";

// Native OpenRouter key budgets own enforcement and the monthly spend counter.
// https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key
const budgetSchema = z.object({
  limit: z.number().nonnegative().nullable(),
  limit_reset: z.enum(["daily", "weekly", "monthly"]).nullable(),
  limit_remaining: z.number().nullable(),
  usage_monthly: z.number().nonnegative(),
});
const currentKeySchema = z.object({
  data: budgetSchema.extend({
    is_management_key: z.boolean(),
    is_provisioning_key: z.boolean().optional(),
  }),
});
const createdKeySchema = z.object({
  key: z.string().min(16).max(512),
  data: budgetSchema.extend({ hash: z.string().min(1), disabled: z.boolean() }),
});

export function aiBillingUnavailable() {
  return createCoreRpcHttpError({
    code: "ai_billing.unavailable",
    status: 503,
    reason:
      "AI billing is unavailable. Try again, or ask an administrator to check the provider configuration.",
  });
}

async function openRouterRequest(input: {
  apiKey: string;
  path: "/key" | "/keys";
  body?: {
    name: string;
    limit: number;
    limit_reset: "monthly";
    include_byok_in_limit: false;
  };
}) {
  let response: Response;
  try {
    response = await fetch(`https://openrouter.ai/api/v1${input.path}`, {
      method: input.body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw aiBillingUnavailable();
  }
  if (!response.ok) {
    if (input.path === "/key" && [401, 403].includes(response.status)) {
      throw createCoreRpcHttpError({
        code: "ai_billing.key_invalid",
        status: 400,
        reason:
          "OpenRouter rejected this API key. Replace it in AI usage settings.",
      });
    }
    // Never propagate provider bodies, URLs containing key hashes, or headers.
    throw aiBillingUnavailable();
  }
  try {
    return await response.json();
  } catch {
    throw aiBillingUnavailable();
  }
}

export async function readOpenRouterKey(apiKey: string) {
  const parsed = currentKeySchema.safeParse(
    await openRouterRequest({ apiKey, path: "/key" })
  );
  if (!parsed.success) {
    throw aiBillingUnavailable();
  }
  if (
    parsed.data.data.is_management_key ||
    parsed.data.data.is_provisioning_key
  ) {
    throw createCoreRpcHttpError({
      code: "ai_billing.key_invalid",
      status: 400,
      reason:
        "Use an OpenRouter inference API key. Management keys cannot run models.",
    });
  }
  return parsed.data.data;
}

export async function createOpenRouterKey(input: {
  managementKey: string;
  organizationId: string;
}) {
  const limitUsd = AI_FREE_MONTHLY_CREDITS / AI_CREDITS_PER_USD;
  const parsed = createdKeySchema.safeParse(
    await openRouterRequest({
      apiKey: input.managementKey,
      path: "/keys",
      body: {
        name: `openmeld:${input.organizationId}:free`,
        limit: limitUsd,
        limit_reset: "monthly",
        include_byok_in_limit: false,
      },
    })
  );
  if (
    !parsed.success ||
    parsed.data.data.disabled ||
    parsed.data.data.limit !== limitUsd ||
    parsed.data.data.limit_reset !== "monthly"
  ) {
    throw aiBillingUnavailable();
  }
  return { apiKey: parsed.data.key, hash: parsed.data.data.hash };
}
