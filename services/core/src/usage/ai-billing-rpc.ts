import { memberRoleHasOrganizationPermission } from "@openmeld/auth/organization-policy";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  organizationAiBillingRpcInputSchema,
  updateOrganizationAiBillingRpcInputSchema,
} from "@openmeld/schemas";
import type {
  OrganizationAiBillingRpcInput,
  UpdateOrganizationAiBillingRpcInput,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { createCoreRpcHttpError } from "../rpc/errors";
import { encryptAiCredential, readAiBilling } from "./ai-billing-service";
import { readOpenRouterKey } from "./openrouter-keys";

async function billingMember(
  env: CoreBindings,
  input: OrganizationAiBillingRpcInput
) {
  const parsed = organizationAiBillingRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidSettings();
  }
  const membership = await resolveActiveOrganizationMembership({
    env,
    context: parsed.data.context,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      code: membership.code,
      reason: membership.message,
      status: membership.status,
    });
  }
  if (parsed.data.context.actorContext.profileKind !== "human") {
    throw createCoreRpcHttpError({
      code: "organization.membership_required",
      reason: "AI billing settings are available to human members.",
      status: 403,
    });
  }
  return {
    ...membership,
    canManage: memberRoleHasOrganizationPermission(membership.role, {
      channel: ["connect"],
    }),
  };
}
export async function rpcReadAiBilling(
  env: CoreBindings,
  input: OrganizationAiBillingRpcInput
) {
  const member = await billingMember(env, input);
  return readAiBilling(env, member.organizationId, member.canManage);
}
export async function rpcUpdateAiBilling(
  env: CoreBindings,
  input: UpdateOrganizationAiBillingRpcInput
) {
  const parsed = updateOrganizationAiBillingRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidSettings();
  }
  const member = await billingMember(env, { context: parsed.data.context });
  if (!member.canManage) {
    throw createCoreRpcHttpError({
      code: "organization.role_required",
      status: 403,
      reason: "Only a workspace owner or admin can change the AI provider key.",
    });
  }
  const db = getPostgresDatabase(env);
  if (parsed.data.settings.source === "byok") {
    const apiKey = parsed.data.settings.apiKey;
    await readOpenRouterKey(apiKey);
    const encrypted = await encryptAiCredential(
      env,
      member.organizationId,
      "byok",
      apiKey
    );
    await db.query(
      `INSERT INTO "openmeld"."organization_ai_credentials"
      (organization_id, source, encrypted_key, key_suffix, updated_at_ms)
      VALUES ($1, 'byok', $2, $3, $4) ON CONFLICT (organization_id, source) DO UPDATE SET
      encrypted_key = EXCLUDED.encrypted_key, key_suffix = EXCLUDED.key_suffix, updated_at_ms = EXCLUDED.updated_at_ms`,
      [member.organizationId, encrypted, apiKey.slice(-4), Date.now()]
    );
  } else {
    await db.query(
      `DELETE FROM "openmeld"."organization_ai_credentials" WHERE organization_id = $1 AND source = 'byok'`,
      [member.organizationId]
    );
  }
  return readAiBilling(env, member.organizationId, member.canManage);
}
function invalidSettings() {
  return createCoreRpcHttpError({
    code: "invalid_payload",
    reason: "Enter a valid OpenRouter API key.",
    status: 400,
  });
}
