import assert from "node:assert/strict";
import test from "node:test";
import { RESOURCE_TOKEN } from "../dev/local-resources.mjs";
import {
  buildProductionRenderer,
  rendererBuildEnvironment,
} from "./renderer-build.mjs";

const BUDGET = /budget/u;

test("renderer heap stays within machine headroom and its heavy reservation", () => {
  assert.throws(() => rendererBuildEnvironment({}, 4 * 1024 ** 3), BUDGET);
  const large = rendererBuildEnvironment({}, 32 * 1024 ** 3);
  assert.equal(large.NODE_OPTIONS, "--max-old-space-size=4096");
  assert.equal(large.OPENMELD_LOCAL_HEAVY_GIB, "5");
  assert.throws(
    () =>
      rendererBuildEnvironment(
        { OPENMELD_RENDERER_NODE_HEAP_MB: "8192" },
        8 * 1024 ** 3
      ),
    BUDGET
  );
  assert.throws(
    () =>
      rendererBuildEnvironment(
        {
          OPENMELD_LOCAL_HEAVY_GIB: "2",
          OPENMELD_RENDERER_NODE_HEAP_MB: "2048",
        },
        32 * 1024 ** 3
      ),
    BUDGET
  );
  assert.throws(
    () =>
      rendererBuildEnvironment(
        { OPENMELD_LOCAL_HEAVY_GIB: "8" },
        8 * 1024 ** 3
      ),
    BUDGET
  );
});

test("explicit bounded heap overrides prior Node heap flags without affecting other options", () => {
  const env = rendererBuildEnvironment(
    {
      OPENMELD_RENDERER_NODE_HEAP_MB: "4096",
      NODE_OPTIONS: "--enable-source-maps --max_old_space_size=8192",
    },
    32 * 1024 ** 3
  );
  assert.equal(
    env.NODE_OPTIONS,
    "--enable-source-maps --max-old-space-size=4096"
  );
  assert.equal(env.OPENMELD_LOCAL_HEAVY_GIB, "5");
});

test("hosted renderer builds run without waiting for the local worktree resource queue", async () => {
  const invocations = [];
  const options = {
    readMemory: () => ({
      availableBytes: 6 * 1024 ** 3,
      totalBytes: 8 * 1024 ** 3,
      pressure: "unknown",
    }),
    acquireResources: () => {
      throw new Error("Hosted build entered the local resource queue.");
    },
    runCommand: (_command, _args, input) => {
      invocations.push(input.env);
      return 0;
    },
  };
  await buildProductionRenderer(
    "/tmp/release-source",
    {
      GITHUB_ACTIONS: "true",
      OPENMELD_LOCAL_HEAVY_GIB: "5.5",
      OPENMELD_RENDERER_NODE_HEAP_MB: "4608",
    },
    options
  );
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].NODE_OPTIONS, "--max-old-space-size=4608");
  assert.equal(invocations[0][RESOURCE_TOKEN], undefined);

  let released = false;
  await buildProductionRenderer(
    "/tmp/release-source",
    {},
    {
      ...options,
      acquireResources: () => ({
        token: "local-reservation",
        release: () => {
          released = true;
        },
      }),
    }
  );
  assert.equal(invocations[1][RESOURCE_TOKEN], "local-reservation");
  assert.equal(released, true);
});
