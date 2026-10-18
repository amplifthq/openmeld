// Reads which source each production component runs from the platform itself.
// Workers carry RELEASE_SHA as a Worker variable; renderers render it as
// <meta name="openmeld-source-sha">; npm records gitHead. No repository-side
// record of "what is deployed" exists.

import { execFileSync } from "node:child_process";

const FULL_SHA = /^[0-9a-f]{40}$/u;
const SOURCE_META =
  /<meta\s+[^>]*name="openmeld-source-sha"[^>]*content="([0-9a-f]{40})"/u;
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

const exact = (value) => (FULL_SHA.test(value ?? "") ? value : null);

export async function readWorkerHealthSha(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  const body = await response.json();
  if (body.ok !== true) {
    throw new Error(`${url} did not report ok: true`);
  }
  return exact(body.releaseSha);
}

export async function readRendererSha(url, fetchImpl = fetch) {
  const target = new URL(url.endsWith("app.openmeld.ai") ? "/login" : "/", url);
  const response = await fetchImpl(target, {
    headers: { accept: "text/html", "cache-control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${target} returned HTTP ${response.status}`);
  }
  return exact(SOURCE_META.exec(await response.text())?.[1]);
}

// The active deployment's version holds RELEASE_SHA as a plain-text binding.
// A split (gradual) deployment has no single source and reads as unknown.
export async function readWorkerVersionSha(
  script,
  env = process.env,
  fetchImpl = fetch
) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token =
    env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN;
  if (!(accountId && token)) {
    return null;
  }
  const get = async (path) => {
    const response = await fetchImpl(
      `${CLOUDFLARE_API}/accounts/${accountId}/workers/scripts/${script}${path}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      }
    );
    const body = await response.json();
    if (!(response.ok && body.success)) {
      throw new Error(
        `Cloudflare ${script}${path} returned HTTP ${response.status}`
      );
    }
    return body.result;
  };
  const [latest] = (await get("/deployments")).deployments ?? [];
  const versions = latest?.versions ?? [];
  if (versions.length !== 1 || versions[0].percentage !== 100) {
    return null;
  }
  const version = await get(`/versions/${versions[0].version_id}`);
  const binding = version.resources?.bindings?.find(
    (entry) => entry.type === "plain_text" && entry.name === "RELEASE_SHA"
  );
  return exact(binding?.text);
}

export function readNpmGitHead(version, run = execFileSync) {
  const spec = version ? `openmeld@${version}` : "openmeld";
  try {
    return exact(
      run("npm", ["view", spec, "gitHead"], { encoding: "utf8" }).trim()
    );
  } catch {
    return null;
  }
}

export function readLiveReleaseSha(component, components, options = {}) {
  if (component.releaseShaFrom) {
    const owner = components.find(
      (entry) => entry.name === component.releaseShaFrom
    );
    return readLiveReleaseSha(owner, components, options);
  }
  const { health } = component;
  const fetchImpl = options.fetch ?? fetch;
  if (health.kind === "worker-health") {
    return readWorkerHealthSha(health.url, fetchImpl);
  }
  if (health.kind === "renderer") {
    return readRendererSha(health.url, fetchImpl);
  }
  if (health.kind === "worker-version") {
    return readWorkerVersionSha(health.script, options.env, fetchImpl);
  }
  if (health.kind === "cli") {
    return Promise.resolve((options.readNpmGitHead ?? readNpmGitHead)());
  }
  return Promise.resolve(null);
}
