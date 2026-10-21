import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./tests/workerd/worker.ts",
      miniflare: {
        workerLoaders: { LOADER: {} },
        compatibilityDate: "2026-07-15",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: {
          AGENT_COMPUTER: {
            className: "AgentComputer",
            useSQLite: true,
          },
          ACCOUNT_ERASURE_PROBE: {
            className: "AccountErasureProbe",
            useSQLite: true,
          },
          COMPUTER_PROBE: {
            className: "ComputerCommandProbe",
            useSQLite: true,
          },
        },
      },
    }),
  ],
  test: {
    include: ["tests/workerd/**/*.test.ts"],
    server: {
      deps: {
        inline: [
          /@cloudflare\/computer/u,
          /just-bash/u,
          /turndown/u,
          /\/ai\//u,
          /@ai-sdk\//u,
          /\/agents\//u,
          /@cloudflare\/codemode/u,
          /@flue\//u,
        ],
      },
    },
  },
});
