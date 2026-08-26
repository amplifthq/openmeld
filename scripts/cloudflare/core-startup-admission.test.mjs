import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCoreBundleEvidenceStepSpec,
  buildCoreStartupAdmissionStepSpec,
  CORE_STARTUP_PERFORMANCE_TARGET_MS,
  createCoreStartupAdmissionEvidence,
  parseWranglerStartupTime,
  parseWranglerVersionUploadEvent,
  runCoreStartupAdmission,
} from "./core-startup-admission.mjs";

const CAPTURED_WRANGLER_UPLOAD_OUTPUT = `
Total Upload: 5530.47 KiB / gzip: 1165.24 KiB
Worker Startup Time: 421 ms
Uploaded openmeld-core-prod (12.34 sec)
Worker Version ID: 603c2f42-8eb6-48aa-b3be-bae44e6c61d2
`;
const MISSING_STARTUP_TIME_RE = /did not report Worker Startup Time/u;
const MISSING_VERSION_UPLOAD_RE = /did not record a version-upload event/u;

test("verifies the final Core bundle module graph before startup admission", () => {
  assert.deepEqual(buildCoreBundleEvidenceStepSpec(), {
    args: ["run", "evidence:bundle:core"],
    command: "pnpm",
    label: "Verify Core Worker bundle module graph",
  });
});

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

test("records a non-traffic version within the startup performance target", () => {
  const evidence = createCoreStartupAdmissionEvidence({
    outputFile: CAPTURED_WRANGLER_OUTPUT_FILE,
    releaseSha: "552812d05f1398f791fc327ec8247b24166193ee",
    wranglerOutput: CAPTURED_WRANGLER_UPLOAD_OUTPUT,
  });

  assert.equal(CORE_STARTUP_PERFORMANCE_TARGET_MS, 500);
  assert.equal(evidence.decision, "accepted");
  assert.equal(evidence.performanceStatus, "within_target");
  assert.equal(evidence.startupTimeMs, 421);
  assert.equal(evidence.startupTargetMs, 500);
  assert.equal(evidence.trafficPercent, 0);
});

test("accepts a Cloudflare-approved version with a performance warning above target", () => {
  const evidence = createCoreStartupAdmissionEvidence({
    outputFile: CAPTURED_WRANGLER_OUTPUT_FILE,
    releaseSha: "552812d05f1398f791fc327ec8247b24166193ee",
    wranglerOutput: CAPTURED_WRANGLER_UPLOAD_OUTPUT.replace("421 ms", "501 ms"),
  });

  assert.equal(evidence.decision, "accepted");
  assert.equal(evidence.performanceStatus, "above_target");
  assert.equal(evidence.startupTimeMs, 501);
  assert.equal(evidence.startupTargetMs, 500);
  assert.equal(evidence.trafficPercent, 0);
});

test("continues a guarded release after Cloudflare accepts an above-target version", () => {
  const fixtureDirectory = mkdtempSync(
    path.join(tmpdir(), "openmeld-core-startup-warning-test-")
  );
  try {
    const evidence = runCoreStartupAdmission({
      cwd: fixtureDirectory,
      output: "startup-evidence.json",
      releaseSha: "552812d05f1398f791fc327ec8247b24166193ee",
      runCommand(commandInput) {
        writeFileSync(
          commandInput.env.WRANGLER_OUTPUT_FILE_PATH,
          CAPTURED_WRANGLER_OUTPUT_FILE
        );
        return {
          status: 0,
          stderr: "",
          stdout: CAPTURED_WRANGLER_UPLOAD_OUTPUT.replace("421 ms", "948 ms"),
        };
      },
    });

    assert.equal(evidence.decision, "accepted");
    assert.equal(evidence.performanceStatus, "above_target");
    assert.equal(evidence.startupTimeMs, 948);
    assert.equal(
      JSON.parse(
        readFileSync(
          path.join(fixtureDirectory, "startup-evidence.json"),
          "utf8"
        )
      ).performanceStatus,
      "above_target"
    );
  } finally {
    rmSync(fixtureDirectory, { force: true, recursive: true });
  }
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
