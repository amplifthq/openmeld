import {
  type AccountOrganizationPreferenceRepository,
  type AccountOrganizationPreferenceService,
  createAccountOrganizationPreferenceService,
  createAuthDatabase,
  createDrizzleAccountOrganizationPreferenceRepository,
} from "@openmeld/auth/server";
import { createMiddleware } from "hono/factory";
import type { AuthBindings } from "../bindings";
import type { AppContext } from "../context";
export function getAccountOrganizationPreferenceRepository(
  _env: AuthBindings
): AccountOrganizationPreferenceRepository {
  return createDrizzleAccountOrganizationPreferenceRepository(
    createAuthDatabase()
  );
}
export function getAccountOrganizationPreferenceService(
  env: AuthBindings
): AccountOrganizationPreferenceService {
  const service = createAccountOrganizationPreferenceService(
    getAccountOrganizationPreferenceRepository(env)
  );
  return service;
}
export const accountOrganizationPreferenceServiceMiddleware =
  createMiddleware<AppContext>(async (c, next) => {
    c.set(
      "accountOrganizationPreferenceService",
      getAccountOrganizationPreferenceService(c.env)
    );
    await next();
  });
