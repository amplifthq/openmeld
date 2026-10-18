import { localComponentsReleaseManifestSchema } from "@openmeld/schemas";
import type { LocalComponentsReleaseManifest } from "@openmeld/schemas/types";
import {
  type CoreLocalComponentsRelease,
  LOCAL_COMPONENTS_RELEASE_OBJECT_KEY,
} from "../src/local-components/release-source";

// The CLI release manifest published for v0.3.264 (cli/local-components.json
// in the production CLI release bucket). Tests copy and edit it explicitly.
export const PUBLISHED_LOCAL_COMPONENTS_MANIFEST: LocalComponentsReleaseManifest =
  localComponentsReleaseManifestSchema.parse({
    schemaVersion: 1,
    updatedAt: "2026-10-16T16:25:15.531Z",
    components: {
      cli: {
        commandContractVersion:
          "openmeld-cli-command-contract-2026-09-project-work-v1",
        packageVersion: "0.3.264",
        updatePolicy: "available",
        reason:
          "Existing CLI commands remain wire-compatible; bounded stop, verified repair and opt-in native recovery improve diagnostics.",
      },
      service: {
        bundleHash:
          "97aac63c39e1b964ec4324d240d12aca0a85e566208406dcf35fe9deed071864",
        portableBundleHash:
          "66d19be2e93467b33d0b44762b70cd36b25e07caa131a6da3a7882d9836f33fc",
        bundleVersion: "0.3.264",
        runtimeContractEpoch: "runtime-transport-epoch-2026-09-project-work-v1",
        serviceContractVersion:
          "openmeld-service-contract-2026-10-auth-freshness-v1",
        updatePolicy: "required",
        reason:
          "Native account checks must run each minute before Core can enforce the two-minute evidence lifetime; old five-minute carriers cannot satisfy it.",
      },
      skills: {
        bundleHash:
          "77e639d354b9ebf56ffdaa231a469fd0f848ad63c9b6f78662bdf4e698e2946d",
        skillContractVersion:
          "openmeld-skills-contract-2026-09-explicit-space-recipients-v1",
        skillIds: ["openmeld-cli"],
        updatePolicy: "available",
        reason:
          "Guidance clarifies existing command prefixes, addressing, and Computer operations without adding runtime authority.",
      },
    },
  });

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
