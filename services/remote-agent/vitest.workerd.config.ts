import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["tests/workerd/**/*.test.ts"],
    server: {
      deps: { inline: [/@cloudflare\/computer/u, /just-bash/u, /turndown/u] },
    },
    poolOptions: {
      workers: {
        main: "./tests/workerd/worker.ts",
        miniflare: {
          compatibilityDate: "2026-07-15",
          compatibilityFlags: ["nodejs_compat"],
          durableObjects: {
            COMPUTER_PROBE: {
              className: "ComputerCommandProbe",
              useSQLite: true,
            },
          },
        },
      },
    },
  },
});
