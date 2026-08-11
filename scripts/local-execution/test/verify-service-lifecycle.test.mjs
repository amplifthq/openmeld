import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertRecommendationMode,
  extractInstalled,
  parseNdjson,
  RECOMMENDATION_CODE,
  STARTUP_AUTO_INSTALL_MODES,
  STATUS_CODE,
} from "../verify-service-lifecycle.mjs";

test("verify-service-lifecycle keeps startup auto-install mode matrix stable", () => {
  assert.deepEqual(STARTUP_AUTO_INSTALL_MODES, ["ask", "never", "always"]);
});

test("verify-service-lifecycle extracts installed state from service status line", () => {
  const installedOutput = [
    JSON.stringify({
      code: STATUS_CODE,
      payload: {
        installed: true,
      },
    }),
  ].join("\n");

  const uninstalledOutput = [
    JSON.stringify({
      code: STATUS_CODE,
      payload: {
        installed: false,
      },
    }),
  ].join("\n");

  assert.equal(extractInstalled(installedOutput), true);
  assert.equal(extractInstalled(uninstalledOutput), false);
});

test("verify-service-lifecycle validates recommendation mode from startup output", () => {
  const askOutput = [
    JSON.stringify({
      code: RECOMMENDATION_CODE,
      payload: {
        autoInstallMode: "ask",
      },
    }),
  ].join("\n");

  assert.doesNotThrow(() => assertRecommendationMode(askOutput, "ask"));
  assert.throws(() => assertRecommendationMode(askOutput, "always"));
});

test("verify-service-lifecycle NDJSON parser fails on invalid JSON line", () => {
  assert.throws(() => parseNdjson('{"ok":1}\n{broken-json}', "broken-output"));
});
