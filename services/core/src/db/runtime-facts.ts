import {
  CORE_DB_BINDING_NAME,
  CORE_DB_RELEASE_NOTES,
  getCoreDbMigrationSources,
  getCoreDbSchemaSources,
} from "@openmeld/db/core/facts";
import {
  buildDbFactSnapshot,
  buildSharedRuntimeDbTarget,
} from "@openmeld/db/facts";
import { toErrorMessage } from "@openmeld/gateway-contract";
import { dispatchStorageReadinessSchema } from "@openmeld/schemas";
import type {
  DbFactSnapshot,
  DispatchStorageReadiness,
} from "@openmeld/schemas/types";
import {
  type CoreBindings,
  localStateDb,
  projectionsDb,
  wakeEvidenceDb,
} from "../lib/bindings";

export const inspectCoreDbState = (
  env?: Pick<CoreBindings, "OPENMELD_DB">
): DbFactSnapshot => {
  const bindingAvailable = Boolean(env?.OPENMELD_DB);

  return buildDbFactSnapshot({
    subject: "core",
    mode: "runtime",
    bindingName: CORE_DB_BINDING_NAME,
    schemaSources: getCoreDbSchemaSources(),
    migrationSources: getCoreDbMigrationSources(),
    target: buildSharedRuntimeDbTarget({ bindingAvailable }),
    d1LocalDbPath: null,
    notes: [
      ...CORE_DB_RELEASE_NOTES,
      bindingAvailable
        ? "Runtime DB diagnostics confirmed that Core can see the OPENMELD_DB worker binding."
        : "Runtime DB diagnostics could not confirm that Core can see the OPENMELD_DB worker binding.",
    ],
  });
};

export const inspectCoreDispatchStorageReadiness = async (
  env?: Pick<
    CoreBindings,
    | "OPENMELD_DB"
    | "OPENMELD_LOCAL_STATE_DB"
    | "OPENMELD_WAKE_EVIDENCE_DB"
    | "OPENMELD_PROJECTIONS_DB"
  >
): Promise<DispatchStorageReadiness> => {
  const checkedAt = new Date().toISOString();
  if (!env) {
    return dispatchStorageReadinessSchema.parse({
      ready: false,
      detail:
        "Core dispatch storage cannot be inspected because the bindings are missing.",
      checkedAt,
    });
  }

  // Per-domain readiness after the physical DB split: a single handle no longer
  // sees every table, so probe one sentinel table through each domain accessor.
  // Correct in the alias phase (all accessors resolve to openmeld-db) and after the
  // cutover (each accessor resolves to its own domain DB).
  const domainProbes = [
    {
      db: localStateDb(env),
      domain: "local-state",
      table: "openMeldDaemon_agent_profile_bindings",
    },
    {
      db: wakeEvidenceDb(env),
      domain: "wake-evidence",
      table: "openMeldDaemon_dispatch_ledger",
    },
    {
      db: projectionsDb(env),
      domain: "projections",
      table: "space_index_memberships",
    },
  ];

  for (const probe of domainProbes) {
    if (!probe.db) {
      return dispatchStorageReadinessSchema.parse({
        ready: false,
        detail: `Core ${probe.domain} dispatch storage binding is missing.`,
        checkedAt,
      });
    }
    try {
      await probe.db.prepare(`SELECT 1 FROM ${probe.table} LIMIT 1`).all();
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
