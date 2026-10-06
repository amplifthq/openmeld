import {
  AccountDisplayNameValidationError,
  createAuthDatabase,
  createDrizzleOpenMeldProfileRepository,
  createDrizzleProfileSpaceHistoryRepository,
  createDrizzleSpaceDeletionTombstoneRepository,
  createOpenMeldProfileService as createOpenMeldProfileServiceFactory,
  type OpenMeldProfileService,
  ProfileValidationError,
} from "@openmeld/auth/server";
import { createMiddleware } from "hono/factory";
import { getAccountDisplayNameService } from "../account/service";
import type { AuthBindings } from "../bindings";
import type { AppContext } from "../context";
import { projectSpaceIndexMembershipOverlay } from "./overlay-reconcile";
export function getOpenMeldProfileService(
  env: AuthBindings
): OpenMeldProfileService {
  const additionalHumanProfileCreationEnabled =
    env.OPENMELD_ADDITIONAL_HUMAN_PROFILE_CREATION_ENABLED === "true";
  const db = createAuthDatabase();
  const service = createOpenMeldProfileServiceFactory(
    createDrizzleOpenMeldProfileRepository(db),
    {
      additionalHumanProfileCreationEnabled,
      profileSpaceHistoryRepository:
        createDrizzleProfileSpaceHistoryRepository(db),
      profileSpaceHistoryHooks: {
        // Announce Profile-domain history changes to the Core-owned Space
        // Index overlay projection (physical-db-split.md P0.3). The RPC path
        // awaits the same helper; this hook keeps non-RPC writes convergent.
        onHistoryWritten: (record) => {
          projectSpaceIndexMembershipOverlay({
            coreWorker: env.OPENMELD_CORE_WORKER,
            record,
          }).then((result) => {
            if (result.status !== "applied") {
              console.warn({
                event: "auth.space_index_overlay.project_degraded",
                profileId: record.profileId,
                repairAttempted: result.repairAttempted,
                spaceId: record.spaceId,
                status: result.status,
              });
            }
          });
        },
      },
      spaceDeletionTombstoneRepository:
        createDrizzleSpaceDeletionTombstoneRepository(db),
      updateDefaultHumanProfileDisplayName: async (input) => {
        try {
          const result = await getAccountDisplayNameService().update({
            displayName: input.displayName,
            expectedDefaultHumanProfileId: input.profileId,
            ownerUserId: input.ownerUserId,
          });
          return result.defaultHumanProfile;
        } catch (error) {
          if (error instanceof AccountDisplayNameValidationError) {
            throw new ProfileValidationError(error.message);
          }
          throw error;
        }
      },
    }
  );
  return service;
}
export const profileServiceMiddleware = createMiddleware<AppContext>(
  async (c, next) => {
    c.set("profileService", getOpenMeldProfileService(c.env));
    await next();
  }
);
