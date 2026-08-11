import { createAuthConfig } from "@openmeld/auth/server";
import { betterAuth } from "better-auth";

const BETTER_AUTH_CODEGEN_SECRET =
  "openmeld-better-auth-schema-codegen-only-not-a-runtime-secret";

// Better Auth CLI loads this file in Node for schema/code generation.
// Keep code generation deterministic and independent from production secrets.
// The Auth Worker runtime uses index.ts and still requires its bound secret.
export const auth = betterAuth(
  createAuthConfig({
    AUTH_WORKER_NODE_ENV: "development",
    BETTER_AUTH_OPENMELD_SECRET: BETTER_AUTH_CODEGEN_SECRET,
  })
);
