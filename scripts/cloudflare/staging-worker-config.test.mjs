import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseJsoncObject } from "../../packages/db/src/tooling/parse-jsonc.ts";

const STAGING_DB_ID = "10da3483-0644-459a-8523-381a2a17ac39";
const STAGING_KV_ID = "ce0678aff60e4d5b864ad0591ea5e88a";
const PRODUCTION_RESOURCE_PATTERN = /-prod/u;
const PRODUCTION_URL_PATTERN =
  /https:\/\/(?:auth\.|gateway\.)?openmeld\.ai(?:["/])/u;

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
};

test("declares one isolated staging environment for every internal Worker", () => {
  for (const [component, config] of Object.entries(configs)) {
    const staging = config.env?.stg;
    assert.ok(staging, `${component} must declare env.stg`);
    assert.equal(staging.vars?.OPENMELD_WORKER_ENVIRONMENT, "stg");
    assert.doesNotMatch(JSON.stringify(staging), PRODUCTION_URL_PATTERN);
    assert.doesNotMatch(JSON.stringify(staging), PRODUCTION_RESOURCE_PATTERN);
  }
});

test("routes staging public Workers through staging.openmeld.ai", () => {
  assert.deepEqual(configs.web.env.stg.route, {
    custom_domain: true,
    pattern: "staging.openmeld.ai",
  });
  assert.deepEqual(configs.auth.env.stg.route, {
    custom_domain: true,
    pattern: "auth.staging.openmeld.ai",
  });
  assert.deepEqual(configs.gateway.env.stg.route, {
    custom_domain: true,
    pattern: "gateway.staging.openmeld.ai",
  });
});

test("binds Auth and Core only to the staging database", () => {
  for (const config of [configs.auth, configs.core]) {
    assert.ok(config.env.stg.d1_databases.length > 0);
    assert.ok(
      config.env.stg.d1_databases.every(
        (binding) =>
          binding.database_name === "openmeld-db-stg" &&
          binding.database_id === STAGING_DB_ID
      )
    );
  }
  assert.deepEqual(configs.auth.env.stg.kv_namespaces, [
    { binding: "OPENMELD_AUTH_KV", id: STAGING_KV_ID },
  ]);
});

test("keeps staging service bindings, queues, and storage inside staging", () => {
  assert.deepEqual(
    configs.core.env.stg.services.map((binding) => binding.service),
    ["openmeld-auth-stg", "openmeld-remote-agent-stg"]
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
  assert.equal(configs.gateway.env.stg.vars.OPENMELD_CONNECTORS_BASE_URL, "");
  assert.equal(
    configs.remoteAgent.env.stg.vars.OPENMELD_CONNECTORS_BASE_URL,
    ""
  );
});
