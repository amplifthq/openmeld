import type {
  createAccountDisplayNameService,
  createAccountOrganizationPreferenceService,
  createOpenMeldProfileService,
} from "@openmeld/auth/server";
import type { createAuth } from "./better-auth";
import type { SessionRecord, UserRecord } from "./better-auth/session-resolver";
import type { AuthBindings } from "./bindings";

type AuthInstance = ReturnType<typeof createAuth>;
type OpenMeldProfileService = ReturnType<typeof createOpenMeldProfileService>;
type AccountDisplayNameService = ReturnType<
  typeof createAccountDisplayNameService
>;
type AccountOrganizationPreferenceService = ReturnType<
  typeof createAccountOrganizationPreferenceService
>;

export type AppVariables = {
  betterAuth: AuthInstance;
  accountDisplayNameService: AccountDisplayNameService;
  accountOrganizationPreferenceService: AccountOrganizationPreferenceService;
  user: UserRecord | null;
  session: SessionRecord | null;
  profileService: OpenMeldProfileService;
  requestId: string;
};

export type AppContext = {
  Bindings: AuthBindings;
  Variables: AppVariables;
};
