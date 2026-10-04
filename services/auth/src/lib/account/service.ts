import {
  type AccountDisplayNameService,
  createAccountDisplayNameService,
  createAuthDatabase,
  createDrizzleAccountDisplayNameRepository,
} from "@openmeld/auth/server";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../context";
export function getAccountDisplayNameService(): AccountDisplayNameService {
  const service = createAccountDisplayNameService(
    createDrizzleAccountDisplayNameRepository(createAuthDatabase())
  );
  return service;
}
export const accountDisplayNameServiceMiddleware = createMiddleware<AppContext>(
  async (c, next) => {
    c.set("accountDisplayNameService", getAccountDisplayNameService());
    await next();
  }
);
