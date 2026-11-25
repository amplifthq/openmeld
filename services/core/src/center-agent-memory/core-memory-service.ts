import { waitUntil } from "cloudflare:workers";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { CoreBindings } from "../lib/bindings";

import {
  clearRemoteAgentNativeDeliveryTriggerTextForMember,
  clearRemoteAgentNativeDeliveryTriggerTextForOrganization,
} from "../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { CENTER_AGENT_MEMORY_RECALL_TIMEOUT_MS } from "./contract";
import {
  type CenterAgentMemoryService,
  createCenterAgentMemoryService,
  withCenterAgentMemoryTimeout,
} from "./memory-service";
import { createPostgresCenterAgentMemoryRepository } from "./postgresql-memory-repository";
import {
  type RetainedMemoryRead,
  searchRetainedCenterAgentMemory,
} from "./retained-memory-search";
import { createCenterAgentMemorySpaceAccess } from "./space-memory-access";
import { createZepCenterAgentMemoryAdapter } from "./zep-memory-adapter";

export async function readCoreOrganizationMemoryAvailability(
  env: CoreBindings,
  organizationId: string
): Promise<"available" | "unavailable" | "not_checked" | "disabled"> {
  const db = getPostgresDatabase(env);
  if (!db) {
    return "unavailable";
  }
  const repository = createPostgresCenterAgentMemoryRepository(db);
  const policy = await repository.readPolicy(organizationId);
  if (!policy.organizationMemoryOptIn) {
    return "disabled";
  }
  const apiKey = normalizeOptionalText(env.ZEP_OPENMELD_API_KEY);
  if (!apiKey) {
    return "unavailable";
  }
  const refs = await repository.readActiveSubjects({ organizationId });
  const ref = refs.find(
    (candidate) => candidate.subject.kind === "organization"
  );
  // Do not create an organization graph just to check its setting.
  if (!ref) {
    return "not_checked";
  }
  try {
    await withCenterAgentMemoryTimeout(
      createZepCenterAgentMemoryAdapter({ apiKey })
        .searchDetailed({
          ref,
          query: "organization memory",
          limit: 1,
        })
        .then((result) => {
          if (result.status !== "complete") {
            throw new Error("provenance_unavailable");
          }
        }),
      CENTER_AGENT_MEMORY_RECALL_TIMEOUT_MS,
      "center_agent_memory.availability_timeout"
    );
    return "available";
  } catch (error) {
    console.warn("[core.center_agent_memory.availability_unavailable]", {
      organizationId,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return "unavailable";
  }
}

export function createCoreCenterAgentMemoryService(
  env: CoreBindings
): CenterAgentMemoryService | null {
  const db = getPostgresDatabase(env);
  const apiKey = normalizeOptionalText(env.ZEP_OPENMELD_API_KEY);
  if (!(db && apiKey)) {
    return null;
  }

  return createCenterAgentMemoryService({
    spaceAccess: createCenterAgentMemorySpaceAccess(env),
    waitUntil,
    adapter: createZepCenterAgentMemoryAdapter({ apiKey }),
    nativeDeliveryLedger: {
      clearTriggerTextForMember: (ledgerInput) =>
        clearRemoteAgentNativeDeliveryTriggerTextForMember({
          db,
          ...ledgerInput,
        }),
      clearTriggerTextForOrganization: (ledgerInput) =>
        clearRemoteAgentNativeDeliveryTriggerTextForOrganization({
          db,
          ...ledgerInput,
        }),
    },
    repository: createPostgresCenterAgentMemoryRepository(db),
  });
}

export async function readCoreCenterAgentRetainedMemory(
  env: CoreBindings,
  input: {
    organizationId: string;
    speakerMember: { memberId: string; userId: string };
    query: string;
    limit: number;
    spaceId?: string;
  }
): Promise<RetainedMemoryRead> {
  const db = getPostgresDatabase(env);
  const apiKey = normalizeOptionalText(env.ZEP_OPENMELD_API_KEY);
  if (!(db && apiKey)) {
    return { items: [], status: "unavailable" };
  }
  return await searchRetainedCenterAgentMemory({
    ...input,
    adapter: createZepCenterAgentMemoryAdapter({ apiKey }),
    repository: createPostgresCenterAgentMemoryRepository(db),
  });
}

export async function deleteCoreCenterAgentSpaceMemory(
  env: CoreBindings,
  input: { organizationId: string; spaceId: string }
) {
  const db = getPostgresDatabase(env);
  const existing = await db.query({
    text: `SELECT 1 FROM "openmeld"."center_agent_memory_subjects" WHERE organization_id = $1 AND subject_kind = 'space' AND space_id = $2 AND status <> 'deleted' LIMIT 1`,
    values: [input.organizationId, input.spaceId],
  });
  const service = createCoreCenterAgentMemoryService(env);
  if (!service) {
    if (existing.rows.length) {
      throw new Error("center_agent_memory.space_deletion_unavailable");
    }
    const repository = createPostgresCenterAgentMemoryRepository(db);
    await repository.beginSpaceDeletion({ ...input, nowMs: Date.now() });
    await repository.markSpaceDeleted({ ...input, deletedAtMs: Date.now() });
    return;
  }
  await service.deleteSpaceMemory(input);
}

export async function clearCoreCenterAgentOrganizationNativeDeliveryData(
  env: CoreBindings,
  organizationId: string
): Promise<boolean> {
  const db = getPostgresDatabase(env);
  if (!db) {
    return false;
  }
  await clearRemoteAgentNativeDeliveryTriggerTextForOrganization({
    db,
    organizationId,
  });
  return true;
}

export async function clearCoreCenterAgentMemberNativeDeliveryData(
  env: CoreBindings,
  organizationId: string,
  userId: string
): Promise<boolean> {
  const db = getPostgresDatabase(env);
  if (!db) {
    return false;
  }
  await clearRemoteAgentNativeDeliveryTriggerTextForMember({
    db,
    organizationId,
    userId,
  });
  return true;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
