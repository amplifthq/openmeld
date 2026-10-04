import { buildPostgresRuntimeDbFactSnapshot } from "@openmeld/db/facts";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { toErrorMessage } from "@openmeld/gateway-contract";
import { dispatchStorageReadinessSchema } from "@openmeld/schemas";
import type {
  DbFactSnapshot,
  DispatchStorageReadiness,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
export const inspectCoreDbState = (
  env?: Pick<CoreBindings, "OPENMELD_POSTGRESQL">
): DbFactSnapshot => {
  const bindingAvailable = Boolean(env?.OPENMELD_POSTGRESQL);
  return buildPostgresRuntimeDbFactSnapshot({
    subject: "core",
    bindingAvailable,
  });
};
export const inspectCoreDispatchStorageReadiness = async (
  env?: Pick<CoreBindings, "OPENMELD_POSTGRESQL">
): Promise<DispatchStorageReadiness> => {
  const checkedAt = new Date().toISOString();
  if (!env?.OPENMELD_POSTGRESQL) {
    return dispatchStorageReadinessSchema.parse({
      ready: false,
      detail:
        "Core dispatch storage cannot be inspected because the bindings are missing.",
      checkedAt,
    });
  }
  // Shared application tables use one PostgreSQL binding. Runtime probes
  // do not receive access to the migration owner's private journal.
  const domainProbes = [
    {
      db: getPostgresDatabase(env),
      domain: "local-state",
      table: "openMeldDaemon_agent_profile_bindings",
    },
    {
      db: getPostgresDatabase(env),
      domain: "wake-evidence",
      table: "openMeldDaemon_dispatch_ledger",
    },
    {
      db: getPostgresDatabase(env),
      domain: "projections",
      table: "space_index_memberships",
    },
  ];
  for (const probe of domainProbes) {
    try {
      await probe.db.query({
        text: `SELECT 1 FROM "openmeld"."${probe.table}" LIMIT 1`,
        values: [],
      });
    } catch (error) {
      return dispatchStorageReadinessSchema.parse({
        ready: false,
        detail: `Core ${probe.domain} dispatch storage not ready: ${toErrorMessage(error)}`,
        checkedAt,
      });
    }
  }
  return dispatchStorageReadinessSchema.parse({
    ready: true,
    detail: null,
    checkedAt,
  });
};
