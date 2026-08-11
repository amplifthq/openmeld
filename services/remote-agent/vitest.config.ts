import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
    include: ["tests/**/*.test.ts"],
    server: {
      deps: {
        // Force these through the vite pipeline so the cloudflare:workers
        // alias above applies inside the package too.
        inline: [/@cloudflare\/computer/u],
      },
    },
  },
});
