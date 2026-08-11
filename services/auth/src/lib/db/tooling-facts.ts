import type { AuthToolingDbTargetInput as AuthToolingDbTargetInputFromDb } from "@openmeld/db/tooling";
import {
  findLocalD1DatabasePath as findLocalD1DatabasePathFromDb,
  isAuthToolingProductionMode as isAuthToolingProductionModeFromDb,
  resolveAuthDrizzleConfigInput as resolveAuthDrizzleConfigInputFromDb,
  resolveAuthToolingDbTarget as resolveAuthToolingDbTargetFromDb,
} from "@openmeld/db/tooling";

export type AuthToolingDbTargetInput = AuthToolingDbTargetInputFromDb;
export const findLocalD1DatabasePath = findLocalD1DatabasePathFromDb;
export const isAuthToolingProductionMode = isAuthToolingProductionModeFromDb;
export const resolveAuthDrizzleConfigInput =
  resolveAuthDrizzleConfigInputFromDb;
export const resolveAuthToolingDbTarget = resolveAuthToolingDbTargetFromDb;
