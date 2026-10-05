import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { AuthBindings } from "../bindings";

type LocalAuthUserStore = {
  hasUserById: (userId: string) => Promise<boolean>;
};
export function getLocalAuthUserStore(env: AuthBindings): LocalAuthUserStore {
  const store: LocalAuthUserStore = {
    async hasUserById(userId) {
      const row = await getPostgresDatabase(env)
        .query<{
          present?: number;
        }>({
          text: 'select 1 as present from "openmeld"."users" where id = $1 and deleted_at is null limit 1',
          values: [userId],
        })
        .then((result) => result.rows[0] ?? null);
      return row?.present === 1;
    },
  };
  return store;
}
