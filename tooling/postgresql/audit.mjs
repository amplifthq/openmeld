// biome-ignore-all lint/suspicious/noMisplacedAssertion: This operational check fails closed on real cloud contract violations.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { connect, migrate, migrationLock } from "./database.mjs";

const inventory = JSON.parse(
  await readFile(new URL("./resources.json", import.meta.url), "utf8")
);
function secret(name, config) {
  const result = spawnSync(
    "doppler",
    [
      "secrets",
      "get",
      name,
      "--plain",
      "--project",
      "openmeld-release",
      "--config",
      config,
      "--silent",
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error("Credential custody read failed");
  }
  return result.stdout.trim();
}
const stagingUrl = secret("POSTGRESQL_OPENMELD_MIGRATION_URL", "stg");
const productionUrl = secret("POSTGRESQL_OPENMELD_MIGRATION_URL", "prd");
for (const [target, value] of [
  ["staging", stagingUrl],
  ["production", productionUrl],
]) {
  const url = new URL(value);
  assert.equal(url.hostname, inventory.environments[target].host);
  assert(
    decodeURIComponent(url.username).endsWith(
      `.${inventory.environments[target].branchId}`
    )
  );
}
const staging = await connect(stagingUrl);
const contender = await connect(stagingUrl);
const production = await connect(productionUrl);
try {
  for (const [target, client] of [
    ["staging", staging],
    ["production", production],
  ]) {
    const version = (await client.query("SHOW server_version_num")).rows[0]
      .server_version_num;
    assert.equal(
      Math.floor(Number(version) / 10_000),
      Number(inventory.environments[target].majorVersion)
    );
    console.log(
      `${target}: PostgreSQL ${(await client.query("SHOW server_version")).rows[0].server_version}`
    );
  }
  assert.equal((await migrate(staging)).applied.length, 0);
  await staging.query("SELECT pg_advisory_lock($1)", [migrationLock]);
  try {
    await assert.rejects(migrate(contender), /Another PostgreSQL migration/u);
  } finally {
    await staging.query("SELECT pg_advisory_unlock($1)", [migrationLock]);
  }
  assert.equal((await migrate(contender)).applied.length, 0);
  assert.equal(
    (
      await production.query(
        "SELECT count(*)::int AS n FROM pg_namespace WHERE nspname IN ('openmeld', 'openmeld_meta', 'openmeld_probe')"
      )
    ).rows[0].n,
    0
  );
  const invalid = new URL(secret("POSTGRESQL_OPENMELD_RUNTIME_URL", "stg"));
  invalid.hostname = inventory.environments.production.host;
  invalid.username = `${inventory.environments.staging.runtimeRole}.${inventory.environments.production.branchId}`;
  await assert.rejects(connect(invalid.toString()), { code: "28P01" });
  console.log(
    "PASS cloud migration repeat/concurrent lock; production destination has no application schemas; staging runtime credential rejected by production"
  );
} finally {
  await Promise.all([staging.end(), contender.end(), production.end()]);
}
