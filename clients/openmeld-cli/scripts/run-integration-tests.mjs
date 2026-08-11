import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SHARD_VALUE_RE = /^(\d+)\/(\d+)$/;

const forwardedArgs = process.argv.slice(2);
const rawVitestArgs =
  forwardedArgs[0] === "--" ? forwardedArgs.slice(1) : forwardedArgs;
const { shard, vitestArgs } = parseShardArgs(rawVitestArgs);
const selectedShardFiles = shard ? selectIntegrationShardFiles(shard) : [];
if (shard) {
  console.error(
    `[openmeld-cli] running integration file shard ${shard.index}/${shard.total} (${selectedShardFiles.length}/${shard.allFiles.length} files)`
  );
}

const child = spawn(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.integration.config.ts",
    ...selectedShardFiles,
    ...vitestArgs,
  ],
  {
    shell: process.platform === "win32",
    stdio: "inherit",
  }
);

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

function parseShardArgs(args) {
  let shard = null;
  const vitestArgs = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--shard") {
      const value = args[index + 1];
      shard = parseShardValue(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--shard=")) {
      shard = parseShardValue(arg.slice("--shard=".length));
      continue;
    }
    vitestArgs.push(arg);
  }
  return { shard, vitestArgs };
}

function parseShardValue(value) {
  const match = SHARD_VALUE_RE.exec(String(value ?? "").trim());
  if (!match) {
    throw new Error("integration test shard must use <index>/<total>");
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (
    !(Number.isSafeInteger(index) && Number.isSafeInteger(total)) ||
    index < 1 ||
    total < 1 ||
    index > total
  ) {
    throw new Error("integration test shard index must be between 1 and total");
  }
  return { index, total, allFiles: listIntegrationTestFiles() };
}

function selectIntegrationShardFiles(shard) {
  return shard.allFiles.filter(
    (_file, fileIndex) => fileIndex % shard.total === shard.index - 1
  );
}

function listIntegrationTestFiles() {
  return listFilesRecursively("tests")
    .filter((file) => file.endsWith(".integration.test.ts"))
    .sort();
}

function listFilesRecursively(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(absolutePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(relative(process.cwd(), absolutePath).split(sep).join("/"));
    }
  }
  return files;
}
