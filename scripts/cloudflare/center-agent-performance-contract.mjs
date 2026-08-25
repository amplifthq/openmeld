import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_PATH = path.join(
  "packages",
  "schemas",
  "src",
  "schemas",
  "http",
  "center-agent-performance.ts"
);

export function readCenterAgentPerformanceContract(input = {}) {
  const repoRoot = input.repoRoot ?? path.resolve(import.meta.dirname, "../..");
  return parseCenterAgentPerformanceContract(
    readFileSync(path.join(repoRoot, SOURCE_PATH), "utf8")
  );
}

export function parseCenterAgentPerformanceContract(source) {
  const blobs = extractConstStringArray(
    source,
    "CENTER_AGENT_PERFORMANCE_ANALYTICS_BLOBS"
  );
  const doubles = extractConstStringArray(
    source,
    "CENTER_AGENT_PERFORMANCE_ANALYTICS_DOUBLES"
  );
  return {
    blobs,
    blobColumns: buildColumnMap(blobs, "blob"),
    doubles,
    doubleColumns: buildColumnMap(doubles, "double"),
  };
}

function extractConstStringArray(source, constName) {
  const pattern = new RegExp(
    `export\\s+const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s+as\\s+const`,
    "u"
  );
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`Missing ${constName} in Center Agent performance schema.`);
  }
  return Array.from(match[1].matchAll(/"([^"]+)"/gu), (entry) => entry[1]);
}

function buildColumnMap(fields, prefix) {
  return new Map(
    fields.map((field, index) => [field, `${prefix}${String(index + 1)}`])
  );
}
