import { beforeAll } from "vitest";
import publishedManifest from "./published-local-components-release.json";

// Core reads the published CLI release from R2 at runtime. Integration tests
// start from the published manifest, as production does after a CLI release.
// The key matches LOCAL_COMPONENTS_RELEASE_OBJECT_KEY in release-source.ts.
//
// Import cloudflare:test lazily: a static import loads the Core Worker entry
// before each test file is collected, which bypasses that file's vi.mock calls.
beforeAll(async () => {
  const { env } = await import("cloudflare:test");
  await env.OPENMELD_CLI_RELEASES.put(
    "cli/local-components.json",
    JSON.stringify(publishedManifest)
  );
});
