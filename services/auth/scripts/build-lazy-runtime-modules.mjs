#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_OUTPUT_DIRECTORY = path.join(
  AUTH_DIRECTORY,
  "src/generated-runtime"
);

export async function buildLazyRuntimeModules(
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY
) {
  const outputPath = path.join(outputDirectory, "better-auth.mjs");
  const result = await build({
    bundle: true,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    entryPoints: [path.join(AUTH_DIRECTORY, "src/lib/better-auth/index.ts")],
    external: ["cloudflare:*", "node:*"],
    format: "esm",
    legalComments: "eof",
    metafile: true,
    minify: true,
    outfile: outputPath,
    platform: "browser",
    target: "es2022",
    write: false,
  });
  if (result.outputFiles?.length !== 1) {
    throw new Error(
      "Lazy Better Auth runtime build did not produce exactly one module"
    );
  }
  const outputMetadata = Object.values(result.metafile?.outputs ?? {})[0];
  const requiredExports = ["createAuth", "runWithAuthRequestState"];
  const missingExports = requiredExports.filter(
    (exportName) => !outputMetadata?.exports.includes(exportName)
  );
  if (missingExports.length > 0) {
    throw new Error(
      `Lazy Better Auth runtime is missing exports: ${missingExports.join(", ")}`
    );
  }

  const output = result.outputFiles[0].contents;
  const changed = writeOutputIfChanged(outputPath, output);
  console.log(
    `[auth-build] ${changed ? "Generated" : "Reused"} lazy Better Auth runtime (${String(statSync(outputPath).size)} bytes)`
  );
  return { changed, outputPath };
}

function writeOutputIfChanged(outputPath, output) {
  if (existsSync(outputPath) && readFileSync(outputPath).equals(output)) {
    return false;
  }
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryOutputPath = `${outputPath}.${String(process.pid)}.tmp`;
  try {
    writeFileSync(temporaryOutputPath, output);
    renameSync(temporaryOutputPath, outputPath);
  } finally {
    rmSync(temporaryOutputPath, { force: true });
  }
  return true;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await buildLazyRuntimeModules();
}
