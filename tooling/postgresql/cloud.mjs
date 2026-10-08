import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  connect,
  grantRuntime,
  migrate,
  quoteIdentifier,
} from "./database.mjs";

const inventoryPath = new URL("./resources.json", import.meta.url);
const sensitiveField = /password|token/u;
const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
const [action, target] = process.argv.slice(2);
if (inventory.organization !== "amplift") {
  throw new Error("OpenMeld resources must belong to Amplift");
}
const entry = inventory.environments[target];
if (
  !(
    entry &&
    [
      "inventory",
      "prepare",
      "hyperdrive",
      "migrate",
      "accept",
      "grant-runtime",
      "preserve-foundation",
      "seed-business",
      "seed-smoke-identities",
    ].includes(action)
  )
) {
  throw new Error(
    "Usage: cloud.mjs <inventory|prepare|hyperdrive> <staging|production>; cloud.mjs <preserve-foundation|migrate|grant-runtime|seed-business|seed-smoke-identities|accept> staging"
  );
}
const config = target === "staging" ? "stg" : "prd";
function execute(program, args, input) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    input,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, WRANGLER_LOG: "log" },
  });
  if (result.status !== 0) {
    throw new Error(
      `${program} ${args.slice(0, 2).join(" ")} failed (exit ${result.status}); no credential-bearing output printed`
    );
  }
  return result.stdout;
}
function pscale(args) {
  return JSON.parse(
    execute("pscale", [...args, "--org", "amplift", "--format", "json"])
  );
}
function secret(name, value) {
  execute(
    "doppler",
    [
      "secrets",
      "set",
      name,
      "--project",
      "openmeld-release",
      "--config",
      config,
      "--silent",
    ],
    value
  );
}
function getSecret(name) {
  return execute("doppler", [
    "secrets",
    "get",
    name,
    "--plain",
    "--project",
    "openmeld-release",
    "--config",
    config,
    "--silent",
  ]).trim();
}
async function save() {
  await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
}
function roleUrl(role) {
  if (!(role.username && role.password && role.access_host_url)) {
    throw new Error(
      `Unknown PlanetScale role response fields: ${Object.keys(role)
        .filter((k) => !sensitiveField.test(k))
        .join(",")}`
    );
  }
  const url = new URL(`postgresql://${role.access_host_url}:5432/postgres`);
  url.username = role.username;
  url.password = role.password;
  return url.toString();
}
try {
  const database = pscale([
    "api",
    `organizations/amplift/databases/${entry.database}`,
  ]);
  const branch = pscale([
    "api",
    `organizations/amplift/databases/${entry.database}/branches/main`,
  ]);
  if (
    database.kind !== "postgresql" ||
    database.cloudflare_billed !== true ||
    database.cloudflare_uid !== inventory.accountId
  ) {
    throw new Error("Database engine or Cloudflare billing identity mismatch");
  }
  if (
    (entry.databaseId && entry.databaseId !== database.id) ||
    (entry.branchId && entry.branchId !== branch.id)
  ) {
    throw new Error(
      "Live database or branch differs from the registered target"
    );
  }
  entry.databaseId = database.id;
  entry.branchId = branch.id;
  entry.cluster = branch.cluster_name;
  entry.replicas = branch.replicas;
  if (!branch.ready) {
    entry.status = "provisioning";
  } else if (["not-provisioned", "provisioning"].includes(entry.status)) {
    entry.status = "ready-empty";
  }
  await save();
  if (action === "inventory") {
    console.log(
      JSON.stringify(
        {
          environment: target,
          databaseId: database.id,
          branchId: branch.id,
          ready: branch.ready,
          cloudflareBilled: database.cloudflare_billed,
          branchFields: Object.keys(branch),
        },
        null,
        2
      )
    );
  } else if (
    [
      "migrate",
      "accept",
      "grant-runtime",
      "preserve-foundation",
      "seed-business",
      "seed-smoke-identities",
    ].includes(action)
  ) {
    if (target !== "staging") {
      throw new Error("Cloud mutation/acceptance commands are staging-only");
    }
    const variable =
      action === "accept"
        ? "POSTGRESQL_OPENMELD_RUNTIME_URL"
        : "POSTGRESQL_OPENMELD_MIGRATION_URL";
    const result = spawnSync(
      process.execPath,
      [new URL("./cli.mjs", import.meta.url).pathname, action, "staging"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          [variable]: getSecret(variable),
          POSTGRESQL_OPENMELD_RUNTIME_ROLE: entry.runtimeRole,
        },
      }
    );
    if (result.status !== 0) {
      throw new Error(
        "Staging operation failed; no credential-bearing output printed"
      );
    }
    console.log(result.stdout.trim());
  } else if (action === "prepare") {
    if (!branch.ready) {
      throw new Error("Database is still provisioning");
    }
    const names = [
      "postgresql-openmeld-migration",
      "postgresql-openmeld-runtime",
    ].map((x) => `${x}-${config === "prd" ? "prod" : config}`);
    const existing = pscale(["role", "list", entry.database, "main"]);
    if (existing.some((role) => names.includes(role.name))) {
      throw new Error(
        "Roles already exist; inspect custody before resuming, never silently rotate"
      );
    }
    const migration = pscale([
      "role",
      "create",
      entry.database,
      "main",
      names[0],
    ]);
    const migrationUrl = roleUrl(migration);
    secret("POSTGRESQL_OPENMELD_MIGRATION_URL", migrationUrl);
    const runtime = pscale([
      "role",
      "create",
      entry.database,
      "main",
      names[1],
    ]);
    const runtimeUrl = roleUrl(runtime);
    secret("POSTGRESQL_OPENMELD_RUNTIME_URL", runtimeUrl);
    const bootstrap = pscale([
      "role",
      "create",
      entry.database,
      "main",
      `postgresql-openmeld-bootstrap-${Date.now()}`,
      "--inherited-roles",
      "postgres",
      "--ttl",
      "1h",
    ]);
    const admin = await connect(roleUrl(bootstrap));
    const migrationRole = migration.username.split(".")[0];
    const runtimeRole = runtime.username.split(".")[0];
    try {
      await admin.query(
        `REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT CREATE ON DATABASE postgres TO ${quoteIdentifier(migrationRole)}`
      );
    } finally {
      await admin.end();
    }
    entry.host = new URL(migrationUrl).hostname;
    entry.migrationRole = migrationRole;
    entry.migrationRoleId = migration.id;
    entry.runtimeRole = runtimeRole;
    entry.runtimeRoleId = runtime.id;
    await save();
    if (target === "staging") {
      const owner = await connect(migrationUrl);
      try {
        await migrate(owner);
        await grantRuntime(owner, runtimeRole);
        await owner.query(
          `CREATE SCHEMA openmeld_probe; REVOKE ALL ON SCHEMA openmeld_probe FROM PUBLIC; CREATE TABLE openmeld_probe.records (id uuid PRIMARY KEY, payload jsonb NOT NULL); GRANT USAGE ON SCHEMA openmeld_probe TO ${quoteIdentifier(runtimeRole)}; GRANT SELECT, INSERT, UPDATE, DELETE ON openmeld_probe.records TO ${quoteIdentifier(runtimeRole)}`
        );
      } finally {
        await owner.end();
      }
      secret(
        "POSTGRESQL_OPENMELD_PROBE_TOKEN",
        randomBytes(32).toString("hex")
      );
      entry.status = "foundation-applied";
    }
    await save();
    console.log(
      JSON.stringify({
        environment: target,
        credentialsStored: true,
        host: entry.host,
        migrationRole,
        runtimeRole,
        status: entry.status,
      })
    );
  } else if (action === "hyperdrive") {
    const runtimeUrl = new URL(getSecret("POSTGRESQL_OPENMELD_RUNTIME_URL"));
    if (
      runtimeUrl.hostname !== entry.host ||
      !decodeURIComponent(runtimeUrl.username).endsWith(`.${entry.branchId}`)
    ) {
      throw new Error("Runtime credential target mismatch");
    }
    const auth = JSON.parse(
      execute("pnpm", ["exec", "wrangler", "auth", "token", "--json"])
    );
    const token = auth.token;
    if (!token) {
      throw new Error("Wrangler token response missing token");
    }
    async function cf(method, suffix, body) {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${inventory.accountId}/hyperdrive/configs${suffix}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        }
      );
      const json = await response.json();
      if (!json.success) {
        throw new Error(
          `Hyperdrive ${method} failed: HTTP ${response.status}, codes ${json.errors?.map((e) => e.code).join(",")}`
        );
      }
      return json.result;
    }
    const existing = (await cf("GET", "")).filter(
      (item) => item.name === entry.hyperdriveName
    );
    if (existing.length) {
      throw new Error(
        "Named Hyperdrive already exists; inspect before reusing"
      );
    }
    const created = await cf("POST", "", {
      name: entry.hyperdriveName,
      origin: {
        scheme: "postgres",
        host: runtimeUrl.hostname,
        port: 5432,
        database: "postgres",
        user: decodeURIComponent(runtimeUrl.username),
        password: decodeURIComponent(runtimeUrl.password),
      },
      caching: { disabled: true },
      origin_connection_limit: 5,
    });
    if (created.caching?.disabled !== true) {
      throw new Error("Hyperdrive caching must be disabled");
    }
    entry.hyperdriveId = created.id;
    await save();
    if (target === "staging") {
      const file = new URL("./wrangler.jsonc", import.meta.url);
      const wrangler = JSON.parse(await readFile(file, "utf8"));
      wrangler.hyperdrive = [
        { binding: "OPENMELD_POSTGRESQL", id: created.id },
      ];
      await writeFile(file, `${JSON.stringify(wrangler, null, 2)}\n`);
    }
    console.log(
      JSON.stringify({
        environment: target,
        hyperdriveId: created.id,
        cachingDisabled: created.caching.disabled,
        originConnectionLimit: created.origin_connection_limit,
      })
    );
  }
} catch (error) {
  console.error(
    error.code
      ? `Cloud preparation failed (SQLSTATE ${error.code})`
      : error.message
  );
  process.exitCode = 1;
}
