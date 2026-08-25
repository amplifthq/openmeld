#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const LINE_SPLIT_PATTERN = /\r?\n/u;
const WRANGLER_STARTUP_TIME_PATTERN = /Worker Startup Time:\s*([\d.]+)\s*ms/u;

export const CORE_STARTUP_ADMISSION_LIMIT_MS = 500;

// TODO(system optimization): evaluate splitting Core initialization by stable
// business domain, or by a reviewed Service Binding boundary, after the current
// reliability work. Keep every public RPC contract and receiver-first rollout
// invariant intact; never replace startup headroom by raising this limit.

export function parseWranglerStartupTime(output) {
  const match = output.match(WRANGLER_STARTUP_TIME_PATTERN);
  if (!match) {
    throw new Error(
      "Cloudflare did not report Worker Startup Time for the uploaded Core version"
    );
  }
  const startupTimeMs = Number(match[1]);
  if (!Number.isFinite(startupTimeMs)) {
    throw new Error("Cloudflare reported an invalid Worker Startup Time");
  }
  return startupTimeMs;
}

export function parseWranglerVersionUploadEvent(outputFile) {
  const events = outputFile
    .split(LINE_SPLIT_PATTERN)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error("Wrangler output evidence contained invalid JSON");
      }
    });
  const event = events.find(
    (candidate) => candidate?.type === "version-upload"
  );
  if (!(event?.version_id && event?.worker_name && event?.worker_tag)) {
    throw new Error(
      "Wrangler output evidence did not record a version-upload event"
    );
  }
  return {
    versionId: String(event.version_id),
    workerName: String(event.worker_name),
    workerTag: String(event.worker_tag),
  };
}

export function createCoreStartupAdmissionEvidence(input) {
  if (!FULL_COMMIT_SHA_PATTERN.test(input.releaseSha)) {
    throw new Error("Core startup admission requires an exact release SHA");
  }
  const startupTimeMs = parseWranglerStartupTime(input.wranglerOutput);
  const version = parseWranglerVersionUploadEvent(input.outputFile);
  return {
    decision:
      startupTimeMs <= CORE_STARTUP_ADMISSION_LIMIT_MS
        ? "accepted"
        : "rejected",
    generatedAt: new Date().toISOString(),
    releaseSha: input.releaseSha,
    schemaVersion: 1,
    startupLimitMs: CORE_STARTUP_ADMISSION_LIMIT_MS,
    startupTimeMs,
    trafficPercent: 0,
    ...version,
  };
}

export function buildCoreStartupAdmissionStepSpec(input) {
  return {
    args: [
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
      "prod",
      ...(input.tag ? ["--tag", input.tag] : []),
      ...input.defines.flatMap((definition) => ["--define", definition]),
    ],
    command: "pnpm",
  };
}

export function runCoreStartupAdmission(input) {
  if (!FULL_COMMIT_SHA_PATTERN.test(input.releaseSha)) {
    throw new Error(
      "Core startup admission requires an exact release SHA before uploading a version"
    );
  }
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), "openmeld-core-startup-admission-")
  );
  const wranglerOutputPath = path.join(
    temporaryDirectory,
    "wrangler-output.jsonl"
  );
  try {
    const step = buildCoreStartupAdmissionStepSpec({
      defines: input.defines ?? [],
      tag: input.tag,
    });
    const runCommand =
      input.runCommand ??
      ((commandInput) =>
        spawnSync(commandInput.command, commandInput.args, {
          cwd: input.cwd ?? REPOSITORY_ROOT,
          encoding: "utf8",
          env: commandInput.env,
          maxBuffer: 1024 * 1024 * 20,
        }));
    const result = runCommand({
      ...step,
      env: {
        ...(input.env ?? process.env),
        WRANGLER_OUTPUT_FILE_PATH: wranglerOutputPath,
      },
    });
    const wranglerOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    process.stdout.write(wranglerOutput);
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        `Core startup admission upload failed with exit code ${String(result.status)}`
      );
    }
    const evidence = createCoreStartupAdmissionEvidence({
      outputFile: readFileSync(wranglerOutputPath, "utf8"),
      releaseSha: input.releaseSha,
      wranglerOutput,
    });
    const outputPath = path.resolve(
      input.cwd ?? REPOSITORY_ROOT,
      input.output ?? "dev-tmp/core-startup-admission.json"
    );
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(
      `[core-startup] Cloudflare measured ${String(evidence.startupTimeMs)} ms; OpenMeld limit ${String(evidence.startupLimitMs)} ms; traffic ${String(evidence.trafficPercent)}%`
    );
    console.log(`[core-startup] evidence: ${outputPath}`);
    if (evidence.decision === "rejected") {
      throw new Error(
        `Core startup admission rejected version ${evidence.versionId}: ${String(evidence.startupTimeMs)} ms exceeds the ${String(evidence.startupLimitMs)} ms OpenMeld release limit. The version received no production traffic.`
      );
    }
    return evidence;
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  runCoreStartupAdmission(options);
}

function parseArguments(argumentsList) {
  const options = {
    defines: [],
    output: "dev-tmp/core-startup-admission.json",
    releaseSha: "",
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    const value = argumentsList[index + 1];
    if (argument === "--define") {
      options.defines.push(requireArgumentValue(argument, value));
      index += 1;
    } else if (argument === "--output") {
      options.output = requireArgumentValue(argument, value);
      index += 1;
    } else if (argument === "--release-sha") {
      options.releaseSha = requireArgumentValue(argument, value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${String(argument)}`);
    }
  }
  if (!options.releaseSha) {
    throw new Error("--release-sha is required");
  }
  return options;
}

function requireArgumentValue(argument, value) {
  if (!(value && !value.startsWith("--"))) {
    throw new Error(`${argument} requires a value`);
  }
  return value;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main();
}
