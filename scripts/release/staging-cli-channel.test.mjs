import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStagingCliPublishStepSpec,
  parseStagingCliChannelArgs,
  resolveStagingCliVersion,
} from "./staging-cli-channel.mjs";

const INVALID_COMMAND_PATTERN = /plan, publish, or verify/u;

test("accepts only guarded staging CLI channel commands", () => {
  assert.deepEqual(parseStagingCliChannelArgs(["plan"]), { command: "plan" });
  assert.deepEqual(parseStagingCliChannelArgs(["publish"]), {
    command: "publish",
  });
  assert.deepEqual(parseStagingCliChannelArgs(["verify"]), {
    command: "verify",
  });
  assert.throws(
    () => parseStagingCliChannelArgs(["deploy"]),
    INVALID_COMMAND_PATTERN
  );
});

test("builds a monotonic prerelease after the current production version", () => {
  assert.equal(
    resolveStagingCliVersion({
      baseVersion: "0.3.121",
      gitSha: "30530093cf0fcc29789389d848a06321c0c3522c",
      now: new Date("2026-08-28T00:15:27.123Z"),
    }),
    "0.3.122-staging.20260828001527123.30530093"
  );
});

test("publishes only through the staging release credential and bucket", () => {
  const step = buildStagingCliPublishStepSpec({
    version: "0.3.122-staging.20260828001527123.30530093",
  });
  assert.deepEqual(step, {
    args: [
      "scripts/dev/doppler-environment.mjs",
      "component:stg",
      "release",
      "--",
      "node",
      "scripts/release/staging-cli-channel.mjs",
      "__publish",
      "--version",
      "0.3.122-staging.20260828001527123.30530093",
    ],
    command: "node",
  });
  assert.equal(step.args.includes("prod"), false);
  assert.equal(step.args.includes("prd"), false);
});
