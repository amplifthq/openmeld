import assert from "node:assert/strict";
import test from "node:test";
import { rendererBuildEnvironment } from "./renderer-build.mjs";

const BUDGET = /budget/u;

test("renderer heap stays within machine headroom and its heavy reservation", () => {
  const small = rendererBuildEnvironment({}, 4 * 1024 ** 3);
  assert.ok(Number(small.OPENMELD_LOCAL_HEAVY_GIB) <= 3);
  const large = rendererBuildEnvironment({}, 32 * 1024 ** 3);
  assert.equal(large.NODE_OPTIONS, "--max-old-space-size=6144");
  assert.equal(large.OPENMELD_LOCAL_HEAVY_GIB, "7");
  assert.throws(
    () =>
      rendererBuildEnvironment(
        { OPENMELD_DESKTOP_NODE_HEAP_MB: "8192" },
        8 * 1024 ** 3
      ),
    BUDGET
  );
  assert.throws(
    () =>
      rendererBuildEnvironment(
        {
          OPENMELD_LOCAL_HEAVY_GIB: "2",
          OPENMELD_DESKTOP_NODE_HEAP_MB: "2048",
        },
        32 * 1024 ** 3
      ),
    BUDGET
  );
});

test("explicit bounded heap overrides prior Node heap flags without affecting other options", () => {
  const env = rendererBuildEnvironment(
    {
      OPENMELD_DESKTOP_NODE_HEAP_MB: "4096",
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
