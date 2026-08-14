export const OPENCONNECTOR_PRODUCTION_SECRET_MAPPINGS = Object.freeze({
  OOMOL_CONNECT_ADMIN_TOKEN: "OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN",
  OOMOL_CONNECT_ENCRYPTION_KEY: "OPEN_CONNECTOR_OPENMELD_ENCRYPTION_KEY",
  OOMOL_CONNECT_GITHUB_APP_ID: "OPEN_CONNECTOR_OPENMELD_GITHUB_APP_ID",
  OOMOL_CONNECT_GITHUB_APP_PRIVATE_KEY:
    "OPEN_CONNECTOR_OPENMELD_GITHUB_APP_PRIVATE_KEY",
  OOMOL_CONNECT_RUNTIME_TOKEN: "OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN",
});

export function assertRequiredOpenConnectorRuntimeSecrets(secretMetadata) {
  const deployedSecretNames = new Set(
    Array.isArray(secretMetadata)
      ? secretMetadata
          .map((secret) => secret?.name)
          .filter((name) => typeof name === "string")
      : []
  );
  const missingRuntimeKeys = Object.keys(
    OPENCONNECTOR_PRODUCTION_SECRET_MAPPINGS
  ).filter((runtimeKey) => !deployedSecretNames.has(runtimeKey));

  if (missingRuntimeKeys.length > 0) {
    throw new Error(
      `The deployed OpenConnector Worker is missing required secrets: ${missingRuntimeKeys.join(", ")}.`
    );
  }
}

export function resolveOpenConnectorProductionSecrets(env = process.env) {
  const missingCanonicalKeys = [];
  const runtimeSecrets = {};

  for (const [runtimeKey, canonicalKey] of Object.entries(
    OPENCONNECTOR_PRODUCTION_SECRET_MAPPINGS
  )) {
    const value = env[canonicalKey];
    if (typeof value !== "string" || value.trim().length === 0) {
      missingCanonicalKeys.push(canonicalKey);
      continue;
    }
    runtimeSecrets[runtimeKey] = value;
  }

  if (missingCanonicalKeys.length > 0) {
    throw new Error(
      `Missing required OpenConnector production credentials: ${missingCanonicalKeys.join(", ")}.`
    );
  }

  return runtimeSecrets;
}

export function resolveOpenConnectorProductionSecretsIfAvailable(
  env = process.env
) {
  const hasEveryCanonicalSecret = Object.values(
    OPENCONNECTOR_PRODUCTION_SECRET_MAPPINGS
  ).every(
    (canonicalKey) =>
      typeof env[canonicalKey] === "string" &&
      env[canonicalKey].trim().length > 0
  );

  return hasEveryCanonicalSecret
    ? resolveOpenConnectorProductionSecrets(env)
    : undefined;
}

export function resolveOpenConnectorProductionEnvironment(env = process.env) {
  return { ...env, ...resolveOpenConnectorProductionSecrets(env) };
}
