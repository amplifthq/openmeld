import { createAuthCodegenDatabase } from "@openmeld/db/auth";
import {
  type AuthConfigEnv,
  createAuthConfig,
} from "../src/configs/auth.config";

/** Configuration-only tests use the existing schema fixture and never issue SQL. */
export function createAuthConfigForTest(env: AuthConfigEnv) {
  return createAuthConfig(
    {
      OPENMELD_POSTGRESQL: {
        connectionString:
          "postgresql://configuration_fixture@127.0.0.1:9/configuration_fixture",
      },
      ...env,
    },
    createAuthCodegenDatabase()
  );
}
