declare module "cloudflare:test" {
  export const env: CloudflareBindings & {
    OPENMELD_DB: D1Database;
    TEST_MIGRATIONS: unknown[];
  };

  export function applyD1Migrations(
    db: D1Database,
    migrations: unknown[]
  ): Promise<void>;
}
