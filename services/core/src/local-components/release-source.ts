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
const MISSING_RELEASE_RETRY_MS = 10_000;

export type CoreLocalComponentsRelease = {
  manifest: LocalComponentsReleaseManifest | null;
  availabilityCatalog: LocalComponentsAvailabilityCatalog | null;
};

export const UNAVAILABLE_LOCAL_COMPONENTS_RELEASE: CoreLocalComponentsRelease =
  Object.freeze({ manifest: null, availabilityCatalog: null });

type CliReleaseBucket = Pick<R2Bucket, "get">;

let cached: {
  release: CoreLocalComponentsRelease;
  expiresAtMs: number;
} | null = null;
let pending: Promise<CoreLocalComponentsRelease> | null = null;

// A missing manifest fails closed: update projections report
// local_components.release_manifest_invalid and block new Wake work. A read
// error keeps the last manifest this isolate validated, because it is still
// the most recent published release this Core has evidence for.
export function readCoreLocalComponentsRelease(
  bucket: CliReleaseBucket | undefined,
  nowMs = Date.now()
): Promise<CoreLocalComponentsRelease> {
  if (cached && cached.expiresAtMs > nowMs) {
    return Promise.resolve(cached.release);
  }
  pending ??= loadRelease(bucket, nowMs).finally(() => {
    pending = null;
  });
  return pending;
}

async function loadRelease(
  bucket: CliReleaseBucket | undefined,
  nowMs: number
): Promise<CoreLocalComponentsRelease> {
  try {
    const release = await readRelease(bucket);
    cached = {
      release,
      expiresAtMs:
        nowMs +
        (release.manifest ? RELEASE_CACHE_TTL_MS : MISSING_RELEASE_RETRY_MS),
    };
    return release;
  } catch (error) {
    console.error("[core.local_components.release_read_failed]", {
      message: error instanceof Error ? error.message : String(error),
      retainedManifest: Boolean(cached?.release.manifest),
    });
    const release = cached?.release ?? UNAVAILABLE_LOCAL_COMPONENTS_RELEASE;
    cached = { release, expiresAtMs: nowMs + MISSING_RELEASE_RETRY_MS };
    return release;
  }
}

async function readRelease(
  bucket: CliReleaseBucket | undefined
): Promise<CoreLocalComponentsRelease> {
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
    return UNAVAILABLE_LOCAL_COMPONENTS_RELEASE;
  }
  const parsed = localComponentsReleaseManifestSchema.safeParse(manifestSource);
  if (!parsed.success) {
    console.error("[core.local_components.release_manifest_invalid]", {
      objectKey: LOCAL_COMPONENTS_RELEASE_OBJECT_KEY,
      issues: parsed.error.issues.slice(0, 5),
    });
    return UNAVAILABLE_LOCAL_COMPONENTS_RELEASE;
  }
  let availabilityCatalog: LocalComponentsAvailabilityCatalog | null = null;
  try {
    const [stableSource, previewSource] = await Promise.all([
      readJsonObject(bucket, CLI_STABLE_MANIFEST_OBJECT_KEY),
      readJsonObject(bucket, CLI_WINDOWS_PREVIEW_MANIFEST_OBJECT_KEY),
    ]);
    availabilityCatalog = buildLocalComponentsAvailabilityCatalog({
      release: parsed.data,
      stableManifest: stableSource,
      previewManifest: previewSource,
    });
  } catch (error) {
    console.error("[core.local_components.channel_read_failed]", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  // Channel availability must not discard a freshly validated required policy.
  return { manifest: parsed.data, availabilityCatalog };
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
  cached = null;
  pending = null;
}
