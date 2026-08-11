import {
  organizationUsageOverviewResponseSchema,
  organizationUsageOverviewRpcInputSchema,
} from "@openmeld/schemas";
import type {
  OrganizationUsageOverviewResponse,
  OrganizationUsageOverviewRpcInput,
} from "@openmeld/schemas/types";
import { type CoreBindings, routineDb, wakeEvidenceDb } from "../lib/bindings";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { createCoreRpcHttpError } from "../rpc/errors";
import { readOrganizationUsageOverview } from "./organization-usage-overview-service";

export async function rpcReadOrganizationUsageOverview(
  env: CoreBindings,
  input: OrganizationUsageOverviewRpcInput
): Promise<OrganizationUsageOverviewResponse> {
  const request = organizationUsageOverviewRpcInputSchema.safeParse(input);
  if (!request.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Organization Usage overview request is invalid.",
      status: 400,
    });
  }
  const membership = await resolveActiveOrganizationMembership({
    context: request.data.context,
    env,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      code: membership.code,
      reason: membership.message,
      status: membership.status,
    });
  }
  if (request.data.context.actorContext.profileKind !== "human") {
    throw createCoreRpcHttpError({
      code: "organization.membership_required",
      reason: "Organization Usage is available to active human members.",
      status: 403,
    });
  }
  const routines = routineDb(env);
  const wakeEvidence = wakeEvidenceDb(env);
  if (!(routines && wakeEvidence)) {
    throw createCoreRpcHttpError({
      code: "usage.store_unavailable",
      reason: "Organization Usage is unavailable.",
      status: 503,
    });
  }
  const response = organizationUsageOverviewResponseSchema.safeParse(
    await readOrganizationUsageOverview({
      configuredDailyLimit: env.OPENMELD_REMOTE_AGENT_DAILY_ADMISSION_LIMIT,
      nowMs: Date.now(),
      organizationId: membership.organizationId,
      routineDb: routines,
      wakeEvidenceDb: wakeEvidence,
    })
  );
  if (!response.success) {
    throw new Error("Failed to build a valid Organization Usage overview.", {
      cause: response.error,
    });
  }
  return response.data;
}
