import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenMeldCanaryDefaultEnv } from "./openmeld-canary.mjs";

test("packaged canary wrapper defaults to the local OpenMeld environment", () => {
  assert.deepEqual(buildOpenMeldCanaryDefaultEnv(), {
    OPENMELD_GATEWAY_URL: "http://localhost:8080",
    OPENMELD_AUTH_URL: "http://localhost:8788",
  });
});
