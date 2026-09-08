import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRequiredOpenConnectorRuntimeSecrets,
  OPENCONNECTOR_SECRET_MAPPINGS,
  resolveOpenConnectorEnvironment,
  resolveOpenConnectorSecrets,
  resolveOpenConnectorSecretsIfAvailable,
} from "./openconnector-secrets.mjs";

test("maps canonical OpenMeld credentials to the upstream runtime contract", () => {
  const canonicalValues = {
    OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN: "admin-value",
    OPEN_CONNECTOR_OPENMELD_ENCRYPTION_KEY: "encryption-value",
    OPEN_CONNECTOR_OPENMELD_GITHUB_APP_ID: "github-app-id",
    OPEN_CONNECTOR_OPENMELD_GITHUB_APP_PRIVATE_KEY: "github-private-key",
    OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN: "runtime-value",
  };

  const resolved = resolveOpenConnectorEnvironment({
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
  assert.deepEqual(Object.values(OPENCONNECTOR_SECRET_MAPPINGS), [
    "OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN",
    "OPEN_CONNECTOR_OPENMELD_ENCRYPTION_KEY",
    "OPEN_CONNECTOR_OPENMELD_GITHUB_APP_ID",
    "OPEN_CONNECTOR_OPENMELD_GITHUB_APP_PRIVATE_KEY",
    "OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN",
  ]);
  assert.deepEqual(resolveOpenConnectorSecrets(canonicalValues), {
    OOMOL_CONNECT_ADMIN_TOKEN: "admin-value",
    OOMOL_CONNECT_ENCRYPTION_KEY: "encryption-value",
    OOMOL_CONNECT_GITHUB_APP_ID: "github-app-id",
    OOMOL_CONNECT_GITHUB_APP_PRIVATE_KEY: "github-private-key",
    OOMOL_CONNECT_RUNTIME_TOKEN: "runtime-value",
  });
  assert.deepEqual(
    resolveOpenConnectorSecretsIfAvailable(canonicalValues),
    resolveOpenConnectorSecrets(canonicalValues)
  );
});

test("fails closed and names every missing canonical credential", () => {
  assert.throws(
    () =>
      resolveOpenConnectorEnvironment({
        OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN: "admin-value",
      }),
    {
      message:
        "Missing required OpenConnector credentials: OPEN_CONNECTOR_OPENMELD_ENCRYPTION_KEY, OPEN_CONNECTOR_OPENMELD_GITHUB_APP_ID, OPEN_CONNECTOR_OPENMELD_GITHUB_APP_PRIVATE_KEY, OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN.",
    }
  );
});

test("accepts a deployed Worker only when every required runtime secret already exists", () => {
  assert.equal(
    resolveOpenConnectorSecretsIfAvailable({
      OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN: "admin-value",
    }),
    undefined
  );
  assert.doesNotThrow(() =>
    assertRequiredOpenConnectorRuntimeSecrets([
      { name: "OOMOL_CONNECT_ADMIN_TOKEN", type: "secret_text" },
      { name: "OOMOL_CONNECT_ENCRYPTION_KEY", type: "secret_text" },
      { name: "OOMOL_CONNECT_GITHUB_APP_ID", type: "secret_text" },
      { name: "OOMOL_CONNECT_GITHUB_APP_PRIVATE_KEY", type: "secret_text" },
      { name: "OOMOL_CONNECT_RUNTIME_TOKEN", type: "secret_text" },
    ])
  );

  assert.throws(
    () =>
      assertRequiredOpenConnectorRuntimeSecrets([
        { name: "OOMOL_CONNECT_ADMIN_TOKEN", type: "secret_text" },
        { name: "OOMOL_CONNECT_RUNTIME_TOKEN", type: "secret_text" },
      ]),
    {
      message:
        "The deployed OpenConnector Worker is missing required secrets: OOMOL_CONNECT_ENCRYPTION_KEY, OOMOL_CONNECT_GITHUB_APP_ID, OOMOL_CONNECT_GITHUB_APP_PRIVATE_KEY.",
    }
  );
});
