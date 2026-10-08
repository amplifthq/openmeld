import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_SOURCE_PATTERN = /\.(?:test|test-support|d)\.ts$/u;

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const owners = [
  "services/core/src",
  "services/auth/src",
  "services/gateway/src",
  "services/remote-agent",
  "packages/auth/src",
];
const forbidden =
  /\b(?:D1Database|D1PreparedStatement|D1Result|OPENMELD_DB|OPENMELD_LOCAL_STATE_DB|OPENMELD_WAKE_EVIDENCE_DB|OPENMELD_PROJECTIONS_DB|OPENMELD_DIAGNOSTICS_DB)\b|drizzle-orm\/d1/u;
function sources(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return [
        "node_modules",
        "dist",
        "tests",
        "__tests__",
        ".wrangler",
      ].includes(entry.name)
        ? []
        : sources(full);
    }
    return entry.name.endsWith(".ts") && !TEST_SOURCE_PATTERN.test(entry.name)
      ? [full]
      : [];
  });
}
describe("shared persistence has one native PostgreSQL runtime", () => {
  it("does not reintroduce D1 bindings, driver types, or a parallel D1 adapter", () => {
    const violations = owners
      .flatMap((owner) => sources(path.join(root, owner)))
      .flatMap((file) =>
        fs
          .readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, index) =>
            forbidden.test(line)
              ? [`${path.relative(root, file)}:${index + 1}: ${line.trim()}`]
              : []
          )
      );
    expect(violations).toEqual([]);
  });
});
