#!/usr/bin/env node

import { fileURLToPath } from "node:url";

const API_BASE = "https://api.cloudflare.com/client/v4";
const BOOTSTRAP_MODULE_NAME = "openmeld-bootstrap.mjs";
const BOOTSTRAP_COMPATIBILITY_DATE = "2026-02-03";

export const OPENMELD_BOOTSTRAP_WORKERS = [
  "openmeld-core-prod",
  "openmeld-auth-prod",
  "openmeld-remote-agent-prod",
  "openmeld-gateway-prod",
  "openmeld-web-prod",
];
export const OPENMELD_STAGING_BOOTSTRAP_WORKERS = [
  "openmeld-core-stg",
  "openmeld-auth-stg",
  "openmeld-remote-agent-stg",
  "openmeld-gateway-stg",
  "openmeld-web-stg",
];

export const OPENMELD_BOOTSTRAP_SOURCE = `export default {
  async fetch() {
    return new Response("OpenMeld provisioning in progress.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export async function bootstrapOpenMeldWorkerIdentities(input) {
  const client = input.client ?? createCloudflareClient(input);
  const workerNames =
    input.environment === "staging"
      ? OPENMELD_STAGING_BOOTSTRAP_WORKERS
      : OPENMELD_BOOTSTRAP_WORKERS;
  const before = new Set(await client.listWorkerNames());
  const resources = [];

  for (const name of workerNames) {
    if (before.has(name)) {
      resources.push({ action: "existing", name });
      continue;
    }
    if (!input.apply) {
      resources.push({ action: "missing", name });
      continue;
    }
    await client.uploadBootstrapWorker(name);
    resources.push({ action: "created", name });
  }

  const after = input.apply ? new Set(await client.listWorkerNames()) : before;
  for (const resource of resources) {
    resource.verified = after.has(resource.name);
  }
  return {
    mode: input.apply ? "apply" : "plan",
    ok: resources.every((resource) => resource.verified),
    resources,
  };
}

export function parseArgs(rawArgs, env = process.env) {
  const parsed = {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    apply: false,
    environment: "production",
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }
    if (arg === "--environment") {
      const value = rawArgs[index + 1];
      if (value !== "production" && value !== "staging") {
        throw new Error("--environment must be production or staging.");
      }
      parsed.environment = value;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!(parsed.accountId && parsed.apiToken)) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required."
    );
  }
  return parsed;
}

function createCloudflareClient({ accountId, apiToken, fetchImpl = fetch }) {
  const request = async (path, options = {}) => {
    const response = await fetchImpl(
      `${API_BASE}/accounts/${accountId}${path}`,
      {
        body: options.body,
        headers: {
          Authorization: `Bearer ${apiToken}`,
          ...(options.headers ?? {}),
        },
        method: options.method ?? "GET",
      }
    );
    const payload = await response.json().catch(() => undefined);
    if (!(response.ok && payload?.success !== false)) {
      const detail = (payload?.errors ?? [])
        .map(
          (error) =>
            `${error.code ?? "unknown"}: ${error.message ?? "request failed"}`
        )
        .join("; ");
      throw new Error(
        `Cloudflare API ${String(response.status)}${detail ? ` (${detail})` : ""}`
      );
    }
    return payload;
  };

  return {
    async listWorkerNames() {
      const payload = await request("/workers/scripts");
      if (!Array.isArray(payload.result)) {
        throw new Error(
          "Cloudflare Workers list returned an unexpected response."
        );
      }
      return payload.result
        .map((worker) => worker?.id)
        .filter((name) => typeof name === "string" && name.length > 0);
    },
    async uploadBootstrapWorker(name) {
      const form = new FormData();
      form.append(
        "metadata",
        new Blob(
          [
            JSON.stringify({
              bindings: [],
              compatibility_date: BOOTSTRAP_COMPATIBILITY_DATE,
              main_module: BOOTSTRAP_MODULE_NAME,
            }),
          ],
          { type: "application/json" }
        )
      );
      form.append(
        BOOTSTRAP_MODULE_NAME,
        new Blob([OPENMELD_BOOTSTRAP_SOURCE], {
          type: "application/javascript+module",
        }),
        BOOTSTRAP_MODULE_NAME
      );
      await request(`/workers/scripts/${encodeURIComponent(name)}`, {
        body: form,
        method: "PUT",
      });
    },
  };
}

async function runCli(rawArgs) {
  const parsed = parseArgs(rawArgs);
  if (parsed.help) {
    console.log(`Usage: node scripts/cloudflare/bootstrap-openmeld-worker-identities.mjs [--environment production|staging] [--apply]

Default mode is read-only. --apply creates only the five missing, route-free,
fail-closed Worker identities for the selected environment. They break
OpenMeld's first-deploy Service Binding cycle before routes become public.
Existing Workers are never overwritten.`);
    return;
  }
  const summary = await bootstrapOpenMeldWorkerIdentities(parsed);
  for (const resource of summary.resources) {
    console.log(
      `Worker: ${resource.name} (${resource.action}, verified=${String(resource.verified)})`
    );
  }
  if (!summary.ok) {
    process.exitCode = 1;
  }
}
