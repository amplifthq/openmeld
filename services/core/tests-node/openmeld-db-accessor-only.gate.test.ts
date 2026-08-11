import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Physical DB split static gate (physical-db-split.md Stage B).
//
// Production code must route every shared-DB read through an explicit
// per-domain accessor (localStateDb / wakeEvidenceDb / projectionsDb), never by
// reading the raw OPENMELD_DB binding. This static scan fails the moment a new
// `*.OPENMELD_DB` read appears outside the allowlist, so a hand-written or
// merge-introduced raw binding read cannot silently re-enter the codebase and
// quietly bypass the split routing.

const CORE_SRC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src"
);

// Files where a raw OPENMELD_DB reference is legitimate:
// - lib/bindings.ts: the accessor definitions themselves (`?? env.OPENMELD_DB`).
// - db/runtime-facts.ts: diagnostics that report whether the (legacy shared)
//   OPENMELD_DB binding is present; this is an ops/observability probe, not routing.
const ALLOWLIST = new Set<string>(["lib/bindings.ts", "db/runtime-facts.ts"]);

// Every shape that reads the raw OPENMELD_DB binding instead of a domain accessor:
// property access, bracket access, and object destructuring off the env.
const RAW_OPENMELD_DB_READ_PATTERNS = [
  /\.OPENMELD_DB\b/u, // env.OPENMELD_DB / this.bindings.OPENMELD_DB
  /\[\s*["']OPENMELD_DB["']\s*\]/u, // env["OPENMELD_DB"] / env['OPENMELD_DB']
  /\{[^}]*\bOPENMELD_DB\b[^}]*\}\s*=[^=]/u, // const { OPENMELD_DB } = env
];

function listTypeScriptSources(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") {
        continue;
      }
      files.push(...listTypeScriptSources(full));
      continue;
    }
    if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test-support.ts")
    ) {
      files.push(full);
    }
  }
  return files;
}

describe("physical DB split static gate: no raw OPENMELD_DB reads in production", () => {
  it("only the per-domain accessors (and the diagnostic probe) touch env.OPENMELD_DB", () => {
    const violations: string[] = [];
    for (const file of listTypeScriptSources(CORE_SRC_DIR)) {
      const relative = path.relative(CORE_SRC_DIR, file);
      if (ALLOWLIST.has(relative)) {
        continue;
      }
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (
          RAW_OPENMELD_DB_READ_PATTERNS.some((pattern) => pattern.test(line))
        ) {
          violations.push(`${relative}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
