import { readFile } from "node:fs/promises";
import {
  postgresqlD1RemoteSourceSchema,
  postgresqlRemoteImportTargetSchema,
} from "../../packages/schemas/src/schemas/release/postgresql-import.ts";

export async function readCutoverTarget() {
  const inventory = JSON.parse(
    await readFile(new URL("./resources.json", import.meta.url), "utf8")
  );
  const entry = inventory.environments.production;
  return {
    databaseName: entry.database,
    branchName: entry.branch,
    sourceDatabaseName: entry.sourceD1.databaseName,
    source: postgresqlD1RemoteSourceSchema.parse({
      kind: "cloudflare-d1",
      accountId: inventory.accountId,
      databaseId: entry.sourceD1.databaseId,
    }),
    target: postgresqlRemoteImportTargetSchema.parse({
      kind: "planetscale",
      organization: inventory.organization,
      databaseId: entry.databaseId,
      branchId: entry.branchId,
      host: entry.host,
      database: "postgres",
    }),
    migrationRole: entry.migrationRole,
    runtimeRole: entry.runtimeRole,
    hyperdriveId: entry.hyperdriveId,
  };
}

export function verifyRemoteCredential(connectionString, registered) {
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== registered.target.host ||
    url.port !== "5432" ||
    url.pathname !== `/${registered.target.database}` ||
    decodeURIComponent(url.username) !==
      `${registered.migrationRole}.${registered.target.branchId}` ||
    url.search ||
    url.hash
  ) {
    throw new Error("Credential does not match the registered cutover target");
  }
}
