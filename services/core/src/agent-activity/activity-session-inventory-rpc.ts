import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  agentActivitySessionInventoryRpcInputSchema,
  submitAgentActivitySessionReconciliationRpcInputSchema,
} from "@openmeld/schemas";
import type {
  AgentActivitySessionInventoryResponse,
  AgentActivitySessionInventoryRpcInput,
  SubmitAgentActivitySessionReconciliationResponse,
  SubmitAgentActivitySessionReconciliationRpcInput,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { resolveOrganizationMembershipById } from "../organizations/organization-context";
import {
  readProjectLifecycleRecord,
  readProjectRepositorySettingsRecord,
} from "../projects/project-repository";
import { prepareHumanProjectRequest } from "../projects/project-request-preparation";
import { createCoreRpcHttpError } from "../rpc/errors";
import { verifyRuntimeReportingAuthority } from "../runtime-reporting/runtime-reporting-authority";
import {
  acceptAgentActivitySessionReconciliation,
  readAgentActivitySessionInventory,
  readConnectedComputerId,
} from "./activity-session-inventory-repository";
export async function rpcReadAgentActivitySessionInventory(
  env: CoreBindings,
  input: AgentActivitySessionInventoryRpcInput
): Promise<AgentActivitySessionInventoryResponse> {
  const parsed = agentActivitySessionInventoryRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "Agent Activity Session Inventory request is invalid.",
      status: 400,
    });
  }
  const { context, ...query } = parsed.data;
  const { authority } = await prepareHumanProjectRequest(env, context);
  const db = requireActivityDb(env);
  try {
    return await readAgentActivitySessionInventory({
      db,
      nowMs: Date.now(),
      organizationId: authority.organizationId,
      query,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("cursor is invalid")) {
      throw createCoreRpcHttpError({
        code: "invalid_payload",
        reason: error.message,
        status: 400,
      });
    }
    throw error;
  }
}
export async function rpcSubmitAgentActivitySessionReconciliation(
  env: CoreBindings,
  input: SubmitAgentActivitySessionReconciliationRpcInput
): Promise<SubmitAgentActivitySessionReconciliationResponse> {
  const parsed =
    submitAgentActivitySessionReconciliationRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        parsed.error.issues[0]?.message ??
        "Agent Activity Session reconciliation is invalid.",
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
  const db = requireActivityDb(env);
  const runtime = await verifyRuntimeReportingAuthority({
    db,
    deviceId: parsed.data.deviceId,
    lane: parsed.data.lane,
    ownerUserId,
    openMeldServiceRuntimeId: parsed.data.openMeldServiceRuntimeId,
  });
  if (!runtime.ok) {
    throw createCoreRpcHttpError({
      code: `agent_activity.${runtime.reason}`,
      reason: "Runtime authority is not current for Session reconciliation.",
      status: 409,
    });
  }
  const membership = await resolveOrganizationMembershipById({
    env,
    organizationId: parsed.data.organizationId,
    requestId: parsed.data.context?.actorContext.requestId,
    userId: ownerUserId,
  });
  if (!membership.ok || membership.userId !== runtime.runtime.ownerUserId) {
    throw createCoreRpcHttpError({
      code: "organization.membership_required",
      reason: "Current Organization membership is required.",
      status: membership.ok ? 403 : membership.status,
    });
  }
  const project = await readProjectLifecycleRecord({
    db,
    organizationId: parsed.data.organizationId,
    projectId: parsed.data.projectId,
  });
  if (!canReconcileProject(project, parsed.data.result)) {
    throw createCoreRpcHttpError({
      code: "agent_activity.project_unavailable",
      reason: "The connected Project is unavailable.",
      status: 409,
    });
  }
  await assertReconciliationRepositoryAssociated({
    env,
    organizationId: parsed.data.organizationId,
    projectId: parsed.data.projectId,
    reportedRepositoryFingerprint: parsed.data.repositoryFingerprint,
    result: parsed.data.result,
  });
  const connectedComputerId = await readConnectedComputerId({
    db,
    deviceId: runtime.runtime.deviceId,
    ownerUserId,
  });
  if (!connectedComputerId) {
    throw createCoreRpcHttpError({
      code: "agent_activity.computer_identity_required",
      reason: "Connect this Computer before reporting Agent Activity Sessions.",
      status: 409,
    });
  }
  const nowMs = Date.now();
  if (!isObservationTimeCurrent(parsed.data.observedAtMs, nowMs)) {
    throw createCoreRpcHttpError({
      code: "agent_activity.observation_time_invalid",
      reason: "Session reconciliation observation time is outside its window.",
      status: 400,
    });
  }
  try {
    const {
      context: _context,
      deviceId: _deviceId,
      ...reconciliation
    } = parsed.data;
    return await acceptAgentActivitySessionReconciliation({
      authority: {
        connectedComputerId,
        deviceId: runtime.runtime.deviceId,
        organizationId: parsed.data.organizationId,
        ownerUserId,
      },
      db,
      nowMs,
      reconciliation,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("expected page") ||
        error.message.includes("already claimed"))
    ) {
      throw createCoreRpcHttpError({
        code: "agent_activity.reconciliation_conflict",
        reason: error.message,
        status: 409,
      });
    }
    throw error;
  }
}

async function assertReconciliationRepositoryAssociated(input: {
  env: CoreBindings;
  organizationId: string;
  projectId: string;
  reportedRepositoryFingerprint: string | null;
  result: SubmitAgentActivitySessionReconciliationRpcInput["result"];
}): Promise<void> {
  if (input.result === "disconnected") {
    return;
  }
  const db = getPostgresDatabase(input.env);
  const settings = db
    ? await readProjectRepositorySettingsRecord({
        db,
        organizationId: input.organizationId,
        projectId: input.projectId,
      })
    : null;
  if (!settings) {
    throw createCoreRpcHttpError({
      code: "project.store_unavailable",
      reason: "Project repository settings are unavailable.",
      status: 503,
    });
  }
  const fingerprints = [
    ...(settings.legacyDefaultFingerprint
      ? [settings.legacyDefaultFingerprint]
      : []),
    ...settings.repositories.map(
      (repository) => repository.repositoryFingerprint
    ),
  ];
  if (
    !isSessionReconciliationFingerprintCompatible({
      projectRepositoryFingerprints: fingerprints,
      reportedRepositoryFingerprint: input.reportedRepositoryFingerprint,
      result: input.result,
    })
  ) {
    throw createCoreRpcHttpError({
      code: "agent_activity.repository_fingerprint_mismatch",
      reason: "The connected Project repository does not match.",
      status: 409,
    });
  }
}
function canReconcileProject(
  project: Awaited<ReturnType<typeof readProjectLifecycleRecord>>,
  result: SubmitAgentActivitySessionReconciliationRpcInput["result"]
): project is NonNullable<typeof project> {
  return Boolean(
    project && (project.archivedAtMs === null || result === "disconnected")
  );
}
export function isSessionReconciliationFingerprintCompatible(input: {
  projectRepositoryFingerprints: readonly string[];
  reportedRepositoryFingerprint: string | null;
  result: SubmitAgentActivitySessionReconciliationRpcInput["result"];
}): boolean {
  return (
    input.result === "disconnected" ||
    input.projectRepositoryFingerprints.length === 0 ||
    (input.reportedRepositoryFingerprint !== null &&
      input.projectRepositoryFingerprints.includes(
        input.reportedRepositoryFingerprint
      ))
  );
}
function isObservationTimeCurrent(observedAtMs: number, nowMs: number) {
  return (
    observedAtMs >= nowMs - 24 * 60 * 60_000 &&
    observedAtMs <= nowMs + 5 * 60_000
  );
}
function requireActivityDb(env: CoreBindings): PostgresDatabase {
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "agent_activity.store_unavailable",
      reason: "Agent Activity storage is unavailable.",
      status: 503,
    });
  }
  return db;
}
