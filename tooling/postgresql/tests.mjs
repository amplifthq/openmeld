import {
  connect,
  grantRuntime,
  migrate,
  quoteIdentifier,
  readMigrations,
} from "./database.mjs";

/** Worker suites own a fresh pg:local cluster and retain their existing unique fixtures. */
export async function initializePostgresTests(options = {}) {
  if (process.env.OPENMELD_PG_ISOLATED !== "1") {
    throw new Error(
      "Run Worker tests through pg:local; shared databases are forbidden."
    );
  }
  const owner = new URL(process.env.POSTGRESQL_OPENMELD_MIGRATION_URL ?? "");
  const runtime = new URL(process.env.POSTGRESQL_OPENMELD_RUNTIME_URL ?? "");
  for (const url of [owner, runtime]) {
    if (
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/openmeld_pg_local" ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        "Worker tests require the fresh isolated loopback database."
      );
    }
  }
  const client = await connect(owner.toString(), true);
  try {
    await migrate(client);
    await grantRuntime(client, "openmeld_pg_runtime");
  } finally {
    await client.end();
  }
  const templateName = `openmeld_pg_worker_template_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = await connect(owner.toString(), true);
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(templateName)}`);
  } finally {
    await admin.end();
  }
  const templateUrl = new URL(owner);
  templateUrl.pathname = `/${templateName}`;
  const template = await connect(templateUrl.toString(), true);
  try {
    await migrate(template);
    await grantRuntime(template, "openmeld_pg_runtime");
  } finally {
    await template.end();
  }
  let preGuardTemplateName;
  let ownerGuardsAndLater;
  if (options.legacyBindingFixtures) {
    // Legacy ownership rejection tests start before the immutable owner guards.
    const migrations = await readMigrations();
    const guardIndex = migrations.findIndex(
      (entry) => entry.name === "0004_owner_guards.sql"
    );
    if (guardIndex < 0) {
      throw new Error("Owner guard migration is missing");
    }
    preGuardTemplateName = `openmeld_pg_worker_template_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = await connect(owner.toString(), true);
    try {
      await admin.query(
        `CREATE DATABASE ${quoteIdentifier(preGuardTemplateName)}`
      );
    } finally {
      await admin.end();
    }
    const url = new URL(owner);
    url.pathname = `/${preGuardTemplateName}`;
    const legacy = await connect(url.toString(), true);
    try {
      for (const entry of migrations.slice(0, guardIndex)) {
        for (const sql of entry.sql) {
          await legacy.query(sql);
        }
      }
      await grantRuntime(legacy, "openmeld_pg_runtime");
    } finally {
      await legacy.end();
    }
    ownerGuardsAndLater = migrations
      .slice(guardIndex)
      .flatMap((entry) => entry.sql);
  }
  return {
    runtime: runtime.toString(),
    owner: owner.toString(),
    templateName,
    preGuardTemplateName,
    ownerGuardsAndLater,
  };
}
