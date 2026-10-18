import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { createCoreRpcHttpError } from "../../rpc/errors";

// Contract: developing/product/organizations-and-center-agent.md, MemberAgent
// management operations. A permission-mode change asked of the Center Agent
// needs a separate confirmation from the same member in a later turn. Core
// binds that evidence to the member, the Agent Profile, and the exact mode;
// the instruction alone never applies the change.

const CONFIRMATION_TTL_MS = 30 * 60_000;
const TABLE = '"openmeld"."center_agent_permission_mode_confirmations"';

export type CenterAgentPermissionModeConfirmationScope = {
  actorProfileId: string;
  agentControllerPermissionMode: string;
  agentProfileId: string;
  organizationId: string;
  representedProfileId: string;
  representedUserId: string;
};

export type CenterAgentPermissionModeConfirmationDecision =
  | { status: "confirmed" }
  | {
      status: "confirmation_required";
      confirmation: { expiresAtMs: number; token: string };
    };

/**
 * Issues confirmation evidence when no token is given, or consumes a token
 * issued in an earlier turn for this exact scope. A token issued in the
 * current turn, for another member, Profile, or mode, or after expiry fails.
 */
export async function requireCenterAgentPermissionModeConfirmation(input: {
  db: PostgresDatabase;
  nativeDeliveryId: string | null;
  nowMs: number;
  scope: CenterAgentPermissionModeConfirmationScope;
  token?: string;
}): Promise<CenterAgentPermissionModeConfirmationDecision> {
  if (!input.nativeDeliveryId) {
    throw createCoreRpcHttpError({
      code: "center_agent.request_chain_unverified",
      reason:
        "OpenMeld couldn't confirm which member asked for this change in this conversation.",
      status: 403,
    });
  }
  if (input.token === undefined) {
    const token = randomToken();
    const expiresAtMs = input.nowMs + CONFIRMATION_TTL_MS;
    await input.db.query({
      text: `
        INSERT INTO ${TABLE} (
          token_hash, organization_id, actor_profile_id, represented_user_id,
          represented_profile_id, agent_profile_id,
          agent_controller_permission_mode, issued_native_delivery_id,
          expires_at_ms, created_at_ms, consumed_at_ms,
          consumed_native_delivery_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NULL)
      `,
      values: [
        await sha256Hex(token),
        input.scope.organizationId,
        input.scope.actorProfileId,
        input.scope.representedUserId,
        input.scope.representedProfileId,
        input.scope.agentProfileId,
        input.scope.agentControllerPermissionMode,
        input.nativeDeliveryId,
        expiresAtMs,
        input.nowMs,
      ],
    });
    return {
      status: "confirmation_required",
      confirmation: { expiresAtMs, token },
    };
  }
  // One atomic claim: the scope, a later turn of the same member (a delivery
  // that started after the evidence was issued), unexpired, and unused (or
  // used by this same turn, so a retried tool call stays idempotent).
  const result = await input.db.query({
    text: `
      UPDATE ${TABLE}
      SET consumed_at_ms = COALESCE(consumed_at_ms, $1),
          consumed_native_delivery_id = $2
      WHERE token_hash = $3
        AND organization_id = $4
        AND actor_profile_id = $5
        AND represented_user_id = $6
        AND represented_profile_id = $7
        AND agent_profile_id = $8
        AND agent_controller_permission_mode = $9
        AND issued_native_delivery_id <> $2
        AND expires_at_ms > $1
        AND (consumed_native_delivery_id IS NULL
          OR consumed_native_delivery_id = $2)
        AND EXISTS (
          SELECT 1
          FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" AS turn
          WHERE turn.delivery_id = $2
            AND turn.profile_id = $5
            AND turn.on_behalf_of_user_id = $6
            AND turn.on_behalf_of_profile_id = $7
            AND turn.created_at_ms >= ${TABLE}.created_at_ms
        )
    `,
    values: [
      input.nowMs,
      input.nativeDeliveryId,
      await sha256Hex(input.token),
      input.scope.organizationId,
      input.scope.actorProfileId,
      input.scope.representedUserId,
      input.scope.representedProfileId,
      input.scope.agentProfileId,
      input.scope.agentControllerPermissionMode,
    ],
  });
  if (Number(result.rowCount ?? 0) !== 1) {
    throw createCoreRpcHttpError({
      code: "center_agent.permission_mode_confirmation_invalid",
      reason:
        "This confirmation is expired, already used, or doesn't match this change. Ask the member to confirm again in a new message.",
      status: 409,
    });
  }
  return { status: "confirmed" };
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
