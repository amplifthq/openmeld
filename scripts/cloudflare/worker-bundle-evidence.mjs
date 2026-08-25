import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
const TOP_INPUT_COUNT = 20;
const WRANGLER_UPLOAD_METRICS_PATTERN =
  /Total Upload:\s+([\d.]+)\s+(KiB|MiB)\s+\/\s+gzip:\s+([\d.]+)\s+(KiB|MiB)/u;

export function parseWranglerUploadMetrics(output) {
  const match = output.match(WRANGLER_UPLOAD_METRICS_PATTERN);
  if (!match) {
    throw new Error("Wrangler output did not include Total Upload metrics");
  }

  return {
    gzipBytes: convertToBytes(Number(match[3]), match[4]),
    uploadBytes: convertToBytes(Number(match[1]), match[2]),
  };
}

export function summarizeMetafileInputs(metafile, forbiddenPatterns = []) {
  const sourceInputs = new Map(
    Object.entries(metafile.inputs ?? {}).map(([inputPath, value]) => [
      inputPath,
      Number(value?.bytes ?? 0),
    ])
  );
  const outputCandidates = Object.entries(metafile.outputs ?? {})
    .map(([outputPath, value]) => ({
      entryPoint: value?.entryPoint,
      inputs: value?.inputs ?? {},
      outputPath,
      totalBytesInOutput: Object.values(value?.inputs ?? {}).reduce(
        (total, input) => total + Number(input?.bytesInOutput ?? 0),
        0
      ),
    }))
    .sort((left, right) => right.totalBytesInOutput - left.totalBytesInOutput);
  const entryOutput =
    outputCandidates.find((candidate) => candidate.entryPoint) ??
    outputCandidates[0];
  if (!entryOutput) {
    throw new Error("Wrangler metafile did not include a Worker output");
  }
  const inputs = Object.entries(entryOutput.inputs)
    .map(([inputPath, value]) => ({
      bytesInOutput: Number(value?.bytesInOutput ?? 0),
      path: inputPath,
      sourceBytes: sourceInputs.get(inputPath) ?? 0,
    }))
    .sort((left, right) => right.bytesInOutput - left.bytesInOutput);
  const forbiddenInputs = forbiddenPatterns.flatMap((pattern) =>
    [...sourceInputs.entries()]
      .filter(([inputPath]) => inputPath.includes(pattern))
      .map(([inputPath, sourceBytes]) => ({
        bytesInOutput: Number(
          entryOutput.inputs[inputPath]?.bytesInOutput ?? 0
        ),
        path: inputPath,
        pattern,
        sourceBytes,
      }))
  );

  return {
    forbiddenInputs,
    inputCount: sourceInputs.size,
    largestInputs: inputs.slice(0, TOP_INPUT_COUNT),
    outputInputCount: inputs.length,
    outputPath: entryOutput.outputPath,
    sourceBytes: [...sourceInputs.values()].reduce(
      (total, bytes) => total + bytes,
      0
    ),
  };
}

export function createWorkerBundleEvidence(input) {
  const inputSummary = summarizeMetafileInputs(
    input.metafile,
    input.forbiddenPatterns
  );
  return {
    bundle: {
      gzipBytes: input.gzipBytes,
      outputBytes: input.outputBytes,
      uploadBytes: input.uploadBytes,
    },
    generatedAt: new Date().toISOString(),
    ...inputSummary,
    schemaVersion: 2,
    worker: input.worker,
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), "openmeld-worker-bundle-")
  );
  const bundleDirectory = path.join(temporaryDirectory, "bundle");
  const metafilePath = path.join(temporaryDirectory, "metafile.json");

  try {
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "deploy",
        "--dry-run",
        "--minify",
        "--config",
        options.config,
        "--env",
        options.environment,
        "--outdir",
        bundleDirectory,
        "--metafile",
        metafilePath,
      ],
      {
        cwd: REPOSITORY_ROOT,
        encoding: "utf8",
        env: process.env,
      }
    );
    const wranglerOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    process.stdout.write(wranglerOutput);
    if (result.status !== 0) {
      throw new Error(
        `Wrangler bundle evidence command failed with exit code ${String(result.status)}`
      );
    }

    const uploadMetrics = parseWranglerUploadMetrics(wranglerOutput);
    const workerOutputPath = findLargestJavaScriptFile(bundleDirectory);
    const workerOutput = readFileSync(workerOutputPath);
    const evidence = createWorkerBundleEvidence({
      forbiddenPatterns: options.forbiddenPatterns,
      gzipBytes: uploadMetrics.gzipBytes,
      metafile: JSON.parse(readFileSync(metafilePath, "utf8")),
      outputBytes: workerOutput.byteLength,
      uploadBytes: uploadMetrics.uploadBytes,
      worker: options.worker,
    });

    mkdirSync(path.dirname(options.output), { recursive: true });
    writeFileSync(options.output, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(
      `[worker-bundle] ${options.worker}: ${String(evidence.bundle.outputBytes)} bytes, gzip ${String(evidence.bundle.gzipBytes)} bytes, ${String(evidence.inputCount)} inputs`
    );
    console.log(`[worker-bundle] evidence: ${options.output}`);

    if (evidence.forbiddenInputs.length > 0) {
      const details = evidence.forbiddenInputs
        .map((entry) => `${entry.pattern}: ${entry.path}`)
        .join("\n");
      throw new Error(`Forbidden Worker bundle inputs detected:\n${details}`);
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function parseArguments(argumentsList) {
  const options = {
    config: "",
    environment: "prod",
    forbiddenPatterns: [],
    output: "",
    worker: "",
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    const value = argumentsList[index + 1];
    if (argument === "--forbid") {
      options.forbiddenPatterns.push(requireArgumentValue(argument, value));
      index += 1;
    } else if (argument === "--config") {
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
    } else if (argument === "--worker") {
      options.worker = requireArgumentValue(argument, value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${String(argument)}`);
    }
  }

  for (const requiredOption of ["config", "output", "worker"]) {
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

function convertToBytes(value, unit) {
  return Math.round(value * (unit === "MiB" ? 1024 * 1024 : 1024));
}

function findLargestJavaScriptFile(directoryPath) {
  const candidates = listFiles(directoryPath)
    .filter((filePath) => filePath.endsWith(".js"))
    .sort((left, right) => statSync(right).size - statSync(left).size);
  if (!candidates[0]) {
    throw new Error("Wrangler did not emit a JavaScript Worker bundle");
  }
  return candidates[0];
}

function listFiles(directoryPath) {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap(
    (entry) => {
      const childPath = path.join(directoryPath, entry.name);
      return entry.isDirectory() ? listFiles(childPath) : [childPath];
    }
  );
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main();
}
