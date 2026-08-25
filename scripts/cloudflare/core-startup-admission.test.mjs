import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCoreStartupAdmissionStepSpec,
  CORE_STARTUP_ADMISSION_LIMIT_MS,
  createCoreStartupAdmissionEvidence,
  parseWranglerStartupTime,
  parseWranglerVersionUploadEvent,
} from "./core-startup-admission.mjs";

const CAPTURED_WRANGLER_UPLOAD_OUTPUT = `
Total Upload: 5530.47 KiB / gzip: 1165.24 KiB
Worker Startup Time: 421 ms
Uploaded openmeld-core-prod (12.34 sec)
Worker Version ID: 603c2f42-8eb6-48aa-b3be-bae44e6c61d2
`;
const MISSING_STARTUP_TIME_RE = /did not report Worker Startup Time/u;
const MISSING_VERSION_UPLOAD_RE = /did not record a version-upload event/u;

const CAPTURED_WRANGLER_OUTPUT_FILE = [
  JSON.stringify({
    command_line_args: ["versions", "upload", "--minify", "--env", "prod"],
    type: "wrangler-session",
    version: 1,
    wrangler_version: "4.110.0",
  }),
  JSON.stringify({
    preview_alias_url: null,
    preview_url: null,
    type: "version-upload",
    version: 1,
    version_id: "603c2f42-8eb6-48aa-b3be-bae44e6c61d2",
    worker_name: "openmeld-core-prod",
    worker_name_overridden: false,
    worker_tag: "f4edc6df3d904f57a487c725fa861f11",
    wrangler_environment: "prod",
  }),
].join("\n");

test("parses Cloudflare startup time from captured Wrangler output", () => {
  assert.equal(parseWranglerStartupTime(CAPTURED_WRANGLER_UPLOAD_OUTPUT), 421);
});

test("uploads the production version with zero traffic and the exact compile inputs", () => {
  const step = buildCoreStartupAdmissionStepSpec({
    defines: ['OPENMELD_RELEASE:"v1"'],
    tag: "openmeld-release-target",
  });

  assert.equal(step.command, "pnpm");
  assert.deepEqual(step.args.slice(0, 13), [
    "--dir",
    "services/core",
    "exec",
    "dotenv",
    "-e",
    "../../.env",
    "-o",
    "--",
    "wrangler",
    "versions",
    "upload",
    "--minify",
    "--env",
  ]);
  assert.ok(step.args.includes("prod"));
  assert.ok(step.args.includes("openmeld-release-target"));
  assert.ok(step.args.includes('OPENMELD_RELEASE:"v1"'));
  assert.ok(!step.args.includes("deploy"));
});

test("parses the exact non-traffic Worker version from Wrangler output evidence", () => {
  assert.deepEqual(
    parseWranglerVersionUploadEvent(CAPTURED_WRANGLER_OUTPUT_FILE),
    {
      versionId: "603c2f42-8eb6-48aa-b3be-bae44e6c61d2",
      workerName: "openmeld-core-prod",
      workerTag: "f4edc6df3d904f57a487c725fa861f11",
    }
  );
});

test("accepts a non-traffic version only with 50 percent startup headroom", () => {
  const evidence = createCoreStartupAdmissionEvidence({
    outputFile: CAPTURED_WRANGLER_OUTPUT_FILE,
    releaseSha: "552812d05f1398f791fc327ec8247b24166193ee",
    wranglerOutput: CAPTURED_WRANGLER_UPLOAD_OUTPUT,
  });

  assert.equal(CORE_STARTUP_ADMISSION_LIMIT_MS, 500);
  assert.equal(evidence.decision, "accepted");
  assert.equal(evidence.startupTimeMs, 421);
  assert.equal(evidence.startupLimitMs, 500);
  assert.equal(evidence.trafficPercent, 0);
});

test("rejects an uploaded version before traffic when startup loses headroom", () => {
  const evidence = createCoreStartupAdmissionEvidence({
    outputFile: CAPTURED_WRANGLER_OUTPUT_FILE,
    releaseSha: "552812d05f1398f791fc327ec8247b24166193ee",
    wranglerOutput: CAPTURED_WRANGLER_UPLOAD_OUTPUT.replace("421 ms", "501 ms"),
  });

  assert.equal(evidence.decision, "rejected");
  assert.equal(evidence.startupTimeMs, 501);
  assert.equal(evidence.trafficPercent, 0);
});

test("fails closed when Cloudflare does not return startup evidence", () => {
  assert.throws(
    () => parseWranglerStartupTime("Uploaded openmeld-core-prod"),
    MISSING_STARTUP_TIME_RE
  );
  assert.throws(
    () => parseWranglerVersionUploadEvent("{}\n"),
    MISSING_VERSION_UPLOAD_RE
  );
});
