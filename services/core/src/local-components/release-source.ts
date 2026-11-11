import { waitUntil } from "cloudflare:workers";
import {
  cliBinaryManifestSchema,
  localComponentsAvailabilityCatalogSchema,
  localComponentsReleaseManifestSchema,
} from "@openmeld/schemas";
import type {
  LocalComponentsAvailabilityCatalog,
  LocalComponentsReleaseManifest,
} from "@openmeld/schemas/types";

// The CLI publisher (scripts/release/publish-cli.mjs) writes these objects to
// the CLI release bucket after the binaries and npm package are available.
// Core reads them at runtime; no Core deploy is needed for a CLI release.
export const LOCAL_COMPONENTS_RELEASE_OBJECT_KEY = "cli/local-components.json";
export const CLI_STABLE_MANIFEST_OBJECT_KEY = "cli/manifest.json";
export const CLI_WINDOWS_PREVIEW_MANIFEST_OBJECT_KEY =
  "cli/windows-preview/manifest.json";

const RELEASE_CACHE_TTL_MS = 60_000;
const RELEASE_REFRESH_AFTER_MS = 30_000;
const MISSING_RELEASE_RETRY_MS = 10_000;

export type CoreLocalComponentsRelease = {
  manifest: LocalComponentsReleaseManifest | null;
  availabilityCatalog: LocalComponentsAvailabilityCatalog | null;
};

export const UNAVAILABLE_LOCAL_COMPONENTS_RELEASE: CoreLocalComponentsRelease =
  Object.freeze({ manifest: null, availabilityCatalog: null });

type CliReleaseBucket = Pick<R2Bucket, "get">;

let cachedPolicy: {
  manifest: LocalComponentsReleaseManifest;
  expiresAtMs: number;
} | null = null;
let cachedChannels: {
  stableManifest: unknown;
  previewManifest: unknown;
  expiresAtMs: number;
} | null = null;
let policyRefreshAfterMs = 0;
let channelsRefreshAfterMs = 0;
let pendingPolicy: Promise<void> | null = null;
let pendingChannels: Promise<void> | null = null;

// Every consumer, including synchronous heartbeat handling, uses the same
// validity boundary. A failed refresh must never extend a policy's lifetime.
export function getCachedCoreLocalComponentsRelease(
  nowMs = Date.now()
): CoreLocalComponentsRelease {
  if (!cachedPolicy || cachedPolicy.expiresAtMs <= nowMs) {
    return UNAVAILABLE_LOCAL_COMPONENTS_RELEASE;
  }
  return {
    manifest: cachedPolicy.manifest,
    availabilityCatalog:
      cachedChannels && cachedChannels.expiresAtMs > nowMs
        ? buildLocalComponentsAvailabilityCatalog({
            release: cachedPolicy.manifest,
            stableManifest: cachedChannels.stableManifest,
            previewManifest: cachedChannels.previewManifest,
          })
        : null,
  };
}

// Cold/expired reads wait only for required policy. While validated policy is
// still valid, readers never join a refresh; optional channels never gate them.
export function readCoreLocalComponentsRelease(
  bucket: CliReleaseBucket | undefined
): Promise<CoreLocalComponentsRelease> {
  const nowMs = Date.now();
  if (!pendingChannels && channelsRefreshAfterMs <= nowMs) {
    pendingChannels = loadChannels(bucket, nowMs).finally(() => {
      pendingChannels = null;
    });
    waitUntil(pendingChannels);
  }
  const release = getCachedCoreLocalComponentsRelease(nowMs);
  if (!pendingPolicy && policyRefreshAfterMs <= nowMs) {
    pendingPolicy = loadPolicy(bucket, nowMs).finally(() => {
      pendingPolicy = null;
    });
    waitUntil(pendingPolicy);
  }
  if (release.manifest || !pendingPolicy) {
    return Promise.resolve(release);
  }
  return pendingPolicy.then(() => getCachedCoreLocalComponentsRelease());
}

async function loadPolicy(
  bucket: CliReleaseBucket | undefined,
  startedAtMs: number
): Promise<void> {
  try {
    const manifest = await readRequiredPolicy(bucket);
    cachedPolicy = manifest
      ? { manifest, expiresAtMs: startedAtMs + RELEASE_CACHE_TTL_MS }
      : null;
    policyRefreshAfterMs = manifest
      ? startedAtMs + RELEASE_REFRESH_AFTER_MS
      : Date.now() + MISSING_RELEASE_RETRY_MS;
  } catch (error) {
    console.error("[core.local_components.release_read_failed]", {
      message: error instanceof Error ? error.message : String(error),
      retainedManifest: Boolean(
        cachedPolicy && cachedPolicy.expiresAtMs > Date.now()
      ),
    });
    policyRefreshAfterMs = Date.now() + MISSING_RELEASE_RETRY_MS;
  }
}

async function readRequiredPolicy(
  bucket: CliReleaseBucket | undefined
): Promise<LocalComponentsReleaseManifest | null> {
  if (!bucket) {
    throw new Error("OPENMELD_CLI_RELEASES R2 binding is not configured.");
  }
  const manifestSource = await readJsonObject(
    bucket,
    LOCAL_COMPONENTS_RELEASE_OBJECT_KEY
  );
  if (manifestSource === null) {
    console.error("[core.local_components.release_manifest_missing]", {
      objectKey: LOCAL_COMPONENTS_RELEASE_OBJECT_KEY,
      next: "Seed it with `node scripts/release/publish-cli.mjs seed-manifest` before this Core serves Wake work.",
    });
    return null;
  }
  const parsed = localComponentsReleaseManifestSchema.safeParse(manifestSource);
  if (!parsed.success) {
    console.error("[core.local_components.release_manifest_invalid]", {
      objectKey: LOCAL_COMPONENTS_RELEASE_OBJECT_KEY,
      issues: parsed.error.issues.slice(0, 5),
    });
    return null;
  }
  return parsed.data;
}

async function loadChannels(
  bucket: CliReleaseBucket | undefined,
  startedAtMs: number
): Promise<void> {
  try {
    if (!bucket) {
      throw new Error("OPENMELD_CLI_RELEASES R2 binding is not configured.");
    }
    const [stableSource, previewSource] = await Promise.all([
      readJsonObject(bucket, CLI_STABLE_MANIFEST_OBJECT_KEY),
      readJsonObject(bucket, CLI_WINDOWS_PREVIEW_MANIFEST_OBJECT_KEY),
    ]);
    for (const [channel, source] of [
      ["stable", stableSource],
      ["windows-preview", previewSource],
    ] as const) {
      if (
        source !== null &&
        !cliBinaryManifestSchema.safeParse(source).success
      ) {
        console.error("[core.local_components.channel_manifest_invalid]", {
          channel,
        });
        cachedChannels = null;
        channelsRefreshAfterMs = Date.now() + MISSING_RELEASE_RETRY_MS;
        return;
      }
    }
    cachedChannels = {
      stableManifest: stableSource,
      previewManifest: previewSource,
      expiresAtMs: startedAtMs + RELEASE_CACHE_TTL_MS,
    };
    channelsRefreshAfterMs = startedAtMs + RELEASE_REFRESH_AFTER_MS;
  } catch (error) {
    console.error("[core.local_components.channel_read_failed]", {
      message: error instanceof Error ? error.message : String(error),
    });
    channelsRefreshAfterMs = Date.now() + MISSING_RELEASE_RETRY_MS;
  }
}

async function readJsonObject(
  bucket: CliReleaseBucket,
  key: string
): Promise<unknown> {
  const object = await bucket.get(key);
  return object ? ((await object.json()) as unknown) : null;
}

// Each binary channel's own componentPolicy selects what that installation
// can update to. Only the stable channel may borrow the global policy, and
// only when it selects exactly the published CLI and Service versions.
export function buildLocalComponentsAvailabilityCatalog(input: {
  release: LocalComponentsReleaseManifest;
  stableManifest: unknown;
  previewManifest: unknown;
}): LocalComponentsAvailabilityCatalog | null {
  const entries: LocalComponentsAvailabilityCatalog["entries"] = [];
  for (const [channel, source] of [
    ["stable", input.stableManifest],
    ["windows-preview", input.previewManifest],
  ] as const) {
    if (source === null) {
      continue;
    }
    const parsed = cliBinaryManifestSchema.safeParse(source);
    if (!parsed.success) {
      console.error("[core.local_components.channel_manifest_invalid]", {
        channel,
      });
      return null;
    }
    const selected = parsed.data.channels.stable;
    const policy =
      selected.componentPolicy ??
      (channel === "stable" &&
      selected.version === input.release.components.cli.packageVersion &&
      (selected.service?.version ?? selected.version) ===
        input.release.components.service.bundleVersion
        ? {
            cli: input.release.components.cli,
            service: input.release.components.service,
          }
        : null);
    if (!policy) {
      continue;
    }
    for (const platform of Object.keys(selected.platforms).sort()) {
      if ((selected.service?.platforms ?? selected.platforms)[platform]) {
        entries.push({ channel, platform, policy });
      }
    }
  }
  const catalog = localComponentsAvailabilityCatalogSchema.safeParse({
    schemaVersion: 1,
    entries,
  });
  return catalog.success ? catalog.data : null;
}

export function resetCoreLocalComponentsReleaseCacheForTests(): void {
  cachedPolicy = null;
  cachedChannels = null;
  policyRefreshAfterMs = 0;
  channelsRefreshAfterMs = 0;
  pendingPolicy = null;
  pendingChannels = null;
}
