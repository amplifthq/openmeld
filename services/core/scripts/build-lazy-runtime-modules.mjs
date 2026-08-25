#!/usr/bin/env node

import {
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const CORE_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const OUTPUT_DIRECTORY = path.join(CORE_DIRECTORY, "src/generated-runtime");

export async function buildLazyRuntimeModules() {
  await buildLazyRuntimeModule({
    displayName: "Zep",
    entryPath: fileURLToPath(import.meta.resolve("@getzep/zep-cloud")),
    outputPath: path.join(OUTPUT_DIRECTORY, "zep-cloud.mjs"),
    verify: verifyZepRuntimeModule,
  });
  await buildLazyRuntimeModule({
    displayName: "Routine schedule",
    entryPath: path.resolve(
      CORE_DIRECTORY,
      "../../packages/routine-schedule/src/index.ts"
    ),
    outputPath: path.join(OUTPUT_DIRECTORY, "routine-schedule.mjs"),
    verify: verifyRoutineScheduleRuntimeModule,
  });
}

async function buildLazyRuntimeModule(input) {
  const result = await build({
    bundle: true,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    entryPoints: [input.entryPath],
    format: "esm",
    legalComments: "eof",
    minify: true,
    outfile: input.outputPath,
    platform: "browser",
    target: "es2022",
    write: false,
  });
  if (result.outputFiles?.length !== 1) {
    throw new Error(
      `Lazy ${input.displayName} runtime build did not produce exactly one module`
    );
  }
  const output = result.outputFiles[0].contents;
  await input.verify(output);

  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  const temporaryOutputPath = `${input.outputPath}.${String(process.pid)}.tmp`;
  try {
    writeFileSync(temporaryOutputPath, output);
    renameSync(temporaryOutputPath, input.outputPath);
  } finally {
    rmSync(temporaryOutputPath, { force: true });
  }

  console.log(
    `[core-build] Generated lazy ${input.displayName} runtime module (${String(statSync(input.outputPath).size)} bytes)`
  );
}

async function verifyZepRuntimeModule(output) {
  const module = await importRuntimeModule(output);
  if (typeof module.ZepClient !== "function") {
    throw new Error("Lazy Zep runtime module does not export ZepClient");
  }
  const client = new module.ZepClient({ apiKey: "build-validation" });
  const graph = client.graph;
  const user = client.user;
  const requiredMethods = [
    ["graph.add", graph?.add],
    ["graph.delete", graph?.delete],
    ["graph.episode.get", graph?.episode?.get],
    ["graph.search", graph?.search],
    ["user.add", user?.add],
    ["user.delete", user?.delete],
  ];
  for (const [name, method] of requiredMethods) {
    if (typeof method !== "function") {
      throw new Error(`Lazy Zep runtime module is missing ${name}`);
    }
  }
}

async function verifyRoutineScheduleRuntimeModule(output) {
  const module = await importRuntimeModule(output);
  const requiredExports = [
    "createDailyRoutineSchedule",
    "formatStoredRoutineSchedule",
    "getNextStoredRoutineOccurrence",
    "getStoredRoutineOccurrenceWindow",
    "validateRoutineSchedule",
  ];
  for (const name of requiredExports) {
    if (typeof module[name] !== "function") {
      throw new Error(
        `Lazy Routine schedule runtime module is missing ${name}`
      );
    }
  }
  const dailySchedule = module.createDailyRoutineSchedule({
    dailyTime: "09:00",
    timezone: "UTC",
  });
  if (
    dailySchedule.cronExpression !== "0 9 * * *" ||
    dailySchedule.timezone !== "UTC"
  ) {
    throw new Error(
      "Lazy Routine schedule runtime module failed build validation"
    );
  }
}

function importRuntimeModule(output) {
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await buildLazyRuntimeModules();
}
