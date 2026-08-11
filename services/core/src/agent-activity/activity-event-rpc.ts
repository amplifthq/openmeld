import {
  submitAgentActivityEventsResponseSchema,
  submitAgentActivityEventsRpcInputSchema,
} from "@openmeld/schemas";
import type {
  SubmitAgentActivityEventsResponse,
  SubmitAgentActivityEventsRpcInput,
} from "@openmeld/schemas/types";
import { agentActivityDb, type CoreBindings } from "../lib/bindings";
import { resolveOrganizationMembershipById } from "../organizations/organization-context";
import { createCoreRpcHttpError } from "../rpc/errors";
import { verifyRuntimeReportingAuthority } from "../runtime-reporting/runtime-reporting-authority";
import { acceptAgentActivityEventBatch } from "./activity-event-service";

export async function rpcSubmitAgentActivityEvents(
  env: CoreBindings,
  input: SubmitAgentActivityEventsRpcInput
): Promise<SubmitAgentActivityEventsResponse> {
  const parsed = submitAgentActivityEventsRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "Invalid Agent Activity event submission.",
      status: 400,
    });
  }
  const ownerUserId = String(
    parsed.data.context?.actorContext.ownerUserId ?? ""
  ).trim();
  if (!ownerUserId) {
    throw createCoreRpcHttpError({
      code: "auth.unauthenticated",
      reason: "Authenticated owner identity is required.",
      status: 401,
    });
  }
  const db = agentActivityDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "agent_activity.store_unavailable",
      reason: "Agent Activity storage is unavailable.",
      status: 503,
    });
  }
  const runtime = await verifyRuntimeReportingAuthority({
    db,
    deviceId: parsed.data.deviceId,
    lane: parsed.data.lane,
    ownerUserId,
    openMeldServiceRuntimeId: parsed.data.openMeldServiceRuntimeId,
  });
  if (!runtime.ok) {
    return buildRuntimeRejectedResponse(parsed.data.events, runtime.reason);
  }
  const membershipCache = new Map<
    string,
    Promise<{ ok: true; userId: string } | { ok: false; unavailable: boolean }>
  >();
  return await acceptAgentActivityEventBatch({
    db,
    events: parsed.data.events,
    resolveMembership: async (organizationId) => {
      let pending = membershipCache.get(organizationId);
      if (!pending) {
        pending = resolveEventMembership({
          env,
          organizationId,
          ownerUserId,
          requestId: parsed.data.context?.actorContext.requestId,
        });
        membershipCache.set(organizationId, pending);
      }
      return await pending;
    },
    runtime: runtime.runtime,
  });
}

async function resolveEventMembership(input: {
  env: CoreBindings;
  organizationId: string;
  ownerUserId: string;
  requestId?: string;
}) {
  const membership = await resolveOrganizationMembershipById({
    env: input.env,
    organizationId: input.organizationId,
    requestId: input.requestId,
    userId: input.ownerUserId,
  });
  if (membership.ok) {
    return { ok: true as const, userId: membership.userId };
  }
  return {
    ok: false as const,
    unavailable: membership.status === 503,
  };
}

function buildRuntimeRejectedResponse(
  events: readonly unknown[],
  reason:
    | "runtime_lookup_conflict"
    | "runtime_missing"
    | "openmeld_service_runtime_id_invalid"
    | "openmeld_service_runtime_id_mismatch"
    | "openmeld_service_runtime_identity_invalid"
): SubmitAgentActivityEventsResponse {
  const response = {
    events: events.map((candidate, index) => ({
      ...readCandidateEventId(candidate),
      index,
      outcome: "retryable_rejected" as const,
      reason,
    })),
    status: "rejected" as const,
  };
  const parsed = submitAgentActivityEventsResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error(
      "Failed to build a Runtime-rejected Agent Activity response."
    );
  }
  return parsed.data;
}

function readCandidateEventId(candidate: unknown): { eventId?: string } {
  if (!(candidate && typeof candidate === "object" && "eventId" in candidate)) {
    return {};
  }
  const eventId = String(candidate.eventId).trim();
  return eventId.length > 0 && eventId.length <= 256 ? { eventId } : {};
}
