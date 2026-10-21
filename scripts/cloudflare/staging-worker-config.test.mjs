import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseJsoncObject } from "../../packages/db/src/tooling/parse-jsonc.ts";

const STAGING_HYPERDRIVE_ID = "6af2d43ec8d8498b9607c653ca231e73";
const STAGING_KV_ID = "ce0678aff60e4d5b864ad0591ea5e88a";
const PRODUCTION_RESOURCE_PATTERN = /-prod/u;
const PRODUCTION_URL_PATTERN =
  /https:\/\/(?:(?:app|auth|gateway)\.)?openmeld\.ai(?:["/])/u;
const DEPLOY_STAGING_SCRIPT_PATTERN = /deploy:stg/u;
const STAGING_ARGUMENT_PATTERN = /stg/u;
const PRODUCTION_ARGUMENT_PATTERN = /prod/u;
const ENVIRONMENT_SECRET_SOURCE_PATTERN = /--from-env/u;
const LOCAL_SECRET_FILE_PATTERN = /\.dev\.vars/u;
const STAGING_SETUP_BUILD_ENV_PATTERN =
  /VITE_OPENMELD_SETUP_USER_FACING_COMMAND=openmeld-canary/u;

const readConfig = (path) =>
  parseJsoncObject(
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
  );

const configs = {
  auth: readConfig("services/auth/wrangler.jsonc"),
  core: readConfig("services/core/wrangler.jsonc"),
  gateway: readConfig("services/gateway/wrangler.jsonc"),
  remoteAgent: readConfig("services/remote-agent/wrangler.jsonc"),
  web: readConfig("clients/web/wrangler.jsonc"),
  website: readConfig("clients/website/wrangler.jsonc"),
  docs: readConfig("clients/docs/wrangler.jsonc"),
};

const packageManifests = {
  auth: readConfig("services/auth/package.json"),
  core: readConfig("services/core/package.json"),
  gateway: readConfig("services/gateway/package.json"),
  remoteAgent: readConfig("services/remote-agent/package.json"),
  web: readConfig("clients/web/package.json"),
  website: readConfig("clients/website/package.json"),
  docs: readConfig("clients/docs/package.json"),
};

test("declares one isolated staging environment for every internal Worker", () => {
  for (const [component, config] of Object.entries(configs)) {
    const staging = config.env?.stg;
    assert.ok(staging, `${component} must declare env.stg`);
    assert.equal(staging.vars?.OPENMELD_WORKER_ENVIRONMENT, "stg");
    assert.doesNotMatch(JSON.stringify(staging), PRODUCTION_URL_PATTERN);
    const isolatedStaging = structuredClone(staging);
    isolatedStaging.vars = Object.fromEntries(
      Object.entries(isolatedStaging.vars ?? {}).filter(
        ([key]) => key !== "OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID"
      )
    );
    assert.doesNotMatch(
      JSON.stringify(isolatedStaging),
      PRODUCTION_RESOURCE_PATTERN
    );
  }
});

test("routes staging public Workers through staging.openmeld.ai", () => {
  assert.deepEqual(configs.web.env.stg.route, {
    custom_domain: true,
    pattern: "app.staging.openmeld.ai",
  });
  assert.deepEqual(configs.website.env.stg.route, {
    custom_domain: true,
    pattern: "staging.openmeld.ai",
  });
  assert.deepEqual(configs.docs.env.stg.route, {
    custom_domain: true,
    pattern: "docs.staging.openmeld.ai",
  });
  assert.deepEqual(configs.auth.env.stg.route, {
    custom_domain: true,
    pattern: "auth.staging.openmeld.ai",
  });
  assert.deepEqual(configs.gateway.env.stg.route, {
    custom_domain: true,
    pattern: "gateway.staging.openmeld.ai",
  });
  assert.equal(
    configs.web.env.stg.vars.VITE_OPENMELD_SETUP_USER_FACING_COMMAND,
    "openmeld-canary"
  );
  assert.match(
    packageManifests.web.scripts?.["build:stg"] ?? "",
    STAGING_SETUP_BUILD_ENV_PATTERN
  );
});

test("binds Auth and Core only to the staging database", () => {
  for (const config of [configs.auth, configs.core]) {
    assert.equal(config.env.stg.d1_databases, undefined);
    assert.deepEqual(config.env.stg.hyperdrive, [
      {
        binding: "OPENMELD_POSTGRESQL",
        id: STAGING_HYPERDRIVE_ID,
      },
    ]);
  }
  assert.deepEqual(configs.auth.env.stg.kv_namespaces, [
    { binding: "OPENMELD_AUTH_KV", id: STAGING_KV_ID },
  ]);
});

test("keeps staging service bindings, queues, and storage inside staging", () => {
  assert.deepEqual(configs.website.env.stg.services, [
    { binding: "APP", service: "openmeld-web-stg" },
  ]);
  assert.deepEqual(configs.web.env.stg.services, [
    { binding: "OPENMELD_GATEWAY_WORKER", service: "openmeld-gateway-stg" },
  ]);
  assert.deepEqual(configs.web.env.prod.services, [
    { binding: "OPENMELD_GATEWAY_WORKER", service: "openmeld-gateway-prod" },
  ]);
  assert.equal(configs.web.services, undefined);
  assert.deepEqual(
    configs.core.env.stg.services.map((binding) => binding.service),
    ["openmeld-gateway-stg", "openmeld-auth-stg", "openmeld-remote-agent-stg"]
  );
  assert.deepEqual(
    configs.gateway.env.stg.services.map((binding) => binding.service),
    ["openmeld-core-stg", "openmeld-auth-stg"]
  );
  assert.deepEqual(
    configs.remoteAgent.env.stg.services.map((binding) => binding.service),
    ["openmeld-core-stg"]
  );

  const stagingText = JSON.stringify(
    Object.values(configs).map((config) => config.env.stg)
  );
  for (const resourceName of [
    "openmeld-daemon-dispatch-stg",
    "openmeld-message-channel-events-stg",
    "openmeld-space-attachments-stg",
    "openmeld-organization-skills-stg",
    "openmeld-organization-logos-stg",
    "openmeld-desktop-downloads-stg",
  ]) {
    assert.match(stagingText, new RegExp(resourceName, "u"));
  }
});

test("disables external message channels in staging", () => {
  assert.equal(
    configs.core.env.stg.vars.OPENMELD_LARK_CHANNEL_ENABLED,
    "false"
  );
  assert.equal(
    configs.core.env.stg.vars.OPENMELD_FEISHU_CHANNEL_ENABLED,
    "false"
  );
});

test("routes Apps only to the independent staging connector and GitHub App", () => {
  assert.equal(
    configs.gateway.env.stg.vars.OPENMELD_CONNECTORS_BASE_URL,
    "https://connectors.staging.openmeld.ai"
  );
  assert.equal(
    configs.remoteAgent.env.stg.vars.OPENMELD_CONNECTORS_BASE_URL,
    "https://connectors.staging.openmeld.ai"
  );
  assert.equal(
    configs.gateway.env.stg.vars.GITHUB_OPENMELD_APP_SLUG,
    "openmeld-staging-flue2"
  );
});

test("reuses the operator-managed OpenRouter gateway in staging", () => {
  assert.equal(
    configs.remoteAgent.env.stg.vars.OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID,
    "openmeld-remote-agent-prod"
  );
  assert.equal(
    configs.remoteAgent.env.stg.vars
      .OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS,
    "openrouter"
  );
});

test("gives every internal Worker an explicit staging deploy command", () => {
  for (const [component, manifest] of Object.entries(packageManifests)) {
    assert.match(
      manifest.scripts?.["sync:config:stg"] ?? "",
      DEPLOY_STAGING_SCRIPT_PATTERN,
      `${component} must expose sync:config:stg`
    );
    assert.match(
      manifest.scripts?.["deploy:stg"] ?? "",
      STAGING_ARGUMENT_PATTERN,
      `${component} must deploy only env.stg`
    );
    assert.doesNotMatch(
      manifest.scripts?.["deploy:stg"] ?? "",
      PRODUCTION_ARGUMENT_PATTERN
    );
  }
});

test("keeps the Auth request runtime outside the Worker startup module", () => {
  assert.equal(configs.auth.base_dir, "src");
  assert.equal(configs.auth.find_additional_modules, true);
  assert.deepEqual(configs.auth.rules, [
    {
      globs: ["**/generated-runtime/*.mjs"],
      type: "ESModule",
    },
  ]);
  assert.equal(
    configs.auth.build?.command,
    "pnpm --filter @openmeld/auth-worker run build:lazy-runtime-modules"
  );
  assert.equal(
    packageManifests.auth.scripts?.["build:lazy-runtime-modules"],
    "node scripts/build-lazy-runtime-modules.mjs"
  );
});

test("syncs staging secrets from Doppler without committed secret files", () => {
  const secretOwners = [
    packageManifests.web,
    packageManifests.auth,
    packageManifests.remoteAgent,
  ];
  for (const manifest of secretOwners) {
    assert.match(
      manifest.scripts?.["sync:secrets:stg"] ?? "",
      ENVIRONMENT_SECRET_SOURCE_PATTERN
    );
    assert.doesNotMatch(
      manifest.scripts?.["sync:secrets:stg"] ?? "",
      LOCAL_SECRET_FILE_PATTERN
    );
  }
});
