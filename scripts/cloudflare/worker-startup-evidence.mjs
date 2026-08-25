#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
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

export function createWorkerStartupEvidence(input) {
  const profile = input.profile;
  if (
    !(Array.isArray(profile?.samples) && Array.isArray(profile?.timeDeltas)) ||
    profile.samples.length === 0 ||
    profile.samples.length !== profile.timeDeltas.length
  ) {
    throw new Error(
      "CPU profile samples and timeDeltas must have the same non-zero length"
    );
  }
  const functionNamesByNodeId = new Map(
    (profile.nodes ?? []).map((node) => [
      node.id,
      node.callFrame?.functionName ?? "",
    ])
  );
  let garbageCollectionMicroseconds = 0;
  let idleMicroseconds = 0;
  let sampledMicroseconds = 0;
  for (let index = 0; index < profile.samples.length; index += 1) {
    const duration = Number(profile.timeDeltas[index]);
    if (!(Number.isFinite(duration) && duration >= 0)) {
      throw new Error("CPU profile contained an invalid time delta");
    }
    sampledMicroseconds += duration;
    const functionName = functionNamesByNodeId.get(profile.samples[index]);
    if (functionName === "(garbage collector)") {
      garbageCollectionMicroseconds += duration;
    } else if (functionName === "(idle)") {
      idleMicroseconds += duration;
    }
  }
  const profileWindowMicroseconds =
    Number(profile.endTime ?? 0) - Number(profile.startTime ?? 0);
  const activeMicroseconds = sampledMicroseconds - idleMicroseconds;
  const applicationMicroseconds =
    activeMicroseconds - garbageCollectionMicroseconds;
  if (
    !Number.isFinite(profileWindowMicroseconds) ||
    profileWindowMicroseconds < 0 ||
    sampledMicroseconds > profileWindowMicroseconds ||
    applicationMicroseconds < 0
  ) {
    throw new Error("CPU profile contained inconsistent startup timing");
  }
  return {
    generatedAt: new Date().toISOString(),
    profile: {
      activeMs: toMilliseconds(activeMicroseconds),
      applicationMs: toMilliseconds(applicationMicroseconds),
      garbageCollectionMs: toMilliseconds(garbageCollectionMicroseconds),
      idleMs: toMilliseconds(idleMicroseconds),
      profileWindowMs: toMilliseconds(profileWindowMicroseconds),
      sampleCount: profile.samples.length,
      sampledMs: toMilliseconds(sampledMicroseconds),
    },
    schemaVersion: 1,
    worker: input.worker,
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const configPath = path.resolve(REPOSITORY_ROOT, options.config);
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), "openmeld-worker-startup-")
  );
  const temporaryProfilePath = path.join(
    temporaryDirectory,
    "worker-startup.cpuprofile"
  );
  try {
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "check",
        "startup",
        "--config",
        path.basename(configPath),
        "--env",
        options.environment,
        "--args=--minify",
        "--outfile",
        temporaryProfilePath,
      ],
      {
        cwd: path.dirname(configPath),
        encoding: "utf8",
        env: process.env,
        maxBuffer: 1024 * 1024 * 20,
      }
    );
    const wranglerOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    process.stdout.write(wranglerOutput);
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        `Wrangler startup profile command failed with exit code ${String(result.status)}`
      );
    }
    const evidence = createWorkerStartupEvidence({
      profile: JSON.parse(readFileSync(temporaryProfilePath, "utf8")),
      worker: options.worker,
    });
    mkdirSync(path.dirname(options.output), { recursive: true });
    mkdirSync(path.dirname(options.profileOutput), { recursive: true });
    writeFileSync(options.output, `${JSON.stringify(evidence, null, 2)}\n`);
    copyFileSync(temporaryProfilePath, options.profileOutput);
    console.log(
      `[worker-startup] ${options.worker}: application ${String(evidence.profile.applicationMs)} ms, garbage collection ${String(evidence.profile.garbageCollectionMs)} ms, active including GC ${String(evidence.profile.activeMs)} ms, idle ${String(evidence.profile.idleMs)} ms`
    );
    console.log(`[worker-startup] evidence: ${options.output}`);
    console.log(`[worker-startup] CPU profile: ${options.profileOutput}`);
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function parseArguments(argumentsList) {
  const options = {
    config: "",
    environment: "prod",
    output: "",
    profileOutput: "",
    worker: "",
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    const value = argumentsList[index + 1];
    if (argument === "--config") {
      options.config = requireArgumentValue(argument, value);
      index += 1;
    } else if (argument === "--env") {
      options.environment = requireArgumentValue(argument, value);
      index += 1;
    } else if (argument === "--output") {
      options.output = path.resolve(
        REPOSITORY_ROOT,
        requireArgumentValue(argument, value)
      );
      index += 1;
    } else if (argument === "--profile-output") {
      options.profileOutput = path.resolve(
        REPOSITORY_ROOT,
        requireArgumentValue(argument, value)
      );
      index += 1;
    } else if (argument === "--worker") {
      options.worker = requireArgumentValue(argument, value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${String(argument)}`);
    }
  }
  for (const requiredOption of [
    "config",
    "output",
    "profileOutput",
    "worker",
  ]) {
    if (!options[requiredOption]) {
      throw new Error(`--${requiredOption} is required`);
    }
  }
  return options;
}

function requireArgumentValue(argument, value) {
  if (!(value && !value.startsWith("--"))) {
    throw new Error(`${argument} requires a value`);
  }
  return value;
}

function toMilliseconds(microseconds) {
  return Number((microseconds / 1000).toFixed(3));
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main();
}
