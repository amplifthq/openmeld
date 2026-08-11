import { readFileSync } from "node:fs";
import path from "node:path";

const OBSERVABILITY_RUNTIME_EVENT_SOURCE = path.join(
  "packages",
  "schemas",
  "src",
  "schemas",
  "http",
  "observability-runtime-event.ts"
);

export function readRuntimeEvidenceAnalyticsContract(input = {}) {
  const repoRoot = input.repoRoot ?? path.resolve(import.meta.dirname, "../..");
  const sourcePath = path.join(repoRoot, OBSERVABILITY_RUNTIME_EVENT_SOURCE);
  const source = readFileSync(sourcePath, "utf8");
  return parseRuntimeEvidenceAnalyticsContract(source);
}

export function parseRuntimeEvidenceAnalyticsContract(source) {
  const blobs = extractConstStringArray(
    source,
    "OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS"
  );
  const doubles = extractConstStringArray(
    source,
    "OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES"
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
    throw new Error(`Missing ${constName} in runtime evidence schema.`);
  }
  return Array.from(match[1].matchAll(/"([^"]+)"/gu), (entry) => entry[1]);
}

function buildColumnMap(fields, prefix) {
  return new Map(
    fields.map((field, index) => [field, `${prefix}${String(index + 1)}`])
  );
}
