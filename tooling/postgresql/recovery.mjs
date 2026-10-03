// biome-ignore-all lint/suspicious/noMisplacedAssertion: Standalone operational acceptance uses node:assert and fails the command on contract violations.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { acceptRuntime } from "./acceptance.mjs";
import { connect, migrate } from "./database.mjs";

const file = new URL("./resources.json", import.meta.url);
const inventory = JSON.parse(await readFile(file, "utf8"));
const entry = inventory.environments.staging;
const branchName = "foundation-restore-20261003";
function execute(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${program} operation failed; credential-bearing output suppressed`
    );
  }
  return result.stdout;
}
function api(args) {
  return JSON.parse(
    execute("pscale", [...args, "--org", "amplift", "--format", "json"])
  );
}
function secret(name) {
  return execute("doppler", [
    "secrets",
    "get",
    name,
    "--plain",
    "--project",
    "openmeld-release",
    "--config",
    "stg",
    "--silent",
  ]).trim();
}
if (
  inventory.organization !== "amplift" ||
  entry.database !== "openmeld-postgresql-stg"
) {
  throw new Error(
    "Recovery is restricted to the isolated Amplift staging database"
  );
}
const action = process.argv[2];
if (action === "backup") {
  if (entry.recovery) {
    throw new Error("Recovery already exists; inspect its status");
  }
  const owner = await connect(secret("POSTGRESQL_OPENMELD_MIGRATION_URL"));
  try {
    assert.equal((await migrate(owner)).applied.length, 0);
    await owner.query(
      'INSERT INTO openmeld_probe.records VALUES (\'00000000-0000-4000-8000-000000000017\', \'{"synthetic":true,"purpose":"backup-restore"}\') ON CONFLICT (id) DO NOTHING'
    );
  } finally {
    await owner.end();
  }
  const backup = api([
    "backup",
    "create",
    entry.database,
    "main",
    "--name",
    "foundation-synthetic-20261003",
  ]);
  entry.recovery = {
    backupId: backup.id,
    branch: branchName,
    status: "backup-started",
  };
} else if (action === "status") {
  const backups = api(["backup", "list", entry.database, "main"]);
  console.log(
    JSON.stringify(backups.filter((b) => b.id === entry.recovery?.backupId))
  );
} else if (action === "restore") {
  if (entry.recovery?.status !== "backup-started") {
    throw new Error("Expected a recorded backup awaiting restore");
  }
  const branch = api([
    "backup",
    "restore",
    entry.database,
    branchName,
    entry.recovery.backupId,
    "--cluster-size",
    "PS_5_AWS_ARM",
    "--replicas",
    "0",
  ]);
  entry.recovery.branchId = branch.id;
  entry.recovery.status = "restoring";
} else if (action === "check") {
  const branch = api([
    "api",
    `organizations/amplift/databases/${entry.database}/branches/${branchName}`,
  ]);
  if (!branch.ready) {
    throw new Error("Restore branch is still provisioning");
  }
  const role = api([
    "role",
    "create",
    entry.database,
    branchName,
    `foundation-restore-check-${Date.now()}`,
    "--inherited-roles",
    "postgres",
    "--ttl",
    "1h",
  ]);
  const url = new URL(`postgresql://${role.access_host_url}:5432/postgres`);
  url.username = role.username;
  url.password = role.password;
  const restored = await connect(url.toString());
  const source = await connect(secret("POSTGRESQL_OPENMELD_MIGRATION_URL"));
  try {
    assert.deepEqual(
      (
        await restored.query(
          "SELECT payload FROM openmeld_probe.records WHERE id='00000000-0000-4000-8000-000000000017'"
        )
      ).rows,
      [{ payload: { synthetic: true, purpose: "backup-restore" } }]
    );
    assert.deepEqual(
      (
        await restored.query(
          "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at"
        )
      ).rows,
      (
        await source.query(
          "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at"
        )
      ).rows
    );
    await restored.query(
      "DELETE FROM openmeld_probe.records WHERE id='00000000-0000-4000-8000-000000000017'"
    );
    assert.equal(
      (
        await source.query(
          "SELECT count(*)::int AS n FROM openmeld_probe.records WHERE id='00000000-0000-4000-8000-000000000017'"
        )
      ).rows[0].n,
      1
    );
    await source.query(
      "DELETE FROM openmeld_probe.records WHERE id='00000000-0000-4000-8000-000000000017'"
    );
    entry.recovery.status = "verified";
    entry.recovery.verifiedAt = new Date().toISOString();
    console.log(
      "PASS provider backup restored into an independent branch; synthetic payload and migration checksums preserved; restored writes isolated from source"
    );
  } finally {
    await Promise.all([restored.end(), source.end()]);
  }
} else if (action === "runtime-check") {
  if (entry.recovery?.status !== "verified") {
    throw new Error("Verify the restored backup first");
  }
  const roles = api(["role", "list", entry.database, branchName]);
  const previous = roles.find(
    (role) =>
      role.username === `${entry.runtimeRole}.${entry.recovery.branchId}`
  );
  if (!previous) {
    throw new Error("Restored runtime role missing");
  }
  const role = api([
    "role",
    "reset",
    entry.database,
    branchName,
    previous.id,
    "--force",
  ]);
  const url = new URL(`postgresql://${role.access_host_url}:5432/postgres`);
  url.username = role.username;
  url.password = role.password;
  const runtime = await connect(url.toString());
  try {
    await acceptRuntime(runtime);
  } finally {
    await runtime.end();
  }
  entry.recovery.runtimePermissionsVerified = true;
  console.log(
    "PASS restored runtime role retains CRUD and denied DDL/ledger/TRUNCATE after branch-local password reset"
  );
} else if (action === "cleanup") {
  if (
    entry.recovery?.status !== "verified" ||
    !entry.recovery.runtimePermissionsVerified
  ) {
    throw new Error("Recovery checks must pass before cleanup");
  }
  const branch = api([
    "api",
    `organizations/amplift/databases/${entry.database}/branches/${branchName}`,
  ]);
  assert.equal(branch.id, entry.recovery.branchId);
  assert.equal(branch.name, branchName);
  assert.equal(branch.default, false);
  execute("pscale", [
    "branch",
    "delete",
    entry.database,
    branchName,
    "--org",
    "amplift",
    "--force",
  ]);
  assert(
    !api(["branch", "list", entry.database]).some(
      (item) => item.id === branch.id
    )
  );
  entry.recovery.status = "verified-and-removed";
  entry.recovery.removedAt = new Date().toISOString();
  console.log(
    "Removed only the verified synthetic restore branch; retained backup and both main databases"
  );
} else {
  throw new Error(
    "Usage: recovery.mjs backup|status|restore|check|runtime-check|cleanup"
  );
}
await writeFile(file, `${JSON.stringify(inventory, null, 2)}\n`);
