import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

// Error captured from production run 34352633793. Deploy event fields follow
// Wrangler 4.130.0 deploy-helpers writeOutput({ type: "deploy", ... }).
const MIGRATION_REFUSAL =
  "Version upload failed. You attempted to upload a version of a Worker that includes a Durable Object migration, but migrations must be fully applied via a non-versioned deployment. [code: 10211]";

test("applies only the platform-required migration atomically and records actual traffic", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "core-migration-test-"));
  mkdirSync(path.join(cwd, "services/core"), { recursive: true });
  writeFileSync(
    path.join(cwd, "services/core/wrangler.jsonc"),
    '{"migrations":[{"tag":"v5","new_sqlite_classes":["LarkChannelConnector"]}]}'
  );
  const calls = [];
  try {
    const evidence = runCoreStartupAdmission({
      cwd,
      releaseSha: "a".repeat(40),
      tag: "release-target",
      defines: ['MANIFEST:"exact"'],
      runCommand(input) {
        calls.push(input);
        if (calls.length === 1) {
          return { status: 1, stderr: MIGRATION_REFUSAL };
        }
        writeFileSync(
          input.env.WRANGLER_OUTPUT_FILE_PATH,
          JSON.stringify({
            type: "deploy",
            version: 1,
            worker_name: "openmeld-core-prod",
            worker_tag: "f4edc6df3d904f57a487c725fa861f11",
            version_id: "603c2f42-8eb6-48aa-b3be-bae44e6c61d2",
            targets: [],
            wrangler_environment: "prod",
            worker_name_overridden: false,
          })
        );
        return { status: 0, stdout: "Worker Startup Time: 421 ms" };
      },
    });
    assert.equal(calls.length, 2);
    assert.ok(calls[0].args.includes("upload"));
    assert.ok(calls[1].args.includes("deploy"));
    assert.ok(!calls[1].args.includes("versions"));
    assert.ok(calls[1].args.includes("release-target"));
    assert.ok(calls[1].args.includes('MANIFEST:"exact"'));
    assert.equal(evidence.trafficPercent, 100);
    assert.equal(evidence.releaseSha, "a".repeat(40));
    assert.equal(evidence.startupTimeMs, 421);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("does not turn a startup or authentication failure into a production deployment", () => {
  for (const stderr of [
    "Worker startup failed [code: 10021]",
    "Authentication failed [code: 10000]",
  ]) {
    let calls = 0;
    assert.throws(() =>
      runCoreStartupAdmission({
        releaseSha: "a".repeat(40),
        runCommand() {
          calls++;
          return { status: 1, stderr };
        },
      })
    );
    assert.equal(calls, 1);
  }
});

test("stops when the required atomic migration fails without retrying it", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "core-migration-failure-"));
  mkdirSync(path.join(cwd, "services/core"), { recursive: true });
  writeFileSync(path.join(cwd, "services/core/wrangler.jsonc"), "{}");
  let calls = 0;
  try {
    assert.throws(() =>
      runCoreStartupAdmission({
        cwd,
        releaseSha: "a".repeat(40),
        runCommand() {
          calls++;
          return {
            status: 1,
            stderr:
              calls === 1
                ? MIGRATION_REFUSAL
                : "Worker startup failed [code: 10021]",
          };
        },
      })
    );
    assert.equal(calls, 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
