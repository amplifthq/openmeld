import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseJsoncObject } from "../../packages/db/src/tooling/parse-jsonc.ts";

const repoRoot = path.resolve(
  process.env.OPENMELD_VERIFICATION_ROOT ??
    path.resolve(import.meta.dirname, "../..")
);
const QUEUE_NOT_FOUND_PATTERN = /Queue(?: "[^"]+")? does not exist/u;

export function collectProductionQueueNames(configInputs) {
  const queueNames = new Set();

  for (const configInput of configInputs) {
    const config = parseJsoncObject(configInput.source);
    const productionConfig = config.env?.prod;
    if (!productionConfig) {
      throw new Error(`${configInput.path} must declare env.prod.`);
    }

    for (const producer of productionConfig.queues?.producers ?? []) {
      addQueueName(queueNames, producer?.queue, configInput.path);
    }
    for (const consumer of productionConfig.queues?.consumers ?? []) {
      addQueueName(queueNames, consumer?.queue, configInput.path);
    }
  }

  return [...queueNames].sort();
}

export async function verifyProductionQueues({
  queueNames,
  runQueueInfo = runWranglerQueueInfo,
}) {
  if (queueNames.length === 0) {
    throw new Error("No production Queue bindings were found.");
  }

  for (const queueName of queueNames) {
    try {
      await runQueueInfo(queueName);
    } catch (error) {
      const causeMessage =
        error instanceof Error ? error.message : String(error);
      if (!QUEUE_NOT_FOUND_PATTERN.test(causeMessage)) {
        throw new Error(
          `Production Queue "${queueName}" could not be verified: ${causeMessage}\nRestore Cloudflare credentials or connectivity, then rerun the guarded release.`,
          { cause: error }
        );
      }
      throw new Error(
        `Production Queue "${queueName}" does not exist: ${causeMessage}\nProvision it with \`pnpm exec wrangler queues create ${queueName}\`, then rerun the guarded release.`,
        { cause: error }
      );
    }
  }
}

function addQueueName(queueNames, queueName, configPath) {
  if (typeof queueName !== "string" || queueName.trim().length === 0) {
    throw new Error(
      `${configPath} contains a production Queue binding without a queue name.`
    );
  }
  queueNames.add(queueName);
}

async function runWranglerQueueInfo(queueName) {
  await new Promise((resolve, reject) => {
    let stderr = "";
    let stdout = "";
    const child = spawn(
      "pnpm",
      ["exec", "wrangler", "queues", "info", queueName],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const details = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
      reject(
        new Error(
          details ||
            (signal
              ? `Wrangler was terminated by ${signal}.`
              : `Wrangler exited with code ${code ?? "unknown"}.`)
        )
      );
    });
  });
}

async function main(configPaths) {
  const normalizedConfigPaths = configPaths.filter(
    (configPath) => configPath !== "--"
  );
  if (normalizedConfigPaths.length === 0) {
    throw new Error(
      "Provide at least one Worker wrangler.jsonc path to verify."
    );
  }

  const configInputs = normalizedConfigPaths.map((configPath) => ({
    path: configPath,
    source: readFileSync(path.resolve(repoRoot, configPath), "utf8"),
  }));
  const queueNames = collectProductionQueueNames(configInputs);

  process.stdout.write(
    `[verify-production-queues] Checking ${queueNames.join(", ")}\n`
  );
  await verifyProductionQueues({ queueNames });
  process.stdout.write("[verify-production-queues] OK\n");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Queue verification failed."
    );
    process.exitCode = 1;
  });
}
