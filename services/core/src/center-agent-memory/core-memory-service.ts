import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { CoreBindings } from "../lib/bindings";

import {
  clearRemoteAgentNativeDeliveryTriggerTextForMember,
  clearRemoteAgentNativeDeliveryTriggerTextForOrganization,
} from "../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  type CenterAgentMemoryService,
  createCenterAgentMemoryService,
} from "./memory-service";
import { createPostgresCenterAgentMemoryRepository } from "./postgresql-memory-repository";
import {
  type RetainedMemoryRead,
  searchRetainedCenterAgentMemory,
} from "./retained-memory-search";
import { createZepCenterAgentMemoryAdapter } from "./zep-memory-adapter";

export function createCoreCenterAgentMemoryService(
  env: CoreBindings
): CenterAgentMemoryService | null {
  const db = getPostgresDatabase(env);
  const apiKey = normalizeOptionalText(env.ZEP_OPENMELD_API_KEY);
  if (!(db && apiKey)) {
    return null;
  }

  return createCenterAgentMemoryService({
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
