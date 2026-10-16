import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseJsoncObject } from "../../packages/db/src/tooling/parse-jsonc.ts";

const root = path.resolve(import.meta.dirname, "../..");
const owner = "src/organizations/account-deletion.ts";
const AVATAR_CONTRACT_ERROR =
  /@openmeld\/core (?:top-level|env\.prod).*OPENMELD_ACCOUNT_AVATARS/u;
const POSTGRESQL_CONTRACT_ERROR = /OPENMELD_POSTGRESQL/u;
const REMOVED_BILLING_ERROR =
  /unexpected key OPENMELD_INTERNAL_BILLING_ORGANIZATION_ID/u;

function prepareBillingReader(core, scenario) {
  if (!scenario.endsWith("billing-reader")) {
    return;
  }
  const example = path.join(core, ".dev.vars.example");
  writeFileSync(
    example,
    `${readFileSync(example, "utf8")}\nOPENMELD_INTERNAL_BILLING_ORGANIZATION_ID=\n`
  );
  const billing = path.join(core, "src/usage/ai-billing-service.ts");
  mkdirSync(path.dirname(billing), { recursive: true });
  // Captured from the pinned 3e882aec release's billing owner.
  writeFileSync(
    billing,
    scenario === "historical-billing-reader"
      ? "const configured = env.OPENMELD_INTERNAL_BILLING_ORGANIZATION_ID?.trim();\n"
      : "// The billing exemption was removed.\n"
  );
}

for (const scenario of [
  "historical-without-owner",
  "owner-missing-binding",
  "owner-wrong-bucket",
  "historical-staging",
  "production-missing-postgresql",
  "historical-billing-reader",
  "removed-billing-reader",
]) {
  test(`current verifier validates production source contracts: ${scenario}`, () => {
    const product = mkdtempSync(
      path.join(tmpdir(), "openmeld-worker-env-source-")
    );
    try {
      for (const name of [
        ".github",
        "clients",
        "config",
        "packages",
        "scripts",
        "tooling",
        "release",
      ]) {
        symlinkSync(path.join(root, name), path.join(product, name), "dir");
      }
      mkdirSync(path.join(product, "services"));
      for (const name of readdirSync(path.join(root, "services"))) {
        if (name !== "core") {
          symlinkSync(
            path.join(root, "services", name),
            path.join(product, "services", name),
            "dir"
          );
        }
      }
      const core = path.join(product, "services/core");
      mkdirSync(core);
      for (const name of [
        "package.json",
        "worker-configuration.d.ts",
        ".dev.vars.example",
        ".dev.vars.prod.example",
      ]) {
        copyFileSync(
          path.join(root, "services/core", name),
          path.join(core, name)
        );
      }
      if (scenario !== "historical-without-owner") {
        mkdirSync(path.dirname(path.join(core, owner)), { recursive: true });
        copyFileSync(
          path.join(root, "services/core", owner),
          path.join(core, owner)
        );
      }
      prepareBillingReader(core, scenario);
      const config = parseJsoncObject(
        readFileSync(path.join(root, "services/core/wrangler.jsonc"), "utf8")
      );
      for (const section of [config, config.env.prod]) {
        if (scenario === "owner-wrong-bucket") {
          section.r2_buckets.find(
            ({ binding }) => binding === "OPENMELD_ACCOUNT_AVATARS"
          ).bucket_name = "wrong-avatar-bucket";
        } else if (
          scenario !== "historical-staging" &&
          scenario !== "production-missing-postgresql" &&
          !scenario.endsWith("billing-reader")
        ) {
          section.r2_buckets = section.r2_buckets.filter(
            ({ binding }) => binding !== "OPENMELD_ACCOUNT_AVATARS"
          );
        }
      }
      if (scenario === "historical-staging") {
        config.env.stg.hyperdrive = undefined;
      }
      if (scenario === "production-missing-postgresql") {
        config.env.prod.hyperdrive = undefined;
      }
      writeFileSync(path.join(core, "wrangler.jsonc"), JSON.stringify(config));
      const result = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          path.join(root, "scripts/cloudflare/verify-worker-env-contract.mjs"),
          "--profile",
          "production",
        ],
        {
          cwd: product,
          env: { ...process.env, OPENMELD_VERIFICATION_ROOT: product },
          encoding: "utf8",
          timeout: 10_000,
        }
      );
      assert.equal(result.error, undefined);
      assert.equal(
        result.status,
        [
          "historical-without-owner",
          "historical-staging",
          "historical-billing-reader",
        ].includes(scenario)
          ? 0
          : 1,
        result.stderr
      );
      if (scenario.startsWith("owner-")) {
        assert.match(result.stderr, AVATAR_CONTRACT_ERROR);
      }
      if (scenario === "removed-billing-reader") {
        assert.match(result.stderr, REMOVED_BILLING_ERROR);
      }
      if (scenario === "production-missing-postgresql") {
        assert.match(result.stderr, POSTGRESQL_CONTRACT_ERROR);
      }
      if (scenario === "historical-staging") {
        const all = spawnSync(
          process.execPath,
          [
            path.join(
              root,
              "scripts/cloudflare/verify-worker-env-contract.mjs"
            ),
            "--profile",
            "all",
          ],
          {
            cwd: product,
            env: { ...process.env, OPENMELD_VERIFICATION_ROOT: product },
            encoding: "utf8",
            timeout: 10_000,
          }
        );
        assert.equal(all.status, 1);
        assert.match(all.stderr, POSTGRESQL_CONTRACT_ERROR);
      }
    } finally {
      rmSync(product, { recursive: true, force: true });
    }
  });
}

const CONNECTOR_RUNTIME_LINE =
  /^.*OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN.*\r?\n/gmu;
const CONNECTOR_CONTRACT_ERROR =
  /OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN|ENOENT/u;

function prepareGatewayWithoutRuntimeDeclarations(product) {
  for (const name of [
    ".github",
    "clients",
    "config",
    "packages",
    "scripts",
    "tooling",
    "release",
  ]) {
    symlinkSync(path.join(root, name), path.join(product, name), "dir");
  }
  mkdirSync(path.join(product, "services"));
  for (const name of readdirSync(path.join(root, "services"))) {
    if (name !== "gateway") {
      symlinkSync(
        path.join(root, "services", name),
        path.join(product, "services", name),
        "dir"
      );
    }
  }
  const gateway = path.join(product, "services/gateway");
  mkdirSync(gateway);
  copyFileSync(
    path.join(root, "services/gateway/package.json"),
    path.join(gateway, "package.json")
  );
  for (const name of [
    "worker-configuration.d.ts",
    ".dev.vars.example",
    ".dev.vars.prod.example",
  ]) {
    const source = readFileSync(
      path.join(root, "services/gateway", name),
      "utf8"
    );
    writeFileSync(
      path.join(gateway, name),
      source.replace(CONNECTOR_RUNTIME_LINE, "")
    );
  }
  const config = parseJsoncObject(
    readFileSync(path.join(root, "services/gateway/wrangler.jsonc"), "utf8")
  );
  for (const section of [config, ...Object.values(config.env)]) {
    if (section.secrets?.required) {
      section.secrets.required = section.secrets.required.filter(
        (name) => name !== "OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN"
      );
    }
  }
  writeFileSync(path.join(gateway, "wrangler.jsonc"), JSON.stringify(config));
  const route = path.join(
    gateway,
    "src/routes/rpc-http.connector-connections.ts"
  );
  mkdirSync(path.dirname(route), { recursive: true });
  const client = path.join(gateway, "src/lib/openconnector-client.ts");
  mkdirSync(path.dirname(client), { recursive: true });
  copyFileSync(
    path.join(root, "services/gateway/src/lib/openconnector-client.ts"),
    client
  );
  return { route, client };
}

for (const scenario of [
  "historical-reader",
  "runtime-reader",
  "runtime-client-with-legacy-reader",
  "missing-reader",
]) {
  test(`current verifier binds connector credentials to the product reader: ${scenario}`, () => {
    const product = mkdtempSync(
      path.join(tmpdir(), "openmeld-gateway-env-source-")
    );
    try {
      const { route, client } =
        prepareGatewayWithoutRuntimeDeclarations(product);
      if (
        ["historical-reader", "runtime-client-with-legacy-reader"].includes(
          scenario
        )
      ) {
        // Captured legacy client construction: providers used the admin token.
        writeFileSync(
          route,
          `function createOpenConnectorClient(env: CloudflareBindings): OpenConnectorClient {
  const bindings = env as CloudflareBindings & OpenConnectorBindings;
  return new OpenConnectorClient({
    adminToken: bindings.OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN ?? "",
    baseUrl: bindings.OPENMELD_CONNECTORS_BASE_URL ?? "",
  });
}
`
        );
        if (scenario === "historical-reader") {
          writeFileSync(
            client,
            `class OpenConnectorClient {
  async listProviders(): Promise<ConnectorAppCatalogProvider[]> {
    const payload = await this.#request(
      "/v1/providers?includeConnectionAuth=true",
      { method: "GET" }
    );
    return parseOpenConnectorPayload({
      operation: "list providers",
      payload,
      schema: openConnectorProviderListSchema,
    }).data;
  }
}
`
          );
        }
      } else if (scenario === "runtime-reader") {
        copyFileSync(
          path.join(
            root,
            "services/gateway/src/routes/rpc-http.connector-connections.ts"
          ),
          route
        );
      }
      const result = spawnSync(
        process.execPath,
        [
          path.join(root, "scripts/cloudflare/verify-worker-env-contract.mjs"),
          "--profile",
          "production",
        ],
        {
          cwd: product,
          env: { ...process.env, OPENMELD_VERIFICATION_ROOT: product },
          encoding: "utf8",
          timeout: 10_000,
        }
      );
      assert.equal(result.error, undefined);
      assert.equal(
        result.status,
        scenario === "historical-reader" ? 0 : 1,
        result.stderr
      );
      if (scenario !== "historical-reader") {
        assert.match(result.stderr, CONNECTOR_CONTRACT_ERROR);
      }
    } finally {
      rmSync(product, { recursive: true, force: true });
    }
  });
}
