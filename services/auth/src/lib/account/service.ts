import {
  type AccountDisplayNameService,
  createAccountDisplayNameService,
  createD1Db,
  createDrizzleAccountDisplayNameRepository,
} from "@openmeld/auth/server";
import { createMiddleware } from "hono/factory";
import type { AuthBindings } from "../bindings";
import type { AppContext } from "../context";

const serviceCache = new WeakMap<D1Database, AccountDisplayNameService>();

export function getAccountDisplayNameService(
  env: AuthBindings
): AccountDisplayNameService {
  const cached = serviceCache.get(env.OPENMELD_DB);
  if (cached) {
    return cached;
  }

  const service = createAccountDisplayNameService(
    createDrizzleAccountDisplayNameRepository(createD1Db(env.OPENMELD_DB))
  );
  serviceCache.set(env.OPENMELD_DB, service);
  return service;
}

export const accountDisplayNameServiceMiddleware = createMiddleware<AppContext>(
  async (c, next) => {
    c.set("accountDisplayNameService", getAccountDisplayNameService(c.env));
    await next();
  }
);
