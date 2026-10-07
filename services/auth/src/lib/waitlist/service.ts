import {
  createAuthDatabase,
  createDrizzleWaitlistRepository,
  createWaitlistService as createWaitlistServiceFactory,
} from "@openmeld/auth/server";
export function getWaitlistService() {
  const db = createAuthDatabase();
  const service = createWaitlistServiceFactory(
    createDrizzleWaitlistRepository(db)
  );
  return service;
}
