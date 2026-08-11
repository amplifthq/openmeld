export const OPENCONNECTOR_PRODUCTION_SECRET_MAPPINGS = Object.freeze({
  OOMOL_CONNECT_ADMIN_TOKEN: "OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN",
  OOMOL_CONNECT_ENCRYPTION_KEY: "OPEN_CONNECTOR_OPENMELD_ENCRYPTION_KEY",
  OOMOL_CONNECT_RUNTIME_TOKEN: "OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN",
});

export function resolveOpenConnectorProductionEnvironment(env = process.env) {
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

  return { ...env, ...runtimeSecrets };
}
