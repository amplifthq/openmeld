import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENMELD_RESOURCES,
  OPENMELD_STAGING_RESOURCES,
  provisionOpenMeldResources,
} from "./provision-openmeld-resources.mjs";

const OPENMELD_ZONE_ID = "722d0107341d0b03c5bb6294c2dc97ec";

test("reconciles every static resource and active Worker version", async () => {
  const client = createFakeCloudflareClient();

  const summary = await provisionOpenMeldResources({ apply: true, client });

  assert.equal(summary.ok, true, JSON.stringify(summary, null, 2));
  assert.equal(summary.resources.length, OPENMELD_RESOURCES.length + 6);
  assert.ok(
    summary.resources.every((resource) => resource.tagStatus === "verified")
  );
  assert.equal(client.tagWrites.length, OPENMELD_RESOURCES.length + 6);
  assert.equal(
    client.tagWrites.filter((write) => write.apiScope === "global").length,
    5
  );
  assert.equal(
    client.tagWrites.filter(
      (write) => write.body.resource_type === "worker_version"
    ).length,
    6
  );
  assert.ok(
    client.tagWrites
      .filter((write) => write.body.resource_type === "worker_version")
      .every((write) => write.body.worker_id?.startsWith("openmeld-"))
  );
});

test("fails closed without creating a missing deployment-managed Worker", async () => {
  const missingWorker = "openmeld-web-prod";
  const client = createFakeCloudflareClient({ missingNames: [missingWorker] });

  const summary = await provisionOpenMeldResources({ apply: true, client });

  assert.equal(summary.ok, false);
  assert.deepEqual(
    summary.resources.find(
      (resource) =>
        resource.kind === "Worker" && resource.name === missingWorker
    ),
    { action: "missing", kind: "Worker", name: missingWorker }
  );
  assert.equal(client.creates.length, 0);
  assert.equal(
    summary.resources.some(
      (resource) =>
        resource.kind === "Worker version" &&
        resource.name.startsWith(`${missingWorker}@`)
    ),
    false
  );
});

test("keeps staging infrastructure isolated from production", () => {
  const productionNames = new Set(
    OPENMELD_RESOURCES.map((resource) => resource.name)
  );

  assert.ok(OPENMELD_STAGING_RESOURCES.length > 0);
  assert.ok(
    OPENMELD_STAGING_RESOURCES.every(
      (resource) => resource.environment === "staging"
    )
  );
  assert.ok(
    OPENMELD_STAGING_RESOURCES.every(
      (resource) => !productionNames.has(resource.name)
    )
  );
  assert.deepEqual(
    OPENMELD_STAGING_RESOURCES.filter((resource) => resource.kind === "D1").map(
      (resource) => resource.name
    ),
    ["openmeld-db-stg"]
  );
});

test("requests every Durable Object namespace in one page", () => {
  const durableObjects = [
    ...OPENMELD_RESOURCES,
    ...OPENMELD_STAGING_RESOURCES,
  ].filter((resource) => resource.kind === "Durable Object namespace");

  assert.ok(durableObjects.length > 0);
  assert.ok(
    durableObjects.every(
      (resource) =>
        resource.listPath ===
        "/workers/durable_objects/namespaces?per_page=100"
    )
  );
});

test("allows deployment-managed staging resources to arrive after prerequisites", async () => {
  const missingDeploymentManagedResources = OPENMELD_STAGING_RESOURCES.filter(
    (resource) => resource.lifecycle === "deployment-managed"
  );
  const client = createFakeCloudflareClient({
    missingResources: missingDeploymentManagedResources.map(
      (resource) => `${resource.kind}:${resource.name}`
    ),
    resources: OPENMELD_STAGING_RESOURCES,
  });

  const summary = await provisionOpenMeldResources({
    apply: true,
    environment: "staging",
    requireDeploymentManaged: false,
    client,
  });

  assert.equal(summary.ok, true, JSON.stringify(summary, null, 2));
  assert.equal(client.creates.length, 0);
  assert.deepEqual(
    summary.resources
      .filter((resource) => resource.action === "awaiting-deploy")
      .map((resource) => `${resource.kind}:${resource.name}`)
      .toSorted(),
    missingDeploymentManagedResources
      .map((resource) => `${resource.kind}:${resource.name}`)
      .toSorted()
  );
});

function createFakeCloudflareClient(input = {}) {
  const missingNames = new Set(input.missingNames ?? []);
  const missingResources = new Set(input.missingResources ?? []);
  const resources = input.resources ?? OPENMELD_RESOURCES;
  const tags = new Map();
  const tagWrites = [];
  const creates = [];

  return {
    creates,
    tagWrites,
    request(path, options = {}) {
      if (options.method === "PUT" && path.endsWith("/tags")) {
        const key = tagKey(options.body);
        tags.set(key, structuredClone(options.body.tags));
        tagWrites.push({
          apiScope: options.apiScope,
          body: structuredClone(options.body),
        });
        return { result: { tags: tags.get(key) }, success: true };
      }
      if (options.method === "POST") {
        creates.push({ path, options });
        throw new Error("all fake resources must already exist");
      }
      if (path.includes("/tags?")) {
        const query = new URL(path, "https://cloudflare.test").searchParams;
        const key = tagKey(Object.fromEntries(query));
        return { result: { tags: structuredClone(tags.get(key) ?? {}) } };
      }
      if (path.endsWith("/deployments")) {
        const workerName = decodeURIComponent(path.split("/").at(-2));
        return {
          result: {
            deployments: [
              {
                created_on: "2026-08-12T00:00:00.000Z",
                versions: [
                  { percentage: 100, version_id: `${workerName}-version` },
                ],
              },
            ],
          },
        };
      }

      const resourcesForPath = resources.filter(
        (resource) => resource.listPath === path
      );
      if (resourcesForPath.length === 0) {
        throw new Error(`unexpected Cloudflare request: ${path}`);
      }
      const desiredResources = resourcesForPath.filter(
        (resource) =>
          !(
            missingNames.has(resource.name) ||
            missingResources.has(`${resource.kind}:${resource.name}`)
          )
      );
      const values = desiredResources.map(fakeResourceValue);
      return resourcesForPath[0].listResultField
        ? { result: { [resourcesForPath[0].listResultField]: values } }
        : { result: values };
    },
  };
}

function fakeResourceValue(desired) {
  if (desired.kind === "Zone") {
    return {
      id: OPENMELD_ZONE_ID,
      name: desired.name,
      status: "active",
    };
  }
  if (desired.kind === "DNS record") {
    return {
      content: "100::",
      id: `${desired.component}-dns-id`,
      name: desired.name,
      proxied: true,
      type: "AAAA",
    };
  }

  const value = {
    [desired.idField]: desired.name,
    [desired.nameField]: desired.name,
  };
  if (desired.kind === "Queue") {
    value.settings = { message_retention_period: 4 * 24 * 60 * 60 };
  }
  return value;
}

function tagKey(value) {
  return [value.resource_type, value.resource_id, value.worker_id ?? ""].join(
    ":"
  );
}
