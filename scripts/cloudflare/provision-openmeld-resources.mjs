#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const API_BASE = "https://api.cloudflare.com/client/v4";
const FOUR_DAYS_IN_SECONDS = 4 * 24 * 60 * 60;
const MAX_ATTEMPTS = 3;
const OPENMELD_ZONE_ID = "722d0107341d0b03c5bb6294c2dc97ec";

export const OPENMELD_RESOURCES = [
  zone("openmeld.ai"),
  dnsRecord("openmeld.ai", "web"),
  dnsRecord("auth.openmeld.ai", "auth"),
  dnsRecord("gateway.openmeld.ai", "gateway"),
  dnsRecord("connectors.openmeld.ai", "open-connector"),
  worker("openmeld-web-prod", "web"),
  worker("openmeld-auth-prod", "auth"),
  worker("openmeld-core-prod", "core"),
  worker("openmeld-gateway-prod", "gateway"),
  worker("openmeld-remote-agent-prod", "remote-agent"),
  worker("openmeld-open-connector-prod", "open-connector"),
  durableObject("openmeld-core-prod_RuntimeTransportHub", "core", "ephemeral"),
  durableObject("openmeld-core-prod_Space", "core", "confidential"),
  durableObject("openmeld-core-prod_PrepareSessionHub", "core", "confidential"),
  durableObject(
    "openmeld-remote-agent-prod_FlueCenterAgentAgent",
    "remote-agent",
    "confidential"
  ),
  durableObject(
    "openmeld-remote-agent-prod_AgentComputer",
    "remote-agent",
    "private"
  ),
  durableObject(
    "openmeld-remote-agent-prod_FlueRegistry",
    "remote-agent",
    "private"
  ),
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

export const OPENMELD_STAGING_RESOURCES = [
  dnsRecord("staging.openmeld.ai", "web", "staging"),
  dnsRecord("auth.staging.openmeld.ai", "auth", "staging"),
  dnsRecord("gateway.staging.openmeld.ai", "gateway", "staging"),
  worker("openmeld-web-stg", "web", "staging"),
  worker("openmeld-auth-stg", "auth", "staging"),
  worker("openmeld-core-stg", "core", "staging"),
  worker("openmeld-gateway-stg", "gateway", "staging"),
  worker("openmeld-remote-agent-stg", "remote-agent", "staging"),
  durableObject(
    "openmeld-core-stg_RuntimeTransportHub",
    "core",
    "ephemeral",
    "staging"
  ),
  durableObject("openmeld-core-stg_Space", "core", "confidential", "staging"),
  durableObject(
    "openmeld-core-stg_PrepareSessionHub",
    "core",
    "confidential",
    "staging"
  ),
  durableObject(
    "openmeld-remote-agent-stg_FlueCenterAgentAgent",
    "remote-agent",
    "confidential",
    "staging"
  ),
  durableObject(
    "openmeld-remote-agent-stg_AgentComputer",
    "remote-agent",
    "private",
    "staging"
  ),
  durableObject(
    "openmeld-remote-agent-stg_FlueRegistry",
    "remote-agent",
    "private",
    "staging"
  ),
  d1("openmeld-db-stg", "shared", "staging"),
  kv("openmeld-auth-kv-stg", "auth", "staging"),
  r2("openmeld-space-attachments-stg", "shared", "confidential", "staging"),
  r2("openmeld-organization-skills-stg", "shared", "private", "staging"),
  r2("openmeld-organization-logos-stg", "shared", "public", "staging"),
  r2("openmeld-desktop-downloads-stg", "web", "public", "staging"),
  queue("openmeld-daemon-dispatch-stg", "shared", "staging"),
  queue("openmeld-message-channel-events-stg", "shared", "staging"),
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}

export async function provisionOpenMeldResources(input) {
  const client = input.client ?? createCloudflareClient(input);
  const desiredResources = resolveDesiredResources(input.environment);
  const requireDeploymentManaged = input.requireDeploymentManaged ?? true;
  const summary = {
    environment: input.environment ?? "production",
    mode: input.apply ? "apply" : "plan",
    ok: true,
    resources: [],
    tagWarnings: [],
  };

  for (const desired of desiredResources) {
    const result = await reconcileDesiredResource({
      apply: input.apply,
      client,
      desired,
      requireDeploymentManaged,
    });
    summary.resources.push(result.resource);
    if (!result.ok) {
      summary.ok = false;
    }
    if (result.tagWarning) {
      summary.tagWarnings.push(result.tagWarning);
    }
  }

  if (input.apply) {
    await verifyCreatedResources(client, summary, desiredResources);
    await reconcileActiveWorkerVersionTags(client, summary, desiredResources);
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
    environment: "production",
    requireDeploymentManaged: true,
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    switch (arg) {
      case "--allow-pending-deploy":
        result.requireDeploymentManaged = false;
        break;
      case "--apply":
        result.apply = true;
        break;
      case "--environment":
        result.environment = parseEnvironment(rawArgs[index + 1]);
        index += 1;
        break;
      case "--help":
      case "-h":
        return { help: true };
      case "--output":
        result.outputPath = parseOutputPath(rawArgs[index + 1]);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!(result.accountId && result.apiToken)) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required."
    );
  }
  return result;
}

async function reconcileDesiredResource(input) {
  try {
    const existing = await findResource(input.client, input.desired);
    const mayCreate =
      input.apply && input.desired.lifecycle !== "deployment-managed";
    if (!(existing || mayCreate)) {
      return summarizeMissingResource(input);
    }

    const resource =
      existing ?? (await createResource(input.client, input.desired));
    const tagResult = await reconcileResourceTags({
      ...input,
      resourceId: resource.id,
    });
    return {
      ok: tagResult.ok,
      resource: {
        ...toSummary(input.desired, existing ? "existing" : "created"),
        id: resource.id,
        tagStatus: tagResult.status,
      },
      tagWarning: tagResult.warning,
    };
  } catch (error) {
    return {
      ok: false,
      resource: {
        ...toSummary(input.desired, "blocked"),
        error: formatError(error),
      },
    };
  }
}

function summarizeMissingResource(input) {
  const awaitingDeployment =
    input.desired.lifecycle === "deployment-managed" &&
    !input.requireDeploymentManaged;
  return {
    ok: awaitingDeployment,
    resource: toSummary(
      input.desired,
      awaitingDeployment ? "awaiting-deploy" : "missing"
    ),
  };
}

async function reconcileResourceTags(input) {
  if (!input.apply) {
    return { ok: true, status: "not-requested" };
  }
  try {
    const status = await reconcileTags(
      input.client,
      input.desired,
      input.resourceId
    );
    return { ok: true, status };
  } catch (error) {
    return {
      ok: false,
      status: "blocked",
      warning: `${input.desired.kind} ${input.desired.name}: ${formatError(error)}`,
    };
  }
}

function parseEnvironment(value) {
  if (value !== "production" && value !== "staging") {
    throw new Error("--environment must be production or staging.");
  }
  return value;
}

function parseOutputPath(value) {
  if (!value || value.startsWith("--")) {
    throw new Error("--output requires a file path.");
  }
  return value;
}

function worker(name, component, environment = "production") {
  return resource({
    component,
    dataClass: "private",
    idField: "id",
    kind: "Worker",
    lifecycle: "deployment-managed",
    listPath: "/workers/scripts",
    name,
    nameField: "id",
    resourceType: "worker",
    environment,
  });
}

function zone(name) {
  return resource({
    apiScope: "global",
    component: "shared",
    dataClass: "public",
    idField: "id",
    kind: "Zone",
    lifecycle: "deployment-managed",
    listPath: `/zones?name=${encodeURIComponent(name)}`,
    matches: (candidate) =>
      candidate?.id === OPENMELD_ZONE_ID &&
      candidate?.name === name &&
      candidate?.status === "active",
    name,
    resourceType: "zone",
    tagPath: `/zones/${OPENMELD_ZONE_ID}/tags`,
  });
}

function dnsRecord(name, component, environment = "production") {
  return resource({
    apiScope: "global",
    component,
    dataClass: "public",
    idField: "id",
    kind: "DNS record",
    lifecycle: "deployment-managed",
    listPath: `/zones/${OPENMELD_ZONE_ID}/dns_records?per_page=100`,
    matches: (candidate) =>
      candidate?.name === name &&
      candidate?.type === "AAAA" &&
      candidate?.content === "100::" &&
      candidate?.proxied === true,
    name,
    resourceType: "dns_record",
    tagPath: `/zones/${OPENMELD_ZONE_ID}/tags`,
    environment,
  });
}

function durableObject(name, component, dataClass, environment = "production") {
  return resource({
    component,
    dataClass,
    idField: "id",
    kind: "Durable Object namespace",
    lifecycle: "deployment-managed",
    listPath: "/workers/durable_objects/namespaces?per_page=100",
    name,
    nameField: "name",
    resourceType: "durable_object_namespace",
    environment,
  });
}

function d1(name, component, environment = "production") {
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
    environment,
  });
}

function kv(name, component, environment = "production") {
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
    environment,
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

function queue(name, component, environment = "production") {
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
    environment,
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

function aiGateway(name, component, environment = "production") {
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
    environment,
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
  const response = await client.request(desired.listPath, {
    apiScope: desired.apiScope,
  });
  const values = desired.listResultField
    ? response.result?.[desired.listResultField]
    : response.result;
  if (!Array.isArray(values)) {
    throw new Error(`${desired.kind} list returned an unexpected response.`);
  }
  const match = values.find((candidate) =>
    desired.matches
      ? desired.matches(candidate)
      : candidate?.[desired.nameField] === desired.name
  );
  return match ? normalizeResource(match, desired) : undefined;
}

async function createResource(client, desired) {
  const response = await client.request(desired.postPath, {
    apiScope: desired.apiScope,
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
  const tagQuery = buildTagQuery(desired, resourceId);
  let currentTags = {};
  try {
    const current = await client.request(tagQuery, {
      apiScope: desired.apiScope,
    });
    currentTags = current.result?.tags ?? {};
  } catch (error) {
    if (!(error instanceof CloudflareApiError && error.status === 500)) {
      throw error;
    }
  }
  const tags = mergeTags(currentTags, desired.tags);
  await client.request(desired.tagPath ?? "/tags", {
    apiScope: desired.apiScope,
    body: {
      ...desired.tagContext,
      resource_id: resourceId,
      resource_type: desired.resourceType,
      tags,
    },
    method: "PUT",
  });
  const verified = await client.request(tagQuery, {
    apiScope: desired.apiScope,
  });
  const actual = verified.result?.tags ?? {};
  for (const [key, value] of Object.entries(desired.tags)) {
    if (actual[key] !== value) {
      throw new Error(`tag verification failed for ${key}`);
    }
  }
  return "verified";
}

function buildTagQuery(desired, resourceId) {
  const query = new URLSearchParams({
    resource_id: resourceId,
    resource_type: desired.resourceType,
    ...desired.tagContext,
  });
  return `${desired.tagPath ?? "/tags"}?${query.toString()}`;
}

async function reconcileActiveWorkerVersionTags(
  client,
  summary,
  desiredResources
) {
  const availableWorkers = new Set(
    summary.resources
      .filter(
        (item) =>
          item.kind === "Worker" && item.id && item.action === "existing"
      )
      .map((item) => item.name)
  );
  const workers = desiredResources.filter(
    (desired) =>
      desired.resourceType === "worker" && availableWorkers.has(desired.name)
  );
  for (const workerResource of workers) {
    try {
      const response = await client.request(
        `/workers/scripts/${encodeURIComponent(workerResource.name)}/deployments`
      );
      const deployments = response.result?.deployments;
      if (!(Array.isArray(deployments) && deployments.length > 0)) {
        throw new Error("no Worker deployment was found");
      }
      const activeDeployment = deployments.toSorted(
        (left, right) =>
          Date.parse(right.created_on ?? "") - Date.parse(left.created_on ?? "")
      )[0];
      const activeVersions = (activeDeployment.versions ?? []).filter(
        (version) =>
          typeof version.version_id === "string" && version.percentage > 0
      );
      if (activeVersions.length === 0) {
        throw new Error("the active Worker deployment has no serving version");
      }
      for (const activeVersion of activeVersions) {
        const desired = resource({
          component: workerResource.component,
          dataClass: workerResource.dataClass,
          kind: "Worker version",
          name: `${workerResource.name}@${activeVersion.version_id}`,
          resourceType: "worker_version",
          tagContext: { worker_id: workerResource.name },
          environment: workerResource.environment,
        });
        let tagStatus = "verified";
        try {
          tagStatus = await reconcileTags(
            client,
            desired,
            activeVersion.version_id
          );
        } catch (error) {
          tagStatus = "blocked";
          summary.ok = false;
          summary.tagWarnings.push(
            `${desired.kind} ${desired.name}: ${formatError(error)}`
          );
        }
        summary.resources.push({
          ...toSummary(desired, "existing"),
          id: activeVersion.version_id,
          idVerified: tagStatus === "verified",
          tagStatus,
        });
      }
    } catch (error) {
      summary.ok = false;
      summary.resources.push({
        action: "blocked",
        error: formatError(error),
        kind: "Worker version",
        name: `${workerResource.name}@active`,
      });
    }
  }
}

async function verifyCreatedResources(client, summary, desiredResources) {
  for (const item of summary.resources) {
    if (!item.id) {
      continue;
    }
    const desired = desiredResources.find(
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

function resolveDesiredResources(environment = "production") {
  if (environment === "staging") {
    return OPENMELD_STAGING_RESOURCES;
  }
  if (environment === "production") {
    return OPENMELD_RESOURCES;
  }
  throw new Error(`Unsupported OpenMeld environment: ${environment}`);
}

function createCloudflareClient({ accountId, apiToken, fetchImpl = fetch }) {
  return {
    async request(path, options = {}) {
      let lastError;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetchImpl(
            `${cloudflareApiRoot(accountId, options.apiScope)}${path}`,
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

function cloudflareApiRoot(accountId, apiScope) {
  return apiScope === "global" ? API_BASE : `${API_BASE}/accounts/${accountId}`;
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
    console.log(`Usage: node scripts/cloudflare/provision-openmeld-resources.mjs [--environment production|staging] [--apply] [--allow-pending-deploy] [--output PATH]

Default mode is read-only and reports whether each exact resource exists.
--apply creates missing provisioned resources, requires deployment-managed resources
to exist, reconciles tags, and verifies IDs by listing again. Use
--allow-pending-deploy only for the first staging provision before Workers and
Custom Domains exist.
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
