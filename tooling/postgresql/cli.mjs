import { readFile } from "node:fs/promises";
import { acceptRuntime } from "./acceptance.mjs";
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
    ["migrate", "grant-runtime", "accept"].includes(command) &&
    ["local", "staging"].includes(target) &&
    extra.length === 0
  ) {
    const variable =
      command === "accept"
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
    } finally {
      await client.end();
    }
  } else {
    throw new Error(
      "Usage: pg plan | pg <migrate|grant-runtime|accept> <local|staging>. Production apply is deliberately unavailable before cutover preparation."
    );
  }
} catch (error) {
  // Server errors can contain SQL/user data. Emit only their structured SQLSTATE.
  console.error(
    error.code
      ? `PostgreSQL operation failed (SQLSTATE ${error.code})`
      : error.message
  );
  process.exitCode = 1;
}
