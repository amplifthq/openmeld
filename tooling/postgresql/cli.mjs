import { readFile } from "node:fs/promises";
import { acceptRuntime } from "./acceptance.mjs";
import { seedBusinessFixture } from "./business-fixture.mjs";
import {
  importD1Snapshot,
  readD1ImportCompletion,
  reconcileD1Snapshot,
} from "./d1-import.mjs";
import {
  closeMigrationClient,
  connect,
  grantRuntime,
  migrate,
  readMigrations,
} from "./database.mjs";
import { backfillMemberAgents } from "./member-agent-backfill.mjs";

const [command, target, ...extra] = process.argv.slice(2);
const resources = JSON.parse(
  await readFile(new URL("./resources.json", import.meta.url), "utf8")
);
const snapshotCommands = {
  "import-d1": importD1Snapshot,
  "reconcile-d1": reconcileD1Snapshot,
  "read-d1-import": readD1ImportCompletion,
};

try {
  if (command === "plan" && !target) {
    console.log(
      JSON.stringify(
        {
          resources,
          migrations: (await readMigrations()).map(({ name, checksum }) => ({
            name,
            checksum,
          })),
        },
        null,
        2
      )
    );
  } else if (
    Object.hasOwn(snapshotCommands, command) &&
    target === "local" &&
    extra.length === 1
  ) {
    console.log(
      JSON.stringify(
        await snapshotCommands[command]({
          snapshot: extra[0],
          connectionString: process.env.POSTGRESQL_OPENMELD_MIGRATION_URL,
          migrationsDirectory:
            process.env.OPENMELD_PG_LOCAL_MIGRATIONS_DIRECTORY || undefined,
        })
      )
    );
  } else if (
    [
      "migrate",
      "grant-runtime",
      "accept",
      "inspect",
      "preserve-foundation",
      "seed-business",
      "seed-smoke-identities",
      "backfill-member-agents",
    ].includes(command) &&
    ["local", "staging"].includes(target) &&
    (![
      "preserve-foundation",
      "seed-business",
      "seed-smoke-identities",
    ].includes(command) ||
      target === "staging") &&
    extra.length === 0
  ) {
    const variable = ["accept", "inspect"].includes(command)
      ? "POSTGRESQL_OPENMELD_RUNTIME_URL"
      : "POSTGRESQL_OPENMELD_MIGRATION_URL";
    const value = process.env[variable];
    if (!value) {
      throw new Error(`Missing ${variable}; use the scoped secret launcher`);
    }
    if (target === "local" && process.env.OPENMELD_PG_ISOLATED !== "1") {
      throw new Error("Local target must be started by pg:local");
    }
    if (target === "staging") {
      const destination = resources.environments.staging;
      const url = new URL(value);
      if (
        !(destination.branchId && destination.host) ||
        url.hostname !== destination.host ||
        decodeURIComponent(url.username) !==
          `${["accept", "inspect"].includes(command) ? destination.runtimeRole : destination.migrationRole}.${destination.branchId}`
      ) {
        throw new Error(
          "Credential does not match the registered staging branch"
        );
      }
    }
    const client = await connect(value, target === "local");
    try {
      if (command === "preserve-foundation") {
        await client.query(
          await readFile(
            new URL("./preserve-foundation.sql", import.meta.url),
            "utf8"
          )
        );
        console.log(
          "Historical foundation namespaces and ledger preserved; no data removed"
        );
      }
      if (command === "seed-business") {
        console.log(JSON.stringify(await seedBusinessFixture(client)));
      }
      if (command === "seed-smoke-identities") {
        const { buildIdentitySeedSql, readFixtureSecrets } = await import(
          "../../scripts/e2e/staging-work-coordinator-fixture.mjs"
        );
        const sql = await buildIdentitySeedSql({
          secrets: readFixtureSecrets(),
        });
        await client.query("BEGIN; SET LOCAL search_path TO openmeld, public");
        try {
          await client.query(sql);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
        console.log("Staging smoke identities prepared in PostgreSQL");
      }
      if (command === "migrate") {
        console.log(JSON.stringify(await migrate(client)));
      }
      if (command === "backfill-member-agents") {
        console.log(JSON.stringify(await backfillMemberAgents(client)));
      }
      if (command === "grant-runtime") {
        const role = process.env.POSTGRESQL_OPENMELD_RUNTIME_ROLE;
        if (!role) {
          throw new Error("Missing runtime role name");
        }
        await grantRuntime(client, role);
        console.log("Runtime permissions verified and granted");
      }
      if (command === "accept") {
        console.log(JSON.stringify(await acceptRuntime(client)));
      }
      if (command === "inspect") {
        const result = await client.query(
          "SELECT current_database() AS database, current_user AS role, current_setting('server_version') AS version"
        );
        console.log(JSON.stringify({ target, ...result.rows[0] }));
      }
    } finally {
      await closeMigrationClient(client);
    }
  } else {
    throw new Error(
      "Usage: pg plan | pg <migrate|grant-runtime|accept|inspect|backfill-member-agents> <local|staging> | pg <preserve-foundation|seed-business> staging | pg <import-d1|reconcile-d1|read-d1-import> local <snapshot>. Production operations and automatic optimization are unavailable before the reviewed cutover."
    );
  }
} catch (error) {
  // Server errors can contain SQL/user data. Emit only their structured SQLSTATE.
  const sqlState = error.code ?? error.cause?.code;
  console.error(
    sqlState
      ? `PostgreSQL operation failed (SQLSTATE ${sqlState})`
      : error.message
  );
  process.exitCode = 1;
}
