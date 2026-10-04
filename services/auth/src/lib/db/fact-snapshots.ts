import { buildPostgresRuntimeDbFactSnapshot } from "@openmeld/db/facts";
import type { DbFactSnapshot } from "@openmeld/schemas/types";
import type { AuthBindings } from "../bindings";
export const buildAuthRuntimeDbFactSnapshot = (
  env?: Pick<AuthBindings, "OPENMELD_POSTGRESQL">
): DbFactSnapshot => {
  const bindingAvailable = Boolean(env?.OPENMELD_POSTGRESQL);
  return buildPostgresRuntimeDbFactSnapshot({
    subject: "auth",
    bindingAvailable,
  });
};
