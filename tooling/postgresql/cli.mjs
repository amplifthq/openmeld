import { readFile } from "node:fs/promises";
import { acceptRuntime } from "./acceptance.mjs";
import { importD1Snapshot } from "./d1-import.mjs";
import { connect, grantRuntime, migrate, readMigrations } from "./database.mjs";

const [command, target, ...extra] = process.argv.slice(2);
const resources = JSON.parse(
  await readFile(new URL("./resources.json", import.meta.url), "utf8")
);

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
    command === "import-d1" &&
    target === "local" &&
    extra.length === 1
  ) {
    console.log(
      JSON.stringify(
        await importD1Snapshot({
          snapshot: extra[0],
          connectionString: process.env.POSTGRESQL_OPENMELD_MIGRATION_URL,
        })
      )
    );
  } else if (
    ["migrate", "grant-runtime", "accept", "inspect"].includes(command) &&
    ["local", "staging"].includes(target) &&
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
        !decodeURIComponent(url.username).endsWith(`.${destination.branchId}`)
      ) {
        throw new Error(
          "Credential does not match the registered staging branch"
        );
      }
    }
    const client = await connect(value, target === "local");
    try {
      if (command === "migrate") {
        console.log(JSON.stringify(await migrate(client)));
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
      await client.end();
    }
  } else {
    throw new Error(
      "Usage: pg plan | pg <migrate|grant-runtime|accept|inspect> <local|staging> | pg import-d1 local <snapshot>. Production operations and automatic optimization are unavailable before the reviewed cutover."
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
