import { localComponentsReleaseManifestSchema } from "../../packages/schemas/src/schemas/local-components.ts";

// This native lane builds a fresh GUI Service carrier from the same source as
// the CLI. It cannot relabel that image as an older retained Service.
export function resolveWindowsPreviewComponentPolicy(input) {
  const release = localComponentsReleaseManifestSchema.parse(
    input.releaseManifest
  );
  if (
    release.components.cli.packageVersion !== input.version ||
    release.components.service.bundleVersion !== input.version
  ) {
    throw new Error(
      "Windows preview requires CLI and fresh Service policies at the carrier version. Prepare a Service release before building this preview; do not relabel a retained Service."
    );
  }
  return { cli: release.components.cli, service: release.components.service };
}
