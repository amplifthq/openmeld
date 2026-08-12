import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENMELD_RESOURCES,
  provisionOpenMeldResources,
} from "./provision-openmeld-resources.mjs";

const OPENMELD_ZONE_ID = "722d0107341d0b03c5bb6294c2dc97ec";

test("reconciles every static resource and active Worker version", async () => {
  const client = createFakeCloudflareClient();

  const summary = await provisionOpenMeldResources({ apply: true, client });

  assert.equal(summary.ok, true);
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

function createFakeCloudflareClient(input = {}) {
  const missingNames = new Set(input.missingNames ?? []);
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

      const desiredResources = OPENMELD_RESOURCES.filter(
        (resource) => resource.listPath === path
      ).filter((resource) => !missingNames.has(resource.name));
      if (desiredResources.length === 0) {
        throw new Error(`unexpected Cloudflare request: ${path}`);
      }
      const values = desiredResources.map(fakeResourceValue);
      return desiredResources[0].listResultField
        ? { result: { [desiredResources[0].listResultField]: values } }
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
