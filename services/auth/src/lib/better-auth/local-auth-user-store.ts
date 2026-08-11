import type { AuthBindings } from "../bindings";

type LocalAuthUserStore = {
  hasUserById: (userId: string) => Promise<boolean>;
};

const storeCache = new WeakMap<D1Database, LocalAuthUserStore>();

export function getLocalAuthUserStore(env: AuthBindings): LocalAuthUserStore {
  const cached = storeCache.get(env.OPENMELD_DB);
  if (cached) {
    return cached;
  }

  const store: LocalAuthUserStore = {
    async hasUserById(userId) {
      const row = await env.OPENMELD_DB.prepare(
        "select 1 as present from users where id = ? limit 1"
      )
        .bind(userId)
        .first<{ present?: number }>();

      return row?.present === 1;
    },
  };

  storeCache.set(env.OPENMELD_DB, store);
  return store;
}
