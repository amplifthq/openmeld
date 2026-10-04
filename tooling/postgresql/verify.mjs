// biome-ignore-all lint/suspicious/noMisplacedAssertion: Standalone operational acceptance uses node:assert and fails the command on contract violations.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseJsoncObject } from "../../packages/db/src/tooling/parse-jsonc.ts";

const hyperdriveIdPattern = /^[a-f0-9]{32}$/u;
export function verifyPostgresqlEnvironment(root) {
  const directory = path.join(root, "tooling/postgresql");
  const inventory = JSON.parse(
    readFileSync(path.join(directory, "resources.json"), "utf8")
  );
  const worker = JSON.parse(
    readFileSync(path.join(directory, "wrangler.jsonc"), "utf8")
  );
  assert.equal(inventory.organization, "amplift");
  assert.equal(worker.account_id, inventory.accountId);
  assert.equal(worker.name, "openmeld-postgresql-probe-stg");
  assert.equal(
    worker.vars.OPENMELD_WORKER_ENVIRONMENT,
    "postgresql-foundation-staging"
  );
  assert(Number.isFinite(Date.parse(worker.vars.POSTGRESQL_PROBE_EXPIRES_AT)));
  assert.deepEqual(worker.secrets.required, [
    "POSTGRESQL_OPENMELD_PROBE_TOKEN",
  ]);
  assert.deepEqual(worker.hyperdrive, [
    {
      binding: "OPENMELD_POSTGRESQL",
      id: inventory.environments.staging.hyperdriveId,
    },
  ]);
  assert.match(
    inventory.environments.staging.hyperdriveId,
    hyperdriveIdPattern
  );
  assert.equal(worker.preview_urls, false);
  for (const key of [
    "routes",
    "route",
    "services",
    "d1_databases",
    "r2_buckets",
    "durable_objects",
    "env",
  ]) {
    assert.equal(worker[key], undefined, `Isolated probe cannot have ${key}`);
  }
  for (const key of [
    "database",
    "databaseId",
    "branchId",
    "runtimeRoleId",
    "migrationRoleId",
    "hyperdriveId",
  ]) {
    const staging = inventory.environments.staging[key];
    const production = inventory.environments.production[key];
    assert(
      staging && production && staging !== production,
      `Environment isolation requires distinct ${key}`
    );
  }
  const types = readFileSync(
    path.join(directory, "worker-configuration.d.ts"),
    "utf8"
  );
  assert(types.includes("OPENMELD_POSTGRESQL: Hyperdrive;"));
  assert(types.includes("POSTGRESQL_OPENMELD_PROBE_TOKEN: string;"));
  for (const service of ["auth", "core"]) {
    const config = parseJsoncObject(
      readFileSync(
        path.join(root, "services", service, "wrangler.jsonc"),
        "utf8"
      )
    );
    for (const section of [config, config.env.prod]) {
      assert.deepEqual(section.hyperdrive, [
        {
          binding: "OPENMELD_POSTGRESQL",
          id: inventory.environments.production.hyperdriveId,
        },
      ]);
      assert.equal(
        section.d1_databases,
        undefined,
        `${service} must have one relational authority`
      );
    }
  }
  console.log(
    "PASS isolated PostgreSQL resource and Worker environment contracts"
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  verifyPostgresqlEnvironment(path.resolve(import.meta.dirname, "../.."));
}
