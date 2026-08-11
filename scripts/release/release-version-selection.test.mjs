import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCliReleaseVersionResolution,
  readCliReleaseChannels,
  resolveCliReleaseVersion,
} from "./release-version-selection.mjs";

const NEXT_MODE_FAILURE_RE = /--next could not determine a release version/u;
const VERSION_DRIFT_RE = /WARNING: CLI channel version drift/u;
const DRIFT_DECISION_RE =
  /npm latest 0\.2\.42; R2 stable 0\.2\.44; highest 0\.2\.44; next 0\.2\.45/u;
const VERSION_FLAGS_MUTUALLY_EXCLUSIVE_RE =
  /--next and --version are mutually exclusive/u;
const NPM_NETWORK_FAILURE_RE = /npm registry ENOTFOUND/u;
const NO_VERSION_SELECTED_RE = /No version was selected/u;
const RELEASE_PREFLIGHT_COMMAND_RE = /pnpm run release:preflight/u;

test("increments the shared npm and R2 patch version", async () => {
  const resolution = await resolveCliReleaseVersion({
    next: true,
    readChannels: async () => ({
      npmVersion: "0.2.43",
      r2Version: "0.2.43",
    }),
  });

  assert.deepEqual(resolution, {
    drift: false,
    highestPublishedVersion: "0.2.43",
    npmVersion: "0.2.43",
    r2Version: "0.2.43",
    source: "next",
    targetVersion: "0.2.44",
  });
  assert.equal(
    formatCliReleaseVersionResolution(resolution),
    "CLI version decision: npm latest 0.2.43; R2 stable 0.2.43; highest 0.2.43; next 0.2.44."
  );
});

test("increments the higher channel version and warns when npm and R2 drift", async () => {
  const resolution = await resolveCliReleaseVersion({
    next: true,
    readChannels: async () => ({
      npmVersion: "0.2.42",
      r2Version: "0.2.44",
    }),
  });

  assert.equal(resolution.targetVersion, "0.2.45");
  assert.equal(resolution.highestPublishedVersion, "0.2.44");
  assert.equal(resolution.drift, true);
  assert.match(formatCliReleaseVersionResolution(resolution), VERSION_DRIFT_RE);
  assert.match(
    formatCliReleaseVersionResolution(resolution),
    DRIFT_DECISION_RE
  );
});

test("uses an explicit version without reading release channels", async () => {
  let channelReadCount = 0;
  const resolution = await resolveCliReleaseVersion({
    explicitVersion: "0.2.50",
    readChannels: () => {
      channelReadCount += 1;
      throw new Error("channel lookup must not run");
    },
  });

  assert.deepEqual(resolution, {
    source: "explicit",
    targetVersion: "0.2.50",
  });
  assert.equal(channelReadCount, 0);
});

test("rejects combining --next with an explicit --version", async () => {
  await assert.rejects(
    resolveCliReleaseVersion({
      explicitVersion: "0.2.50",
      next: true,
      readChannels: async () => ({
        npmVersion: "0.2.43",
        r2Version: "0.2.43",
      }),
    }),
    VERSION_FLAGS_MUTUALLY_EXCLUSIVE_RE
  );
});

test("fails --next without guessing when a channel lookup is unavailable", async () => {
  await assert.rejects(
    resolveCliReleaseVersion({
      next: true,
      readChannels: () => {
        throw new Error("npm registry ENOTFOUND");
      },
    }),
    (error) => {
      assert.match(error.message, NEXT_MODE_FAILURE_RE);
      assert.match(error.message, NPM_NETWORK_FAILURE_RE);
      assert.match(error.message, NO_VERSION_SELECTED_RE);
      assert.match(error.message, RELEASE_PREFLIGHT_COMMAND_RE);
      return true;
    }
  );
});

test("reads npm latest and R2 stable from their release channel contracts", async () => {
  const channels = await readCliReleaseChannels({
    fetch: async () =>
      new Response(
        JSON.stringify({
          channels: { stable: { version: "0.2.42" } },
          schemaVersion: 1,
        }),
        { status: 200 }
      ),
    runCommand: ({ args, command }) => {
      assert.deepEqual(
        [command, ...args],
        ["npm", "view", "openmeld", "dist-tags", "--json"]
      );
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify({ latest: "0.2.43" }),
      };
    },
  });

  assert.deepEqual(channels, {
    npmVersion: "0.2.43",
    r2Version: "0.2.42",
  });
});
