import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Physical DB split routing gate (physical-db-split.md Stage B safety net).
//
// A workers pool isolated from the main integration pool (vitest.config.ts):
// it binds the three per-domain D1 databases as SEPARATE local databases and
// leaves OPENMELD_DB as an empty trap (see wrangler.split-gate.jsonc). Real Durable
// Objects (Space / RuntimeTransport / PrepareSessionHub) are instantiated here so the
// gate exercises the ACTUAL routing line inside the DO (`wakeEvidenceDb(this.env)`
// etc.), not just the underlying repository — a misroute or an unrewired read
// fails with `no such table` because the table is absent in the routed DB.
export default defineWorkersConfig({
  test: {
    fileParallelism: false,
    globals: true,
    include: ["tests-split-gate/**/*.test.ts"],
    setupFiles: ["./tests-split-gate/apply-split-baselines.ts"],
    poolOptions: {
      workers: {
        // RuntimeTransport/Space stream tests need shared storage (see vitest.config.ts).
        isolatedStorage: false,
        singleWorker: true,
        wrangler: {
          configPath: "./wrangler.split-gate.jsonc",
        },
      },
    },
  },
});
