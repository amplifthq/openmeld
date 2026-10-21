import { resolveNativeAgentControllerPermissionModeForController } from "@openmeld/agent-runtime";
import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import type {
  ListPermissionModeSuggestionsResponse,
  PermissionModeSuggestion,
  ResolvePermissionModeSuggestionResponse,
  SuggestPermissionModeResponse,
} from "@openmeld/schemas";
import {
  listPermissionModeSuggestionsResponseSchema,
  listPermissionModeSuggestionsRpcInputSchema,
  permissionModeSuggestionSchema,
  resolvePermissionModeSuggestionResponseSchema,
  resolvePermissionModeSuggestionRpcInputSchema,
  runtimeCoordinatorExecutionAccessResponseSchema,
  suggestPermissionModeResponseSchema,
  suggestPermissionModeRpcInputSchema,
} from "@openmeld/schemas";
import { readPrimaryAgentProfileBindingRecord } from "../../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import { resolveRuntimeTransportOwnerShard } from "../../dispatch/infrastructure/runtime-transport/runtime-transport-shard";
import type { CoreBindings } from "../../lib/bindings";
import { requireExpectedOrganizationContext } from "../../organizations/expected-organization-context";
import { resolveActiveOrganizationMembership } from "../../organizations/organization-context";
import { createCoreRpcHttpError } from "../../rpc/errors";
import {
  listPendingPermissionModeSuggestionCards,
  offerPermissionModeSuggestionCard,
  type PermissionModeAdvisoryRow,
  readPermissionModeAdvisoryRow,
  readPermissionModeAdvisoryRowBySuggestionId,
  resolvePermissionModeSuggestionCard,
} from "../infrastructure/postgresql/permission-mode-advisor-repo";
import { PERMISSION_MODE_ADVISOR_COOLDOWN_MS } from "./permission-mode-advisor";

// Contract: developing/product/organizations-and-center-agent.md
// (Permission-mode advisor). The card only offers the change; the owner's
// Web session applies it through the existing permission-mode write.

/**
 * The task stand-in's `suggest_permission_mode` action. It opens the
 * owner-only card for the one Wake that received this week's advisory, and
 * only with that Wake's live execution proof. It never writes a setting.
 */
export async function rpcSuggestPermissionMode(
  env: CoreBindings,
  value: unknown
): Promise<SuggestPermissionModeResponse> {
  const parsed = suggestPermissionModeRpcInputSchema.safeParse(value);
  if (!parsed.success) {
    throw invalid("Choose a valid permission-mode suggestion.");
  }
  const input = parsed.data;
  const member = await requireMember(env, input);
  const actor = input.context.actorContext;
  if (actor.profileKind !== "agent") {
    throw forbidden("Only a Local Agent task can offer this suggestion.");
  }
  const db = requireDb(env);
  const agentProfileId = actor.openMeldProfileId;
  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId,
    db,
    owner: { id: member.userId, kind: "owner_account" },
  });
  if (
    binding?.bindingState !== "enabled_primary" ||
    binding.runtimeKind !== "openmeld_service"
  ) {
    throw forbidden("This Agent is not a configured Local Agent you own.");
  }
  const wake = await readDispatchWake({
    agentProfileId,
    db,
    dispatchId: input.request.dispatchId,
    organizationId: member.organizationId,
  });
  if (!wake) {
    throw forbidden("This task's Wake could not be verified.");
  }
  const proof = input.request.executionTokenEcho;
  const access = runtimeCoordinatorExecutionAccessResponseSchema.parse(
    await resolveRuntimeTransportOwnerShard(
      env,
      member.userId
    ).rpcAuthorizeExecutionAccess({
      executionTokenEcho: proof,
      expectedAuthorityScope: {
        agentControllerRef: binding.agentControllerRef,
        bindingId: binding.bindingId,
        openMeldServiceRuntimeId: binding.openMeldServiceRuntimeId,
      },
      expectedExecutionScope: {
        dispatchId: input.request.dispatchId,
        runtimeCoordinatorExecutionId: proof.runtimeCoordinatorExecutionId,
        sourceClientMessageId: wake.sourceClientMessageId,
        spaceId: wake.spaceId,
        targetProfileId: agentProfileId,
      },
    })
  );
  if (!access.allowed) {
    throw forbidden("This task is no longer running.");
  }
  return await offerPermissionModeSuggestionForWake({
    agentProfileId,
    db,
    dispatchId: input.request.dispatchId,
    nowMs: Date.now(),
    ownerUserId: member.userId,
    spaceId: wake.spaceId,
  });
}

export type PermissionModeSuggestionCardRepo = {
  listPending: typeof listPendingPermissionModeSuggestionCards;
  offer: typeof offerPermissionModeSuggestionCard;
  readByProfile: typeof readPermissionModeAdvisoryRow;
  readBySuggestionId: typeof readPermissionModeAdvisoryRowBySuggestionId;
  resolve: typeof resolvePermissionModeSuggestionCard;
};

const defaultRepo: PermissionModeSuggestionCardRepo = {
  listPending: listPendingPermissionModeSuggestionCards,
  offer: offerPermissionModeSuggestionCard,
  readByProfile: readPermissionModeAdvisoryRow,
  readBySuggestionId: readPermissionModeAdvisoryRowBySuggestionId,
  resolve: resolvePermissionModeSuggestionCard,
};

/**
 * Opens the card only for the dispatch that received the advisory, only for
 * the Profile owner, and only inside the suggestion week.
 */
export async function offerPermissionModeSuggestionForWake(input: {
  agentProfileId: string;
  db: PostgresDatabase;
  dispatchId: string;
  nowMs: number;
  ownerUserId: string;
  repo?: PermissionModeSuggestionCardRepo;
  spaceId: string;
}): Promise<SuggestPermissionModeResponse> {
  const repo = input.repo ?? defaultRepo;
  const offered = await repo.offer({
    agentProfileId: input.agentProfileId,
    db: input.db,
    dispatchId: input.dispatchId,
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    spaceId: input.spaceId,
    suggestedSinceMs: input.nowMs - PERMISSION_MODE_ADVISOR_COOLDOWN_MS,
  });
  if (offered) {
    return suggestPermissionModeResponseSchema.parse({
      status: "offered",
      suggestion: toSuggestion(offered),
    });
  }
  const current = await repo.readByProfile({
    agentProfileId: input.agentProfileId,
    db: input.db,
  });
  if (
    current &&
    current.suggestedDispatchId === input.dispatchId &&
    current.ownerUserId === input.ownerUserId &&
    current.cardStatus !== null
  ) {
    return suggestPermissionModeResponseSchema.parse({
      status:
        current.cardStatus === "pending"
          ? "already_offered"
          : "already_resolved",
      suggestion: toSuggestion(current),
    });
  }
  throw createCoreRpcHttpError({
    code: "permission_mode_suggestion.not_available",
    reason:
      "This task has no permission-mode suggestion to offer. Mention nothing about permission modes.",
    status: 409,
  });
}

export async function rpcListPermissionModeSuggestions(
  env: CoreBindings,
  value: unknown
): Promise<ListPermissionModeSuggestionsResponse> {
  const parsed = listPermissionModeSuggestionsRpcInputSchema.safeParse(value);
  if (!parsed.success) {
    throw invalid("Choose a valid Space.");
  }
  const member = await requireMember(env, parsed.data);
  if (parsed.data.context.actorContext.profileKind !== "human") {
    return { suggestions: [] };
  }
  return await listCurrentPermissionModeSuggestions({
    db: requireDb(env),
    nowMs: Date.now(),
    organizationId: member.organizationId,
    ownerUserId: member.userId,
    spaceId: parsed.data.spaceId,
  });
}

/**
 * Pending cards whose recorded starting mode is still the Binding's mode. A
 * card made stale by any other mode change is hidden, so Apply can never
 * skip the next step from the current mode.
 */
export async function listCurrentPermissionModeSuggestions(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  ownerUserId: string;
  readCurrentPermissionMode?: (input: {
    agentProfileId: string;
    db: PostgresDatabase;
    ownerUserId: string;
  }) => Promise<string | null>;
  spaceId: string;
}): Promise<ListPermissionModeSuggestionsResponse> {
  const rows = await listPendingPermissionModeSuggestionCards({
    db: input.db,
    offeredSinceMs: input.nowMs - PERMISSION_MODE_ADVISOR_COOLDOWN_MS,
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
    spaceId: input.spaceId,
  });
  const readCurrent =
    input.readCurrentPermissionMode ?? readCurrentBindingPermissionMode;
  const current: PermissionModeAdvisoryRow[] = [];
  for (const row of rows) {
    const mode = await readCurrent({
      agentProfileId: row.agentProfileId,
      db: input.db,
      ownerUserId: input.ownerUserId,
    });
    if (mode === row.currentPermissionMode) {
      current.push(row);
    }
  }
  return listPermissionModeSuggestionsResponseSchema.parse({
    suggestions: current.map(toSuggestion),
  });
}

async function readCurrentBindingPermissionMode(input: {
  agentProfileId: string;
  db: PostgresDatabase;
  ownerUserId: string;
}): Promise<string | null> {
  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: input.agentProfileId,
    db: input.db,
    owner: { id: input.ownerUserId, kind: "owner_account" },
  });
  if (binding?.bindingState !== "enabled_primary") {
    return null;
  }
  return (
    resolveNativeAgentControllerPermissionModeForController(
      binding.agentControllerPermissionMode,
      { agentControllerRef: binding.agentControllerRef }
    ) ?? null
  );
}

export async function rpcResolvePermissionModeSuggestion(
  env: CoreBindings,
  value: unknown
): Promise<ResolvePermissionModeSuggestionResponse> {
  const parsed = resolvePermissionModeSuggestionRpcInputSchema.safeParse(value);
  if (!parsed.success) {
    throw invalid("Choose a valid permission-mode suggestion.");
  }
  const member = await requireMember(env, parsed.data);
  if (parsed.data.context.actorContext.profileKind !== "human") {
    throw ownerRequired();
  }
  return await resolvePermissionModeSuggestionForOwner({
    actingUserId: member.userId,
    db: requireDb(env),
    nowMs: Date.now(),
    organizationId: member.organizationId,
    resolution: parsed.data.resolution,
    suggestionId: parsed.data.suggestionId,
  });
}

/** Only the Profile owner closes the card; anyone else is refused. */
export async function resolvePermissionModeSuggestionForOwner(input: {
  actingUserId: string;
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  repo?: PermissionModeSuggestionCardRepo;
  resolution: "applied" | "dismissed";
  suggestionId: string;
}): Promise<ResolvePermissionModeSuggestionResponse> {
  const repo = input.repo ?? defaultRepo;
  const row = await repo.readBySuggestionId({
    db: input.db,
    suggestionId: input.suggestionId,
  });
  if (!row || row.organizationId !== input.organizationId) {
    throw createCoreRpcHttpError({
      code: "permission_mode_suggestion.not_found",
      reason: "This suggestion is no longer available.",
      status: 404,
    });
  }
  if (row.ownerUserId !== input.actingUserId) {
    throw ownerRequired();
  }
  const resolved = await repo.resolve({
    db: input.db,
    nowMs: input.nowMs,
    ownerUserId: input.actingUserId,
    resolution: input.resolution,
    suggestionId: input.suggestionId,
  });
  if (!resolved && row.cardStatus !== input.resolution) {
    throw createCoreRpcHttpError({
      code: "permission_mode_suggestion.already_resolved",
      reason: "This suggestion was already handled.",
      status: 409,
    });
  }
  return resolvePermissionModeSuggestionResponseSchema.parse({
    status: input.resolution,
    suggestionId: input.suggestionId,
  });
}

function toSuggestion(
  row: PermissionModeAdvisoryRow
): PermissionModeSuggestion {
  return permissionModeSuggestionSchema.parse({
    agentProfileId: row.agentProfileId,
    currentPermissionMode: row.currentPermissionMode,
    offeredAtMs: row.cardOfferedAtMs,
    spaceId: row.cardSpaceId,
    suggestedPermissionMode: row.suggestedPermissionMode,
    suggestionId: row.suggestionId,
    waitingApprovalCount: row.waitingApprovalCount,
  });
}

async function readDispatchWake(input: {
  agentProfileId: string;
  db: PostgresDatabase;
  dispatchId: string;
  organizationId: string;
}): Promise<{ sourceClientMessageId: string; spaceId: string } | null> {
  const result = await input.db.query<{
    source_client_message_id: string | null;
    space_id: string;
  }>({
    text: `
      SELECT ledger.space_id, ledger.source_client_message_id
      FROM "openmeld"."openMeldDaemon_dispatch_ledger" AS ledger
      JOIN "openmeld"."space_index_spaces" AS space
        ON space.space_id = ledger.space_id
      WHERE ledger.dispatch_id = $1
        AND ledger.target_profile_id = $2
        AND space.organization_id = $3
      LIMIT 1
    `,
    values: [input.dispatchId, input.agentProfileId, input.organizationId],
  });
  const row = result.rows[0];
  return row?.source_client_message_id
    ? {
        sourceClientMessageId: row.source_client_message_id,
        spaceId: row.space_id,
      }
    : null;
}

async function requireMember(
  env: CoreBindings,
  input: {
    context: Parameters<
      typeof resolveActiveOrganizationMembership
    >[0]["context"];
    expectedOrganizationId: string;
  }
) {
  const member = await resolveActiveOrganizationMembership({
    context: input.context,
    env,
  });
  if (!member.ok) {
    throw createCoreRpcHttpError({
      code: member.code,
      reason: member.message,
      status: member.status,
    });
  }
  requireExpectedOrganizationContext({
    actualOrganizationId: member.organizationId,
    errorCode: "permission_mode_suggestion.organization_changed",
    expectedOrganizationId: input.expectedOrganizationId,
  });
  return member;
}

function requireDb(env: CoreBindings): PostgresDatabase {
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "permission_mode_suggestion.state_unavailable",
      reason: "Permission-mode suggestions are unavailable right now.",
      status: 503,
    });
  }
  return db;
}

function invalid(reason: string) {
  return createCoreRpcHttpError({
    code: "invalid_payload",
    reason,
    status: 400,
  });
}

function forbidden(reason: string) {
  return createCoreRpcHttpError({
    code: "permission_mode_suggestion.forbidden",
    reason,
    status: 403,
  });
}

function ownerRequired() {
  return createCoreRpcHttpError({
    code: "permission_mode_suggestion.owner_required",
    reason: "Only the Agent's owner can handle this suggestion.",
    status: 403,
  });
}
