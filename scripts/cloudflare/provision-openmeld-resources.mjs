#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const API_BASE = "https://api.cloudflare.com/client/v4";
const FOUR_DAYS_IN_SECONDS = 4 * 24 * 60 * 60;
const MAX_ATTEMPTS = 3;

export const OPENMELD_RESOURCES = [
  d1("openmeld-db-prod", "shared"),
  d1("openmeld-open-connector-db-prod", "open-connector"),
  kv("openmeld-auth-kv-prod", "auth"),
  r2("openmeld-space-attachments-prod", "shared", "confidential"),
  r2("openmeld-organization-skills-prod", "shared", "private"),
  r2("openmeld-organization-logos-prod", "shared", "public"),
  r2("openmeld-desktop-downloads-prod", "web", "public"),
  r2(
    "openmeld-open-connector-transit-files-prod",
    "open-connector",
    "ephemeral"
  ),
  r2("openmeld-space-attachments-preview", "shared", "confidential", "preview"),
  r2("openmeld-organization-skills-preview", "shared", "private", "preview"),
  r2("openmeld-organization-logos-preview", "shared", "public", "preview"),
  queue("openmeld-daemon-dispatch-prod", "shared"),
  queue("openmeld-message-channel-events-prod", "shared"),
  aiGateway("openmeld-remote-agent-prod", "remote-agent"),
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}

export async function provisionOpenMeldResources(input) {
  const client = input.client ?? createCloudflareClient(input);
  const summary = {
    mode: input.apply ? "apply" : "plan",
    ok: true,
    resources: [],
    tagWarnings: [],
  };

  for (const desired of OPENMELD_RESOURCES) {
    try {
      const existing = await findResource(client, desired);
      if (!(existing || input.apply)) {
        summary.resources.push(toSummary(desired, "missing"));
        summary.ok = false;
        continue;
      }

      const resource = existing ?? (await createResource(client, desired));
      const action = existing ? "existing" : "created";
      let tagStatus = "not-requested";

      if (input.apply) {
        try {
          tagStatus = await reconcileTags(client, desired, resource.id);
        } catch (error) {
          tagStatus = "blocked";
          summary.tagWarnings.push(
            `${desired.kind} ${desired.name}: ${formatError(error)}`
          );
        }
      }

      summary.resources.push({
        ...toSummary(desired, action),
        id: resource.id,
        tagStatus,
      });
    } catch (error) {
      summary.ok = false;
      summary.resources.push({
        ...toSummary(desired, "blocked"),
        error: formatError(error),
      });
    }
  }

  if (input.apply) {
    await verifyCreatedResources(client, summary);
  }
  if (input.outputPath) {
    await writeFile(input.outputPath, `${JSON.stringify(summary, null, 2)}\n`, {
      mode: 0o600,
    });
  }
  return summary;
}

export function mergeTags(current, desired) {
  return { ...current, ...desired };
}

export function parseArgs(rawArgs, env = process.env) {
  const result = {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    apply: false,
    outputPath: undefined,
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--apply") {
      result.apply = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--output") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--output requires a file path.");
      }
      result.outputPath = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!(result.accountId && result.apiToken)) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required."
    );
  }
  return result;
}

function d1(name, component) {
  return resource({
    component,
    createBody: { name, primary_location_hint: "enam" },
    dataClass: "confidential",
    idField: "uuid",
    kind: "D1",
    listPath: "/d1/database?per_page=100",
    name,
    nameField: "name",
    postPath: "/d1/database",
    resourceType: "d1_database",
  });
}

function kv(name, component) {
  return resource({
    component,
    createBody: { title: name },
    dataClass: "confidential",
    idField: "id",
    kind: "KV",
    listPath: "/storage/kv/namespaces?per_page=100",
    name,
    nameField: "title",
    postPath: "/storage/kv/namespaces",
    resourceType: "kv_namespace",
  });
}

function r2(name, component, dataClass, environment = "production") {
  return resource({
    component,
    createBody: { locationHint: "enam", name, storageClass: "Standard" },
    dataClass,
    environment,
    idField: "name",
    kind: "R2",
    listPath: "/r2/buckets?per_page=100",
    listResultField: "buckets",
    name,
    nameField: "name",
    postPath: "/r2/buckets",
    resourceType: "r2_bucket",
  });
}

function queue(name, component) {
  return resource({
    component,
    createBody: { queue_name: name },
    dataClass: "private",
    idField: "queue_id",
    kind: "Queue",
    listPath: "/queues?per_page=100",
    name,
    nameField: "queue_name",
    postPath: "/queues",
    resourceType: "queue",
    verify(resourceValue) {
      const retention = resourceValue.settings?.message_retention_period;
      if (retention !== FOUR_DAYS_IN_SECONDS) {
        throw new Error(
          `expected 4-day retention (${FOUR_DAYS_IN_SECONDS}s), received ${String(retention)}`
        );
      }
    },
  });
}

function aiGateway(name, component) {
  return resource({
    component,
    createBody: {
      authentication: true,
      cache_invalidate_on_update: true,
      cache_ttl: 0,
      collect_logs: true,
      id: name,
      rate_limiting_interval: 0,
      rate_limiting_limit: 0,
    },
    dataClass: "confidential",
    idField: "id",
    kind: "AI Gateway",
    listPath: "/ai-gateway/gateways?per_page=100",
    name,
    nameField: "id",
    postPath: "/ai-gateway/gateways",
    resourceType: "ai_gateway",
  });
}

function resource(input) {
  const environment = input.environment ?? "production";
  return {
    ...input,
    environment,
    tags: {
      component: input.component,
      "data-class": input.dataClass,
      environment,
      "managed-by": "openmeld-infra",
      owner: "platform",
      product: "openmeld",
      repository: "openmeld",
    },
  };
}

async function findResource(client, desired) {
  const response = await client.request(desired.listPath);
  const values = desired.listResultField
    ? response.result?.[desired.listResultField]
    : response.result;
  if (!Array.isArray(values)) {
    throw new Error(`${desired.kind} list returned an unexpected response.`);
  }
  const match = values.find(
    (candidate) => candidate?.[desired.nameField] === desired.name
  );
  return match ? normalizeResource(match, desired) : undefined;
}

async function createResource(client, desired) {
  const response = await client.request(desired.postPath, {
    body: desired.createBody,
    method: "POST",
  });
  return normalizeResource(response.result, desired);
}

function normalizeResource(value, desired) {
  const id = value?.[desired.idField];
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`${desired.kind} ${desired.name} has no stable ID.`);
  }
  return { id, value };
}

async function reconcileTags(client, desired, resourceId) {
  let currentTags = {};
  try {
    const current = await client.request(
      `/tags?resource_type=${encodeURIComponent(desired.resourceType)}&resource_id=${encodeURIComponent(resourceId)}`
    );
    currentTags = current.result?.tags ?? {};
  } catch (error) {
    if (!(error instanceof CloudflareApiError && error.status === 500)) {
      throw error;
    }
  }
  const tags = mergeTags(currentTags, desired.tags);
  await client.request("/tags", {
    body: {
      resource_id: resourceId,
      resource_type: desired.resourceType,
      tags,
    },
    method: "PUT",
  });
  const verified = await client.request(
    `/tags?resource_type=${encodeURIComponent(desired.resourceType)}&resource_id=${encodeURIComponent(resourceId)}`
  );
  const actual = verified.result?.tags ?? {};
  for (const [key, value] of Object.entries(desired.tags)) {
    if (actual[key] !== value) {
      throw new Error(`tag verification failed for ${key}`);
    }
  }
  return "verified";
}

async function verifyCreatedResources(client, summary) {
  for (const item of summary.resources) {
    if (!item.id) {
      continue;
    }
    const desired = OPENMELD_RESOURCES.find(
      (candidate) =>
        candidate.kind === item.kind && candidate.name === item.name
    );
    const current = await findResource(client, desired);
    if (!current || current.id !== item.id) {
      item.action = "verification-failed";
      item.error = "resource ID did not round-trip through the list API";
      summary.ok = false;
      continue;
    }
    try {
      desired.verify?.(current.value);
      item.idVerified = true;
    } catch (error) {
      item.action = "verification-failed";
      item.error = formatError(error);
      summary.ok = false;
    }
  }
}

function createCloudflareClient({ accountId, apiToken, fetchImpl = fetch }) {
  return {
    async request(path, options = {}) {
      let lastError;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetchImpl(
            `${API_BASE}/accounts/${accountId}${path}`,
            {
              body: options.body ? JSON.stringify(options.body) : undefined,
              headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
              },
              method: options.method ?? "GET",
            }
          );
          const payload = await response.json().catch(() => undefined);
          if (!(response.ok && payload?.success !== false)) {
            throw new CloudflareApiError(response.status, payload);
          }
          return payload;
        } catch (error) {
          lastError = error;
          if (!isRetryable(error) || attempt === MAX_ATTEMPTS) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, attempt * 250));
        }
      }
      throw lastError;
    },
  };
}

class CloudflareApiError extends Error {
  constructor(status, payload) {
    const details = (payload?.errors ?? [])
      .map(
        (error) =>
          `${error.code ?? "unknown"}: ${error.message ?? "request failed"}`
      )
      .join("; ");
    super(`Cloudflare API ${status}${details ? ` (${details})` : ""}`);
    this.name = "CloudflareApiError";
    this.status = status;
  }
}

function isRetryable(error) {
  return (
    !(error instanceof CloudflareApiError) ||
    error.status === 429 ||
    error.status >= 500
  );
}

function toSummary(desired, action) {
  return { action, kind: desired.kind, name: desired.name };
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function runCli(rawArgs) {
  const parsed = parseArgs(rawArgs);
  if (parsed.help) {
    console.log(`Usage: node scripts/cloudflare/provision-openmeld-resources.mjs [--apply] [--output PATH]

Default mode is read-only and reports whether each exact resource exists.
--apply creates missing resources, reconciles tags, and verifies IDs by listing again.
Credentials must be supplied via CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.`);
    return;
  }
  const summary = await provisionOpenMeldResources(parsed);
  for (const item of summary.resources) {
    const tagSuffix = item.tagStatus ? `, tags=${item.tagStatus}` : "";
    console.log(`${item.kind}: ${item.name} (${item.action}${tagSuffix})`);
  }
  for (const warning of summary.tagWarnings) {
    console.warn(`Tag warning: ${warning}`);
  }
  if (parsed.outputPath) {
    console.log(`Machine-readable result written to ${parsed.outputPath}.`);
  }
  if (!summary.ok) {
    process.exitCode = 1;
  }
}
