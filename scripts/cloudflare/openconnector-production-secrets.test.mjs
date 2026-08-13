import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENCONNECTOR_PRODUCTION_SECRET_MAPPINGS,
  resolveOpenConnectorProductionEnvironment,
  resolveOpenConnectorProductionSecrets,
} from "./openconnector-production-secrets.mjs";

test("maps canonical OpenMeld credentials to the upstream runtime contract", () => {
  const canonicalValues = {
    OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN: "admin-value",
    OPEN_CONNECTOR_OPENMELD_ENCRYPTION_KEY: "encryption-value",
    OPEN_CONNECTOR_OPENMELD_GITHUB_APP_ID: "github-app-id",
    OPEN_CONNECTOR_OPENMELD_GITHUB_APP_PRIVATE_KEY: "github-private-key",
    OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN: "runtime-value",
  };

  const resolved = resolveOpenConnectorProductionEnvironment({
    CLOUDFLARE_API_TOKEN: "cloudflare-value",
    ...canonicalValues,
  });

  assert.equal(resolved.OOMOL_CONNECT_ADMIN_TOKEN, "admin-value");
  assert.equal(resolved.OOMOL_CONNECT_ENCRYPTION_KEY, "encryption-value");
  assert.equal(resolved.OOMOL_CONNECT_GITHUB_APP_ID, "github-app-id");
  assert.equal(
    resolved.OOMOL_CONNECT_GITHUB_APP_PRIVATE_KEY,
    "github-private-key"
  );
  assert.equal(resolved.OOMOL_CONNECT_RUNTIME_TOKEN, "runtime-value");
  assert.equal(resolved.CLOUDFLARE_API_TOKEN, "cloudflare-value");
  assert.deepEqual(Object.values(OPENCONNECTOR_PRODUCTION_SECRET_MAPPINGS), [
    "OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN",
    "OPEN_CONNECTOR_OPENMELD_ENCRYPTION_KEY",
    "OPEN_CONNECTOR_OPENMELD_GITHUB_APP_ID",
    "OPEN_CONNECTOR_OPENMELD_GITHUB_APP_PRIVATE_KEY",
    "OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN",
  ]);
  assert.deepEqual(resolveOpenConnectorProductionSecrets(canonicalValues), {
    OOMOL_CONNECT_ADMIN_TOKEN: "admin-value",
    OOMOL_CONNECT_ENCRYPTION_KEY: "encryption-value",
    OOMOL_CONNECT_GITHUB_APP_ID: "github-app-id",
    OOMOL_CONNECT_GITHUB_APP_PRIVATE_KEY: "github-private-key",
    OOMOL_CONNECT_RUNTIME_TOKEN: "runtime-value",
  });
});

test("fails closed and names every missing canonical credential", () => {
  assert.throws(
    () =>
      resolveOpenConnectorProductionEnvironment({
        OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN: "admin-value",
      }),
    {
      message:
        "Missing required OpenConnector production credentials: OPEN_CONNECTOR_OPENMELD_ENCRYPTION_KEY, OPEN_CONNECTOR_OPENMELD_GITHUB_APP_ID, OPEN_CONNECTOR_OPENMELD_GITHUB_APP_PRIVATE_KEY, OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN.",
    }
  );
});
