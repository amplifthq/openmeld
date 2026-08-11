import { buildDbFactSnapshot, buildSharedRuntimeDbTarget } from "@openmeld/db";
import type { DbFactSnapshot } from "@openmeld/schemas/types";
import type { AuthBindings } from "../bindings";
import {
  AUTH_DB_BINDING_NAME,
  AUTH_DB_RELEASE_NOTES,
  getAuthDbMigrationSources,
  getAuthDbSchemaSources,
} from "./fact-metadata";

export const buildAuthRuntimeDbFactSnapshot = (
  env?: Pick<AuthBindings, "OPENMELD_DB">
): DbFactSnapshot => {
  const bindingAvailable = Boolean(env?.OPENMELD_DB);

  return buildDbFactSnapshot({
    subject: "auth",
    mode: "runtime",
    bindingName: AUTH_DB_BINDING_NAME,
    schemaSources: getAuthDbSchemaSources(),
    migrationSources: getAuthDbMigrationSources(),
    target: buildSharedRuntimeDbTarget({ bindingAvailable }),
    d1LocalDbPath: null,
    notes: [
      ...AUTH_DB_RELEASE_NOTES,
      bindingAvailable
        ? "Runtime DB diagnostics confirmed that Auth can see the OPENMELD_DB worker binding."
        : "Runtime DB diagnostics could not confirm that Auth can see the OPENMELD_DB worker binding.",
    ],
  });
};
