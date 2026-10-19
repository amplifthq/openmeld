import { localComponentsReleaseManifestSchema } from "@openmeld/schemas";
import type { LocalComponentsReleaseManifest } from "@openmeld/schemas/types";
import {
  type CoreLocalComponentsRelease,
  LOCAL_COMPONENTS_RELEASE_OBJECT_KEY,
} from "../src/local-components/release-source";
import publishedManifestJson from "./published-local-components-release.json";

// The CLI release manifest published for v0.3.264 (cli/local-components.json
// in the production CLI release bucket). Tests copy and edit it explicitly.
export const PUBLISHED_LOCAL_COMPONENTS_MANIFEST: LocalComponentsReleaseManifest =
  localComponentsReleaseManifestSchema.parse(publishedManifestJson);

export function createPublishedLocalComponentsRelease(
  manifest: LocalComponentsReleaseManifest | null = structuredClone(
    PUBLISHED_LOCAL_COMPONENTS_MANIFEST
  )
): CoreLocalComponentsRelease {
  return { manifest, availabilityCatalog: null };
}

// Integration tests run Core against an R2 binding; publish the manifest the
// same way scripts/release/publish-cli.mjs does.
export async function seedPublishedLocalComponentsRelease(
  bucket: R2Bucket,
  manifest: LocalComponentsReleaseManifest = PUBLISHED_LOCAL_COMPONENTS_MANIFEST
): Promise<void> {
  await bucket.put(
    LOCAL_COMPONENTS_RELEASE_OBJECT_KEY,
    JSON.stringify(manifest)
  );
}

// Node tests build CoreBindings by hand. This bucket serves only the published
// release manifest, as the production CLI release bucket does after seeding.
export function createPublishedCliReleasesBucket(
  manifest: LocalComponentsReleaseManifest = PUBLISHED_LOCAL_COMPONENTS_MANIFEST
): R2Bucket {
  return {
    get: async (key: string) => {
      await Promise.resolve();
      return key === LOCAL_COMPONENTS_RELEASE_OBJECT_KEY
        ? { json: async () => structuredClone(manifest) }
        : null;
    },
  } as unknown as R2Bucket;
}
