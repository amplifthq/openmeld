import { defineConfig } from "drizzle-kit";

const url = process.env.POSTGRESQL_OPENMELD_MIGRATION_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./postgresql/migrations",
  ...(url ? { dbCredentials: { url } } : {}),
});
