import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const BODY = /<body[\s>]/iu;
const SCRIPT = /<script[\s>]/iu;
const SOURCE_SHA = /^[a-f0-9]{40}$/u;
const SSR_ROUTES = ["/login", "/forgot-password", "/check-email"];
const DOCS_SSR_ROUTES = ["/", "/docs"];
const WEBSITE_SSR_ROUTES = ["/", "/privacy", "/terms", "/guides/local-agents"];
const BUILD_META =
  /<meta\s+[^>]*name="(openmeld-[a-z-]+)"[^>]*content="([^"]*)"[^>]*>/gu;

export function validateSsrPage({
  status,
  contentType,
  html,
  sourceSha,
  expectedBuildId,
  allowDirty = false,
}) {
  if (
    status !== 200 ||
    !contentType?.includes("text/html") ||
    !BODY.test(html) ||
    !SCRIPT.test(html)
  ) {
    throw new Error(
      `Web SSR page failed (HTTP ${status}); a static asset is not SSR health.`
    );
  }
  const metadata = new Map(
    [...html.matchAll(BUILD_META)].map((match) => [match[1], match[2]])
  );
  if (
    metadata.get("openmeld-source-sha") !== sourceSha ||
    !metadata.get("openmeld-build-id")
  ) {
    throw new Error(
      "Web SSR deployment source does not match the requested release."
    );
  }
  if (
    expectedBuildId &&
    metadata.get("openmeld-build-id") !== expectedBuildId
  ) {
    throw new Error(
      "Web SSR build identity does not match the verified artifact."
    );
  }
  if (!allowDirty && metadata.get("openmeld-build-dirty") !== "false") {
    throw new Error("Web SSR was built from an unverified dirty source.");
  }
  return { sourceSha, buildId: metadata.get("openmeld-build-id"), status };
}

export async function checkProductionWeb({
  scope = "web",
  url,
  sourceSha,
  expectedBuildId,
  allowDirty = false,
  fetchImpl = fetch,
}) {
  if (!SOURCE_SHA.test(sourceSha)) {
    throw new Error("An exact Web source SHA is required.");
  }
  if (!["web", "website", "docs"].includes(scope)) {
    throw new Error("Unknown renderer health scope.");
  }
  if (scope === "web") {
    const response = await fetchImpl(new URL("/", url), {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      headers: { accept: "text/html", "cache-control": "no-cache" },
    });
    const location = response.headers.get("location");
    if (
      !([302, 303, 307].includes(response.status) && location) ||
      new URL(location, url).href !== new URL("/login", url).href
    ) {
      throw new Error(
        "Anonymous App root must redirect to its own login page."
      );
    }
    await response.body?.cancel();
  }
  let rootPage;
  const routes = {
    web: SSR_ROUTES,
    website: WEBSITE_SSR_ROUTES,
    docs: DOCS_SSR_ROUTES,
  }[scope];
  for (const route of routes) {
    const target = new URL(route, url);
    target.searchParams.set("release-health", sourceSha);
    const response = await fetchImpl(target, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { accept: "text/html", "cache-control": "no-cache" },
    });
    const html = await response.text();
    if (html.includes("Server function info not found")) {
      throw new Error(`Web SSR ${route} has an unresolved server function.`);
    }
    const page = validateSsrPage({
      status: response.status,
      contentType: response.headers.get("content-type"),
      html,
      sourceSha,
      expectedBuildId,
      allowDirty,
    });
    if (!rootPage) {
      rootPage = page;
    }
  }
  return rootPage;
}

export async function waitForProductionWeb({
  sleepImpl = sleep,
  now = () => performance.now(),
  maxWaitMs = 60_000,
  retryDelayMs = 3000,
  ...healthOptions
}) {
  if (!SOURCE_SHA.test(healthOptions.sourceSha)) {
    throw new Error("An exact Web source SHA is required.");
  }
  new URL("/", healthOptions.url);
  const startedAt = now();
  for (;;) {
    try {
      return await checkProductionWeb(healthOptions);
    } catch (cause) {
      const remainingMs = maxWaitMs - (now() - startedAt);
      if (remainingMs <= 0) {
        throw new Error(
          `Web SSR health did not match the verified release within ${maxWaitMs}ms: ${cause.message}`,
          { cause }
        );
      }
      await sleepImpl(Math.min(retryDelayMs, remainingMs));
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      scope: { type: "string", default: "web" },
      "source-sha": { type: "string" },
      "artifact-receipt": { type: "string" },
    },
  });
  let expectedBuildId;
  if (values["artifact-receipt"]) {
    const receipt = JSON.parse(
      await readFile(values["artifact-receipt"], "utf8")
    );
    if (
      receipt.scope !== values.scope ||
      receipt.sourceSha !== values["source-sha"] ||
      receipt.allowDirty !== false ||
      !receipt.ssr?.buildId
    ) {
      throw new Error(
        "Web health requires the verified clean artifact receipt for this source."
      );
    }
    expectedBuildId = receipt.ssr.buildId;
  }
  console.log(
    JSON.stringify(
      await waitForProductionWeb({
        scope: values.scope,
        url: values.url,
        sourceSha: values["source-sha"],
        expectedBuildId,
      })
    )
  );
}
