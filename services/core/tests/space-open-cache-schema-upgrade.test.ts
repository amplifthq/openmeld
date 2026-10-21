import { env, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";
import type { Space } from "../src/space/transport/do/space";

const CACHE_TABLES = [
  "space_member_owner_avatar_cache",
  "space_member_profile_display_cache",
  "space_profile_lineage",
];

it("adds the Space open cache tables to a Space already at schema v53", async () => {
  const namespace = (
    env as unknown as { OPENMELD_SPACES: DurableObjectNamespace<Space> }
  ).OPENMELD_SPACES;
  await runInDurableObject(
    namespace.get(namespace.newUniqueId()),
    (_instance, state) => {
      // A v53 Space predates the lineage and member display caches. Without a
      // new schema version, the up-to-date check skips their creation.
      for (const table of CACHE_TABLES) {
        state.storage.sql.exec(`DROP TABLE IF EXISTS ${table}`);
      }
      state.storage.sql.exec(
        "DELETE FROM schema_migrations WHERE version >= 53"
      );
      state.storage.sql.exec(
        "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (53, 'space-sql-schema-v53', ?)",
        Date.now()
      );

      ensureSpaceSqlSchema(state.storage.sql);

      const tables = state.storage.sql
        .exec<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${CACHE_TABLES.map(() => "?").join(", ")}) ORDER BY name`,
          ...CACHE_TABLES
        )
        .toArray()
        .map((row) => row.name);
      expect(tables).toEqual(CACHE_TABLES);
    }
  );
});
