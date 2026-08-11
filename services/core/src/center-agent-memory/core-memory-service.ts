import type { CoreBindings } from "../lib/bindings";
import { identityDb } from "../lib/bindings";
import {
  clearRemoteAgentNativeDeliveryTriggerTextForMember,
  clearRemoteAgentNativeDeliveryTriggerTextForOrganization,
} from "../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { createD1CenterAgentMemoryRepository } from "./d1-memory-repository";
import {
  type CenterAgentMemoryService,
  createCenterAgentMemoryService,
} from "./memory-service";
import { createZepCenterAgentMemoryAdapter } from "./zep-memory-adapter";

export function createCoreCenterAgentMemoryService(
  env: CoreBindings
): CenterAgentMemoryService | null {
  const db = identityDb(env);
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
    repository: createD1CenterAgentMemoryRepository(db),
  });
}

export async function clearCoreCenterAgentOrganizationNativeDeliveryData(
  env: CoreBindings,
  organizationId: string
): Promise<boolean> {
  const db = identityDb(env);
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
  const db = identityDb(env);
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
