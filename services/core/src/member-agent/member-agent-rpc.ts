import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  type DetectedHarnessKind,
  type GetMemberAgentPresenceResponse,
  getMemberAgentPresenceResponseSchema,
  type ListMemberAgentsResponse,
  MEMBER_AGENTS_DISABLED_CODE,
  MEMBER_AGENTS_DISABLED_MESSAGE,
  MEMBER_AGENTS_ENABLED,
  type MemberAgentSyncResult,
  openMeldRequestContextSchema,
  type SyncMemberAgentsRequest,
  type SyncMemberAgentsResponse,
  syncMemberAgentsRequestSchema,
  syncMemberAgentsResponseSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  RuntimeTransportAgentProfileOperationalContext,
  SubmitRuntimeAgentControllerReportsResponse,
} from "@openmeld/schemas/types";
import {
  lookupRuntimeTransportOwnerService,
  readRuntimeTransportAgentProfileOperationalContexts,
} from "../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import type { CoreBindings } from "../lib/bindings";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  rpcEnsureAgentProfilePrimaryBinding,
  rpcGetAgentExecutionReadinessBatch,
  rpcOpenDirectMessageSpace,
  rpcSetPeopleComputerLocalAgentEnabled,
  rpcSubmitRuntimeAgentControllerReports,
  type SubmitRuntimeAgentControllerReportsInput,
} from "../rpc/methods";
import { callRequiredAuthWorkerRpc } from "../rpc/required-auth-worker-rpc";
import {
  classifyHarnessReportDetection,
  type HarnessReportDetection,
} from "./application/harness-presence-policy";
import {
  buildOnlineRuntimeKey,
  type MemberAgentPresenceDeps,
  readMemberAgentPresence,
} from "./application/member-agent-presence-service";
import {
  type MemberAgentSyncDeps,
  syncMemberAgents,
} from "./application/member-agent-sync-service";
import { projectRuntimeHarnesses } from "./application/runtime-harness-catalog";
import {
  hasAnyAgentProfileBinding,
  listOwnerRuntimeHarnessCatalog,
  readAgentProfileGroupingControllerRef,
  recordRuntimeHarnessObservation,
} from "./infrastructure/postgresql/runtime-harness-presence-repo";
import { assignBoundProfileToMemberAgent } from "./member-agent-profile-assignment";

// Core operations of the MemberAgent catalog sync
// (design-plans/member-agent-program.md §4.1, §4.5), gated by
// MEMBER_AGENTS_ENABLED. `syncMemberAgents` runs lazily per Organization
// when the member opens its Agents or Direct Message surface, and again on a
// catalog update only for Organizations where the owner already has a
// MemberAgent. It never broadcasts to every Organization on connect.

const PROFILE_BATCH_SIZE = 100;

type MemberAgentCaller = {
  context: OpenMeldRequestContext;
  db: PostgresDatabase;
  organizationId: string;
  ownerUserId: string;
};

export type MemberAgentRpcInput = {
  context?: OpenMeldRequestContext;
};

// Tests opt in explicitly; production follows the shared release decision.
export type MemberAgentRpcOptions = { enabled?: boolean };

export type SyncMemberAgentsRpcInput = MemberAgentRpcInput &
  SyncMemberAgentsRequest;

export async function rpcSyncMemberAgents(
  env: CoreBindings,
  input: SyncMemberAgentsRpcInput,
  options: MemberAgentRpcOptions = {}
): Promise<SyncMemberAgentsResponse> {
  const caller = await requireMemberAgentCaller(env, input.context, options);
  const request = syncMemberAgentsRequestSchema.safeParse({
    createHarnessKinds: input.createHarnessKinds,
  });
  if (!request.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: request.error.issues[0]?.message ?? "Invalid Agent sync request.",
    });
  }
  const { addableHarnessKinds, assignedProfileIds, results } =
    await syncMemberAgents(createSyncDeps(env, caller), request.data);
  logSyncResults(
    caller,
    request.data.createHarnessKinds.length > 0 ? "create" : "surface_open",
    results
  );
  return syncMemberAgentsResponseSchema.parse({
    ok: true,
    organizationId: caller.organizationId,
    results,
    assignedProfileIds,
    addableHarnessKinds,
  });
}

export async function rpcGetMemberAgentPresence(
  env: CoreBindings,
  input: MemberAgentRpcInput,
  options: MemberAgentRpcOptions = {}
): Promise<GetMemberAgentPresenceResponse> {
  const caller = await requireMemberAgentCaller(env, input.context, options);
  const nowMs = Date.now();
  const memberAgents = await readMemberAgentPresence(
    createPresenceDeps(env, caller, nowMs)
  );
  return getMemberAgentPresenceResponseSchema.parse({
    ok: true,
    organizationId: caller.organizationId,
    generatedAt: new Date(nowMs).toISOString(),
    memberAgents,
  });
}

/**
 * Catalog-update hook for `submitRuntimeAgentControllerReports`. It records
 * each accepted report in the debounce fact and, when a Harness becomes
 * detected (installed, or turned back on in Local agents), reconciles only
 * the Organizations where this owner already has a MemberAgent. Failures are logged; the report submission never fails here.
 */
export async function recordMemberAgentCatalogReports(
  env: CoreBindings,
  input: {
    context: OpenMeldRequestContext;
    db: PostgresDatabase;
    enabled?: boolean;
    nowMs: number;
    ownerUserId: string;
    reports: readonly {
      agentControllerRef: string;
      observedAtMs: number;
      openMeldServiceRuntimeId: string;
      reasonCodes: readonly string[];
      status: Parameters<typeof classifyHarnessReportDetection>[0]["status"];
    }[];
  }
): Promise<void> {
  if (!(input.enabled ?? MEMBER_AGENTS_ENABLED)) {
    return;
  }
  let becameDetected = false;
  for (const report of input.reports) {
    if (!report.agentControllerRef.startsWith("builtin:")) {
      continue;
    }
    const detection: HarnessReportDetection = classifyHarnessReportDetection({
      reasonCodes: report.reasonCodes,
      status: report.status,
    });
    try {
      const recorded = await recordRuntimeHarnessObservation({
        agentControllerRef: report.agentControllerRef,
        db: input.db,
        detection,
        nowMs: input.nowMs,
        observedAtMs: report.observedAtMs,
        openMeldServiceRuntimeId: report.openMeldServiceRuntimeId,
      });
      becameDetected ||= recorded.becameDetected;
    } catch (error) {
      console.warn("[core.member_agents.presence_fact_failed]", {
        agentControllerRef: report.agentControllerRef,
        error: toErrorMessage(error),
        ownerUserId: input.ownerUserId,
      });
    }
  }
  if (!becameDetected) {
    return;
  }
  try {
    await reconcileKnownOrganizations(env, input);
  } catch (error) {
    console.warn("[core.member_agents.catalog_reconcile_failed]", {
      error: toErrorMessage(error),
      ownerUserId: input.ownerUserId,
    });
  }
}

async function reconcileKnownOrganizations(
  env: CoreBindings,
  input: {
    context: OpenMeldRequestContext;
    db: PostgresDatabase;
    ownerUserId: string;
  }
): Promise<void> {
  // Direct Message creation needs the owner's human actor; a Service
  // context without one leaves the work to the next surface open.
  if (input.context.actorContext.profileKind !== "human") {
    return;
  }
  const organizations = await callRequiredAuthWorkerRpc({
    authWorker: env.OPENMELD_AUTH_WORKER,
    call: (authWorker) =>
      authWorker.listMemberAgentOrganizationIds({
        ownerUserId: input.ownerUserId,
      }),
    unavailable: {
      code: "member_agents.unavailable",
      reason: "Agents are unavailable.",
    },
  });
  if (!organizations.ok) {
    throw new Error(`${organizations.code}: ${organizations.message}`);
  }
  for (const organizationId of organizations.organizationIds) {
    const context = { ...input.context, activeOrganizationId: organizationId };
    const membership = await resolveActiveOrganizationMembership({
      context,
      env,
    });
    if (!membership.ok || membership.userId !== input.ownerUserId) {
      continue;
    }
    const caller = {
      context,
      db: input.db,
      organizationId,
      ownerUserId: input.ownerUserId,
    };
    logSyncResults(
      caller,
      "catalog_update",
      (await syncMemberAgents(createSyncDeps(env, caller))).results
    );
  }
}

async function requireMemberAgentCaller(
  env: CoreBindings,
  contextInput: OpenMeldRequestContext | undefined,
  options: MemberAgentRpcOptions
): Promise<MemberAgentCaller> {
  if (!(options.enabled ?? MEMBER_AGENTS_ENABLED)) {
    throw createCoreRpcHttpError({
      status: 404,
      code: MEMBER_AGENTS_DISABLED_CODE,
      reason: MEMBER_AGENTS_DISABLED_MESSAGE,
    });
  }
  const parsed = openMeldRequestContextSchema.safeParse(contextInput);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 401,
      code: "auth.unauthenticated",
      reason: "Sign in to see your Agents.",
    });
  }
  const context = parsed.data;
  const ownerUserId = context.actorContext.ownerUserId?.trim();
  if (!ownerUserId || context.actorContext.profileKind !== "human") {
    throw createCoreRpcHttpError({
      status: 403,
      code: "member_agents.human_caller_required",
      reason: "Only the signed-in member can manage their Agents.",
    });
  }
  const membership = await resolveActiveOrganizationMembership({
    context,
    env,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      status: membership.status,
      code: membership.code,
      reason: membership.message,
    });
  }
  if (membership.userId !== ownerUserId) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "organization.membership_required",
      reason: "You do not have access to this organization.",
    });
  }
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      code: "member_agents.store_unavailable",
      reason: "Agents are unavailable.",
    });
  }
  return {
    context: { ...context, activeOrganizationId: membership.organizationId },
    db,
    organizationId: membership.organizationId,
    ownerUserId,
  };
}

function createSyncDeps(
  env: CoreBindings,
  caller: MemberAgentCaller
): MemberAgentSyncDeps {
  return {
    assignBoundProfile: (agentProfileId) =>
      assignBoundProfileToMemberAgent(env, {
        agentProfileId,
        db: caller.db,
        ownerUserId: caller.ownerUserId,
      }),
    ensureDetectedMemberAgent: (harnessKind: DetectedHarnessKind) =>
      callRequiredAuthWorkerRpc({
        authWorker: env.OPENMELD_AUTH_WORKER,
        call: (authWorker) =>
          authWorker.ensureDetectedMemberAgent({
            harnessKind,
            organizationId: caller.organizationId,
            ownerUserId: caller.ownerUserId,
          }),
        unavailable: {
          code: "member_agents.unavailable",
          reason: "Agents are unavailable.",
        },
      }),
    hasAnyBinding: (agentProfileId) =>
      hasAnyAgentProfileBinding({
        agentProfileId,
        db: caller.db,
        ownerUserId: caller.ownerUserId,
      }),
    listOwnerMemberAgents: () => listOwnerMemberAgents(env, caller),
    listRuntimeHarnesses: () => listRuntimeHarnesses(caller, Date.now()),
    openDirectMessage: async (agentProfileId) => {
      const opened = await rpcOpenDirectMessageSpace(env, {
        context: caller.context,
        targetProfileId: agentProfileId,
      });
      return { spaceId: opened.spaceId };
    },
    readGroupingControllerRef: (agentProfileId) =>
      readAgentProfileGroupingControllerRef({
        agentProfileId,
        db: caller.db,
        ownerUserId: caller.ownerUserId,
      }),
    turnOnHarness: async (target) => {
      const switched = await rpcSetPeopleComputerLocalAgentEnabled(env, {
        agentId: target.agentControllerRef.slice("builtin:".length),
        context: caller.context,
        deviceId: target.deviceId,
        enabled: true,
        runtimeLane: target.lane,
      });
      if (!switched.enabled) {
        throw Object.assign(new Error("The harness stayed off."), {
          code: "member_agent.turn_on_failed",
        });
      }
    },
    writeDefaultBinding: async ({ agentProfileId, target }) => {
      const written = await rpcEnsureAgentProfilePrimaryBinding(env, {
        agentControllerRef: target.agentControllerRef,
        agentProfileId,
        context: caller.context,
        deviceId: target.deviceId,
        lane: target.lane,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: target.openMeldServiceRuntimeId,
        },
        // Harness defaults: no model, mode, or permission override, and an
        // existing Binding is never replaced.
        writeMode: "initialize",
      });
      return { reasonCodes: written.reasonCodes, status: written.status };
    },
  };
}

function createPresenceDeps(
  env: CoreBindings,
  caller: MemberAgentCaller,
  nowMs: number
): MemberAgentPresenceDeps {
  return {
    listOwnerMemberAgents: () => listOwnerMemberAgents(env, caller),
    listRuntimeHarnesses: () => listRuntimeHarnesses(caller, nowMs),
    readOnlineRuntimeKeys: async () => {
      try {
        const service = await lookupRuntimeTransportOwnerService({
          blockForgottenDevices: true,
          env,
          ownerUserId: caller.ownerUserId,
        });
        return new Set(
          service.online
            ? service.sessions.map((session) => buildOnlineRuntimeKey(session))
            : []
        );
      } catch (error) {
        console.warn("[core.member_agents.online_lookup_failed]", {
          error: toErrorMessage(error),
          ownerUserId: caller.ownerUserId,
        });
        return null;
      }
    },
    readOperationalContexts: async (agentProfileIds) => {
      const contexts = new Map<
        string,
        RuntimeTransportAgentProfileOperationalContext
      >();
      for (const batch of chunk(agentProfileIds)) {
        const response =
          await readRuntimeTransportAgentProfileOperationalContexts({
            env,
            includeWorkReferences: false,
            ownerUserId: caller.ownerUserId,
            targetProfileIds: batch,
          });
        for (const entry of response.contexts) {
          contexts.set(entry.targetProfileId, entry.operationalContext);
        }
      }
      return contexts;
    },
    readWakeAvailability: async (agentProfileIds) => {
      const categories = new Map<
        string,
        "available" | "checking" | "offline" | "unavailable"
      >();
      for (const batch of chunk(agentProfileIds)) {
        try {
          const response = await rpcGetAgentExecutionReadinessBatch(env, {
            agentProfileIds: [...batch],
            context: caller.context,
          });
          for (const item of response.items) {
            categories.set(
              item.agentProfileId,
              item.agentWakeAvailability.category
            );
          }
        } catch (error) {
          // Missing entries read as checking, never as a hard verdict.
          console.warn("[core.member_agents.wakeability_unavailable]", {
            error: toErrorMessage(error),
            ownerUserId: caller.ownerUserId,
          });
        }
      }
      return categories;
    },
  };
}

async function listOwnerMemberAgents(
  env: CoreBindings,
  caller: MemberAgentCaller
): Promise<ListMemberAgentsResponse> {
  const listing = await callRequiredAuthWorkerRpc({
    authWorker: env.OPENMELD_AUTH_WORKER,
    call: (authWorker) =>
      authWorker.listOwnerMemberAgents({
        organizationId: caller.organizationId,
        ownerUserId: caller.ownerUserId,
      }),
    unavailable: {
      code: "member_agents.unavailable",
      reason: "Agents are unavailable.",
    },
  });
  if (!listing.ok) {
    throw createCoreRpcHttpError({
      status: listing.code === "organization.membership_required" ? 403 : 502,
      code: listing.code,
      reason: listing.message,
    });
  }
  return listing;
}

async function listRuntimeHarnesses(caller: MemberAgentCaller, nowMs: number) {
  return projectRuntimeHarnesses({
    entries: await listOwnerRuntimeHarnessCatalog({
      db: caller.db,
      ownerUserId: caller.ownerUserId,
    }),
    nowMs,
  });
}

function logSyncResults(
  caller: Pick<MemberAgentCaller, "organizationId" | "ownerUserId">,
  trigger: "catalog_update" | "create" | "surface_open" | "turned_on",
  results: readonly MemberAgentSyncResult[]
): void {
  const changed = results.filter((result) => result.outcome !== "unchanged");
  if (changed.length === 0) {
    return;
  }
  console.info("[core.member_agents.sync]", {
    event: "member_agents.sync",
    organizationId: caller.organizationId,
    ownerUserId: caller.ownerUserId,
    results: changed.map((result) => ({
      binding: result.binding,
      directMessage: result.directMessage,
      harnessKind: result.harnessKind,
      outcome: result.outcome,
      reasonCodes: result.reasonCodes,
    })),
    trigger,
  });
}

function chunk(values: readonly string[]): string[][] {
  const batches: string[][] = [];
  for (let start = 0; start < values.length; start += PROFILE_BATCH_SIZE) {
    batches.push(values.slice(start, start + PROFILE_BATCH_SIZE));
  }
  return batches;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Turn a local agent on or off from OpenMeld Web, then, when it was turned
 * on, add its MemberAgent in the caller's current Organization: turning a
 * Harness on is how the member adds it (§4.1). The Service refreshed its
 * catalog report before answering, so the sync sees the Harness on. The
 * switch response never depends on the sync; a failed sync is logged and
 * the next Agents surface open finishes it.
 */
export async function setLocalAgentEnabledWithMemberAgents<
  Input extends { context?: OpenMeldRequestContext; enabled: boolean },
  Output,
>(
  env: CoreBindings,
  input: Input,
  setEnabled: (input: Input) => Promise<Output>,
  options: MemberAgentRpcOptions = {}
): Promise<Output> {
  const response = await setEnabled(input);
  if (!(input.enabled && (options.enabled ?? MEMBER_AGENTS_ENABLED))) {
    return response;
  }
  try {
    const caller = await requireMemberAgentCaller(env, input.context, options);
    logSyncResults(
      caller,
      "turned_on",
      (await syncMemberAgents(createSyncDeps(env, caller))).results
    );
  } catch (error) {
    console.warn("[core.member_agents.turned_on_sync_failed]", {
      error: toErrorMessage(error),
    });
  }
  return response;
}

/**
 * Accept Runtime Agent Controller Reports, then feed the accepted ones to
 * the MemberAgent catalog hook. The report response never depends on it.
 */
export async function rpcSubmitRuntimeAgentControllerReportsWithMemberAgents(
  env: CoreBindings,
  input: SubmitRuntimeAgentControllerReportsInput
): Promise<SubmitRuntimeAgentControllerReportsResponse> {
  const response = await rpcSubmitRuntimeAgentControllerReports(env, input);
  const runtimeId = response.openMeldServiceRuntimeId?.value;
  const context = openMeldRequestContextSchema.safeParse(input.context);
  const ownerUserId = context.success
    ? context.data.actorContext.ownerUserId?.trim()
    : undefined;
  const db = getPostgresDatabase(env);
  if (
    !(
      MEMBER_AGENTS_ENABLED &&
      runtimeId &&
      context.success &&
      ownerUserId &&
      db
    )
  ) {
    return response;
  }
  await recordMemberAgentCatalogReports(env, {
    context: context.data,
    db,
    nowMs: Date.now(),
    ownerUserId,
    reports: pairAcceptedReports(input, response, runtimeId),
  });
  return response;
}

// Core answers one result per submitted report, in order. Pair them by
// position so a rejected duplicate of an accepted controller never counts.
export function pairAcceptedReports(
  input: SubmitRuntimeAgentControllerReportsInput,
  response: SubmitRuntimeAgentControllerReportsResponse,
  openMeldServiceRuntimeId: string
) {
  const reports = input.reports ?? [];
  if (response.reports.length !== reports.length) {
    return [];
  }
  return reports.flatMap((report, index) => {
    const result = response.reports[index];
    return result?.status === "accepted" &&
      result.agentControllerRef === report.agentControllerRef
      ? [
          {
            agentControllerRef: report.agentControllerRef,
            observedAtMs: report.observedAtMs,
            openMeldServiceRuntimeId,
            reasonCodes: report.reasonCodes ?? [],
            status: report.status,
          },
        ]
      : [];
  });
}
