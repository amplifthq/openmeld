import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildCoreCurrentCliProjectionDeployStepSpec,
  deployCoreWithCurrentCliProjection,
  resolveCurrentCliProjectionReleaseManifest,
} from "./deploy-core-current-cli-projection.mjs";

const CURRENT_MANIFEST = JSON.parse(
  readFileSync(new URL("../../release/local-components.json", import.meta.url))
);
const PUBLISHED_VERSION = "0.3.32";
const VERSION_MISMATCH_RE =
  /declares CLI 0\.3\.33, but the production channel is 0\.3\.32/u;
const PUBLISHED_MANIFEST = {
  ...CURRENT_MANIFEST,
  components: {
    ...CURRENT_MANIFEST.components,
    cli: {
      ...CURRENT_MANIFEST.components.cli,
      packageVersion: PUBLISHED_VERSION,
    },
    service: {
      ...CURRENT_MANIFEST.components.service,
      bundleVersion: PUBLISHED_VERSION,
    },
  },
};

test("loads the Core projection from the immutable tag named by the live CLI channel", () => {
  const reads = [];
  const resolved = resolveCurrentCliProjectionReleaseManifest({
    channelManifest: {
      channels: { stable: { version: PUBLISHED_VERSION } },
    },
    readTagFile: (input) => {
      reads.push(input);
      return JSON.stringify(PUBLISHED_MANIFEST);
    },
  });

  assert.deepEqual(reads, [
    {
      path: "release/local-components.json",
      tagName: `v${PUBLISHED_VERSION}`,
    },
  ]);
  assert.deepEqual(resolved, PUBLISHED_MANIFEST);
});

test("refuses a tag manifest that does not match the live CLI channel", () => {
  assert.throws(
    () =>
      resolveCurrentCliProjectionReleaseManifest({
        channelManifest: {
          channels: { stable: { version: PUBLISHED_VERSION } },
        },
        readTagFile: () => JSON.stringify(CURRENT_MANIFEST),
      }),
    VERSION_MISMATCH_RE
  );
});

test("builds one Core deploy whose compiled projection stays on the published manifest", () => {
  const step = buildCoreCurrentCliProjectionDeployStepSpec({
    releaseManifest: PUBLISHED_MANIFEST,
  });
  const defineIndex = step.args.indexOf("--define");
  const defineArgument = step.args[defineIndex + 1];
  const separatorIndex = defineArgument.indexOf(":");

  assert.equal(step.command, "pnpm");
  assert.deepEqual(step.args.slice(0, defineIndex), [
    "--dir",
    "services/core",
    "exec",
    "dotenv",
    "-e",
    "../../.env",
    "-o",
    "--",
    "wrangler",
    "deploy",
    "--minify",
    "--env",
    "prod",
  ]);
  assert.equal(
    defineArgument.slice(0, separatorIndex),
    "OPENMELD_LOCAL_COMPONENTS_RELEASE_MANIFEST_JSON"
  );
  assert.deepEqual(
    JSON.parse(JSON.parse(defineArgument.slice(separatorIndex + 1))),
    PUBLISHED_MANIFEST
  );
});

test("reads channel truth before running the guarded Core receiver deploy", async () => {
  const events = [];

  await deployCoreWithCurrentCliProjection({
    adapters: {
      fetchChannelManifest: () => {
        events.push("fetch-channel");
        return { channels: { stable: { version: PUBLISHED_VERSION } } };
      },
      readTagFile: () => {
        events.push("read-tag");
        return JSON.stringify(PUBLISHED_MANIFEST);
      },
      runStep: (step) => {
        events.push(step.label);
      },
    },
  });

  assert.deepEqual(events, [
    "fetch-channel",
    "read-tag",
    "Build Core receiver dependencies",
    "Deploy Core with the current published CLI projection",
  ]);
});
