import {
  submitAgentControllerTaskLifecycleEventsResponseSchema,
  submitAgentControllerTaskLifecycleEventsRpcInputSchema,
} from "@openmeld/schemas";
import type {
  SubmitAgentControllerTaskLifecycleEventsResponse,
  SubmitAgentControllerTaskLifecycleEventsRpcInput,
} from "@openmeld/schemas/types";
import {
  agentTaskCoordinationDb,
  type CoreBindings,
  localStateDb,
} from "../../lib/bindings";
import { resolveOrganizationMembershipById } from "../../organizations/organization-context";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { verifyRuntimeReportingAuthority } from "../../runtime-reporting/runtime-reporting-authority";
import { acceptAgentControllerTaskLifecycleEventBatch } from "./agent-controller-task-lifecycle-service";

export async function rpcSubmitAgentControllerTaskLifecycleEvents(
  env: CoreBindings,
  input: SubmitAgentControllerTaskLifecycleEventsRpcInput
): Promise<SubmitAgentControllerTaskLifecycleEventsResponse> {
  const parsed =
    submitAgentControllerTaskLifecycleEventsRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "Invalid Agent Controller task lifecycle event submission.",
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
  const runtimeDb = localStateDb(env);
  const coordinationDb = agentTaskCoordinationDb(env);
  if (!(runtimeDb && coordinationDb)) {
    throw createCoreRpcHttpError({
      code: "agent_controller_task.store_unavailable",
      reason: "Agent Controller task lifecycle storage is unavailable.",
      status: 503,
    });
  }
  const runtime = await verifyRuntimeReportingAuthority({
    db: runtimeDb,
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
  return await acceptAgentControllerTaskLifecycleEventBatch({
    db: coordinationDb,
    env,
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
  events: readonly { eventId: string }[],
  reason:
    | "runtime_lookup_conflict"
    | "runtime_missing"
    | "openmeld_service_runtime_id_invalid"
    | "openmeld_service_runtime_id_mismatch"
    | "openmeld_service_runtime_identity_invalid"
): SubmitAgentControllerTaskLifecycleEventsResponse {
  const response = {
    events: events.map((event) => ({
      eventId: event.eventId,
      reason,
      status: "retryable_rejected" as const,
    })),
    status: "rejected" as const,
  };
  const parsed =
    submitAgentControllerTaskLifecycleEventsResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error(
      "Failed to build a Runtime-rejected Agent Controller task lifecycle response."
    );
  }
  return parsed.data;
}
