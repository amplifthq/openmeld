import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { websiteDomainMigrationSchema } from "../../packages/schemas/src/schemas/release/website-domain-migration.ts";
import { bootstrapOpenMeldWorkerIdentities } from "../cloudflare/bootstrap-openmeld-worker-identities.mjs";

export function websiteDomainNames(environment = "prod") {
  if (!["prod", "stg"].includes(environment)) {
    throw new Error("Website domains require the prod or stg environment.");
  }
  const root = environment === "prod" ? "openmeld.ai" : "staging.openmeld.ai";
  return {
    root,
    app: `app.${root}`,
    web: `openmeld-web-${environment}`,
    auth: `openmeld-auth-${environment}`,
    website: `openmeld-website-${environment}`,
  };
}

export function websiteDomainClient(env = process.env, fetchImpl = fetch) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!(accountId && token)) {
    throw new Error(
      "Website domain admission requires Cloudflare account access."
    );
  }
  return {
    accountId,
    async request(path, method = "GET", body = null) {
      const response = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(30_000),
        }
      );
      const payload = await response.json();
      if (!response.ok || payload.success !== true) {
        const error = new Error(
          `Cloudflare domain operation failed (${response.status}): ${payload.errors?.map((entry) => entry.code).join(", ") ?? "invalid response"}`
        );
        error.status = response.status;
        throw error;
      }
      return payload.result;
    },
  };
}

async function currentDeployment(client, name, optional = false) {
  let result;
  try {
    result = await client.request(`/workers/scripts/${name}/deployments`);
  } catch (error) {
    if (optional && error.status === 404) {
      return null;
    }
    throw error;
  }
  const deployment = result.deployments?.[0];
  if (
    !deployment ||
    deployment.versions?.length !== 1 ||
    deployment.versions[0].percentage !== 100
  ) {
    throw new Error(`${name} must have one current deployment at 100%.`);
  }
  return { id: deployment.id, versionId: deployment.versions[0].version_id };
}

export async function readWebsiteDomainState(client, names) {
  const [domains, web, auth, website, authSettings] = await Promise.all([
    client.request("/workers/domains"),
    currentDeployment(client, names.web),
    currentDeployment(client, names.auth),
    currentDeployment(client, names.website, true),
    client.request(`/workers/scripts/${names.auth}/settings`),
  ]);
  const domain = (hostname) => {
    const match = domains.find((entry) => entry.hostname === hostname);
    if (!match) {
      return null;
    }
    const { id, service, environment, zone_id } = match;
    return { id, hostname, service, environment, zone_id };
  };
  const root = domain(names.root);
  const app = domain(names.app);
  if (
    !root ||
    root.environment !== "production" ||
    ![names.web, names.website].includes(root.service) ||
    (app &&
      (app.environment !== "production" ||
        app.service !== names.web ||
        app.zone_id !== root.zone_id))
  ) {
    throw new Error(
      "Unexpected website/App domain owner; inspect live bindings before continuing."
    );
  }
  return {
    root,
    app,
    web,
    auth,
    website,
    authOrigins: authSettings.bindings
      .filter((entry) =>
        ["WEB_APP_URL", "AUTH_LEGACY_APP_ORIGIN"].includes(entry.name)
      )
      .map((entry) => entry.text),
  };
}

export function assertAppOriginSmoke(state, evidence, names) {
  const smoke = evidence?.appSmoke;
  if (
    !state.app ||
    state.app.service !== names.web ||
    !state.authOrigins.includes(`https://${names.root}`) ||
    !state.authOrigins.includes(`https://${names.app}`) ||
    smoke?.webVersionId !== state.web.versionId ||
    smoke?.authVersionId !== state.auth.versionId
  ) {
    throw new Error(
      "Root cutover requires real App login/session/Space/sign-out evidence for the currently deployed Web and Auth versions, with both exact Auth origins admitted."
    );
  }
}

async function loadEvidence(input, client) {
  if (!input.evidencePath) {
    return null;
  }
  const evidence = websiteDomainMigrationSchema.parse(
    JSON.parse(await readFile(input.evidencePath, "utf8"))
  );
  if (
    evidence.accountId !== client.accountId ||
    evidence.sourceSha !== input.sourceSha ||
    evidence.environment !== (input.environment ?? "prod")
  ) {
    throw new Error(
      "Domain evidence does not match this account, source, and environment."
    );
  }
  return evidence;
}

async function saveEvidence(filename, evidence, options) {
  await writeFile(
    filename,
    `${JSON.stringify(websiteDomainMigrationSchema.parse(evidence), null, 2)}\n`,
    options
  );
}

// Called inside the existing guarded release entrypoint and its component leases.
// This module deliberately has no standalone mutation CLI.
export async function prepareWebsiteDomains(input) {
  const client = input.client ?? websiteDomainClient();
  const names = websiteDomainNames(input.environment);
  const state = await readWebsiteDomainState(client, names);
  if (state.root.service !== names.web || !input.evidencePath) {
    throw new Error(
      "Domain preparation requires the existing Web root and --domain-evidence <file>."
    );
  }
  let evidence;
  try {
    evidence = await loadEvidence(input, client);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  if (!evidence) {
    evidence = {
      schemaVersion: 1,
      accountId: client.accountId,
      sourceSha: input.sourceSha,
      environment: input.environment ?? "prod",
      before: state,
      lastObserved: state,
      appSmoke: null,
    };
    await saveEvidence(input.evidencePath, evidence, { flag: "wx" });
  }
  if (!state.app) {
    await client.request("/workers/domains", "PUT", {
      hostname: names.app,
      service: names.web,
      zone_id: state.root.zone_id,
    });
  }
  if (!state.website) {
    // A route-free identity lets ordinary release receipts record a baseline
    // and staging resource checks run before the first Website publication.
    const result = await bootstrapOpenMeldWorkerIdentities({
      accountId: client.accountId,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      apply: true,
      environment: input.environment === "stg" ? "staging" : "production",
      workerNames: [names.website],
    });
    if (!result.ok) {
      throw new Error("Website Worker identity preparation is unconfirmed.");
    }
  }
  const after = await readWebsiteDomainState(client, names);
  if (
    !after.app ||
    after.root.service !== names.web ||
    after.web.versionId !== state.web.versionId
  ) {
    throw new Error(
      "App alias preparation did not preserve the current Web deployment and root owner."
    );
  }
  await saveEvidence(input.evidencePath, { ...evidence, lastObserved: after });
  return after;
}

export async function admitWebsiteDomainRelease(input) {
  if (
    !input.scopes.some((scope) =>
      ["auth", "web", "website", "core", "gateway"].includes(scope)
    )
  ) {
    return null;
  }
  const client = input.client ?? websiteDomainClient();
  const names = websiteDomainNames(input.environment);
  const state = await readWebsiteDomainState(client, names);
  const evidence = await loadEvidence(input, client);
  // Internal staging can replace the full stack in one maintenance window.
  // Ownership is still checked above, and deployment read-back verifies both hosts.
  if (
    input.environment === "stg" &&
    ["auth", "core", "gateway", "web", "website"].every((scope) =>
      input.scopes.includes(scope)
    )
  ) {
    return { client, names, state, evidence };
  }
  if (!state.app) {
    throw new Error(
      "Prepare and verify the App hostname before publishing App-origin configuration."
    );
  }
  if (state.root.service === names.web) {
    if (
      input.scopes.some((scope) => ["web", "core", "gateway"].includes(scope))
    ) {
      throw new Error(
        "Publish and verify Website root cutover before Web, Core, or Gateway. Run migration stages separately."
      );
    }
    if (input.scopes.includes("website")) {
      assertAppOriginSmoke(state, evidence, names);
    }
  }
  return { client, names, state, evidence };
}

export async function recordWebsiteDomainRelease(input, admission) {
  if (!admission) {
    return;
  }
  const { client, names, evidence } = admission;
  const state = await readWebsiteDomainState(client, names);
  // Keep the observed deployment even when a later endpoint check fails, so
  // rollback can recognize this attempt instead of rejecting it as unrelated.
  if (evidence) {
    await saveEvidence(input.evidencePath, {
      ...evidence,
      lastObserved: state,
    });
  }
  if (
    !state.app ||
    (input.scopes.includes("website") && state.root.service !== names.website)
  ) {
    throw new Error(
      "Deployment completed without the expected website/App domain bindings."
    );
  }
  if (input.scopes.includes("website")) {
    await checkWebsiteDomainEndpoints(names, input.fetchImpl);
  }
  return state;
}

export async function executeObservedDomainRelease(input, admission, execute) {
  let deploymentError;
  try {
    await execute();
  } catch (error) {
    deploymentError = error;
  }
  try {
    await recordWebsiteDomainRelease(input, admission);
  } catch (error) {
    if (deploymentError) {
      throw new AggregateError(
        [deploymentError, error],
        `${deploymentError.message}; domain read-back: ${error.message}`
      );
    }
    throw error;
  }
  if (deploymentError) {
    throw deploymentError;
  }
}

export async function checkWebsiteDomainEndpoints(names, fetchImpl = fetch) {
  for (const url of [
    `https://${names.app}/login`,
    `https://${names.root}/guide.md`,
  ]) {
    const response = await fetchImpl(url, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status !== 200) {
      throw new Error(`Domain endpoint failed: ${url} (${response.status}).`);
    }
    await response.body?.cancel();
  }
  // PostHog identifies the production OAuth client by this exact public URL.
  // Its metadata fetch does not follow redirects. Check after cutover and rollback.
  if (names.root === "openmeld.ai") {
    const url = `https://${names.root}/.well-known/posthog-client.json`;
    const response = await fetchImpl(url, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (
      response.status !== 200 ||
      !response.headers.get("content-type")?.includes("application/json")
    ) {
      throw new Error(
        "PostHog OAuth client metadata must remain a direct JSON response at the root domain."
      );
    }
    const metadata = await response.json();
    if (
      metadata.client_id !== url ||
      !metadata.redirect_uris?.includes(
        "https://connectors.openmeld.ai/oauth/callback"
      )
    ) {
      throw new Error(
        "PostHog OAuth client identity or callback changed during domain migration."
      );
    }
  }
}

async function restoreWebDomainTriggers(client, names, state) {
  const domains = await client.request("/workers/domains");
  if (
    domains.some(
      (entry) =>
        entry.service === names.web &&
        ![names.root, names.app].includes(entry.hostname)
    )
  ) {
    throw new Error(
      "Web has an unexpected additional domain; inspect before restoring its triggers."
    );
  }
  await mkdir("dev-tmp", { recursive: true });
  const directory = await mkdtemp(
    path.resolve("dev-tmp/website-domain-rollback-")
  );
  try {
    const config = path.join(directory, "wrangler.json");
    await writeFile(
      config,
      JSON.stringify({
        name: names.web,
        workers_dev: false,
        previews_enabled: false,
        routes: [names.root, names.app].map((hostname) => ({
          pattern: hostname,
          custom_domain: true,
          zone_id: state.root.zone_id,
        })),
      })
    );
    // Public Wrangler command owns domain takeover. Plain Domains PUT returns
    // 409 for an existing owner; never emulate Wrangler's private API here.
    execFileSync(
      "pnpm",
      ["exec", "wrangler", "triggers", "deploy", "--config", config],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function rollbackWebsiteDomains(input) {
  const client = input.client ?? websiteDomainClient();
  const names = websiteDomainNames(input.environment);
  const evidence = await loadEvidence(input, client);
  if (!evidence) {
    throw new Error("Domain rollback requires the migration evidence file.");
  }
  const state = await readWebsiteDomainState(client, names);
  const before = evidence.before;
  if (
    before.root.service !== names.web ||
    before.root.hostname !== names.root ||
    before.root.zone_id !== state.root.zone_id ||
    !state.app ||
    !state.authOrigins.includes(`https://${names.root}`) ||
    !state.authOrigins.includes(`https://${names.app}`) ||
    ![evidence.lastObserved.web.versionId, before.web.versionId].includes(
      state.web.versionId
    )
  ) {
    throw new Error(
      "Rollback state differs from the recorded migration; retain both exact Auth origins and inspect intervening deployments."
    );
  }
  if (state.web.versionId !== before.web.versionId) {
    await client.request(`/workers/scripts/${names.web}/deployments`, "POST", {
      strategy: "percentage",
      versions: [{ version_id: before.web.versionId, percentage: 100 }],
    });
  }
  const restored = await readWebsiteDomainState(client, names);
  if (restored.web.versionId !== before.web.versionId) {
    throw new Error(
      "Previous Web version was not restored; root ownership is unchanged."
    );
  }
  if (restored.root.service !== names.web) {
    await (input.restoreDomainTriggers ?? restoreWebDomainTriggers)(
      client,
      names,
      restored
    );
  }
  const after = await readWebsiteDomainState(client, names);
  if (after.root.service !== names.web) {
    throw new Error("Root ownership rollback is unconfirmed.");
  }
  await saveEvidence(input.evidencePath, { ...evidence, lastObserved: after });
  await checkWebsiteDomainEndpoints(names, input.fetchImpl);
  return after;
}
