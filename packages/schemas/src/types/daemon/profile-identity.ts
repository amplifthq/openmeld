import type { z } from "zod/v4";

type OpenMeldActorContextSchema =
  typeof import("../../schemas/daemon/profile-identity")["openMeldActorContextSchema"];
type OpenMeldProfileIdSchema =
  typeof import("../../schemas/daemon/profile-identity")["openMeldProfileIdSchema"];
type OpenMeldRequestContextSchema =
  typeof import("../../schemas/daemon/profile-identity")["openMeldRequestContextSchema"];
type ResolvedOpenMeldProfileSchema =
  typeof import("../../schemas/daemon/profile-identity")["resolvedOpenMeldProfileSchema"];

export type OpenMeldActorContext = z.infer<OpenMeldActorContextSchema>;
export type OpenMeldProfileId = z.infer<OpenMeldProfileIdSchema>;
export type OpenMeldRequestContext = z.infer<OpenMeldRequestContextSchema>;
export type ResolvedOpenMeldProfile = z.infer<ResolvedOpenMeldProfileSchema>;
