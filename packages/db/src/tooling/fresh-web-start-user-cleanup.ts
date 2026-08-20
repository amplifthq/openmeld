import Database from "better-sqlite3";
import { listSharedLocalWorkerDbTargets } from "../shared/local-worker-targets.ts";
import {
  type DbExecutionMode,
  resolveDbExecutionMode,
} from "./db-execution-mode.ts";

const SQLITE_BUSY_ERROR_RE = /database is locked|busy/i;

export type FreshWebStartUserCleanupCounts = {
  agentActivitySessionInventory: number;
  agentActivitySessionInventoryCandidates: number;
  agentActivitySessionInventorySources: number;
  openMeldProfileSpaceHistory: number;
  openMeldProfiles: number;
  openMeldSpaceDeletionTombstones: number;
  openMeldDaemonCurrentDeviceTargets: number;
  // TODO(2026-05-15): Rename this cleanup counter with the Local Runtime
  // registry storage cleanup.
  openMeldDaemonOwnedDevices: number;
  authOneTimeTokenVerifications: number;
  authSessions: number;
};

export type FreshWebStartUserCleanupResult = {
  clearAuthSessions: boolean;
  counts: FreshWebStartUserCleanupCounts;
  email: string;
  localDbTargets: readonly FreshWebStartLocalDbTarget[];
  userId: string;
};

export type FreshWebStartLocalDbTarget = {
  localDbPath: string;
  services: readonly ("auth" | "core")[];
};

type CleanupUserRow = {
  email: string;
  normalizedEmail: string | null;
  userId: string;
};

type BetterSqliteDatabase = Database.Database;

const DEFAULT_COUNTS: FreshWebStartUserCleanupCounts = {
  agentActivitySessionInventory: 0,
  agentActivitySessionInventoryCandidates: 0,
  agentActivitySessionInventorySources: 0,
  openMeldProfileSpaceHistory: 0,
  openMeldProfiles: 0,
  openMeldSpaceDeletionTombstones: 0,
  openMeldDaemonCurrentDeviceTargets: 0,
  openMeldDaemonOwnedDevices: 0,
  authOneTimeTokenVerifications: 0,
  authSessions: 0,
};

export const normalizeFreshWebStartCleanupEmail = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || !normalized.includes("@")) {
    throw new Error("fresh Web Start cleanup requires a valid --email value");
  }
  return normalized;
};

export const resolveFreshWebStartLocalDbTargets = (input?: {
  mode?: DbExecutionMode;
}): FreshWebStartLocalDbTarget[] => {
  const mode = input?.mode ?? resolveDbExecutionMode();
  if (mode !== "dev") {
    throw new Error(
      "fresh Web Start cleanup only supports the local shared OPENMELD_DB sqlite targets"
    );
  }

  const groupedTargets = new Map<string, Set<"auth" | "core">>();
  for (const target of listSharedLocalWorkerDbTargets()) {
    const localDbPath = String(target.localPath ?? "").trim();
    if (localDbPath.length === 0) {
      throw new Error(
        `fresh Web Start cleanup could not resolve the ${target.targetLabel} sqlite path`
      );
    }

    const services = groupedTargets.get(localDbPath) ?? new Set();
    services.add(target.service);
    groupedTargets.set(localDbPath, services);
  }

  if (groupedTargets.size === 0) {
    throw new Error(
      "fresh Web Start cleanup could not resolve any local OPENMELD_DB sqlite targets"
    );
  }

  return Array.from(groupedTargets.entries()).map(([localDbPath, services]) => {
    const orderedServices: Array<"auth" | "core"> = [];
    if (services.has("auth")) {
      orderedServices.push("auth");
    }
    if (services.has("core")) {
      orderedServices.push("core");
    }
    return {
      localDbPath,
      services: orderedServices,
    };
  });
};

export const runFreshWebStartUserCleanup = (input: {
  clearAuthSessions?: boolean;
  email: string;
  localDbTargets?: readonly FreshWebStartLocalDbTarget[];
  databasesByPath?: ReadonlyMap<string, BetterSqliteDatabase>;
  mode?: DbExecutionMode;
}): FreshWebStartUserCleanupResult => {
  const normalizedEmail = normalizeFreshWebStartCleanupEmail(input.email);
  const localDbTargets =
    input.localDbTargets ??
    resolveFreshWebStartLocalDbTargets({ mode: input.mode });
  const databasesByPath = new Map(input.databasesByPath ?? []);
  const ownedPaths = new Set<string>();

  try {
    const readDatabase = (localDbPath: string): BetterSqliteDatabase => {
      const existing = databasesByPath.get(localDbPath);
      if (existing) {
        return existing;
      }

      const database = new Database(localDbPath, {
        fileMustExist: true,
      });
      database.pragma("foreign_keys = ON");
      database.pragma("busy_timeout = 5000");
      databasesByPath.set(localDbPath, database);
      ownedPaths.add(localDbPath);
      return database;
    };

    const authTarget = localDbTargets.find((target) =>
      target.services.includes("auth")
    );
    if (!authTarget) {
      throw new Error(
        "fresh Web Start cleanup requires a local auth OPENMELD_DB target to resolve the test account"
      );
    }

    const authDatabase = readDatabase(authTarget.localDbPath);
    const userRow = resolveCleanupUser(authDatabase, normalizedEmail);
    if (!userRow) {
      throw new Error(
        `fresh Web Start cleanup could not find a local auth user for ${normalizedEmail}`
      );
    }

    const counts = { ...DEFAULT_COUNTS };
    for (const target of localDbTargets) {
      const database = readDatabase(target.localDbPath);
      const targetCounts = database.transaction(() => {
        const nextCounts = { ...DEFAULT_COUNTS };

        nextCounts.agentActivitySessionInventoryCandidates = runDelete(
          database,
          "DELETE FROM agent_activity_session_inventory_candidates WHERE owner_user_id = ?",
          [userRow.userId]
        );
        nextCounts.agentActivitySessionInventory = runDelete(
          database,
          "DELETE FROM agent_activity_session_inventory WHERE owner_user_id = ?",
          [userRow.userId]
        );
        nextCounts.agentActivitySessionInventorySources = runDelete(
          database,
          "DELETE FROM agent_activity_session_inventory_sources WHERE owner_user_id = ?",
          [userRow.userId]
        );
        nextCounts.openMeldProfileSpaceHistory = runDelete(
          database,
          `DELETE FROM openmeld_profile_space_history
         WHERE profile_id IN (
           SELECT profile_id
           FROM openmeld_profiles
           WHERE owner_user_id = ?
         )`,
          [userRow.userId]
        );
        nextCounts.openMeldSpaceDeletionTombstones = runDelete(
          database,
          `DELETE FROM openmeld_space_deletion_tombstones
         WHERE deleted_by_owner_user_id = ?`,
          [userRow.userId]
        );
        nextCounts.openMeldProfiles = runDelete(
          database,
          "DELETE FROM openmeld_profiles WHERE owner_user_id = ?",
          [userRow.userId]
        );
        nextCounts.openMeldDaemonCurrentDeviceTargets = runDelete(
          database,
          "DELETE FROM openMeldDaemon_current_device_targets WHERE owner_user_id = ?",
          [userRow.userId]
        );
        nextCounts.openMeldDaemonOwnedDevices = runDelete(
          database,
          "DELETE FROM openMeldDaemon_owned_devices WHERE owner_user_id = ?",
          [userRow.userId]
        );

        if (input.clearAuthSessions && target.services.includes("auth")) {
          nextCounts.authSessions = runDelete(
            database,
            "DELETE FROM sessions WHERE user_id = ?",
            [userRow.userId]
          );
          nextCounts.authOneTimeTokenVerifications = runDelete(
            database,
            "DELETE FROM verifications WHERE identifier LIKE 'one-time-token:%'",
            []
          );
        }

        return nextCounts;
      })();

      counts.openMeldProfileSpaceHistory +=
        targetCounts.openMeldProfileSpaceHistory;
      counts.agentActivitySessionInventory +=
        targetCounts.agentActivitySessionInventory;
      counts.agentActivitySessionInventoryCandidates +=
        targetCounts.agentActivitySessionInventoryCandidates;
      counts.agentActivitySessionInventorySources +=
        targetCounts.agentActivitySessionInventorySources;
      counts.openMeldProfiles += targetCounts.openMeldProfiles;
      counts.openMeldSpaceDeletionTombstones +=
        targetCounts.openMeldSpaceDeletionTombstones;
      counts.openMeldDaemonCurrentDeviceTargets +=
        targetCounts.openMeldDaemonCurrentDeviceTargets;
      counts.openMeldDaemonOwnedDevices +=
        targetCounts.openMeldDaemonOwnedDevices;
      counts.authOneTimeTokenVerifications +=
        targetCounts.authOneTimeTokenVerifications;
      counts.authSessions += targetCounts.authSessions;
    }

    return {
      clearAuthSessions: Boolean(input.clearAuthSessions),
      counts,
      email: userRow.email,
      localDbTargets,
      userId: userRow.userId,
    };
  } catch (error) {
    if (error instanceof Error && SQLITE_BUSY_ERROR_RE.test(error.message)) {
      throw new Error(
        `fresh Web Start cleanup could not update the local OPENMELD_DB targets (${localDbTargets
          .map((target) => target.localDbPath)
          .join(
            ", "
          )}) because one of them is busy. Run \`pnpm dev:stop\`, retry the cleanup, then restart with \`pnpm dev\`.`
      );
    }
    throw error;
  } finally {
    for (const localDbPath of ownedPaths) {
      databasesByPath.get(localDbPath)?.close();
    }
  }
};

const resolveCleanupUser = (
  database: BetterSqliteDatabase,
  normalizedEmail: string
): CleanupUserRow | null => {
  const row = database
    .prepare<
      [string, string, string],
      {
        email: string;
        normalizedEmail: string | null;
        userId: string;
      }
    >(
      `SELECT
         id AS userId,
         email,
         normalized_email AS normalizedEmail
       FROM users
       WHERE lower(trim(email)) = ?
          OR normalized_email = ?
       ORDER BY CASE WHEN normalized_email = ? THEN 0 ELSE 1 END
       LIMIT 1`
    )
    .get(normalizedEmail, normalizedEmail, normalizedEmail);

  if (!row) {
    return null;
  }

  return {
    email: String(row.email),
    normalizedEmail:
      row.normalizedEmail === null ? null : String(row.normalizedEmail),
    userId: String(row.userId),
  };
};

const runDelete = (
  database: BetterSqliteDatabase,
  sql: string,
  params: readonly unknown[]
): number => {
  const result = database.prepare(sql).run(...params);
  return Number(result.changes ?? 0);
};
