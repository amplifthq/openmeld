import assert from "node:assert/strict";
import test from "node:test";

import { createFastPrTestPlan } from "./fast-pr-test-plan.mjs";

test("shards only affected heavy unit suites and keeps the remainder together", () => {
  assert.deepEqual(
    createFastPrTestPlan({
      tasks: [
        { package: "openmeld-web", task: "build" },
        { package: "openmeld-web", task: "test" },
        { package: "@openmeld/core", task: "test" },
        { package: "@openmeld/schemas", task: "test" },
      ],
    }),
    {
      hasRemainingTests: true,
      shards: [
        {
          cacheKey: "web-1-of-3",
          config: "vitest.config.ts",
          name: "Web 1/3",
          package: "openmeld-web",
          requiresDependencyBuild: false,
          shard: "1/3",
        },
        {
          cacheKey: "web-2-of-3",
          config: "vitest.config.ts",
          name: "Web 2/3",
          package: "openmeld-web",
          requiresDependencyBuild: false,
          shard: "2/3",
        },
        {
          cacheKey: "web-3-of-3",
          config: "vitest.config.ts",
          name: "Web 3/3",
          package: "openmeld-web",
          requiresDependencyBuild: false,
          shard: "3/3",
        },
        {
          cacheKey: "core-1-of-2",
          config: "vitest.boundary.config.ts",
          name: "Core 1/2",
          package: "@openmeld/core",
          requiresDependencyBuild: true,
          shard: "1/2",
        },
        {
          cacheKey: "core-2-of-2",
          config: "vitest.boundary.config.ts",
          name: "Core 2/2",
          package: "@openmeld/core",
          requiresDependencyBuild: true,
          shard: "2/2",
        },
      ],
    }
  );
});

test("keeps dependency builds for heavy suites that still consume package output", () => {
  const plan = createFastPrTestPlan({
    tasks: [{ package: "openmeld", task: "test" }],
  });

  assert.equal(plan.shards.length, 2);
  assert.ok(plan.shards.every((shard) => shard.requiresDependencyBuild));
});

test("does not schedule heavy suites that are outside the affected task graph", () => {
  assert.deepEqual(
    createFastPrTestPlan({
      tasks: [{ package: "@openmeld/schemas", task: "build" }],
    }),
    { hasRemainingTests: false, shards: [] }
  );
});
