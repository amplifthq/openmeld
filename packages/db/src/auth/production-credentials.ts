import type { DbExecutionMode } from "../tooling/db-execution-mode.ts";
import { resolveWranglerD1BindingMetadataFromSource } from "../tooling/wrangler-d1-target.ts";
import { AUTH_DB_BINDING_NAME } from "./fact-metadata.ts";

export const AUTH_PRODUCTION_CREDENTIAL_ENV_NAMES = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_D1_DATABASE_ID",
  "CLOUDFLARE_API_TOKEN",
] as const;

export type AuthProductionCredentialEnvName =
  (typeof AUTH_PRODUCTION_CREDENTIAL_ENV_NAMES)[number];

type AuthProductionCredentialSpec = {
  acquisitionGuidance: string;
  name: AuthProductionCredentialEnvName;
  purpose: string;
};

const AUTH_PRODUCTION_CREDENTIAL_SPECS: Record<
  AuthProductionCredentialEnvName,
  AuthProductionCredentialSpec
> = {
  CLOUDFLARE_ACCOUNT_ID: {
    acquisitionGuidance:
      "Get it from the Cloudflare dashboard Account ID and export it explicitly.",
    name: "CLOUDFLARE_ACCOUNT_ID",
    purpose: "Selects the Cloudflare account that owns production OPENMELD_DB.",
  },
  CLOUDFLARE_D1_DATABASE_ID: {
    acquisitionGuidance:
      "Export it explicitly or keep services/auth/wrangler.jsonc env.prod OPENMELD_DB database_id valid.",
    name: "CLOUDFLARE_D1_DATABASE_ID",
    purpose: "Selects production OPENMELD_DB for Drizzle D1 HTTP access.",
  },
  CLOUDFLARE_API_TOKEN: {
    acquisitionGuidance:
      "Create a Cloudflare API token with the required D1 access and export it explicitly.",
    name: "CLOUDFLARE_API_TOKEN",
    purpose: "Authenticates production D1 HTTP operations.",
  },
};

type AuthProductionCredentialsInput = {
  env: NodeJS.ProcessEnv;
  wranglerConfigReadError?: unknown;
  wranglerConfigSource?: string;
};

type AuthProductionCredentialsReaderInput = {
  env: NodeJS.ProcessEnv;
  readWranglerConfigSource: () => string;
};

type AsyncAuthProductionCredentialsReaderInput = {
  env: NodeJS.ProcessEnv;
  readWranglerConfigSource: () => Promise<string>;
};

export type AuthProductionCredentialsInspection = {
  accountId: string | null;
  databaseId: string | null;
  databaseIdFallbackDetail: string;
  databaseIdFallbackError: unknown | null;
  databaseIdSource: "cloudflare_env" | "wrangler_config" | null;
  missing: AuthProductionCredentialSpec[];
  token: string | null;
};

const normalizeOptionalString = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};

const formatError = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const hasExplicitAuthProductionDatabaseId = (
  env: NodeJS.ProcessEnv
): boolean => {
  return normalizeOptionalString(env.CLOUDFLARE_D1_DATABASE_ID) !== null;
};

const inspectDatabaseId = (
  input: AuthProductionCredentialsInput
): Pick<
  AuthProductionCredentialsInspection,
  | "databaseId"
  | "databaseIdFallbackDetail"
  | "databaseIdFallbackError"
  | "databaseIdSource"
> => {
  const explicitDatabaseId = normalizeOptionalString(
    input.env.CLOUDFLARE_D1_DATABASE_ID
  );
  if (explicitDatabaseId) {
    return {
      databaseId: explicitDatabaseId,
      databaseIdFallbackDetail:
        "Wrangler fallback not needed because CLOUDFLARE_D1_DATABASE_ID is explicit.",
      databaseIdFallbackError: null,
      databaseIdSource: "cloudflare_env",
    };
  }

  try {
    if (input.wranglerConfigReadError) {
      throw input.wranglerConfigReadError;
    }
    if (typeof input.wranglerConfigSource !== "string") {
      throw new Error("services/auth/wrangler.jsonc could not be read");
    }

    const metadata = resolveWranglerD1BindingMetadataFromSource({
      bindingName: AUTH_DB_BINDING_NAME,
      mode: "prod" satisfies DbExecutionMode,
      source: input.wranglerConfigSource,
    });
    if (!metadata.databaseId) {
      throw new Error(
        "env.prod OPENMELD_DB database_id is missing in services/auth/wrangler.jsonc"
      );
    }

    return {
      databaseId: metadata.databaseId,
      databaseIdFallbackDetail:
        "Wrangler fallback available from services/auth/wrangler.jsonc env.prod OPENMELD_DB database_id.",
      databaseIdFallbackError: null,
      databaseIdSource: "wrangler_config",
    };
  } catch (error) {
    return {
      databaseId: null,
      databaseIdFallbackDetail: `Wrangler fallback unavailable: ${formatError(error)}`,
      databaseIdFallbackError: error,
      databaseIdSource: null,
    };
  }
};

const inspectAuthProductionCredentials = (
  input: AuthProductionCredentialsInput
): AuthProductionCredentialsInspection => {
  const accountId = normalizeOptionalString(input.env.CLOUDFLARE_ACCOUNT_ID);
  const token = normalizeOptionalString(input.env.CLOUDFLARE_API_TOKEN);
  const databaseIdInspection = inspectDatabaseId(input);
  const values: Record<AuthProductionCredentialEnvName, string | null> = {
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_D1_DATABASE_ID: databaseIdInspection.databaseId,
    CLOUDFLARE_API_TOKEN: token,
  };

  return {
    accountId,
    ...databaseIdInspection,
    missing: AUTH_PRODUCTION_CREDENTIAL_ENV_NAMES.filter(
      (name) => values[name] === null
    ).map((name) => AUTH_PRODUCTION_CREDENTIAL_SPECS[name]),
    token,
  };
};

const inspectAuthProductionCredentialsWithWranglerConfigSync = (
  input: AuthProductionCredentialsReaderInput
): AuthProductionCredentialsInspection => {
  if (hasExplicitAuthProductionDatabaseId(input.env)) {
    return inspectAuthProductionCredentials({ env: input.env });
  }

  try {
    return inspectAuthProductionCredentials({
      env: input.env,
      wranglerConfigSource: input.readWranglerConfigSource(),
    });
  } catch (error) {
    return inspectAuthProductionCredentials({
      env: input.env,
      wranglerConfigReadError: error,
    });
  }
};

export const inspectAuthProductionCredentialsWithWranglerConfig = async (
  input: AsyncAuthProductionCredentialsReaderInput
): Promise<AuthProductionCredentialsInspection> => {
  if (hasExplicitAuthProductionDatabaseId(input.env)) {
    return inspectAuthProductionCredentials({ env: input.env });
  }

  try {
    return inspectAuthProductionCredentials({
      env: input.env,
      wranglerConfigSource: await input.readWranglerConfigSource(),
    });
  } catch (error) {
    return inspectAuthProductionCredentials({
      env: input.env,
      wranglerConfigReadError: error,
    });
  }
};

export const formatMissingAuthProductionCredentials = (
  inspection: AuthProductionCredentialsInspection
): string => {
  const missingLines = inspection.missing.map((spec) => {
    const fallbackDetail =
      spec.name === "CLOUDFLARE_D1_DATABASE_ID"
        ? ` ${inspection.databaseIdFallbackDetail}`
        : "";
    return `- ${spec.name}: ${spec.purpose} ${spec.acquisitionGuidance}${fallbackDetail}`;
  });
  return [
    "Production database credentials are incomplete for OPENMELD_DB_EXECUTION_MODE=prod.",
    "Missing production database credentials:",
    ...missingLines,
  ].join("\n");
};

export const resolveAuthProductionCredentials = (
  input: AuthProductionCredentialsReaderInput
): {
  accountId: string;
  databaseId: string;
  databaseIdSource: "cloudflare_env" | "wrangler_config";
  token: string;
} => {
  const inspection =
    inspectAuthProductionCredentialsWithWranglerConfigSync(input);
  if (inspection.missing.length > 0) {
    throw new Error(formatMissingAuthProductionCredentials(inspection), {
      cause: inspection.databaseIdFallbackError ?? undefined,
    });
  }
  if (
    !(
      inspection.accountId &&
      inspection.databaseId &&
      inspection.databaseIdSource &&
      inspection.token
    )
  ) {
    throw new Error(
      "Production credential inspection returned incomplete data."
    );
  }

  return {
    accountId: inspection.accountId,
    databaseId: inspection.databaseId,
    databaseIdSource: inspection.databaseIdSource,
    token: inspection.token,
  };
};
