import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { buildLazyRuntimeModules } from "../core/scripts/build-lazy-runtime-modules.mjs";

// Cross-Core capability tests use the real RPC and retained-memory owners.
// Prepare their request-only modules through the same entry as Core tests.
await buildLazyRuntimeModules();

export default defineConfig({
  resolve: {
    alias: {
      // @cloudflare/computer subclasses WorkerEntrypoint at module load;
      // stub the runtime module so those units are testable under Node.
      "cloudflare:workers": fileURLToPath(
        new URL("./tests/stubs/cloudflare-workers.ts", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    // Match Core's native-fixture budget; concurrency stays inside behavior tests.
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/workerd/**/*.test.ts"],
    setupFiles: ["./tests/reset-mocks.setup.ts"],
    server: {
      deps: {
        // Force these through the vite pipeline so the cloudflare:workers
        // alias above applies inside the package too.
        inline: [
          /@cloudflare\/computer/u,
          /@flue\/runtime/u,
          /agents/u,
          /@cloudflare\/codemode/u,
        ],
      },
    },
  },
});
