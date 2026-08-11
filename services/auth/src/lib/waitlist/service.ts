import {
  createD1Db,
  createDrizzleWaitlistRepository,
  createWaitlistService as createWaitlistServiceFactory,
} from "@openmeld/auth/server";
import type { AuthBindings } from "../bindings";

const serviceCache = new WeakMap<
  D1Database,
  ReturnType<typeof createWaitlistServiceFactory>
>();

export function getWaitlistService(env: AuthBindings) {
  const cached = serviceCache.get(env.OPENMELD_DB);
  if (cached) {
    return cached;
  }

  const db = createD1Db(env.OPENMELD_DB);
  const service = createWaitlistServiceFactory(
    createDrizzleWaitlistRepository(db)
  );
  serviceCache.set(env.OPENMELD_DB, service);
  return service;
}
