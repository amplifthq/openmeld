import {
  type AccountOrganizationPreferenceRepository,
  type AccountOrganizationPreferenceService,
  createAccountOrganizationPreferenceService,
  createD1Db,
  createDrizzleAccountOrganizationPreferenceRepository,
} from "@openmeld/auth/server";
import { createMiddleware } from "hono/factory";
import type { AuthBindings } from "../bindings";
import type { AppContext } from "../context";

const serviceCache = new WeakMap<
  D1Database,
  AccountOrganizationPreferenceService
>();
const repositoryCache = new WeakMap<
  D1Database,
  AccountOrganizationPreferenceRepository
>();

export function getAccountOrganizationPreferenceRepository(
  env: AuthBindings
): AccountOrganizationPreferenceRepository {
  const cached = repositoryCache.get(env.OPENMELD_DB);
  if (cached) {
    return cached;
  }

  const repository = createDrizzleAccountOrganizationPreferenceRepository(
    createD1Db(env.OPENMELD_DB)
  );
  repositoryCache.set(env.OPENMELD_DB, repository);
  return repository;
}

export function getAccountOrganizationPreferenceService(
  env: AuthBindings
): AccountOrganizationPreferenceService {
  const cached = serviceCache.get(env.OPENMELD_DB);
  if (cached) {
    return cached;
  }

  const service = createAccountOrganizationPreferenceService(
    getAccountOrganizationPreferenceRepository(env)
  );
  serviceCache.set(env.OPENMELD_DB, service);
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
