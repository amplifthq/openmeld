import { env } from "cloudflare:test";
import { beforeAll } from "vitest";
import { seedPublishedLocalComponentsRelease } from "./published-local-components-release";

// Core reads the published CLI release from R2 at runtime. Integration tests
// start from the published manifest, as production does after a CLI release.
beforeAll(async () => {
  await seedPublishedLocalComponentsRelease(env.OPENMELD_CLI_RELEASES);
});
