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
const OUTPUT_PATH = path.join(OUTPUT_DIRECTORY, "zep-cloud.mjs");
const TEMPORARY_OUTPUT_PATH = `${OUTPUT_PATH}.${String(process.pid)}.tmp`;

export async function buildLazyRuntimeModules() {
  const zepEntryPath = fileURLToPath(import.meta.resolve("@getzep/zep-cloud"));
  const result = await build({
    bundle: true,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    entryPoints: [zepEntryPath],
    format: "esm",
    legalComments: "eof",
    minify: true,
    outfile: OUTPUT_PATH,
    platform: "browser",
    target: "es2022",
    write: false,
  });
  if (result.outputFiles?.length !== 1) {
    throw new Error(
      "Lazy Zep runtime build did not produce exactly one module"
    );
  }
  const output = result.outputFiles[0].contents;
  await verifyZepRuntimeModule(output);

  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  try {
    writeFileSync(TEMPORARY_OUTPUT_PATH, output);
    renameSync(TEMPORARY_OUTPUT_PATH, OUTPUT_PATH);
  } finally {
    rmSync(TEMPORARY_OUTPUT_PATH, { force: true });
  }

  console.log(
    `[core-build] Generated lazy Zep runtime module (${String(statSync(OUTPUT_PATH).size)} bytes)`
  );
}

async function verifyZepRuntimeModule(output) {
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
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

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await buildLazyRuntimeModules();
}
