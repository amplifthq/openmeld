import { createHash } from "node:crypto";
import { cliBinaryManifestSchema } from "../../packages/schemas/src/schemas/http/cli-binary-manifest.ts";
import {
  localComponentsAvailabilityCatalogSchema,
  localComponentsReleaseManifestSchema,
} from "../../packages/schemas/src/schemas/local-components.ts";
import { fetchCliChannelManifest } from "./cli-channel-sync.mjs";

export const AVAILABILITY_CATALOG_DEFINE =
  "OPENMELD_LOCAL_COMPONENTS_AVAILABILITY_CATALOG_JSON";
export const WINDOWS_PREVIEW_MANIFEST_URL =
  "https://openmeld.ai/cli/manifest.json?channel=windows-preview";

// Build from official channel snapshots. The preview document deliberately has
// channels.stable inside it; the selected source, not that JSON key, owns channel.
export function buildLocalComponentsAvailabilityCatalog(input) {
  const release = localComponentsReleaseManifestSchema.parse(input.releaseManifest);
  const entries = [];
  for (const [channel, source] of [
    ["stable", input.stableManifest],
    ["windows-preview", input.previewManifest],
  ]) {
    if (!source) {
      continue;
    }
    const selected = cliBinaryManifestSchema.parse(source).channels.stable;
    let policy = selected.componentPolicy;
    // Only the legacy stable document may reuse the matching global policy.
    // Never borrow stable policy for a preview or mismatched component pair.
    if (!policy && channel === "stable" &&
      selected.version === release.components.cli.packageVersion &&
      (selected.service?.version ?? selected.version) === release.components.service.bundleVersion) {
      policy = { cli: release.components.cli, service: release.components.service };
    }
    if (!policy) {
      continue;
    }
    for (const platform of Object.keys(selected.platforms).sort()) {
      if (!(selected.service?.platforms ?? selected.platforms)[platform]) {
        continue;
      }
      entries.push({ channel, platform, policy });
    }
  }
  return localComponentsAvailabilityCatalogSchema.parse({ schemaVersion: 1, entries });
}

export async function readLocalComponentsAvailabilityCatalog(input) {
  const stableManifest = input.stableManifest ??
    await fetchCliChannelManifest({ fetch: input.fetch });
  const previewManifest = Object.hasOwn(input, "previewManifest")
    ? input.previewManifest
    : await fetchOptionalWindowsPreview(input.fetch ?? fetch);
  return buildLocalComponentsAvailabilityCatalog({
    releaseManifest: input.releaseManifest,
    stableManifest,
    previewManifest,
  });
}

async function fetchOptionalWindowsPreview(fetchImpl) {
  const response = await fetchImpl(WINDOWS_PREVIEW_MANIFEST_URL, {
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Windows preview availability fetch failed: HTTP ${response.status}`);
  }
  return cliBinaryManifestSchema.parse(await response.json());
}

export function describeLocalComponentsAvailabilityCatalog(catalog) {
  const json = JSON.stringify(localComponentsAvailabilityCatalogSchema.parse(catalog));
  return {
    define: `${AVAILABILITY_CATALOG_DEFINE}:${JSON.stringify(json)}`,
    sha256: createHash("sha256").update(json).digest("hex"),
  };
}
