import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkerBundleEvidence,
  parseWranglerUploadMetrics,
  summarizeMetafileInputs,
} from "./worker-bundle-evidence.mjs";

const ISO_DATE_PREFIX_PATTERN = /^\d{4}-\d{2}-\d{2}T/u;

test("parses Wrangler upload evidence in binary units", () => {
  assert.deepEqual(
    parseWranglerUploadMetrics("Total Upload: 5177.36 KiB / gzip: 1.25 MiB"),
    {
      gzipBytes: 1_310_720,
      uploadBytes: 5_301_617,
    }
  );
});

test("summarizes the largest inputs and reports forbidden dependencies", () => {
  const summary = summarizeMetafileInputs(
    {
      inputs: {
        "node_modules/mailchecker/index.js": { bytes: 972_211 },
        "src/index.ts": { bytes: 140_000 },
        "src/small.ts": { bytes: 20 },
      },
      outputs: {
        "bundle/index.js": {
          entryPoint: "src/index.ts",
          inputs: {
            "node_modules/mailchecker/index.js": { bytesInOutput: 12_000 },
            "src/index.ts": { bytesInOutput: 125_000 },
            "src/small.ts": { bytesInOutput: 20 },
          },
        },
        "bundle/lazy.js": {
          inputs: {
            "node_modules/mailchecker/index.js": { bytesInOutput: 900_000 },
          },
        },
      },
    },
    ["mailchecker", "better-auth-harmony"]
  );

  assert.equal(summary.inputCount, 3);
  assert.equal(summary.sourceBytes, 1_112_231);
  assert.deepEqual(summary.largestInputs[0], {
    bytesInOutput: 125_000,
    path: "src/index.ts",
    sourceBytes: 140_000,
  });
  assert.deepEqual(summary.forbiddenInputs, [
    {
      bytesInOutput: 12_000,
      path: "node_modules/mailchecker/index.js",
      pattern: "mailchecker",
      sourceBytes: 972_211,
    },
  ]);
});

test("creates bounded machine-readable release evidence", () => {
  const evidence = createWorkerBundleEvidence({
    forbiddenPatterns: ["mailchecker"],
    gzipBytes: 100,
    metafile: {
      inputs: { "src/index.ts": { bytes: 200 } },
      outputs: {
        "bundle/index.js": {
          entryPoint: "src/index.ts",
          inputs: { "src/index.ts": { bytesInOutput: 180 } },
        },
      },
    },
    outputBytes: 300,
    uploadBytes: 400,
    worker: "core",
  });

  assert.equal(evidence.schemaVersion, 2);
  assert.equal(evidence.worker, "core");
  assert.deepEqual(evidence.bundle, {
    gzipBytes: 100,
    outputBytes: 300,
    uploadBytes: 400,
  });
  assert.deepEqual(evidence.forbiddenInputs, []);
  assert.match(evidence.generatedAt, ISO_DATE_PREFIX_PATTERN);
});
